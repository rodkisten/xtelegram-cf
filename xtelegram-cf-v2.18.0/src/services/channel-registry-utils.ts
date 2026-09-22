import type { TelegramUpdate } from "../types";
export type ChannelRegistrySource =
  | "configured"
  | "cached"
  | "telegram_api";

const SOURCE_PRIORITY: ChannelRegistrySource[] = [
  "configured",
  "telegram_api",
  "cached",
];

export interface ChannelRegistryEntry {
  key: string;
  channelId: string;
  messageThreadId: number | null;
  name: string | null;
  title: string | null;
  username: string | null;
  source: ChannelRegistrySource;
  sources: ChannelRegistrySource[];
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface RegistryCandidate {
  key: string;
  channelId: string;
  messageThreadId: number | null;
  name?: string | null;
  title?: string | null;
  username?: string | null;
  source: ChannelRegistrySource;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

/**
 * Extracts channel/topic destinations from Telegram Bot API updates.
 *
 * @example
 * Input: a forum-topic update with chat `-100123` and thread `42`.
 * Output: one candidate keyed as `-100123:42`.
 */
export function extractTelegramUpdateCandidates(
  update: TelegramUpdate,
): RegistryCandidate[] {
  const messages = [
    update.message,
    update.edited_message,
    update.channel_post,
    update.edited_channel_post,
  ].filter(Boolean);

  const memberChats = [
    update.my_chat_member?.chat,
    update.chat_member?.chat,
    update.chat_join_request?.chat,
  ].filter(Boolean);

  const seen = new Set<string>();
  const output: RegistryCandidate[] = [];

  for (const message of messages) {
    const chat = message?.chat;
    const channelId = String(chat?.id ?? "").trim();
    const chatType = String(chat?.type || "").toLowerCase();
    if (!/^-?\d+$/.test(channelId)) continue;
    if (chatType && chatType !== "channel" && chatType !== "supergroup") continue;

    const threadId = Number.isSafeInteger(message?.message_thread_id)
      ? Number(message?.message_thread_id)
      : null;
    const key = threadId == null
      ? channelId
      : `${channelId}:${threadId}`;

    if (seen.has(key)) continue;
    seen.add(key);

    const topicName = String(
      message?.forum_topic_created?.name || "",
    ).trim();

    output.push({
      key,
      channelId,
      messageThreadId: threadId,
      name: topicName || null,
      title: String(chat?.title || "").trim() || null,
      username: chat?.username
        ? `@${String(chat.username).replace(/^@+/, "")}`
        : null,
      source: "telegram_api",
      firstSeenAt: updateTimestamp(update),
      lastSeenAt: updateTimestamp(update),
    });
  }

  for (const chat of memberChats) {
    const channelId = String(chat?.id ?? "").trim();
    const chatType = String(chat?.type || "").toLowerCase();
    if (!/^-?\d+$/.test(channelId)) continue;
    if (chatType && chatType !== "channel" && chatType !== "supergroup") continue;

    const key = channelId;
    if (seen.has(key)) continue;
    seen.add(key);

    output.push({
      key,
      channelId,
      messageThreadId: null,
      name: null,
      title: String(chat?.title || "").trim() || null,
      username: chat?.username
        ? `@${String(chat.username).replace(/^@+/, "")}`
        : null,
      source: "telegram_api",
      firstSeenAt: null,
      lastSeenAt: null,
    });
  }

  return output;
}

/**
 * Merges configured, cached, and Telegram API candidates by their canonical
 * `<channel_id>:<message_thread_id>` key while preserving the richest metadata.
 *
 * @example
 * Input: configured and Telegram API candidates for the same topic.
 * Output: one entry with both sources and the API-provided topic name.
 */
export function mergeChannelRegistryCandidates(
  candidates: RegistryCandidate[],
): ChannelRegistryEntry[] {
  const merged = new Map<string, ChannelRegistryEntry>();

  for (const candidate of candidates) {
    const existing = merged.get(candidate.key);

    if (!existing) {
      merged.set(candidate.key, {
        key: candidate.key,
        channelId: candidate.channelId,
        messageThreadId: candidate.messageThreadId,
        name: cleanOptional(candidate.name),
        title: cleanOptional(candidate.title),
        username: cleanUsername(candidate.username),
        source: candidate.source,
        sources: [candidate.source],
        firstSeenAt: candidate.firstSeenAt || null,
        lastSeenAt: candidate.lastSeenAt || null,
      });
      continue;
    }

    if (candidate.name && (
      !existing.name ||
      candidate.source === "telegram_api"
    )) {
      existing.name = candidate.name;
    }

    if (candidate.title && (
      !existing.title ||
      candidate.source === "telegram_api"
    )) {
      existing.title = candidate.title;
    }

    if (candidate.username && (
      !existing.username ||
      candidate.source === "telegram_api"
    )) {
      existing.username = cleanUsername(candidate.username);
    }

    existing.sources = [...new Set([
      ...existing.sources,
      candidate.source,
    ])].sort(compareSources);

    existing.source = preferredSource(existing.sources);

    if (candidate.firstSeenAt && (
      !existing.firstSeenAt ||
      candidate.firstSeenAt < existing.firstSeenAt
    )) {
      existing.firstSeenAt = candidate.firstSeenAt;
    }

    if (candidate.lastSeenAt && (
      !existing.lastSeenAt ||
      candidate.lastSeenAt > existing.lastSeenAt
    )) {
      existing.lastSeenAt = candidate.lastSeenAt;
    }
  }

  return [...merged.values()].sort((left, right) => {
    const sourceDifference =
      sourceRank(left.source) - sourceRank(right.source);
    if (sourceDifference !== 0) return sourceDifference;

    const leftName = left.name || left.title || left.username || left.key;
    const rightName = right.name || right.title || right.username || right.key;
    return leftName.localeCompare(rightName);
  });
}

export function preferredSource(
  sources: ChannelRegistrySource[],
): ChannelRegistrySource {
  for (const source of SOURCE_PRIORITY) {
    if (sources.includes(source)) return source;
  }

  return "cached";
}

function compareSources(
  left: ChannelRegistrySource,
  right: ChannelRegistrySource,
): number {
  return sourceRank(left) - sourceRank(right);
}

function sourceRank(source: ChannelRegistrySource): number {
  return SOURCE_PRIORITY.indexOf(source);
}

export function normalizeSource(value: string): ChannelRegistrySource {
  return SOURCE_PRIORITY.includes(value as ChannelRegistrySource)
    ? value as ChannelRegistrySource
    : "cached";
}

export function parseSources(value: string): ChannelRegistrySource[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ChannelRegistrySource =>
      SOURCE_PRIORITY.includes(item as ChannelRegistrySource),
    );
  } catch {
    return [];
  }
}

function cleanOptional(value?: string | null): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function cleanUsername(value?: string | null): string | null {
  const normalized = String(value || "").trim().replace(/^@+/, "");
  return normalized ? `@${normalized}` : null;
}

function updateTimestamp(update: TelegramUpdate): string {
  const timestamps = [
    update.message?.date,
    update.edited_message?.date,
    update.channel_post?.date,
    update.edited_channel_post?.date,
  ].filter((value): value is number =>
    Number.isFinite(value),
  );

  const unixSeconds = timestamps[0];
  if (unixSeconds) return new Date(unixSeconds * 1000).toISOString();
  return new Date().toISOString();
}
