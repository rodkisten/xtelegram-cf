import type { AlbumMediaType, Env, MediaType } from "./types";

export interface MediaIdentityInput {
  provider?: string | null;
  mediaId?: string | null;
  mediaKey?: string | null;
  sourceUrl?: string | null;
  pageUrl?: string | null;
  mediaUrl?: string | null;
}

export interface MediaIdentity {
  key: string;
  provider: string;
  providerMediaId: string;
  canonicalUrl: string;
}

export interface PersistMediaInput {
  identity: MediaIdentity;
  sourceUrl: string | null;
  pageUrl: string | null;
  mediaType: MediaType | AlbumMediaType | "album";
  mediaCount: number;
  metadata: Record<string, string> | null;
  deliveries: Array<{
    requestedChatId: string;
    telegramChatId: string | number | null;
    telegramChatTitle: string | null;
    messageIds: Array<number | null>;
  }>;
}

export interface StoredDeliveryRow {
  channel_id: string;
  telegram_chat_id: string | null;
  telegram_chat_title: string | null;
  first_message_ids_json: string;
  last_message_ids_json: string;
  send_count: number;
  first_sent_at: string;
  last_sent_at: string;
}

export interface StoredMediaRow {
  media_key: string;
  provider: string;
  provider_media_id: string;
  canonical_url: string;
  source_url: string | null;
  page_url: string | null;
  media_type: string;
  media_count: number;
  metadata_json: string | null;
  first_seen_at: string;
  updated_at: string;
}

export function requireRelayDb(env: Env): D1Database {
  if (!env.RELAY_DB) {
    throw new Error(
      "D1 binding RELAY_DB is missing. Create/bind the database and apply migrations before using media persistence.",
    );
  }
  return env.RELAY_DB;
}

export async function createMediaIdentity(input: MediaIdentityInput): Promise<MediaIdentity> {
  const explicitKey = normalizeKeyPart(input.mediaKey);
  const provider = normalizeProvider(input.provider, input.sourceUrl || input.pageUrl || input.mediaUrl || "");
  const canonicalUrl = canonicalizeIdentityUrl(
    input.sourceUrl || input.pageUrl || input.mediaUrl || "",
  );

  if (explicitKey) {
    const separator = explicitKey.indexOf(":");
    const explicitProvider = separator > 0 ? explicitKey.slice(0, separator) : provider;
    const explicitId = separator > 0 ? explicitKey.slice(separator + 1) : explicitKey;
    return {
      key: explicitKey,
      provider: normalizeKeyPart(explicitProvider) || provider,
      providerMediaId: normalizeKeyPart(explicitId) || explicitKey,
      canonicalUrl,
    };
  }

  const explicitMediaId = normalizeKeyPart(input.mediaId);
  const providerMediaId = explicitMediaId || extractProviderMediaId(provider, canonicalUrl) || await shortSha256(canonicalUrl);

  return {
    key: `${provider}:${providerMediaId}`,
    provider,
    providerMediaId,
    canonicalUrl,
  };
}

export async function getAlreadyDeliveredChannels(
  db: D1Database,
  mediaKey: string,
  channels: string[],
): Promise<Set<string>> {
  if (!channels.length) return new Set();
  const placeholders = channels.map(() => "?").join(",");
  const result = await db
    .prepare(
      `SELECT channel_id FROM media_deliveries WHERE media_key = ? AND channel_id IN (${placeholders})`,
    )
    .bind(mediaKey, ...channels)
    .all<{ channel_id: string }>();
  return new Set((result.results || []).map((row) => row.channel_id));
}

