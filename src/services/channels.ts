import type { Env } from "../types";

export function resolveDefaultTelegramChatId(env: Env): string | undefined {
  const value = String(env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHANNEL_ID || "").trim();
  return value || undefined;
}

export function resolveTelegramChatIds(
  requestedChannels: string[],
  defaultChatId?: string,
): string[] {
  if (requestedChannels.length) return requestedChannels;

  const fallback = String(defaultChatId || "").trim();
  return fallback ? [fallback] : [];
}
