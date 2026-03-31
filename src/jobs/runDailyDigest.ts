import cron from "node-cron";

import { loadConfig, type AppConfig } from "../config.js";
import { formatDigestForSlack } from "../digest/formatDigest.js";
import { summarizeTopics } from "../digest/summarize.js";
import { buildPreviousDayWindow } from "../lib/time.js";
import { fetchTopicsForDigest } from "../slack/fetchMessages.js";
import { sendDigestDm } from "../slack/sendDm.js";
import { StateStore } from "../store/state.js";

export interface DigestRunResult {
  date: string;
  topicCount: number;
  dmChannelId: string;
  dmMessageTs?: string;
}

export async function runDailyDigest(
  config: AppConfig = loadConfig()
): Promise<DigestRunResult> {
  const window = buildPreviousDayWindow(config.digest.timezone);
  const stateStore = new StateStore(
    config.state.filePath,
    config.state.retentionDays,
    config.digest.timezone
  );
  const state = await stateStore.load();
  const fetched = await fetchTopicsForDigest({
    config,
    state,
    window
  });

  for (const channelId of config.slack.targetChannelIds) {
    stateStore.mergeChannelTopics(
      state,
      channelId,
      fetched.topicsByChannel[channelId] ?? [],
      fetched.lastSyncedAtByChannel[channelId] ?? window.endIso
    );
  }

  const topics = stateStore.selectTopicsForWindow(
    state,
    config.slack.targetChannelIds,
    window
  );
  const summary = await summarizeTopics({
    config,
    topics,
    window
  });
  const message = formatDigestForSlack({
    summary,
    topics,
    window,
    targetChannelIds: config.slack.targetChannelIds
  });
  const dmResult = await sendDigestDm(config, message);

  await stateStore.save(state);

  return {
    date: window.dateLabel,
    topicCount: topics.length,
    dmChannelId: dmResult.channelId,
    dmMessageTs: dmResult.messageTs
  };
}

export async function runScheduledDigest(
  config: AppConfig = loadConfig()
): Promise<void> {
  console.log(
    `[schedule] cron=${config.digest.cron} timezone=${config.digest.timezone}`
  );

  cron.schedule(
    config.digest.cron,
    async () => {
      try {
        const result = await runDailyDigest(config);
        console.log(
          `[schedule] ${result.date} digest sent (${result.topicCount} topic(s))`
        );
      } catch (error) {
        console.error(
          `[schedule] digest failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
    {
      timezone: config.digest.timezone
    }
  );

  await new Promise(() => {
    // Keep the scheduler process alive.
  });
}
