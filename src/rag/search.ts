import type { Chunk } from "./chunker.js";
import type { VectorIndex } from "./embeddings.js";
import { embedQuery, cosineSimilarity } from "./embeddings.js";

interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

export async function hybridSearch(
  query: string,
  chunks: Chunk[],
  index: VectorIndex | null,
  topK: number = 20
): Promise<Chunk[]> {
  const keywordResults = keywordSearch(query, chunks, topK * 2);

  if (!index) return keywordResults.slice(0, topK);

  const vectorResults = await vectorSearch(query, chunks, index, topK * 2);

  const combined = mergeResults(keywordResults, vectorResults, chunks, topK);
  return combined;
}

function mergeResults(
  keywordChunks: Chunk[],
  vectorChunks: Chunk[],
  _allChunks: Chunk[],
  topK: number
): Chunk[] {
  const scoreMap = new Map<string, { chunk: Chunk; score: number }>();

  keywordChunks.forEach((c, i) => {
    const rank = 1 / (i + 1);
    scoreMap.set(c.id, { chunk: c, score: rank * 0.4 });
  });

  vectorChunks.forEach((c, i) => {
    const rank = 1 / (i + 1);
    const existing = scoreMap.get(c.id);
    if (existing) {
      existing.score += rank * 0.6;
    } else {
      scoreMap.set(c.id, { chunk: c, score: rank * 0.6 });
    }
  });

  return [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.chunk);
}

async function vectorSearch(
  query: string,
  chunks: Chunk[],
  index: VectorIndex,
  topK: number
): Promise<Chunk[]> {
  const qVec = await embedQuery(query);
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  const scored: ScoredChunk[] = [];
  for (let i = 0; i < index.ids.length; i++) {
    const chunk = chunkMap.get(index.ids[i]);
    if (!chunk) continue;
    scored.push({ chunk, score: cosineSimilarity(qVec, index.vectors[i]) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.chunk);
}

function keywordSearch(query: string, chunks: Chunk[], topK: number): Chunk[] {
  const nq = normalize(query);
  const terms = extractTerms(nq);
  const bigrams = toBigrams(nq);

  const scored: ScoredChunk[] = [];

  for (const chunk of chunks) {
    const nt = normalize(chunk.searchText);
    let score = 0;

    for (const term of terms) {
      if (term.length < 2) continue;
      let pos = 0;
      while ((pos = nt.indexOf(term, pos)) >= 0) {
        score += term.length;
        pos += term.length;
      }
    }

    if (bigrams.length > 0) {
      const textBigrams = new Set(toBigrams(nt));
      for (const bg of bigrams) {
        if (textBigrams.has(bg)) score += 1;
      }
    }

    if (score > 0) scored.push({ chunk, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.chunk);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/\s+/g, " ");
}

function extractTerms(text: string): string[] {
  return text
    .split(/[\s、。・「」『』（）()【】\[\]{},:;!?！？\-–—\/\\|]+/)
    .filter((t) => t.length >= 2);
}

function toBigrams(text: string): string[] {
  const clean = text.replace(/\s+/g, "");
  const bigrams: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) {
    bigrams.push(clean.slice(i, i + 2));
  }
  return bigrams;
}
