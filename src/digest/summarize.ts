import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { sortTopicsByLatest } from "../lib/time.js";
import type { DigestSummary, DigestWindow, NormalizedTopic } from "../types.js";

const insightSchema = z.object({
  title: z.string().min(1).optional(),
  summary: z.string().min(1),
  labels: z.array(z.string().min(1)).default([]),
  owner: z.string().min(1).optional(),
  due: z.string().min(1).optional(),
  sourceTopicIds: z.array(z.string().min(1)).default([])
});

const digestSummarySchema = z.object({
  overview: z.string().min(1),
  importantTopics: z.array(insightSchema).default([]),
  decisions: z.array(insightSchema).default([]),
  actionItems: z.array(insightSchema).default([]),
  shares: z.array(insightSchema).default([]),
  openQuestions: z.array(insightSchema).default([])
});

export async function summarizeTopics(input: {
  config: AppConfig;
  topics: NormalizedTopic[];
  window: DigestWindow;
}): Promise<DigestSummary> {
  const { config, topics, window } = input;

  if (topics.length === 0) {
    return {
      overview: "対象期間にダイジェスト化するメッセージはありませんでした。",
      importantTopics: [],
      decisions: [],
      actionItems: [],
      shares: [],
      openQuestions: []
    };
  }

  const selectedTopics = rankTopicsForPrompt(topics).slice(0, config.digest.maxTopics);
  const client = new Anthropic({
    apiKey: config.llm.apiKey
  });

  try {
    const response = await client.messages.create({
      model: config.llm.model,
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildUserPrompt(selectedTopics, window)
        }
      ]
    });
    const textBlock = response.content.find((block) => block.type === "text");
    const rawContent = textBlock?.type === "text" ? textBlock.text : undefined;

    if (!rawContent) {
      throw new Error("LLMから空の応答が返されました。");
    }

    const parsed = parseDigestSummary(rawContent);
    return sanitizeSummary(parsed, selectedTopics);
  } catch (error) {
    console.warn(
      `[summarize] LLM要約に失敗したためフォールバックに切り替えます: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return buildFallbackSummary(selectedTopics);
  }
}

function buildSystemPrompt(): string {
  return [
    "あなたはSlackの会話から業務向け日次ダイジェストを作る日本語アシスタントです。",
    "同じ話題の連投やスレッドは1つのトピックとして統合してください。",
    "雑談は原則除外し、重要トピック・決定事項・依頼/タスク・共有事項・未解決事項だけを抽出してください。",
    "要約は簡潔にし、自然言語部分の総量はだいたい400〜600字に収めてください。",
    "出力はJSONのみで返し、説明文やコードフェンスは不要です。"
  ].join(" ");
}

function buildUserPrompt(topics: NormalizedTopic[], window: DigestWindow): string {
  const formattedTopics = topics
    .map((topic, index) => {
      const replies = topic.replies.length
        ? topic.replies
            .map(
              (reply) =>
                `  - ${reply.userName} (${reply.ts}): ${reply.text}`
            )
            .join("\n")
        : "  - 返信なし";

      return [
        `Topic ${index + 1}`,
        `id: ${topic.id}`,
        `channel: ${topic.channelLabel}`,
        `root_ts: ${topic.rootTs}`,
        `root_author: ${topic.rootMessage.userName}`,
        `root_text: ${topic.rootMessage.text}`,
        `replies:`,
        replies,
        `permalink: ${topic.permalink ?? "N/A"}`
      ].join("\n");
    })
    .join("\n\n");

  return [
    `対象日: ${window.dateLabel} (${window.timezone})`,
    "次のJSONスキーマに厳密に従ってください。",
    `{
  "overview": "string",
  "importantTopics": [{"title":"string","summary":"string","labels":["string"],"sourceTopicIds":["string"]}],
  "decisions": [{"summary":"string","sourceTopicIds":["string"]}],
  "actionItems": [{"summary":"string","owner":"string","due":"string","sourceTopicIds":["string"]}],
  "shares": [{"summary":"string","sourceTopicIds":["string"]}],
  "openQuestions": [{"summary":"string","sourceTopicIds":["string"]}]
}`,
    "labels には `決定` `対応` `確認待ち` `共有` などを必要に応じて入れてください。",
    "sourceTopicIds には、必ず与えられた topic id のみを使ってください。",
    "重要トピックは最大5件、決定事項は最大5件、対応項目は最大8件、共有事項は最大5件、未解決事項は最大5件にしてください。",
    "以下がSlackから抽出したトピック一覧です。",
    formattedTopics
  ].join("\n\n");
}

function parseDigestSummary(rawContent: string): DigestSummary {
  const json = extractJsonObject(rawContent);
  return digestSummarySchema.parse(JSON.parse(json));
}

function extractJsonObject(content: string): string {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("JSONオブジェクトを抽出できませんでした。");
  }

  return content.slice(start, end + 1);
}

function sanitizeSummary(
  summary: DigestSummary,
  topics: NormalizedTopic[]
): DigestSummary {
  const validIds = new Set(topics.map((topic) => topic.id));

  return {
    overview: summary.overview.trim(),
    importantTopics: sanitizeInsights(summary.importantTopics, validIds).slice(0, 5),
    decisions: sanitizeInsights(summary.decisions, validIds).slice(0, 5),
    actionItems: sanitizeInsights(summary.actionItems, validIds).slice(0, 8),
    shares: sanitizeInsights(summary.shares, validIds).slice(0, 5),
    openQuestions: sanitizeInsights(summary.openQuestions, validIds).slice(0, 5)
  };
}

function sanitizeInsights(
  insights: DigestSummary["importantTopics"],
  validIds: Set<string>
): DigestSummary["importantTopics"] {
  return insights
    .map((insight) => ({
      ...insight,
      title: insight.title?.trim(),
      summary: insight.summary.trim(),
      labels: [...new Set((insight.labels ?? []).map((label) => label.trim()).filter(Boolean))],
      sourceTopicIds: [...new Set(insight.sourceTopicIds.filter((id) => validIds.has(id)))]
    }))
    .filter((insight) => insight.summary.length > 0);
}

function buildFallbackSummary(topics: NormalizedTopic[]): DigestSummary {
  const prioritizedTopics = rankTopicsForPrompt(topics).slice(0, 5);

  return {
    overview: `${topics.length}件の話題が見つかりました。以下は返信数と時系列をもとに優先度が高そうな話題です。`,
    importantTopics: prioritizedTopics.map((topic) => ({
      title: buildTopicTitle(topic.rootMessage.text),
      summary: topic.rootMessage.text,
      labels: topic.replies.length > 0 ? ["確認待ち"] : ["共有"],
      sourceTopicIds: [topic.id]
    })),
    decisions: [],
    actionItems: [],
    shares: prioritizedTopics.slice(0, 3).map((topic) => ({
      summary: `${topic.channelLabel}: ${truncate(topic.rootMessage.text, 100)}`,
      sourceTopicIds: [topic.id]
    })),
    openQuestions: prioritizedTopics
      .filter((topic) => /[?？]/.test(topic.rootMessage.text))
      .slice(0, 3)
      .map((topic) => ({
        summary: truncate(topic.rootMessage.text, 100),
        sourceTopicIds: [topic.id]
      }))
  };
}

function rankTopicsForPrompt(topics: NormalizedTopic[]): NormalizedTopic[] {
  return [...sortTopicsByLatest(topics)].sort((left, right) => {
    const leftScore = left.replies.length * 10 + Number(left.latestTs);
    const rightScore = right.replies.length * 10 + Number(right.latestTs);

    return rightScore - leftScore;
  });
}

function buildTopicTitle(text: string): string {
  return truncate(text.replace(/\s+/g, " "), 36);
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}
