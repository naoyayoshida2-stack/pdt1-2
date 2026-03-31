import path from "node:path";

import dotenv from "dotenv";
import { IANAZone } from "luxon";
import { z } from "zod";

dotenv.config({ quiet: true });

const envSchema = z
  .object({
    SLACK_BOT_TOKEN: z.string().min(1, "SLACK_BOT_TOKEN is required"),
    SLACK_USER_TOKEN: z.string().min(1).optional(),
    SLACK_TARGET_CHANNEL_IDS: z
      .string()
      .min(1, "SLACK_TARGET_CHANNEL_IDS is required"),
    SLACK_DIGEST_USER_ID: z.string().min(1, "SLACK_DIGEST_USER_ID is required"),
    LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
    LLM_MODEL: z.string().min(1).default("gpt-4o-mini"),
    LLM_BASE_URL: z.string().url().optional().or(z.literal("")),
    DIGEST_TIMEZONE: z.string().min(1).default("Asia/Tokyo"),
    DIGEST_CRON: z.string().min(1).default("0 9 * * *"),
    STATE_FILE_PATH: z.string().min(1).default(".data/state.json"),
    STATE_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
    DIGEST_MAX_TOPICS: z.coerce.number().int().positive().default(80),
    SYNC_OUTPUT_DIR: z.string().min(1).default("slack-data"),
    SYNC_STATE_FILE_PATH: z.string().min(1).default(".data/sync-state.json"),
    SYNC_RATE_LIMIT_MS: z.coerce.number().int().nonnegative().default(1200),
    SYNC_CHANNEL_NAMES: z.string().default("")
  })
  .transform((env) => ({
    slack: {
      botToken: env.SLACK_BOT_TOKEN,
      userToken: env.SLACK_USER_TOKEN,
      targetChannelIds: env.SLACK_TARGET_CHANNEL_IDS.split(",")
        .map((channelId) => channelId.trim())
        .filter(Boolean),
      digestUserId: env.SLACK_DIGEST_USER_ID
    },
    llm: {
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
      baseUrl: env.LLM_BASE_URL || undefined
    },
    digest: {
      timezone: env.DIGEST_TIMEZONE,
      cron: env.DIGEST_CRON,
      maxTopics: env.DIGEST_MAX_TOPICS
    },
    state: {
      filePath: path.resolve(process.cwd(), env.STATE_FILE_PATH),
      retentionDays: env.STATE_RETENTION_DAYS
    },
    sync: {
      outputDir: path.resolve(process.cwd(), env.SYNC_OUTPUT_DIR),
      stateFilePath: path.resolve(process.cwd(), env.SYNC_STATE_FILE_PATH),
      rateLimitMs: env.SYNC_RATE_LIMIT_MS,
      channelNames: env.SYNC_CHANNEL_NAMES.split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    }
  }));

export type AppConfig = z.output<typeof envSchema>;

export function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => issue.message)
      .join(", ");

    throw new Error(`環境変数の読み込みに失敗しました: ${details}`);
  }

  if (result.data.slack.targetChannelIds.length === 0) {
    throw new Error("SLACK_TARGET_CHANNEL_IDS に最低1つの channel id を指定してください。");
  }

  if (!IANAZone.isValidZone(result.data.digest.timezone)) {
    throw new Error(
      `DIGEST_TIMEZONE が無効です: ${result.data.digest.timezone}`
    );
  }

  return result.data;
}
