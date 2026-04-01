import { WebClient } from "@slack/web-api";

import type { AppConfig } from "../config.js";
import type { SlackFileInfo } from "./fileDownloader.js";

export interface RawMessage {
  ts: string;
  user?: string;
  userName: string;
  text: string;
  threadTs?: string;
  replyCount: number;
  replies: RawMessage[];
  files: SlackFileInfo[];
}

type SlackFile = {
  id?: string;
  name?: string;
  title?: string;
  filetype?: string;
  mimetype?: string;
  size?: number;
  url_private_download?: string;
  url_private?: string;
  mode?: string;
};

type SlackMsg = {
  ts?: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  bot_profile?: { name?: string };
  hidden?: boolean;
  subtype?: string;
  reply_count?: number;
  files?: SlackFile[];
};

const NOISE_SUBTYPES = new Set([
  "bot_message", "channel_archive", "channel_join", "channel_leave",
  "channel_name", "channel_posting_permissions", "channel_purpose",
  "channel_topic", "channel_unarchive", "group_join", "group_leave",
  "me_message", "pinned_item", "slackbot_response", "unpinned_item"
]);

export async function fetchChannelHistory(input: {
  config: AppConfig;
  channelId: string;
  oldest?: string;
  skipThreads?: boolean;
}): Promise<{ messages: RawMessage[]; latestTs: string }> {
  const { config, channelId, oldest, skipThreads } = input;
  const token = config.slack.userToken ?? config.slack.botToken;
  const client = new WebClient(token, {
    retryConfig: { retries: 3, factor: 2 }
  });
  const userCache = new Map<string, string>();
  const allMessages: RawMessage[] = [];
  let cursor: string | undefined;
  let latestTs = oldest ?? "0";

  do {
    const resp = await client.conversations.history({
      channel: channelId,
      oldest: oldest ?? undefined,
      inclusive: !oldest,
      limit: 200,
      cursor
    });

    for (const msg of (resp.messages ?? []) as SlackMsg[]) {
      if (!msg.ts || msg.hidden) continue;
      if (msg.subtype && NOISE_SUBTYPES.has(msg.subtype)) continue;
      if (msg.thread_ts && msg.thread_ts !== msg.ts) continue;

      const text = cleanText(msg.text);
      if (!text) continue;

      const replies: RawMessage[] = [];
      if (!skipThreads && config.slack.userToken && (msg.reply_count ?? 0) > 0) {
        const threadReplies = await fetchReplies(
          client, channelId, msg.ts, userCache, config.sync.rateLimitMs
        );
        replies.push(...threadReplies);
      }

      allMessages.push({
        ts: msg.ts,
        user: msg.user,
        userName: await resolveUser(client, userCache, msg),
        text,
        threadTs: msg.thread_ts,
        replyCount: msg.reply_count ?? 0,
        replies,
        files: extractFileInfos(msg.files),
      });

      if (Number(msg.ts) > Number(latestTs)) {
        latestTs = msg.ts;
      }
    }

    cursor = resp.response_metadata?.next_cursor || undefined;
    if (cursor) await sleep(config.sync.rateLimitMs);
  } while (cursor);

  allMessages.sort((a, b) => Number(a.ts) - Number(b.ts));
  return { messages: allMessages, latestTs };
}

async function fetchReplies(
  client: WebClient,
  channelId: string,
  rootTs: string,
  userCache: Map<string, string>,
  rateLimitMs: number
): Promise<RawMessage[]> {
  const replies: RawMessage[] = [];
  let cursor: string | undefined;

  do {
    await sleep(rateLimitMs);
    const resp = await client.conversations.replies({
      channel: channelId,
      ts: rootTs,
      limit: 200,
      cursor
    });

    for (const msg of (resp.messages ?? []) as SlackMsg[]) {
      if (msg.ts === rootTs) continue;
      if (!msg.ts || msg.hidden) continue;
      if (msg.subtype && NOISE_SUBTYPES.has(msg.subtype)) continue;

      const text = cleanText(msg.text);
      if (!text) continue;

      replies.push({
        ts: msg.ts,
        user: msg.user,
        userName: await resolveUser(client, userCache, msg),
        text,
        replyCount: 0,
        replies: [],
        files: extractFileInfos(msg.files),
      });
    }

    cursor = resp.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return replies.sort((a, b) => Number(a.ts) - Number(b.ts));
}

async function resolveUser(
  client: WebClient,
  cache: Map<string, string>,
  msg: SlackMsg
): Promise<string> {
  if (msg.user) {
    const cached = cache.get(msg.user);
    if (cached) return cached;

    try {
      const resp = await client.users.info({ user: msg.user });
      const name =
        resp.user?.profile?.display_name ||
        resp.user?.real_name ||
        resp.user?.name ||
        msg.user;
      cache.set(msg.user, name);
      return name;
    } catch {
      cache.set(msg.user, msg.user);
      return msg.user;
    }
  }
  return msg.username || msg.bot_profile?.name || "unknown";
}

function extractFileInfos(files?: SlackFile[]): SlackFileInfo[] {
  if (!files) return [];
  return files
    .filter((f) => f.id && f.mode !== "tombstone")
    .map((f) => ({
      id: f.id!,
      name: f.name ?? "unknown",
      title: f.title ?? f.name ?? "unknown",
      filetype: f.filetype ?? "",
      mimetype: f.mimetype ?? "",
      size: f.size ?? 0,
      urlPrivateDownload: f.url_private_download,
      urlPrivate: f.url_private,
    }));
}

function cleanText(text?: string): string {
  return (text ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
