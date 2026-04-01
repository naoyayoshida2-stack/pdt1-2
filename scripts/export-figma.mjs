import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";

const TOKEN = process.env.FIGMA_TOKEN;
if (!TOKEN) {
  console.error("FIGMA_TOKEN env var is required");
  process.exit(1);
}

const HEADERS = { "X-Figma-Token": TOKEN };
const OUT_DIR = new URL("../images/", import.meta.url).pathname;

const EXPORTS = [
  {
    id: "search-result",
    label: "求人検索結果画面",
    fileKey: "KnXc33c9xzfHVGlkJf6Y7y",
    nodeId: "13009:81495",
  },
  {
    id: "search-condition",
    label: "検索条件保存",
    fileKey: "kvNgQhd2RIntOv88Ghc3wf",
    nodeId: "633:101642",
  },
  {
    id: "job-detail",
    label: "求人詳細画面",
    fileKey: "KnXc33c9xzfHVGlkJf6Y7y",
    nodeId: "7388:89931",
  },
  {
    id: "bulk-apply",
    label: "まとめて応募",
    fileKey: "kvNgQhd2RIntOv88Ghc3wf",
    nodeId: "633:101785",
  },
  {
    id: "resume-edit",
    label: "レジュメ添削確認画面",
    fileKey: "1LFVQaBHp9DJvPvLu80VLZ",
    nodeId: "3781:16471",
  },
  {
    id: "job-filter",
    label: "求人フィルター",
    fileKey: "t1H56uyoSSbvC4uNu0X8mr",
    nodeId: "5436:37696",
  },
  {
    id: "rag-site-top",
    label: "RAGサイトTOP",
    fileKey: "KnXc33c9xzfHVGlkJf6Y7y",
    nodeId: "7375:125974",
  },
  {
    id: "prime-onboarding",
    label: "Prime Onboarding",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "49747:121182",
  },
  {
    id: "ux-flow",
    label: "UXフロー一覧",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "44:169879",
  },
];

async function figmaGet(path) {
  const url = `https://api.figma.com/v1${path}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figma API ${res.status}: ${text}`);
  }
  return res.json();
}

async function downloadImage(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf.length;
}

async function exportBatch(fileKey, items) {
  const nodeIds = items.map((i) => i.nodeId).join(",");
  const data = await figmaGet(
    `/images/${fileKey}?ids=${encodeURIComponent(nodeIds)}&format=png&scale=2`
  );

  if (data.err) {
    console.error(`  Error for ${fileKey}: ${data.err}`);
    return;
  }

  for (const item of items) {
    const imgUrl = data.images?.[item.nodeId];
    if (!imgUrl) {
      console.warn(`  No image URL for ${item.id} (${item.label})`);
      continue;
    }
    const dest = `${OUT_DIR}/${item.id}.png`;
    try {
      const size = await downloadImage(imgUrl, dest);
      console.log(
        `  OK: ${item.id}.png (${item.label}) — ${(size / 1024).toFixed(0)} KB`
      );
    } catch (e) {
      console.error(`  Download failed for ${item.id}: ${e.message}`);
    }
  }
}

async function main() {
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });

  const byFile = new Map();
  for (const item of EXPORTS) {
    if (!byFile.has(item.fileKey)) byFile.set(item.fileKey, []);
    byFile.get(item.fileKey).push(item);
  }

  console.log(
    `Exporting ${EXPORTS.length} frames from ${byFile.size} files...\n`
  );

  for (const [fileKey, items] of byFile) {
    console.log(
      `File: ${fileKey} (${items.length} frames)`
    );
    await exportBatch(fileKey, items);
    console.log();
  }

  console.log("Done! Images saved to:", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
