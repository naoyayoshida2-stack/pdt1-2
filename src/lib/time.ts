import { DateTime } from "luxon";

import type { DigestWindow, NormalizedTopic } from "../types.js";

export function buildPreviousDayWindow(timezone: string): DigestWindow {
  const end = DateTime.now().setZone(timezone).startOf("day");
  const start = end.minus({ days: 1 });

  return {
    startIso: start.toISO() ?? start.toISO({ suppressMilliseconds: false })!,
    endIso: end.toISO() ?? end.toISO({ suppressMilliseconds: false })!,
    dateLabel: start.toFormat("yyyy-LL-dd"),
    timezone
  };
}

export function slackTsToDateTime(ts: string, timezone = "UTC"): DateTime {
  return DateTime.fromSeconds(Number(ts), { zone: "UTC" }).setZone(timezone);
}

export function topicTouchesWindow(
  topic: NormalizedTopic,
  window: DigestWindow
): boolean {
  const start = DateTime.fromISO(window.startIso);
  const end = DateTime.fromISO(window.endIso);
  const messageTimestamps = [topic.rootMessage.ts, ...topic.replies.map((reply) => reply.ts)];

  return messageTimestamps.some((ts) => {
    const current = DateTime.fromSeconds(Number(ts), { zone: "UTC" });
    return current >= start && current < end;
  });
}

export function formatSlackLinkLabel(ts: string, timezone: string): string {
  return slackTsToDateTime(ts, timezone).toFormat("LL/dd HH:mm");
}

export function sortTopicsByLatest(topics: NormalizedTopic[]): NormalizedTopic[] {
  return [...topics].sort((left, right) => Number(right.latestTs) - Number(left.latestTs));
}
