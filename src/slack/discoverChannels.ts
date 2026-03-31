import { WebClient } from "@slack/web-api";

import type { AppConfig } from "../config.js";

export interface DiscoveredChannel {
  id: string;
  name: string;
  isMember: boolean;
  isPrivate: boolean;
  numMembers: number;
}

export async function discoverAllChannels(
  config: AppConfig
): Promise<DiscoveredChannel[]> {
  const token = config.slack.userToken ?? config.slack.botToken;
  const client = new WebClient(token);
  const channels: DiscoveredChannel[] = [];
  let cursor: string | undefined;

  do {
    const response = await client.users.conversations({
      user: config.slack.digestUserId,
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 100,
      cursor
    });

    for (const ch of response.channels ?? []) {
      if (ch.id && ch.name) {
        channels.push({
          id: ch.id,
          name: ch.name,
          isMember: true,
          isPrivate: ch.is_private ?? false,
          numMembers: (ch as Record<string, unknown>).num_members as number ?? 0
        });
      }
    }

    cursor = response.response_metadata?.next_cursor || undefined;
    if (cursor) await sleep(3000);
  } while (cursor);

  return channels.sort((a, b) => a.name.localeCompare(b.name));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
