import type { Env } from "../types";

let cachedRawMap = "";
let cachedUsernameMap = new Map<string, string[]>();

export function resolveDefaultTelegramChatId(env: Env): string | undefined {
  const value = String(env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHANNEL_ID || "").trim();
  return value || undefined;
}

export function resolveTelegramChatIds(
  requestedChannels: string[],
  defaultChatId?: string,
  options: { usernames?: string[]; usernameChannelMapJson?: string } = {},
): string[] {
  const channels = new Set<string>();
  for (const channel of requestedChannels) {
    const normalized = String(channel || "").trim();
    if (normalized) channels.add(normalized);
  }

  const routingMap = parseUsernameChannelMap(options.usernameChannelMapJson);
  for (const username of options.usernames || []) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) continue;
    for (const channel of routingMap.get(normalizedUsername) || []) channels.add(channel);
  }

  if (channels.size) return [...channels];

  const fallback = String(defaultChatId || "").trim();
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
        .map((value) => String(value).trim())
        .filter(Boolean))];
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
