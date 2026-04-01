import OpenAI from "openai";
import type { Chunk } from "./chunker.js";
import type { VectorIndex } from "./embeddings.js";
import { hybridSearch } from "./search.js";

const SYSTEM_PROMPT = `あなたは社内Slackの全チャンネル内容を把握した回答アシスタントです。

## 回答ルール
- 提供されたSlackメッセージに基づき、**簡潔に要点だけ**を回答してください
- 3〜5個の箇条書きで整理。各項目は1〜2文以内
- 情報源の引用は不要（システムが自動付与します）
- 情報がない場合は「該当情報なし」と一言で
- 日本語で回答`;

export interface AnswerResult {
  answer: string;
  sourceCount: number;
  chunks: Chunk[];
}

export async function generateAnswer(
  query: string,
  allChunks: Chunk[],
  vectorIndex: VectorIndex | null,
  _apiKey: string,
  model: string
): Promise<AnswerResult> {
  console.log("[answer] 検索開始...");
  const relevant = await hybridSearch(query, allChunks, vectorIndex, 10);
  console.log(`[answer] 検索完了: ${relevant.length}件`);

  if (relevant.length === 0) {
    return {
      answer: "該当する情報は見つかりませんでした。別のキーワードで試してみてください。",
      sourceCount: 0,
      chunks: [],
    };
  }

  const contextBlocks = relevant
    .slice(0, 8)
    .map((c, i) => `[${i + 1}] #${c.channel} ${c.date}\n${c.text.slice(0, 600)}`);
  const context = contextBlocks.join("\n---\n");

  const client = new OpenAI({
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
    timeout: 60_000,
    maxRetries: 0,
  });

  console.log(`[answer] LLM呼び出し中... (コンテキスト: ${context.length}文字)`);
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${context}\n\n---\n質問: ${query}`,
      },
    ],
  });
  console.log("[answer] LLM応答受信");

  const answer =
    response.choices[0]?.message?.content ?? "回答を生成できませんでした。";

  return { answer, sourceCount: relevant.length, chunks: relevant };
}
