import fs from "node:fs";
import path from "node:path";

export interface Chunk {
  id: string;
  channel: string;
  date: string;
  time: string;
  userId: string;
  ts: string;
  text: string;
  searchText: string;
  files: string[];
}

export function loadAllChunks(dataDir: string): Chunk[] {
  const chunks: Chunk[] = [];
  const channels = fs
    .readdirSync(dataDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"));

  for (const ch of channels) {
    const channelDir = path.join(dataDir, ch.name);
    const mdFiles = fs
      .readdirSync(channelDir)
      .filter((f) => f.endsWith(".md"))
      .sort();

    for (const mdFile of mdFiles) {
      const date = mdFile.replace(".md", "");
      const content = fs.readFileSync(path.join(channelDir, mdFile), "utf-8");
      const parsed = parseMarkdownMessages(content, ch.name, date);
      chunks.push(...parsed);
    }
  }

  console.log(
    `[chunker] ${chunks.length} チャンクを ${channels.length} チャンネルから読み込み`
  );
  return chunks;
}

function parseMarkdownMessages(
  content: string,
  channel: string,
  date: string
): Chunk[] {
  const chunks: Chunk[] = [];
  const sections = content.split(/^---$/m);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    const headerMatch = trimmed.match(
      /^##\s+(\d{2}:\d{2})\s+(\S+?)(?:\s+ts:(\S+))?$/m
    );
    if (!headerMatch) continue;

    const time = headerMatch[1];
    const userId = headerMatch[2];
    const ts = headerMatch[3] ?? "";
    const bodyStart = trimmed.indexOf("\n", trimmed.indexOf(headerMatch[0]));
    const body = bodyStart >= 0 ? trimmed.slice(bodyStart).trim() : "";

    if (!body || body.length < 5) continue;

    const text = body.slice(0, 4000);
    const files = extractFileNames(text);
    const searchText = `[チャンネル: #${channel}] [日付: ${date}] [投稿者: ${userId}]\n${text}`;

    chunks.push({
      id: `${channel}/${date}/${time}`,
      channel, date, time, userId, ts, text, searchText, files,
    });
  }

  return chunks;
}

function extractFileNames(text: string): string[] {
  const names: string[] = [];
  const regex = /📎\s+\*?\*?([^*\n]+?)\*?\*?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    names.push(m[1].trim());
  }
  return names;
}
