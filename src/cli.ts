#!/usr/bin/env node

import { runDailyDigest, runScheduledDigest } from "./jobs/runDailyDigest.js";
import { runSync } from "./jobs/runSync.js";

const command = process.argv[2] ?? "digest";
const flags = new Set(process.argv.slice(3));

try {
  switch (command) {
    case "digest": {
      const result = await runDailyDigest();
      console.log(
        `[digest] ${result.date} digest sent to ${result.dmChannelId} (${result.topicCount} topic(s))`
      );
      break;
    }
    case "schedule": {
      await runScheduledDigest();
      break;
    }
    case "sync": {
      const result = await runSync({ full: flags.has("--full") });
      console.log(
        `[sync] 完了: ${result.channelCount} チャンネル, ${result.totalMessages} メッセージ, ${result.totalFiles} ファイル`
      );
      break;
    }
    case "help":
    case "--help":
    case "-h": {
      console.log(
        [
          "Usage:",
          "  npm run digest          前日分のダイジェストを生成しDMへ送信",
          "  npm run schedule        日次スケジュールで自動実行",
          "  npm run sync            増分同期（前回以降の新着のみ）",
          "  npm run sync -- --full  全量同期（全参加チャンネルの全履歴）"
        ].join("\n")
      );
      break;
    }
    default: {
      throw new Error(`未知のコマンドです: ${command}`);
    }
  }
} catch (error) {
  console.error(
    `[cli] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}
