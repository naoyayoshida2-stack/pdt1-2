import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { DateTime } from "luxon";

import type { RawMessage } from "./fetchFullHistory.js";
import type { ExtractedContent } from "./fileExtractor.js";

export type FileContentMap = Map<string, ExtractedContent>;

export async function exportToMarkdown(input: {
  outputDir: string;
  channelName: string;
  messages: RawMessage[];
  timezone: string;
  fileContents?: FileContentMap;
}): Promise<{ filesWritten: number }> {
  const { outputDir, channelName, messages, timezone, fileContents } = input;

  if (messages.length === 0) {
    return { filesWritten: 0 };
  }

  const byDate = groupByDate(messages, timezone);
  const channelDir = path.join(outputDir, sanitizeDirName(channelName));
  await mkdir(channelDir, { recursive: true });

  let filesWritten = 0;

  for (const [date, dayMessages] of byDate) {
    const filePath = path.join(channelDir, `${date}.md`);
    const existingContent = await readFileSafe(filePath);
    const newContent = renderDay(channelName, date, dayMessages, timezone, fileContents);

    if (existingContent) {
      const merged = mergeContent(existingContent, newContent, dayMessages, channelName, date, timezone, fileContents);
      await writeFile(filePath, merged, "utf-8");
    } else {
      await writeFile(filePath, newContent, "utf-8");
    }

    filesWritten++;
  }

  return { filesWritten };
}

export async function writeChannelIndex(input: {
  outputDir: string;
  channels: Array<{ name: string; messageCount: number; lastSyncedAt?: string }>;
}): Promise<void> {
  const { outputDir, channels } = input;
  await mkdir(outputDir, { recursive: true });

  const lines = [
    "# Slack チャンネル一覧",
    "",
    `最終更新: ${new Date().toISOString()}`,
    "",
    "| チャンネル | メッセージ数 | 最終同期 |",
    "|---|---|---|"
  ];

  for (const ch of channels) {
    const syncLabel = ch.lastSyncedAt
      ? DateTime.fromISO(ch.lastSyncedAt).toFormat("yyyy-LL-dd HH:mm")
      : "未同期";
    lines.push(`| [#${ch.name}](./${sanitizeDirName(ch.name)}/) | ${ch.messageCount} | ${syncLabel} |`);
  }

  await writeFile(path.join(outputDir, "_index.md"), lines.join("\n") + "\n", "utf-8");
}

function groupByDate(
  messages: RawMessage[],
  timezone: string
): Map<string, RawMessage[]> {
  const map = new Map<string, RawMessage[]>();

  for (const msg of messages) {
    const date = DateTime.fromSeconds(Number(msg.ts), { zone: "UTC" })
      .setZone(timezone)
      .toFormat("yyyy-LL-dd");

    const bucket = map.get(date) ?? [];
    bucket.push(msg);
    map.set(date, bucket);
  }

  return map;
}

function renderDay(
  channelName: string,
  date: string,
  messages: RawMessage[],
  timezone: string,
  fileContents?: FileContentMap
): string {
  const lines: string[] = [`# #${channelName} - ${date}`, ""];

  for (const msg of messages) {
    const time = formatTime(msg.ts, timezone);
    lines.push(`## ${time} ${msg.userName} ts:${msg.ts}`);
    lines.push(msg.text);

    if (msg.files.length > 0) {
      lines.push("");
      renderFileAttachments(lines, msg.files, fileContents);
    }

    if (msg.replies.length > 0) {
      lines.push("");
      lines.push(`### スレッド (${msg.replies.length}件)`);

      for (const reply of msg.replies) {
        const replyTime = formatTime(reply.ts, timezone);
        lines.push(`- ${replyTime} ${reply.userName}: ${reply.text}`);
        if (reply.files.length > 0) {
          renderFileAttachments(lines, reply.files, fileContents, "  ");
        }
      }
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function renderFileAttachments(
  lines: string[],
  files: RawMessage["files"],
  fileContents?: FileContentMap,
  indent = ""
): void {
  for (const f of files) {
    const extracted = fileContents?.get(f.id);
    if (extracted) {
      lines.push(`${indent}> **📎 ${f.name}** (${f.filetype})`);
      lines.push(`${indent}>`);
      for (const textLine of extracted.text.split("\n").slice(0, 500)) {
        lines.push(`${indent}> ${textLine}`);
      }
      lines.push("");
    } else {
      lines.push(`${indent}📎 *${f.name}* (${f.filetype}, ${formatSize(f.size)})`);
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mergeContent(
  _existing: string,
  _new: string,
  messages: RawMessage[],
  channelName: string,
  date: string,
  timezone: string,
  fileContents?: FileContentMap
): string {
  return renderDay(channelName, date, messages, timezone, fileContents);
}

function formatTime(ts: string, timezone: string): string {
  return DateTime.fromSeconds(Number(ts), { zone: "UTC" })
    .setZone(timezone)
    .toFormat("HH:mm");
}

function sanitizeDirName(name: string): string {
  return name.replace(/[^\w\-.\u3000-\u9FFF\uF900-\uFAFF]/g, "_");
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
