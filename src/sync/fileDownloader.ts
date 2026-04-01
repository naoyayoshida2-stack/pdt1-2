import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SlackFileInfo {
  id: string;
  name: string;
  title: string;
  filetype: string;
  mimetype: string;
  size: number;
  urlPrivateDownload?: string;
  urlPrivate?: string;
}

export interface DownloadedFile {
  info: SlackFileInfo;
  localPath: string;
  buffer: Buffer;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const SUPPORTED_TYPES = new Set([
  "pdf",
  "docx", "doc",
  "xlsx", "xls", "csv",
  "pptx", "ppt",
  "text", "plain", "markdown", "md",
  "html",
  "json", "xml",
]);

export function isSupported(file: SlackFileInfo): boolean {
  if (file.size > MAX_FILE_SIZE) return false;
  if (SUPPORTED_TYPES.has(file.filetype)) return true;
  if (file.mimetype.startsWith("text/")) return true;
  return false;
}

export async function downloadFile(
  file: SlackFileInfo,
  token: string,
  outputDir: string
): Promise<DownloadedFile | null> {
  const url = file.urlPrivateDownload ?? file.urlPrivate;
  if (!url) return null;

  const buffer = await fetchWithRedirect(url, token);
  if (!buffer) {
    console.warn(`[file] ダウンロード失敗: ${file.name}`);
    return null;
  }

  if (looksLikeHtml(buffer)) {
    console.warn(`[file] ダウンロード失敗 (HTML返却): ${file.name}`);
    return null;
  }

  const safeFilename = `${file.id}-${sanitizeFilename(file.name)}`;
  const localPath = path.join(outputDir, safeFilename);

  await mkdir(outputDir, { recursive: true });
  await writeFile(localPath, buffer);

  return { info: file, localPath, buffer };
}

async function fetchWithRedirect(
  url: string,
  token: string
): Promise<Buffer | null> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "manual",
  });

  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get("location");
    if (location) {
      const redirectResp = await fetch(location);
      if (!redirectResp.ok) return null;
      return Buffer.from(await redirectResp.arrayBuffer());
    }
  }

  if (!resp.ok) return null;
  return Buffer.from(await resp.arrayBuffer());
}

function looksLikeHtml(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 50).toString("utf-8").trimStart();
  return head.startsWith("<!DOCTYPE") || head.startsWith("<html");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-\u3000-\u9FFF\uF900-\uFAFF]/g, "_");
}
