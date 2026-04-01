import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { DateTime } from "luxon";

import type { DigestWindow, NormalizedTopic, PersistedState } from "../types.js";
import { topicTouchesWindow } from "../lib/time.js";

const EMPTY_STATE: PersistedState = {
  version: 1,
  channels: {}
};

export class StateStore {
  constructor(
    private readonly filePath: string,
    private readonly retentionDays: number,
    private readonly timezone: string
  ) {}

  async load(): Promise<PersistedState> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content) as PersistedState;

      return {
        version: 1,
        channels: parsed.channels ?? {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(EMPTY_STATE);
      }

      throw error;
    }
  }

  async save(state: PersistedState): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf-8");
  }

  mergeChannelTopics(
    state: PersistedState,
    channelId: string,
    topics: NormalizedTopic[],
    lastSyncedAt: string
  ): void {
    const existing = state.channels[channelId] ?? {
      topics: []
    };
    const nextTopics = new Map(existing.topics.map((topic) => [topic.id, topic]));

    for (const topic of topics) {
      const current = nextTopics.get(topic.id);

      if (!current || shouldReplaceTopic(current, topic)) {
        nextTopics.set(topic.id, topic);
      }
    }

    const cutoff = DateTime.fromISO(lastSyncedAt)
      .setZone(this.timezone)
      .minus({ days: this.retentionDays });
    const prunedTopics = [...nextTopics.values()]
      .filter((topic) => {
        const latest = DateTime.fromSeconds(Number(topic.latestTs), {
          zone: "UTC"
        }).setZone(this.timezone);

        return latest >= cutoff;
      })
      .sort((left, right) => Number(right.latestTs) - Number(left.latestTs));

    state.channels[channelId] = {
      lastSyncedAt,
      topics: prunedTopics
    };
  }

  selectTopicsForWindow(
    state: PersistedState,
    channelIds: string[],
    window: DigestWindow
  ): NormalizedTopic[] {
    return channelIds
      .flatMap((channelId) => state.channels[channelId]?.topics ?? [])
      .filter((topic) => topicTouchesWindow(topic, window))
      .sort((left, right) => Number(right.latestTs) - Number(left.latestTs));
  }
}

function shouldReplaceTopic(
  current: NormalizedTopic,
  incoming: NormalizedTopic
): boolean {
  if (Number(incoming.latestTs) !== Number(current.latestTs)) {
    return Number(incoming.latestTs) > Number(current.latestTs);
  }

  return incoming.replies.length >= current.replies.length;
}
