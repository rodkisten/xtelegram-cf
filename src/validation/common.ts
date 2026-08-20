import { MAX_TELEGRAM_CHANNELS_PER_REQUEST } from "../config/constants";
import { normalizeOptionalSourceUrl } from "../lib/http";
import type { MediaType, ParseMode } from "../types";
import { normalizeTelegramDestination } from "../services/channels";

const ALLOWED_PARSE_MODES = new Set<ParseMode>(["HTML", "MarkdownV2"]);
const ALLOWED_MEDIA_TYPES = new Set<MediaType>(["video", "audio", "document", "photo"]);

export type ChannelValidationResult =
  | { ok: true; value: string[] }
  | { ok: false; error: string };

export function normalizeTelegramChannels(
  channelValue: unknown,
  channelsValue: unknown,
  options: { maxChannels?: number } = {},
): ChannelValidationResult {
  const hasChannel = channelValue !== undefined && channelValue !== null;
  const hasChannels = channelsValue !== undefined && channelsValue !== null;
  const values: unknown[] = [];

  if (hasChannel) values.push(channelValue);
  if (hasChannels) {
    if (Array.isArray(channelsValue)) values.push(...channelsValue);
    else values.push(channelsValue);
  }

  const channels: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") {
      return {
        ok: false,
        error: "Invalid Telegram channel. channel/channels must contain chat IDs or @channel usernames.",
      };
    }

    const raw = String(value).trim();
    if (!raw || raw.length > 128 || /[\u0000-\u001F]/.test(raw)) {
      return { ok: false, error: "Invalid Telegram channel value." };
    }
    const normalized = normalizeTelegramDestination(raw);
    if (!normalized) {
      return {
        ok: false,
        error: "Invalid Telegram destination. Use <chat_id>, <chat_id>:<message_thread_id>, or @channel.",
      };
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      channels.push(normalized);
    }
  }

  const maxChannels = Math.max(1, Math.floor(options.maxChannels ?? MAX_TELEGRAM_CHANNELS_PER_REQUEST));
  if (channels.length > maxChannels) {
    return {
      ok: false,
      error: `A maximum of ${maxChannels} Telegram channels can be targeted per request.`,
    };
  }

  return { ok: true, value: channels };
}


export type UsernameValidationResult =
  | { ok: true; value: string[] }
  | { ok: false; error: string };

export function normalizeRoutingUsernames(
  usernameValue: unknown,
  usernamesValue: unknown,
): UsernameValidationResult {
  const values: unknown[] = [];
  if (usernameValue !== undefined && usernameValue !== null) values.push(usernameValue);
  if (usernamesValue !== undefined && usernamesValue !== null) {
    if (Array.isArray(usernamesValue)) values.push(...usernamesValue);
    else values.push(usernamesValue);
  }

  const usernames: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") {
      return { ok: false, error: "username/usernames must contain strings." };
    }
    for (const raw of value.split(",")) {
      const handle = raw.trim().replace(/^@+/, "").toLowerCase();
      if (!handle) continue;
      if (handle.length > 100 || /[\s\u0000-\u001F,]/.test(handle)) {
        return { ok: false, error: "Invalid username value." };
      }
      const normalized = `@${handle}`;
      if (!seen.has(normalized)) {
        seen.add(normalized);
        usernames.push(normalized);
      }
    }
  }
  if (usernames.length > 32) {
    return { ok: false, error: "A maximum of 32 usernames can be routed per request." };
  }
  return { ok: true, value: usernames };
}

export function normalizeNullableText(value: unknown, maximumLength: number): string | null {
  const normalized = normalizeOptionalText(value, maximumLength);
  return normalized || null;
}

export function normalizeOptionalText(value: unknown, maximumLength: number): string {
  if (value == null) return "";
  return String(value).trim().slice(0, maximumLength);
}

export function resolveOriginalSourceUrl(record: Record<string, unknown>): string | null {
  const candidates = [
    record.pageUrl,
    record.sourceUrl,
    record.tweetUrl,
    record.postUrl,
    record.storyUrl,
    record.reelUrl,
    record.tiktokUrl,
    record.originalUrl,
    record.permalink,
    record.shareUrl,
    record.canonicalUrl,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeOptionalSourceUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function resolveFallbackMediaUrl(record: Record<string, unknown>): string | null {
  for (const candidate of [record.mediaUrl, record.photoUrl, record.videoUrl, record.fileUrl, record.url]) {
    const normalized = normalizeOptionalSourceUrl(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function resolvePayloadCaption(record: Record<string, unknown>): string {
  const explicit = normalizeCaption(record.caption);
  if (explicit && !isGenericMediaLabel(explicit)) return explicit;

  const rawTitle = normalizeOptionalText(record.title, 1000);
  const title = isGenericMediaLabel(rawTitle) ? "" : rawTitle;
  const text = normalizeOptionalText(record.text, 20_000);
  const sourceUrl = resolveOriginalSourceUrl(record) || resolveFallbackMediaUrl(record);

  // A generated caption must never be linkless when the relay knows any URL.
  // Prefer the original post/story/reel/tweet URL; fall back to the media URL
  // only when the caller did not provide a stable source URL.
  return [title, text, sourceUrl || ""].filter(Boolean).join("\n\n");
}

export function isGenericMediaLabel(value: string): boolean {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (!normalized) return false;

  return /^(?:(?:twitter|x|instagram|tiktok)\s+)?(?:video|media|photo|foto|image|imagem|audio|post|story|reel)(?:\s+(?:video|media|photo|foto|image|imagem|audio))?$/.test(normalized) ||
    /^(?:twitter|x|instagram|tiktok)\s+(?:video|media|photo|foto|image|imagem|audio|post|story|reel)$/.test(normalized);
}

export function normalizeCaption(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : String(value);
}

export function normalizeParseMode(value: unknown): ParseMode | null {
  if (!value) return null;
  const normalized = String(value) as ParseMode;
  return ALLOWED_PARSE_MODES.has(normalized) ? normalized : null;
}

export function normalizeMediaType(value: unknown): MediaType | null {
  if (!value) return null;
  const normalized = String(value).toLowerCase() as MediaType;
  return ALLOWED_MEDIA_TYPES.has(normalized) ? normalized : null;
}

export function normalizeMediaHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const allowed = new Set([
    "accept",
    "accept-language",
    "authorization",
    "cookie",
    "origin",
    "referer",
    "user-agent",
  ]);
  const headers: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (!allowed.has(normalizedKey) || rawValue == null) continue;
    headers[key] = String(rawValue);
  }

  return headers;
}

export function normalizeMetadata(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const metadata: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (rawValue == null) continue;
    if (
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      metadata[key.slice(0, 100)] = String(rawValue).slice(0, 2000);
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}