export async function persistSuccessfulDeliveries(
  db: D1Database,
  input: PersistMediaInput,
): Promise<string[]> {
  if (!input.deliveries.length) return [];
  const now = new Date().toISOString();
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO media (
        media_key, provider, provider_media_id, canonical_url, source_url, page_url,
        media_type, media_count, metadata_json, first_seen_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_key) DO UPDATE SET
        canonical_url = excluded.canonical_url,
        source_url = COALESCE(excluded.source_url, media.source_url),
        page_url = COALESCE(excluded.page_url, media.page_url),
        media_type = excluded.media_type,
        media_count = excluded.media_count,
        metadata_json = COALESCE(excluded.metadata_json, media.metadata_json),
        updated_at = excluded.updated_at`,
    ).bind(
      input.identity.key,
      input.identity.provider,
      input.identity.providerMediaId,
      input.identity.canonicalUrl,
      input.sourceUrl,
      input.pageUrl,
      input.mediaType,
      input.mediaCount,
      metadataJson,
      now,
      now,
    ),
  ];

  for (const delivery of input.deliveries) {
    const messageIds = JSON.stringify(delivery.messageIds.filter((id): id is number => typeof id === "number"));
    statements.push(
      db.prepare(
        `INSERT INTO media_deliveries (
          media_key, channel_id, telegram_chat_id, telegram_chat_title,
          first_message_ids_json, last_message_ids_json, send_count, first_sent_at, last_sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(media_key, channel_id) DO UPDATE SET
          telegram_chat_id = excluded.telegram_chat_id,
          telegram_chat_title = COALESCE(excluded.telegram_chat_title, media_deliveries.telegram_chat_title),
          last_message_ids_json = excluded.last_message_ids_json,
          send_count = media_deliveries.send_count + 1,
          last_sent_at = excluded.last_sent_at`,
      ).bind(
        input.identity.key,
        delivery.requestedChatId,
        delivery.telegramChatId == null ? null : String(delivery.telegramChatId),
        delivery.telegramChatTitle,
        messageIds,
        messageIds,
        now,
        now,
      ),
    );
  }

  await db.batch(statements);
  return input.deliveries.map((delivery) => delivery.requestedChatId);
}

export async function getStoredMedia(db: D1Database, mediaKey: string) {
  const media = await db
    .prepare("SELECT * FROM media WHERE media_key = ? LIMIT 1")
    .bind(mediaKey)
    .first<StoredMediaRow>();
  if (!media) return null;
  const deliveries = await db
    .prepare("SELECT * FROM media_deliveries WHERE media_key = ? ORDER BY last_sent_at DESC")
    .bind(mediaKey)
    .all<StoredDeliveryRow>();
  return { media: formatMediaRow(media), deliveries: (deliveries.results || []).map(formatDeliveryRow) };
}

export async function findStoredMedia(db: D1Database, options: {
  provider?: string | null;
  mediaId?: string | null;
  sourceUrl?: string | null;
  limit?: number;
}) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (options.provider) { conditions.push("provider = ?"); values.push(normalizeKeyPart(options.provider)); }
  if (options.mediaId) { conditions.push("provider_media_id = ?"); values.push(normalizeKeyPart(options.mediaId)); }
  if (options.sourceUrl) { conditions.push("canonical_url = ?"); values.push(canonicalizeIdentityUrl(options.sourceUrl)); }
  const limit = Math.min(100, Math.max(1, options.limit || 25));
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.prepare(
    `SELECT m.*,
      (SELECT COUNT(*) FROM media_deliveries d WHERE d.media_key = m.media_key) AS channel_count,
      (SELECT COALESCE(SUM(send_count), 0) FROM media_deliveries d WHERE d.media_key = m.media_key) AS send_count
     FROM media m ${where}
     ORDER BY updated_at DESC LIMIT ?`,
  ).bind(...values, limit).all<StoredMediaRow & { channel_count: number; send_count: number }>();
  return (result.results || []).map((row) => ({ ...formatMediaRow(row), channelCount: row.channel_count, sendCount: row.send_count }));
}

function formatMediaRow(row: StoredMediaRow) {
  return {
    key: row.media_key,
    provider: row.provider,
    mediaId: row.provider_media_id,
    canonicalUrl: row.canonical_url,
    sourceUrl: row.source_url,
    pageUrl: row.page_url,
    mediaType: row.media_type,
    mediaCount: row.media_count,
    metadata: parseJson(row.metadata_json),
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
  };
}

function formatDeliveryRow(row: StoredDeliveryRow) {
  return {
    channelId: row.channel_id,
    telegramChatId: row.telegram_chat_id,
    telegramChatTitle: row.telegram_chat_title,
    firstMessageIds: parseJson(row.first_message_ids_json) || [],
    lastMessageIds: parseJson(row.last_message_ids_json) || [],
    sendCount: row.send_count,
    firstSentAt: row.first_sent_at,
    lastSentAt: row.last_sent_at,
  };
}

function parseJson(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeProvider(value: string | null | undefined, url: string): string {
  const explicit = normalizeKeyPart(value);
  if (explicit) return explicit;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "x.com" || hostname.endsWith("twitter.com")) return "twitter";
    if (hostname.endsWith("instagram.com")) return "instagram";
    if (hostname.endsWith("tiktok.com")) return "tiktok";
    return normalizeKeyPart(hostname.replace(/^www\./, "")) || "generic";
  } catch {
    return "generic";
  }
}

function extractProviderMediaId(provider: string, url: string): string | null {
  try {
    const parsed = new URL(url);
    if (provider === "twitter" || provider === "x") {
      return parsed.pathname.match(/\/status\/(\d+)/i)?.[1] || null;
    }
    if (provider === "instagram") {
      return parsed.pathname.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/i)?.[1] || null;
    }
    if (provider === "tiktok") {
      return parsed.pathname.match(/\/(?:video|photo)\/(\d+)/i)?.[1] || null;
    }
  } catch { /* hash fallback below */ }
  return null;
}

function canonicalizeIdentityUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    const removable: string[] = [];
    url.searchParams.forEach((_value, key) => {
      if (/^(utm_|fbclid$|gclid$|igshid$|si$|s$|t$)/i.test(key)) removable.push(key);
    });
    for (const key of removable) url.searchParams.delete(key);
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    url.hostname = url.hostname.toLowerCase();
    return url.href;
  } catch {
    return value.trim();
  }
}

function normalizeKeyPart(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._:@-]+/g, "-").slice(0, 240);
}

async function shortSha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
