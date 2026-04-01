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
  console.log(`[search] キーワード検索: ${keywordResults.length}件ヒット`);

  if (!index) return keywordResults.slice(0, topK);

  const vectorResults = await vectorSearch(query, chunks, index, topK * 2);
  console.log(`[search] ベクトル検索: ${vectorResults.length}件ヒット`);

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
    scoreMap.set(c.id, { chunk: c, score: rank * 0.7 });
  });

  vectorChunks.forEach((c, i) => {
    const rank = 1 / (i + 1);
    const existing = scoreMap.get(c.id);
    if (existing) {
      existing.score += rank * 0.3;
    } else {
      scoreMap.set(c.id, { chunk: c, score: rank * 0.3 });
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

  console.log(`[search] 抽出キーワード: [${terms.join(", ")}]  (bigrams: ${bigrams.length}個)`);

  const scored: ScoredChunk[] = [];

  // Pre-compile regex for short ASCII terms (word boundary match)
  const termMatchers = terms
    .filter((t) => t.length >= 2)
    .map((t) => {
      const isShortAscii = t.length <= 3 && /^[a-z0-9]+$/.test(t);
      return { term: t, regex: isShortAscii ? new RegExp(`(?<![a-z0-9])${t}(?![a-z0-9])`, "g") : null };
    });

  for (const chunk of chunks) {
    const nt = normalize(chunk.searchText);
    let score = 0;
    let matchedTermCount = 0;

    for (const { term, regex } of termMatchers) {
      let termHits = 0;
      if (regex) {
        regex.lastIndex = 0;
        while (regex.exec(nt) !== null) termHits++;
      } else {
        let pos = 0;
        while ((pos = nt.indexOf(term, pos)) >= 0) {
          termHits++;
          pos += term.length;
        }
      }
      if (termHits > 0) {
        score += termHits * term.length * 3;
        matchedTermCount++;
      }
    }

    // Multiple distinct keywords matching the same chunk = much more relevant
    if (matchedTermCount >= 2) {
      score *= 1 + matchedTermCount;
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
  const top = scored.slice(0, topK);
  if (top.length > 0) {
    console.log(`[search] キーワードTop5: ${top.slice(0, 5).map((s) => `#${s.chunk.channel} ${s.chunk.date} ${s.chunk.time} score=${s.score}`).join(" | ")}`);
  }
  return top.map((s) => s.chunk);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    )
    .replace(/\s+/g, " ");
}

function charClass(code: number): number {
  if (code >= 0x30 && code <= 0x39) return 1;   // 0-9
  if (code >= 0x61 && code <= 0x7a) return 1;   // a-z (already lowercased)
  if (code >= 0x3040 && code <= 0x309f) return 2; // hiragana
  if (code >= 0x30a0 && code <= 0x30ff) return 3; // katakana
  if (code >= 0x4e00 && code <= 0x9fff) return 4; // kanji
  if (code >= 0x3400 && code <= 0x4dbf) return 4; // kanji ext
  if (code === 0x3005) return 4; // 々 (kanji iteration mark)
  return 0; // punctuation / other
}

function extractTerms(text: string): string[] {
  // 1. Split on punctuation and whitespace
  const rawSegments = text
    .split(/[\s、。・「」『』（）()\[\]{},:;!?！？\-–—\/\\|？！〜～…＝=#+@<>]+/)
    .filter(Boolean);

  const terms: string[] = [];

  for (const seg of rawSegments) {
    // 2. Split each segment on character class transitions (ASCII↔hiragana↔katakana↔kanji)
    let buf = "";
    let prevCls = -1;
    for (const ch of seg) {
      const cls = charClass(ch.charCodeAt(0));
      if (cls === 0) {
        if (buf) terms.push(buf);
        buf = "";
        prevCls = -1;
        continue;
      }
      if (prevCls >= 0 && cls !== prevCls) {
        if (buf) terms.push(buf);
        buf = ch;
      } else {
        buf += ch;
      }
      prevCls = cls;
    }
    if (buf) terms.push(buf);
  }

  return terms.filter((t) => {
    if (t.length < 2) return false;
    // Pure hiragana terms are almost always grammar (particles, conjugations) — not content words
    if (/^[\u3040-\u309f]+$/.test(t)) return false;
    return true;
  });
}

function toBigrams(text: string): string[] {
  const clean = text.replace(/\s+/g, "");
  const bigrams: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) {
    bigrams.push(clean.slice(i, i + 2));
  }
  return bigrams;
}
