# Slack日次DM整理ツール

指定したSlackチャンネルの前日分メッセージを読み取り、LLMで整理した日次ダイジェストを自分宛てDMへ送るMVPです。

## できること

- `conversations.history` で指定チャンネルのメッセージを取得
- `conversations.replies` でスレッド返信を補完
- ノイズになりやすい join/leave や一部bot通知を除外
- LLMで以下の5分類に整理
  - 重要トピック
  - 決定事項
  - 対応が必要なこと
  - 共有事項
  - 未解決事項
- Slack permalink を付けて元投稿へ戻れるように整形
- `.data/state.json` に `lastSyncedAt` とトピックキャッシュを保存
- `npm run digest` の手動実行と `npm run schedule` の日次実行に対応

## 前提

- Slack App を作成済みであること
- 対象チャンネルにアプリまたは user token がアクセスできること
- LLM API キーを用意できること

## 必要スコープ

### 読み取り

- `channels:history`
- `groups:history`
- 必要に応じて `im:history`
- 必要に応じて `mpim:history`
- `users:read`

### 送信

- `chat:write`
- `im:write`

## token の使い分け

- 推奨
  - 読み取り: `SLACK_USER_TOKEN`
  - 送信: `SLACK_BOT_TOKEN`
- フォールバック
  - `SLACK_USER_TOKEN` が無い場合は親メッセージ中心で要約します
  - スレッド返信の取得は `SLACK_USER_TOKEN` がある前提です

## セットアップ

このプロジェクトではローカル実行用に `./.tools/node` を同梱しています。システムに `node` / `npm` が入っていない場合は、以下のどちらかで実行してください。

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
npm install
```

または

```bash
./.tools/node/bin/npm install
```

`.env` を作成します。

```bash
cp .env.example .env
```

最低限、以下を設定してください。

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_USER_TOKEN=xoxp-...
SLACK_TARGET_CHANNEL_IDS=C0123456789,C0987654321
SLACK_DIGEST_USER_ID=U0123456789
LLM_API_KEY=...
LLM_MODEL=gpt-4o-mini
DIGEST_TIMEZONE=Asia/Tokyo
```

任意で以下も使えます。

```env
LLM_BASE_URL=
DIGEST_CRON=0 9 * * *
STATE_FILE_PATH=.data/state.json
STATE_RETENTION_DAYS=14
DIGEST_MAX_TOPICS=80
```

## 実行方法

### 1. 手動実行

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
npm run digest
```

前日分のダイジェストを生成し、自分宛てDMに送信します。

### 2. 日次スケジュール実行

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
npm run schedule
```

`DIGEST_CRON` と `DIGEST_TIMEZONE` を使って定時実行します。

## 保存される状態

- 既定では `.data/state.json`
- チャンネルごとの `lastSyncedAt`
- 取得済みトピックのキャッシュ

これにより、2回目以降は前回同期時刻以降だけを取り込みます。

## 注意点

- `conversations.replies` は公開/非公開チャンネルのスレッド取得で token 種別に制約があります
- まずは 1〜3 チャンネルから始めるのがおすすめです
- LLM 出力が崩れた場合は簡易フォールバック要約に切り替えます

## 開発コマンド

```bash
export PATH="$PWD/.tools/node/bin:$PATH"
npm run typecheck
npm run build
```
