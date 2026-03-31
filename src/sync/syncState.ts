import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface ChannelSyncMeta {
  channelId: string;
  channelName: string;
  lastSyncedTs?: string;
  lastSyncedAt?: string;
  messageCount: number;
}

export interface SyncStateData {
  version: 1;
  channels: Record<string, ChannelSyncMeta>;
}

const EMPTY_STATE: SyncStateData = { version: 1, channels: {} };

export class SyncState {
  constructor(private readonly filePath: string) {}

  async load(): Promise<SyncStateData> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as SyncStateData;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return structuredClone(EMPTY_STATE);
      }
      throw err;
    }
  }

  async save(state: SyncStateData): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf-8");
  }

  updateChannel(
    state: SyncStateData,
    channelId: string,
    channelName: string,
    lastSyncedTs: string,
    messageCount: number
  ): void {
    const existing = state.channels[channelId];
    state.channels[channelId] = {
      channelId,
      channelName,
      lastSyncedTs,
      lastSyncedAt: new Date().toISOString(),
      messageCount: (existing?.messageCount ?? 0) + messageCount
    };
  }
}
