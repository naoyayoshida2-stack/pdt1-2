# Slack RAG ナレッジくん

社内 Slack のメッセージを同期・蓄積し、自然言語で質問できる RAG チャットボットです。
DM や @メンション で質問すると、関連する過去の Slack メッセージを検索して回答します。

## 主な機能

### 1. RAG チャットボット (`npm run bot`)

- Slack Bot に DM または @メンション で質問すると、過去メッセージを検索して回答
- ハイブリッド検索（キーワード検索 + ベクトル検索）で関連メッセージを取得
- 回答にはソースとなった Slack メッセージへのリンクを自動付与
- LLM は Ollama（ローカル）または Anthropic Claude（API）を選択可能

### 2. Slack メッセージ同期 (`npm run sync`)

- 参加チャンネルのメッセージを Markdown 形式でローカルに保存
- 増分同期（前回以降の新着のみ）と全量同期 (`--full`) に対応
- スレッド返信・添付ファイル名も保存

### 3. 日次ダイジェスト (`npm run digest`)

- 指定チャンネルの前日分メッセージを LLM で要約し、自分宛て DM に送信
- 重要トピック・決定事項・対応が必要なこと・共有事項・未解決事項の 5 分類で整理
- `npm run schedule` で cron による日次自動実行にも対応

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して以下を設定してください。

#### 必須

| 変数 | 説明 |
|---|---|
| `SLACK_BOT_TOKEN` | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_TARGET_CHANNEL_IDS` | ダイジェスト対象チャンネル ID（カンマ区切り） |
| `SLACK_DIGEST_USER_ID` | ダイジェスト送信先ユーザー ID |
| `LLM_API_KEY` | LLM API キー（Ollama 使用時は任意の文字列でOK） |

#### ボット機能用

| 変数 | 説明 |
|---|---|
| `SLACK_APP_TOKEN` | App-Level Token (`xapp-...`)。Socket Mode に必要 |
| `LLM_MODEL` | Ollama モデル名（デフォルト: `gemma3:12b`） |
| `ANTHROPIC_API_KEY` | 設定すると Claude で回答生成。未設定時は Ollama を使用 |
| `ANTHROPIC_MODEL` | Claude モデル名（デフォルト: `claude-sonnet-4-20250514`） |
| `BOT_INCLUDE_CHANNELS` | 検索対象チャンネル名（カンマ区切り）。設定時はこれだけを検索 |
| `BOT_EXCLUDE_CHANNEL_PREFIXES` | 除外チャンネルのプレフィックス（デフォルト: `times_,times-,time-,snack-`） |

#### 同期・ダイジェスト用

| 変数 | 説明 | デフォルト |
|---|---|---|
| `SLACK_USER_TOKEN` | User OAuth Token（スレッド取得に推奨） | - |
| `SYNC_OUTPUT_DIR` | 同期データの保存先 | `slack-data` |
| `SYNC_RATE_LIMIT_MS` | API レート制限の待機時間 (ms) | `1200` |
| `DIGEST_TIMEZONE` | タイムゾーン | `Asia/Tokyo` |
| `DIGEST_CRON` | 日次実行の cron 式 | `0 9 * * *` |
| `DIGEST_MAX_TOPICS` | ダイジェストの最大トピック数 | `80` |

### 3. Slack App の設定

Slack App に以下のスコープとイベントを設定してください。

**Bot Token Scopes:**
- `chat:write` — メッセージ送信
- `channels:history` — パブリックチャンネルの履歴取得
- `groups:history` — プライベートチャンネルの履歴取得
- `im:history` — DM の履歴取得
- `app_mentions:read` — @メンション受信
- `channels:read` — チャンネル情報取得
- `reactions:write` — リアクション（処理中表示）

**Event Subscriptions (Socket Mode):**
- `message.im` — DM でのメッセージ受信
- `app_mention` — チャンネルでの @メンション受信

### 4. Ollama（ローカル LLM を使う場合）

```bash
# Ollama をインストール後
ollama pull gemma3:12b
ollama pull nomic-embed-text
```

## 使い方

### メッセージ同期

```bash
npm run sync            # 増分同期（前回以降の新着のみ）
npm run sync -- --full  # 全量同期
```

### RAG ボット起動

```bash
npm run bot
```

起動後、Slack で Bot に DM を送るか、チャンネルで @メンション すると回答が返ります。

### 日次ダイジェスト

```bash
npm run digest    # 手動実行（前日分）
npm run schedule  # cron による日次自動実行
```

## アーキテクチャ

```
質問テキスト
  ↓
ハイブリッド検索（キーワード 70% + ベクトル 30%）
  ↓
関連チャンク取得（Top 20）
  ↓
LLM で回答生成（Anthropic Claude or Ollama）
  ↓
ソースリンク付きで Slack に投稿
```

**検索の仕組み:**
- キーワード検索: 日本語文字種遷移による分割、複数キーワード同時ヒットのブースト
- ベクトル検索: `nomic-embed-text` による埋め込み（キャッシュ付き）
- 両者をスコア融合してランキング

## 開発

```bash
npm run typecheck  # 型チェック
npm run build      # ビルド
```
