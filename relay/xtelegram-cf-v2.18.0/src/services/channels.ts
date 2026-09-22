import type { Env } from "../types";

export interface TelegramDestination {
  chatId: string;
  messageThreadId: number | null;
  /** Canonical dedupe/persistence key: <chat_id> or <chat_id>:<message_thread_id>. */
  key: string;
}

let cachedRawMap = "";
let cachedUsernameMap = new Map<string, string[]>();

export function resolveDefaultTelegramChatId(env: Env): string | undefined {
  const value = String(env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHANNEL_ID || "").trim();
  return value || undefined;
}

/**
 * Parse a compact Telegram destination. Numeric chat IDs may optionally include
 * a forum topic suffix separated by the final colon, e.g. -1001234567890:42.
 * Non-numeric destinations such as @channel remain valid but cannot carry a
 * message_thread_id because the colon form is reserved for numeric chat IDs.
 */
export function parseTelegramDestination(value: string | number): TelegramDestination | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const match = raw.match(/^(-?\d+)(?::(\d+))?$/);
  if (match) {
    const chatId = match[1]!;
    const rawThreadId = match[2];
    const messageThreadId = rawThreadId == null ? null : Number(rawThreadId);
    if (messageThreadId != null && (!Number.isSafeInteger(messageThreadId) || messageThreadId <= 0)) {
      return null;
    }
    return {
      chatId,
      messageThreadId,
      key: messageThreadId == null ? chatId : `${chatId}:${messageThreadId}`,
    };
  }

  if (/^@[A-Za-z0-9_]{1,64}$/.test(raw)) {
    return { chatId: raw, messageThreadId: null, key: raw };
  }

  return null;
}

export function normalizeTelegramDestination(value: string | number): string | null {
  return parseTelegramDestination(value)?.key ?? null;
}

export function resolveTelegramChatIds(
  requestedChannels: string[],
  defaultChatId?: string,
  options: { usernames?: string[]; usernameChannelMapJson?: string } = {},
): string[] {
  const channels = new Set<string>();
  for (const channel of requestedChannels) {
    const normalized = normalizeTelegramDestination(channel);
    if (normalized) channels.add(normalized);
  }

  const routingMap = parseUsernameChannelMap(options.usernameChannelMapJson);
  for (const username of options.usernames || []) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) continue;
    for (const channel of routingMap.get(normalizedUsername) || []) channels.add(channel);
  }

  if (channels.size) return [...channels];

  const fallback = defaultChatId == null ? null : normalizeTelegramDestination(defaultChatId);
  return fallback ? [fallback] : [];
}

export function resolveTelegramChatIdsForEnv(
  env: Env,
  requestedChannels: string[],
  usernames: string[] = [],
): string[] {
  return resolveTelegramChatIds(requestedChannels, resolveDefaultTelegramChatId(env), {
    usernames,
    usernameChannelMapJson: env.TELEGRAM_USERNAME_CHANNEL_MAP_JSON,
  });
}

export function parseUsernameChannelMap(rawValue?: string): Map<string, string[]> {
  const raw = String(rawValue || "").trim();
  if (!raw) return new Map();
  if (raw === cachedRawMap) return cachedUsernameMap;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    cachedRawMap = raw;
    cachedUsernameMap = new Map();
    return cachedUsernameMap;
  }

  const next = new Map<string, string[]>();
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [rawUsernames, rawChannels] of Object.entries(parsed as Record<string, unknown>)) {
      const channelValues = Array.isArray(rawChannels) ? rawChannels : [rawChannels];
      const channels = [...new Set(channelValues
        .filter((value) => typeof value === "string" || typeof value === "number")
        .map((value) => normalizeTelegramDestination(value as string | number))
        .filter((value): value is string => Boolean(value)))];
      if (!channels.length) continue;

      for (const rawUsername of rawUsernames.split(",")) {
        const username = normalizeUsername(rawUsername);
        if (!username) continue;
        const current = next.get(username) || [];
        next.set(username, [...new Set([...current, ...channels])]);
      }
    }
  }

  cachedRawMap = raw;
  cachedUsernameMap = next;
  return next;
}

function normalizeUsername(value: string): string {
  const handle = String(value || "").trim().replace(/^@+/, "").toLowerCase();
  return handle ? `@${handle}` : "";
}
