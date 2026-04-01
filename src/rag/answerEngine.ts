import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Chunk } from "./chunker.js";
import type { VectorIndex } from "./embeddings.js";
import { hybridSearch } from "./search.js";

const ANTHROPIC_SYSTEM_PROMPT = `あなたは社内Slackの全チャンネル内容を把握した、正確で詳細な回答アシスタントです。

## 回答ルール
- 提供されたSlackメッセージを根拠に、正確かつ詳細に回答してください
- 重要な発言は「> 引用文」の形式で直接引用し、投稿者名を明記してください
- 時系列がある場合は日付順に整理してください
- 比較や一覧が適切な場合は表形式でまとめてください
- 複数チャンネルに情報がある場合はチャンネル名を明記してください
- 推測や補足は「※」で明示し、データに基づく事実と区別してください
- 提供されたメッセージの中に直接の答えがなくても、関連する情報があれば共有してください
- Slack の mrkdwn 記法（*bold*, _italic_, ~strike~, \`code\`）で回答してください`;

const OLLAMA_SYSTEM_PROMPT = `あなたは社内Slackのメッセージを検索して回答するアシスタントです。
提供されたSlackメッセージの内容をもとに、質問に日本語で回答してください。
メッセージの内容をそのまま引用しながら、わかりやすくまとめてください。
直接の答えがなくても、関連する情報があればそれを共有してください。`;

export interface AnswerResult {
  answer: string;
  sourceCount: number;
  chunks: Chunk[];
}

export interface LlmConfig {
  anthropicApiKey?: string;
  anthropicModel?: string;
  ollamaModel: string;
}

export async function generateAnswer(
  query: string,
  allChunks: Chunk[],
  vectorIndex: VectorIndex | null,
  llmConfig: LlmConfig
): Promise<AnswerResult> {
  const useAnthropic = !!llmConfig.anthropicApiKey;

  console.log("[answer] 検索開始...");
  const relevant = await hybridSearch(query, allChunks, vectorIndex, 20);
  console.log(`[answer] 検索完了: ${relevant.length}件`);

  if (relevant.length === 0) {
    return {
      answer: "該当する情報は見つかりませんでした。別のキーワードで試してみてください。",
      sourceCount: 0,
      chunks: [],
    };
  }

  for (const c of relevant.slice(0, 5)) {
    console.log(`[answer]   #${c.channel} ${c.date} ${c.time} (${c.text.slice(0, 50)}...)`);
  }

  const maxChunks = useAnthropic ? 15 : 8;
  const maxChars = useAnthropic ? 2000 : 1000;
  const context = buildContext(relevant, maxChunks, maxChars);

  const userMessage = `以下は社内Slackから検索された関連メッセージです。これらの内容をもとに質問に回答してください。\n\n${context}\n\n---\n質問: ${query}`;

  console.log(`[answer] LLM呼び出し中... (provider=${useAnthropic ? "anthropic" : "ollama"}, コンテキスト: ${context.length}文字, ${Math.min(relevant.length, maxChunks)}件)`);

  const answer = useAnthropic
    ? await callAnthropic(userMessage, llmConfig.anthropicApiKey!, llmConfig.anthropicModel ?? "claude-sonnet-4-20250514")
    : await callOllama(userMessage, llmConfig.ollamaModel);

  console.log(`[answer] LLM応答受信 (${answer.length}文字)`);
  return { answer, sourceCount: relevant.length, chunks: relevant };
}

function buildContext(chunks: Chunk[], maxChunks: number, maxChars: number): string {
  return chunks
    .slice(0, maxChunks)
    .map((c, i) => {
      const header = `[${i + 1}] #${c.channel} ${c.date} ${c.time} ${c.userId}`;
      const body = c.text.slice(0, maxChars);
      return `${header}\n${body}`;
    })
    .join("\n---\n");
}

async function callAnthropic(
  userMessage: string,
  apiKey: string,
  model: string
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: ANTHROPIC_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });
  const block = response.content[0];
  return block.type === "text" ? block.text : "回答を生成できませんでした。";
}

async function callOllama(
  userMessage: string,
  model: string
): Promise<string> {
  const client = new OpenAI({
    baseURL: "http://localhost:11434/v1",
    apiKey: "ollama",
    timeout: 120_000,
    maxRetries: 0,
  });
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: OLLAMA_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });
  return response.choices[0]?.message?.content ?? "回答を生成できませんでした。";
}
