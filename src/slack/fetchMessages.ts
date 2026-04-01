import { WebClient } from "@slack/web-api";
import { DateTime } from "luxon";

import type { AppConfig } from "../config.js";
import type {
  DigestWindow,
  NormalizedTopic,
  PersistedState,
  SlackMessage
} from "../types.js";

type SlackApiMessage = {
  ts?: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  username?: string;
  bot_id?: string;
  hidden?: boolean;
  subtype?: string;
  reply_count?: number;
  bot_profile?: {
    name?: string;
  };
};

const NOISE_SUBTYPES = new Set([
  "bot_message",
  "channel_archive",
  "channel_join",
  "channel_leave",
  "channel_name",
  "channel_posting_permissions",
  "channel_purpose",
  "channel_topic",
  "channel_unarchive",
  "group_join",
  "group_leave",
  "me_message",
  "pinned_item",
  "slackbot_response",
  "thread_broadcast",
  "unpinned_item"
]);

export interface FetchTopicsResult {
  topicsByChannel: Record<string, NormalizedTopic[]>;
  lastSyncedAtByChannel: Record<string, string>;
}

export async function fetchTopicsForDigest(input: {
  config: AppConfig;
  state: PersistedState;
  window: DigestWindow;
}): Promise<FetchTopicsResult> {
  const { config, state, window } = input;
  const readToken = config.slack.userToken ?? config.slack.botToken;
  const readClient = new WebClient(readToken);
  const userNameCache = new Map<string, string>();
  const channelLabelCache = new Map<string, string>();
  const topicsByChannel: Record<string, NormalizedTopic[]> = {};
  const lastSyncedAtByChannel: Record<string, string> = {};
  const latestTs = toSlackTimestamp(window.endIso);

  for (const channelId of config.slack.targetChannelIds) {
    const oldestTs = buildOldestTs(window.startIso, state.channels[channelId]?.lastSyncedAt);
    const channelLabel = await resolveChannelLabel(
      readClient,
      channelId,
      channelLabelCache
    );
    const historyMessages = await fetchHistoryMessages(
      readClient,
      channelId,
      oldestTs,
      latestTs
    );
    const normalizedTopics: NormalizedTopic[] = [];

    for (const message of historyMessages.sort(sortByTimestampAscending)) {
      if (!isRelevantRootMessage(message)) {
        continue;
      }

      const rootMessage = await normalizeMessage(
        readClient,
        userNameCache,
        message
      );
      const replies =
        config.slack.userToken && Number(message.reply_count ?? 0) > 0
          ? await fetchThreadReplies(
              readClient,
              channelId,
              message.ts!,
              userNameCache
            )
          : [];
      const permalink = await resolvePermalink(
        readClient,
        channelId,
        message.ts!
      );
      const latestMessageTs =
        replies.at(-1)?.ts ?? rootMessage.ts;

      normalizedTopics.push({
        id: `${channelId}:${message.ts!}`,
        channelId,
        channelLabel,
        rootTs: message.ts!,
        latestTs: latestMessageTs,
        permalink,
        rootMessage,
        replies
      });
    }

    topicsByChannel[channelId] = normalizedTopics.sort(
      (left, right) => Number(right.latestTs) - Number(left.latestTs)
    );
    lastSyncedAtByChannel[channelId] = window.endIso;
    console.log(
      `[fetch] ${channelLabel}: ${normalizedTopics.length} topic(s) fetched`
    );
  }

  return {
    topicsByChannel,
    lastSyncedAtByChannel
  };
}

function buildOldestTs(windowStartIso: string, lastSyncedAt?: string): string {
  const windowStart = DateTime.fromISO(windowStartIso).toUTC().toSeconds();

  if (!lastSyncedAt) {
    return String(windowStart);
  }

  const lastSynced = DateTime.fromISO(lastSyncedAt).toUTC().toSeconds();
  return String(Math.max(windowStart, lastSynced - 1));
}

