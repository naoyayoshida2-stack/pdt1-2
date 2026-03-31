import { WebClient } from "@slack/web-api";

import type { AppConfig } from "../config.js";

export async function sendDigestDm(
  config: AppConfig,
  message: string
): Promise<{ channelId: string; messageTs?: string }> {
  const client = new WebClient(config.slack.botToken);
  const openResponse = await client.conversations.open({
    users: config.slack.digestUserId
  });
  const channelId = openResponse.channel?.id;

  if (!channelId) {
    throw new Error("自分宛てDMのチャンネル作成に失敗しました。");
  }

  const postResponse = await client.chat.postMessage({
    channel: channelId,
    text: message,
    unfurl_links: false,
    unfurl_media: false
  });

  return {
    channelId,
    messageTs: postResponse.ts
  };
}
