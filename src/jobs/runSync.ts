import path from "node:path";

import { loadConfig, type AppConfig } from "../config.js";
import { discoverAllChannels } from "../slack/discoverChannels.js";
import { fetchChannelHistory, type RawMessage } from "../sync/fetchFullHistory.js";
import { isSupported, downloadFile, type SlackFileInfo } from "../sync/fileDownloader.js";
import { extractText, type ExtractedContent } from "../sync/fileExtractor.js";
import { exportToMarkdown, writeChannelIndex, type FileContentMap } from "../sync/markdownExporter.js";
import { SyncState } from "../sync/syncState.js";

export interface SyncResult {
  channelCount: number;
  totalMessages: number;
  totalFiles: number;
}

export async function runSync(options: {
  full?: boolean;
  config?: AppConfig;
}): Promise<SyncResult> {
  const config = options.config ?? loadConfig();
  const full = options.full ?? false;
  const syncState = new SyncState(config.sync.stateFilePath);
  const state = await syncState.load();

  console.log(`[sync] モード: ${full ? "全量" : "増分"}`);
  console.log("[sync] チャンネル一覧を取得中...");

  const allChannels = await discoverAllChannels(config);
  const channels =
    config.sync.channelNames.length > 0
      ? allChannels.filter((ch) => config.sync.channelNames.includes(ch.name))
      : allChannels;

  console.log(
    `[sync] ${allChannels.length} チャンネル中 ${channels.length} チャンネルを対象に同期`
  );

  let totalMessages = 0;
  let totalFiles = 0;

  for (const ch of channels) {
    const meta = state.channels[ch.id];
    const oldest = full ? undefined : meta?.lastSyncedTs;
    const label = ch.isPrivate ? `🔒#${ch.name}` : `#${ch.name}`;

    console.log(
      `[sync] ${label} を取得中...${oldest ? ` (${oldest} 以降)` : " (全量)"}`
    );

    try {
      const { messages, latestTs } = await fetchChannelHistory({
        config,
        channelId: ch.id,
        oldest,
        skipThreads: full
      });

      if (messages.length === 0) {
        console.log(`[sync] ${label}: 新着メッセージなし`);
        continue;
      }

      const fileContents = await processFiles(
        messages,
        config.slack.userToken ?? config.slack.botToken,
        path.join(config.sync.outputDir, "_files", ch.name),
        config.sync.rateLimitMs
      );

      if (fileContents.size > 0) {
        console.log(
          `[sync] ${label}: ${fileContents.size} ファイルからテキスト抽出完了`
        );
      }

      const { filesWritten } = await exportToMarkdown({
        outputDir: config.sync.outputDir,
        channelName: ch.name,
        messages,
        timezone: config.digest.timezone,
        fileContents,
      });

      syncState.updateChannel(state, ch.id, ch.name, latestTs, messages.length);
      totalMessages += messages.length;
      totalFiles += filesWritten;

      console.log(
        `[sync] ${label}: ${messages.length} メッセージ → ${filesWritten} ファイル`
      );
    } catch (err) {
      console.error(
        `[sync] ${label}: エラー - ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  await writeChannelIndex({
    outputDir: config.sync.outputDir,
    channels: channels.map((ch) => ({
      name: ch.name,
      messageCount: state.channels[ch.id]?.messageCount ?? 0,
      lastSyncedAt: state.channels[ch.id]?.lastSyncedAt
    }))
  });

  await syncState.save(state);

  return {
    channelCount: channels.length,
    totalMessages,
    totalFiles
  };
}

function collectFiles(messages: RawMessage[]): SlackFileInfo[] {
  const files: SlackFileInfo[] = [];
  for (const msg of messages) {
    files.push(...msg.files.filter(isSupported));
    for (const reply of msg.replies) {
      files.push(...reply.files.filter(isSupported));
    }
  }
  return files;
}

async function processFiles(
  messages: RawMessage[],
  token: string,
  filesDir: string,
  rateLimitMs: number
): Promise<FileContentMap> {
  const contentMap: FileContentMap = new Map();
  const allFiles = collectFiles(messages);

  if (allFiles.length === 0) return contentMap;

  console.log(`[file] ${allFiles.length} 件のサポート対象ファイルを処理中...`);

  for (const fileInfo of allFiles) {
    try {
      const downloaded = await downloadFile(fileInfo, token, filesDir);
      if (!downloaded) continue;

      const extracted = await extractText(downloaded);
      if (extracted) {
        contentMap.set(fileInfo.id, extracted);
      }

      await sleep(Math.min(rateLimitMs, 500));
    } catch (err) {
      console.warn(
        `[file] 処理スキップ: ${fileInfo.name} - ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return contentMap;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