function toSlackTimestamp(iso: string): string {
  return String(DateTime.fromISO(iso).toUTC().toSeconds());
}

async function fetchHistoryMessages(
  client: WebClient,
  channelId: string,
  oldest: string,
  latest: string
): Promise<SlackApiMessage[]> {
  const messages: SlackApiMessage[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.conversations.history({
      channel: channelId,
      oldest,
      latest,
      inclusive: true,
      limit: 200,
      cursor
    });

    messages.push(...((response.messages ?? []) as SlackApiMessage[]));
    cursor = response.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return messages;
}

async function fetchThreadReplies(
  client: WebClient,
  channelId: string,
  rootTs: string,
  userNameCache: Map<string, string>
): Promise<SlackMessage[]> {
  const replies: SlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.conversations.replies({
      channel: channelId,
      ts: rootTs,
      inclusive: true,
      limit: 200,
      cursor
    });

    const messages = (response.messages ?? []) as SlackApiMessage[];

    for (const message of messages) {
      if (message.ts === rootTs || !isRelevantReplyMessage(message)) {
        continue;
      }

      replies.push(await normalizeMessage(client, userNameCache, message));
    }

    cursor = response.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return replies.sort(sortByTimestampAscending);
}

async function normalizeMessage(
  client: WebClient,
  userNameCache: Map<string, string>,
  message: SlackApiMessage
): Promise<SlackMessage> {
  return {
    ts: message.ts!,
    userId: message.user,
    userName: await resolveUserName(client, userNameCache, message),
    text: normalizeSlackText(message.text)
  };
}

function isRelevantRootMessage(message: SlackApiMessage): boolean {
  if (!message.ts || message.hidden) {
    return false;
  }

  if (message.thread_ts && message.thread_ts !== message.ts) {
    return false;
  }

  if (message.subtype && NOISE_SUBTYPES.has(message.subtype)) {
    return false;
  }

  return normalizeSlackText(message.text).length > 0;
}

function isRelevantReplyMessage(message: SlackApiMessage): boolean {
  if (!message.ts || message.hidden) {
    return false;
  }

  if (message.subtype && NOISE_SUBTYPES.has(message.subtype)) {
    return false;
  }

  return normalizeSlackText(message.text).length > 0;
}

function normalizeSlackText(text?: string): string {
  return (text ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveUserName(
  client: WebClient,
  cache: Map<string, string>,
  message: SlackApiMessage
): Promise<string> {
  if (message.user) {
    const cached = cache.get(message.user);

    if (cached) {
      return cached;
    }

    try {
      const response = await client.users.info({ user: message.user });
      const resolved =
        response.user?.profile?.display_name ||
        response.user?.real_name ||
        response.user?.name ||
        message.user;

      cache.set(message.user, resolved);
      return resolved;
    } catch {
      cache.set(message.user, message.user);
      return message.user;
    }
  }

  return message.username || message.bot_profile?.name || "unknown";
}

async function resolveChannelLabel(
  client: WebClient,
  channelId: string,
  cache: Map<string, string>
): Promise<string> {
  const cached = cache.get(channelId);

  if (cached) {
    return cached;
  }

  try {
    const response = await client.conversations.info({ channel: channelId });
    const label = response.channel?.name ? `#${response.channel.name}` : channelId;

    cache.set(channelId, label);
    return label;
  } catch {
    cache.set(channelId, channelId);
    return channelId;
  }
}

async function resolvePermalink(
  client: WebClient,
  channelId: string,
  messageTs: string
): Promise<string | undefined> {
  try {
    const response = await client.chat.getPermalink({
      channel: channelId,
      message_ts: messageTs
    });

    return response.permalink;
  } catch {
    return undefined;
  }
}

function sortByTimestampAscending(
  left: SlackApiMessage | SlackMessage,
  right: SlackApiMessage | SlackMessage
): number {
  return Number(left.ts ?? 0) - Number(right.ts ?? 0);
}
