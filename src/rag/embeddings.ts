import fs from "node:fs";
import path from "node:path";
import type { Chunk } from "./chunker.js";

const EMBED_MODEL = "nomic-embed-text";
const OLLAMA_URL = "http://localhost:11434/api/embed";
const BATCH_SIZE = 50;

export interface VectorIndex {
  ids: string[];
  vectors: Float32Array[];
}

export async function buildIndex(
  chunks: Chunk[],
  cacheFile: string
): Promise<VectorIndex> {
  const cached = loadCache(cacheFile, chunks);
  if (cached) return cached;

  console.log(`[embeddings] ${chunks.length} チャンクのベクトル化開始...`);
  const ids: string[] = [];
  const vectors: Float32Array[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.searchText.slice(0, 512));

    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    });

    if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
    const data = (await res.json()) as { embeddings: number[][] };

    for (let j = 0; j < batch.length; j++) {
      ids.push(batch[j].id);
      vectors.push(new Float32Array(data.embeddings[j]));
    }

    if ((i / BATCH_SIZE) % 10 === 0) {
      console.log(
        `[embeddings] ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`
      );
    }
  }

  saveCache(cacheFile, chunks, ids, vectors);
  console.log(`[embeddings] 完了 — キャッシュ保存: ${cacheFile}`);
  return { ids, vectors };
}

export async function embedQuery(text: string): Promise<Float32Array> {
  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: [`search_query: ${text}`],
    }),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
  const data = (await res.json()) as { embeddings: number[][] };
  return new Float32Array(data.embeddings[0]);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function chunkHash(chunks: Chunk[]): string {
  let h = 0;
  for (const c of chunks) h = ((h << 5) - h + c.id.length + c.text.length) | 0;
  return `${chunks.length}_${h}`;
}

function loadCache(
  file: string,
  chunks: Chunk[]
): VectorIndex | null {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (raw.hash !== chunkHash(chunks)) return null;

    const ids: string[] = raw.ids;
    const vectors = (raw.vectors as number[][]).map((v) => new Float32Array(v));
    console.log(`[embeddings] キャッシュから ${ids.length} ベクトルを読み込み`);
    return { ids, vectors };
  } catch {
    return null;
  }
}

function saveCache(
  file: string,
  chunks: Chunk[],
  ids: string[],
  vectors: Float32Array[]
): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const data = {
    hash: chunkHash(chunks),
    ids,
    vectors: vectors.map((v) => Array.from(v)),
  };
  fs.writeFileSync(file, JSON.stringify(data));
}
