export interface SlackMessage {
  ts: string;
  userId?: string;
  userName: string;
  text: string;
}

export interface NormalizedTopic {
  id: string;
  channelId: string;
  channelLabel: string;
  rootTs: string;
  latestTs: string;
  permalink?: string;
  rootMessage: SlackMessage;
  replies: SlackMessage[];
}

export interface ChannelState {
  lastSyncedAt?: string;
  topics: NormalizedTopic[];
}

export interface PersistedState {
  version: 1;
  channels: Record<string, ChannelState>;
}

export interface DigestWindow {
  startIso: string;
  endIso: string;
  dateLabel: string;
  timezone: string;
}

export interface DigestInsight {
  title?: string;
  summary: string;
  labels?: string[];
  owner?: string;
  due?: string;
  sourceTopicIds: string[];
}

export interface DigestSummary {
  overview: string;
  importantTopics: DigestInsight[];
  decisions: DigestInsight[];
  actionItems: DigestInsight[];
  shares: DigestInsight[];
  openQuestions: DigestInsight[];
}
