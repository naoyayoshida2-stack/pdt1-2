import { formatSlackLinkLabel } from "../lib/time.js";
import type { DigestSummary, DigestWindow, NormalizedTopic } from "../types.js";

export function formatDigestForSlack(input: {
  summary: DigestSummary;
  topics: NormalizedTopic[];
  window: DigestWindow;
  targetChannelIds: string[];
}): string {
  const { summary, topics, window, targetChannelIds } = input;
  const topicMap = new Map(topics.map((topic) => [topic.id, topic]));
  const channelLabels = [...new Set(topics.map((topic) => topic.channelLabel))];
  const targetLabel =
    channelLabels.length > 0 ? channelLabels.join(", ") : targetChannelIds.join(", ");
  const lines: string[] = [];

  lines.push(`*Slack 日次ダイジェスト* ${window.dateLabel}`);
  lines.push(`対象チャンネル: ${targetLabel}`);
  lines.push("");
  lines.push("*今日の要点*");
  lines.push(summary.overview);
  lines.push("");

  appendInsightSection(lines, "重要トピック", summary.importantTopics, topicMap, true, window);
  appendInsightSection(lines, "決定事項", summary.decisions, topicMap, false, window);
  appendInsightSection(lines, "対応が必要なこと", summary.actionItems, topicMap, false, window);
  appendInsightSection(lines, "共有事項", summary.shares, topicMap, false, window);
  appendInsightSection(lines, "未解決事項", summary.openQuestions, topicMap, false, window);

  return lines.join("\n").trim();
}

function appendInsightSection(
  lines: string[],
  title: string,
  insights: DigestSummary["importantTopics"],
  topicMap: Map<string, NormalizedTopic>,
  numbered: boolean,
  window: DigestWindow
): void {
  lines.push(`*${title}*`);

  if (insights.length === 0) {
    lines.push("・該当なし");
    lines.push("");
    return;
  }

  insights.forEach((insight, index) => {
    const prefix = numbered ? `${index + 1}. ` : "・";
    const titleText = insight.title ? `*${insight.title}* ` : "";
    const labels =
      insight.labels && insight.labels.length > 0
        ? insight.labels.map((label) => `\`${label}\``).join(" ")
        : "";
    const ownerText = insight.owner ? ` 担当: ${insight.owner}` : "";
    const dueText = insight.due ? ` 期限: ${insight.due}` : "";

    lines.push(
      `${prefix}${titleText}${insight.summary}${labels ? ` ${labels}` : ""}${ownerText}${dueText}`
    );

    const sources = formatSources(insight.sourceTopicIds, topicMap, window.timezone);

    if (sources) {
      lines.push(`  出典: ${sources}`);
    }
  });

  lines.push("");
}

function formatSources(
  sourceTopicIds: string[],
  topicMap: Map<string, NormalizedTopic>,
  timezone: string
): string {
  return sourceTopicIds
    .map((topicId) => topicMap.get(topicId))
    .filter((topic): topic is NormalizedTopic => Boolean(topic))
    .map((topic) => {
      const label = `${topic.channelLabel} ${formatSlackLinkLabel(topic.rootTs, timezone)}`;

      return topic.permalink ? `<${topic.permalink}|${label}>` : label;
    })
    .join(", ");
}
