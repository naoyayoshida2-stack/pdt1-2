import type { DownloadedFile } from "./fileDownloader.js";

export interface ExtractedContent {
  fileId: string;
  fileName: string;
  fileType: string;
  text: string;
}

const TEXT_LIMIT = 100_000;

export async function extractText(
  file: DownloadedFile
): Promise<ExtractedContent | null> {
  const ft = file.info.filetype.toLowerCase();

  try {
    let text: string | null = null;

    if (ft === "pdf") {
      text = await extractPdf(file.buffer);
    } else if (ft === "docx") {
      text = await extractDocx(file.buffer);
    } else if (ft === "xlsx" || ft === "xls" || ft === "csv") {
      text = await extractSpreadsheet(file.buffer);
    } else if (ft === "pptx") {
      text = await extractPptx(file.buffer);
    } else if (isPlainText(ft, file.info.mimetype)) {
      text = file.buffer.toString("utf-8");
    }

    if (!text || text.trim().length === 0) return null;

    const trimmed = text.length > TEXT_LIMIT
      ? text.slice(0, TEXT_LIMIT) + "\n\n[... テキストが長いため省略 ...]"
      : text;

    return {
      fileId: file.info.id,
      fileName: file.info.name,
      fileType: ft,
      text: trimmed.trim(),
    };
  } catch (err) {
    console.warn(
      `[file] テキスト抽出失敗: ${file.info.name} - ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

async function extractPdf(buffer: Buffer): Promise<string | null> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  parser.destroy();
  return (result as { text?: string }).text ?? null;
}

async function extractDocx(buffer: Buffer): Promise<string | null> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractSpreadsheet(buffer: Buffer): Promise<string | null> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    lines.push(`[シート: ${sheetName}]`);
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    lines.push(csv);
    lines.push("");
  }

  return lines.join("\n");
}

async function extractPptx(buffer: Buffer): Promise<string | null> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideTexts: string[] = [];

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0");
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0");
      return numA - numB;
    });

  for (const slidePath of slideFiles) {
    const xml = await zip.files[slidePath].async("text");
    const text = extractTextFromXml(xml);
    if (text) {
      const slideNum = slidePath.match(/slide(\d+)/)?.[1] ?? "?";
      slideTexts.push(`[スライド ${slideNum}]`);
      slideTexts.push(text);
      slideTexts.push("");
    }
  }

  return slideTexts.join("\n");
}

function extractTextFromXml(xml: string): string {
  const texts: string[] = [];
  const tagRegex = /<a:t>([^<]*)<\/a:t>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(xml)) !== null) {
    if (match[1]) texts.push(match[1]);
  }
  return texts.join(" ");
}

function isPlainText(filetype: string, mimetype: string): boolean {
  const textTypes = new Set([
    "text", "plain", "markdown", "md", "html", "json", "xml", "csv",
  ]);
  return textTypes.has(filetype) || mimetype.startsWith("text/");
}
