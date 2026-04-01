import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type { KnownBlock } from "@slack/web-api";
import { loadAllChunks } from "../rag/chunker.js";
import type { Chunk } from "../rag/chunker.js";
import { buildIndex } from "../rag/embeddings.js";
import { generateAnswer } from "../rag/answerEngine.js";
import type { LlmConfig } from "../rag/answerEngine.js";

interface BotConfig {
  botToken: string;
  appToken: string;
  llmConfig: LlmConfig;
  dataDir: string;
  cacheFile: string;
  excludeChannelPrefixes: string[];
  includeChannels: string[];
}

type ChannelMap = Map<string, string>;

export async function startBot(config: BotConfig): Promise<void> {
  console.log("[bot] チャンクを読み込み中...");
  const allChunks = loadAllChunks(config.dataDir);

  console.log("[bot] ベクトルインデックスを構築中...");
  const vectorIndex = await buildIndex(allChunks, config.cacheFile);

  let chunks: Chunk[];
  if (config.includeChannels.length > 0) {
    const allowed = new Set(config.includeChannels);
    chunks = allChunks.filter((c) => allowed.has(c.channel));
    console.log(`[bot] 許可チャンネルフィルタ: ${allChunks.length} → ${chunks.length} チャンク (対象: ${config.includeChannels.join(", ")})`);
  } else {
    const prefixes = config.excludeChannelPrefixes;
    chunks = prefixes.length > 0
      ? allChunks.filter((c) => !prefixes.some((p) => c.channel.startsWith(p)))
      : allChunks;
    if (chunks.length < allChunks.length) {
      console.log(`[bot] 除外チャンネルフィルタ: ${allChunks.length} → ${chunks.length} チャンク (除外: ${prefixes.join(", ")})`);
    }
  }

  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    socketMode: true,
    logLevel: LogLevel.WARN,
  });

  let channelMap: ChannelMap = new Map();
  let workspaceUrl = "";

  // チャンネルID解決を非同期で実行（起動をブロックしない）
  (async () => {
    console.log("[bot] チャンネルID解決中（バックグラウンド）...");
    channelMap = await resolveChannelIds(app.client, chunks);
    workspaceUrl = await getWorkspaceUrl(app.client);
    console.log("[bot] チャンネルID解決完了");
  })().catch((e) => console.warn("[bot] チャンネルID解決に失敗:", e));

  async function handleQuestion(
    client: WebClient,
    channel: string,
    ts: string,
    threadTs: string | undefined,
    rawText: string
  ): Promise<void> {
    const query = rawText.replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!query) return;

    console.log(`[bot] 質問受信: "${query.slice(0, 60)}"`);

    try {
      await client.reactions.add({ channel, timestamp: ts, name: "hourglass_flowing_sand" });
    } catch { /* non-critical */ }

    try {
      const result = await generateAnswer(
        query, chunks, vectorIndex, config.llmConfig
      );
      const blocks = buildBlocks(result.answer, result.chunks, channelMap, workspaceUrl);

      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: result.answer,
        blocks,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error("[bot] エラー:\n", msg);
      try {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: `エラーが発生しました: ${err instanceof Error ? err.message : "不明なエラー"}\nもう一度お試しください。`,
        });
      } catch (postErr) {
        console.error("[bot] エラーメッセージ送信にも失敗:", postErr);
      }
    } finally {
      try {
        await client.reactions.remove({ channel, timestamp: ts, name: "hourglass_flowing_sand" });
      } catch { /* ignore */ }
    }
  }

  // DM
  app.message(async ({ message, client }) => {
    console.log(`[bot] message イベント受信: channel=${message.channel} type=${message.channel_type ?? "unknown"}`);
    if (!message.channel.startsWith("D")) return;
    if (!("text" in message) || !message.text) return;
    await handleQuestion(client, message.channel, message.ts, undefined, message.text);
  });

  // チャンネルでの @メンション
  app.event("app_mention", async ({ event, client }) => {
    console.log(`[bot] app_mention イベント受信: channel=${event.channel}`);
    if (!event.text) return;
    await handleQuestion(client, event.channel, event.ts, event.ts, event.text);
  });

  await app.start();
  console.log(
    `[bot] 起動完了 — ${chunks.length} チャンク + ベクトル検索で待機中`
  );
}

function buildBlocks(
  answer: string,
  chunks: Chunk[],
  channelMap: ChannelMap,
  workspaceUrl: string
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  blocks.push({
    type: "section" as const,
    text: { type: "mrkdwn" as const, text: answer.slice(0, 3000) },
  });

  const sourceLinks = buildSourceLinks(chunks, channelMap, workspaceUrl);
  if (sourceLinks.length > 0) {
    blocks.push({ type: "divider" as const });
    blocks.push({
      type: "context" as const,
      elements: [
        { type: "mrkdwn" as const, text: `📌 *ソース*  ${sourceLinks.join("  |  ")}` },
      ],
    });
  }

  const allFiles = collectFiles(chunks);
  if (allFiles.length > 0) {
    blocks.push({
      type: "context" as const,
      elements: [
        { type: "mrkdwn" as const, text: `📎 *参照ファイル*  ${allFiles.join("、")}` },
      ],
    });
  }

  return blocks;
}

function buildSourceLinks(
  chunks: Chunk[],
  channelMap: ChannelMap,
  workspaceUrl: string
): string[] {
  const seen = new Set<string>();
  const links: string[] = [];

  for (const c of chunks.slice(0, 8)) {
    const key = `${c.channel}/${c.date}/${c.time}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const chId = channelMap.get(c.channel);
    if (chId && c.ts) {
      const tsNoDoc = c.ts.replace(".", "");
      const url = `https://${workspaceUrl}/archives/${chId}/p${tsNoDoc}`;
      links.push(`<${url}|#${c.channel} ${c.date} ${c.time}>`);
    } else if (chId) {
      links.push(`<#${chId}|${c.channel}> ${c.date} ${c.time}`);
    } else {
      links.push(`#${c.channel} ${c.date} ${c.time}`);
    }

    if (links.length >= 5) break;
  }

  return links;
}

function collectFiles(chunks: Chunk[]): string[] {
  const files = new Set<string>();
  for (const c of chunks.slice(0, 15)) {
    for (const f of c.files) {
      files.add(f);
      if (files.size >= 5) return [...files];
    }
  }
  return [...files];
}

async function resolveChannelIds(
  client: WebClient,
  chunks: Chunk[]
): Promise<ChannelMap> {
  const map: ChannelMap = new Map();
  const needed = new Set(chunks.map((c) => c.channel));

  try {
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await client.conversations.list({
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 1000,
        cursor,
      });
      for (const ch of res.channels ?? []) {
        if (ch.name && ch.id && needed.has(ch.name)) {
          map.set(ch.name, ch.id);
        }
      }
      cursor = res.response_metadata?.next_cursor || undefined;
      pages++;
      if (map.size >= needed.size || pages >= 10) break;
    } while (cursor);
    console.log(`[bot] ${map.size}/${needed.size} チャンネルIDを解決`);
  } catch (e) {
    console.warn("[bot] チャンネルID解決に失敗（リンクなしで動作）:", e);
  }
  return map;
}

async function getWorkspaceUrl(client: WebClient): Promise<string> {
  try {
    const res = await client.auth.test();
    const url = (res.url as string) ?? "";
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  } catch {
    return "slack.com";
  }
}
