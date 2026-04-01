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
  // --- 3Q file: actual PDT2 screens ---
  {
    id: "job-search",
    label: "PDT2 求人検索画面",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "23429:210803",
  },
  {
    id: "favorites",
    label: "PDT2 気になる一覧",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "23429:210616",
  },
  {
    id: "applied-jobs",
    label: "PDT2 応募済み一覧",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "23429:210547",
  },
  {
    id: "job-detail",
    label: "PDT2 求人詳細画面",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "23709:278050",
  },
  {
    id: "location-modal",
    label: "PDT2 勤務地モーダル",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "61264:37539",
  },
  {
    id: "saved-conditions",
    label: "PDT2 保存した条件改善",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "25789:31012",
  },
  {
    id: "sort-recommend",
    label: "PDT2 おすすめ順ソート",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "41754:40340",
  },
  {
    id: "job-post-improve",
    label: "PDT2 求人ポスト改善",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "25947:8297",
  },
  {
    id: "prime-onboarding",
    label: "PDT2 Prime Onboarding 最終デザイン",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "43737:27252",
  },
  {
    id: "home-screen",
    label: "PDT2 ホーム画面",
    fileKey: "CDEyRalwD8SrredRsiRD9r",
    nodeId: "23429:181524",
  },
  // --- 上期 file ---
  {
    id: "search-page",
    label: "PDT2 さがすタブ",
    fileKey: "kvNgQhd2RIntOv88Ghc3wf",
    nodeId: "104160:120729",
  },
  {
    id: "home-nav",
    label: "PDT2 ホーム（ナビ構造変更後）",
    fileKey: "kvNgQhd2RIntOv88Ghc3wf",
    nodeId: "104160:80774",
  },
  {
    id: "location-search",
    label: "PDT2 勤務地検索改修VD",
    fileKey: "kvNgQhd2RIntOv88Ghc3wf",
    nodeId: "17876:16777",
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
  console.log(`  Requesting: ${items.map((i) => i.id).join(", ")}`);

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
      console.warn(`  SKIP: ${item.id} — no image URL`);
      continue;
    }
    const dest = `${OUT_DIR}/${item.id}.png`;
    try {
      const size = await downloadImage(imgUrl, dest);
      console.log(
        `  OK: ${item.id}.png (${item.label}) — ${(size / 1024).toFixed(0)} KB`
      );
    } catch (e) {
      console.error(`  FAIL: ${item.id} — ${e.message}`);
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
    const chunks = [];
    for (let i = 0; i < items.length; i += 3) {
      chunks.push(items.slice(i, i + 3));
    }

    console.log(`File: ${fileKey} (${items.length} frames in ${chunks.length} batches)`);

    for (const chunk of chunks) {
      try {
        await exportBatch(fileKey, chunk);
      } catch (e) {
        console.error(`  Batch error: ${e.message}`);
        console.log("  Waiting 60s for rate limit...");
        await sleep(60000);
        try {
          await exportBatch(fileKey, chunk);
        } catch (e2) {
          console.error(`  Retry failed: ${e2.message}`);
        }
      }
      await sleep(5000);
    }
    console.log();
  }

  console.log("Done! Images saved to:", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
