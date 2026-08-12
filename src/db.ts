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
  /** Legacy lossy keys accepted for backwards-compatible lookup only. */
  aliases: string[];
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

export async function resolveMediaIdentity(input: MediaIdentityInput): Promise<MediaIdentity> {
  const provider = normalizeProvider(input.provider, input.sourceUrl || input.pageUrl || input.mediaUrl || "");
  const canonicalUrl = canonicalizeIdentityUrl(
    input.sourceUrl || input.pageUrl || input.mediaUrl || "",
  );

  // Explicit mediaKey is an API-level identity override. Preserve it verbatim
  // apart from surrounding whitespace so callers can intentionally reuse an
  // existing key. The provider prefix itself is normalized for metadata only.
  const explicitKey = normalizeExplicitMediaKey(input.mediaKey);
  if (explicitKey) {
    const separator = explicitKey.indexOf(":");
    const explicitProvider = separator > 0 ? explicitKey.slice(0, separator) : provider;
    const explicitId = separator > 0 ? explicitKey.slice(separator + 1) : explicitKey;
    return {
      key: explicitKey,
      provider: normalizeProviderKey(explicitProvider) || provider,
      providerMediaId: normalizeOpaqueMediaId(explicitId) || explicitKey,
      canonicalUrl,
      aliases: [],
    };
  }

  const explicitMediaId = normalizeOpaqueMediaId(input.mediaId);
  const extractedMediaId = extractProviderMediaId(provider, canonicalUrl);
  const providerMediaId = explicitMediaId || extractedMediaId || await shortSha256(canonicalUrl);
  const key = `${provider}:${encodeMediaIdKey(providerMediaId)}`;

  // v2.7 and earlier lower-cased/sanitized provider IDs. Keep that old key as
  // a read alias so existing D1 history remains effective after the lossless
  // identity fix. New rows use the lossless key unless an old row already
  // exists, in which case resolveStorageMediaKey() keeps writing to it.
  const legacyPart = normalizeLegacyKeyPart(providerMediaId);
  const legacyKey = legacyPart ? `${provider}:${legacyPart}` : "";
  const aliases = legacyKey && legacyKey !== key ? [legacyKey] : [];

  return { key, provider, providerMediaId, canonicalUrl, aliases };
}


/** @deprecated Prefer resolveMediaIdentity so every API path shares the same identity resolver. */
export async function createMediaIdentity(input: MediaIdentityInput): Promise<MediaIdentity> {
  return resolveMediaIdentity(input);
}

export interface MediaCheckRecord {
  media: ReturnType<typeof formatMediaRow>;
  deliveries: ReturnType<typeof formatDeliveryRow>[];
}

export async function checkStoredMediaDeliveries(
  db: D1Database,
  identities: MediaIdentity[],
  channels: string[] = [],
): Promise<Map<string, MediaCheckRecord>> {
  const requestedChannels = [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))];
  const queryKeys = [...new Set(identities.flatMap((identity) => [identity.key, ...(identity.aliases || [])]).filter(Boolean))];
  if (!queryKeys.length) return new Map();

  // Bind the arrays as JSON instead of one placeholder per media/channel. D1
  // has a low bound-parameter ceiling, while json_each() keeps this lookup at
  // two parameters even for 100 media identities plus channel filters.
  const result = await db
    .prepare(
      `WITH requested_keys(value) AS (
         SELECT CAST(value AS TEXT) FROM json_each(?)
       ), requested_channels(value) AS (
         SELECT CAST(value AS TEXT) FROM json_each(?)
       )
       SELECT
        m.media_key, m.provider, m.provider_media_id, m.canonical_url,
        m.source_url, m.page_url, m.media_type, m.media_count,
        m.metadata_json, m.first_seen_at, m.updated_at,
        d.channel_id, d.telegram_chat_id, d.telegram_chat_title,
        d.first_message_ids_json, d.last_message_ids_json,
        d.send_count, d.first_sent_at, d.last_sent_at
       FROM media AS m
       LEFT JOIN media_deliveries AS d
         ON d.media_key = m.media_key
        AND (
          NOT EXISTS (SELECT 1 FROM requested_channels)
          OR d.channel_id IN (SELECT value FROM requested_channels)
        )
       WHERE m.media_key IN (SELECT value FROM requested_keys)`,
    )
    .bind(JSON.stringify(queryKeys), JSON.stringify(requestedChannels))
    .all<StoredMediaRow & Partial<StoredDeliveryRow>>();

  const rawRecords = new Map<string, MediaCheckRecord>();
  for (const row of result.results || []) {
    let record = rawRecords.get(row.media_key);
    if (!record) {
      record = { media: formatMediaRow(row), deliveries: [] };
      rawRecords.set(row.media_key, record);
    }
    if (row.channel_id) {
      record.deliveries.push(formatDeliveryRow({
        channel_id: row.channel_id,
        telegram_chat_id: row.telegram_chat_id ?? null,
        telegram_chat_title: row.telegram_chat_title ?? null,
        first_message_ids_json: row.first_message_ids_json ?? "[]",
        last_message_ids_json: row.last_message_ids_json ?? "[]",
        send_count: row.send_count ?? 1,
        first_sent_at: row.first_sent_at ?? "",
        last_sent_at: row.last_sent_at ?? "",
      }));
    }
  }

  // Expose records under the canonical key requested by callers even when the
  // physical row still uses a v2.7 legacy alias.
  const records = new Map<string, MediaCheckRecord>();
  for (const identity of identities) {
    const exact = rawRecords.get(identity.key);
    const alias = (identity.aliases || [])
      .map((key) => rawRecords.get(key))
      .find((record) => {
        if (!record) return false;
        const storedId = extractProviderMediaId(identity.provider, String(record.media?.canonicalUrl || ""));
        // Legacy rows were lossy. Only reuse an alias when its canonical URL can
        // prove it refers to the same opaque provider ID; otherwise prefer a new
        // lossless key rather than creating a false duplicate collision.
        return !storedId || storedId === identity.providerMediaId;
      });
    const record = exact || alias;
    if (record) records.set(identity.key, record);
  }
  return records;
}

export async function getAlreadyDeliveredChannels(
  db: D1Database,
  identityOrKey: MediaIdentity | string,
  channels: string[],
): Promise<Set<string>> {
  if (!channels.length) return new Set();
  const keys = typeof identityOrKey === "string"
    ? [identityOrKey]
    : [identityOrKey.key, ...(identityOrKey.aliases || [])];
  const result = await db
    .prepare(
      `WITH requested_keys(value) AS (SELECT CAST(value AS TEXT) FROM json_each(?)),
            requested_channels(value) AS (SELECT CAST(value AS TEXT) FROM json_each(?))
       SELECT DISTINCT channel_id
       FROM media_deliveries
       WHERE media_key IN (SELECT value FROM requested_keys)
         AND channel_id IN (SELECT value FROM requested_channels)`,
    )
    .bind(JSON.stringify([...new Set(keys)]), JSON.stringify([...new Set(channels)]))
    .all<{ channel_id: string }>();
  return new Set((result.results || []).map((row) => row.channel_id));
}

export interface DeliveryClaimPlan {
  mediaKey: string;
  requestId: string;
  claimed: string[];
  alreadySent: string[];
  inFlight: string[];
}

export async function resolveStorageMediaKey(db: D1Database, identity: MediaIdentity): Promise<string> {
  const candidates = [identity.key, ...(identity.aliases || [])];
  if (candidates.length <= 1) return identity.key;
  const result = await db.prepare(
    `WITH candidates(value) AS (SELECT CAST(value AS TEXT) FROM json_each(?))
     SELECT media_key, canonical_url FROM media WHERE media_key IN (SELECT value FROM candidates)`,
  ).bind(JSON.stringify(candidates)).all<{ media_key: string; canonical_url: string }>();
  const rows = result.results || [];
  if (rows.some((row) => row.media_key === identity.key)) return identity.key;
  for (const alias of identity.aliases || []) {
    const row = rows.find((candidate) => candidate.media_key === alias);
    if (!row) continue;
    const storedId = extractProviderMediaId(identity.provider, row.canonical_url || "");
    if (!storedId || storedId === identity.providerMediaId) return alias;
  }
  return identity.key;
}

export async function acquireDeliveryClaims(
  db: D1Database,
  identity: MediaIdentity,
  channels: string[],
  options: { force?: boolean; requestId?: string; ttlSeconds?: number } = {},
): Promise<DeliveryClaimPlan> {
  const requested = [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))];
  const requestId = options.requestId || crypto.randomUUID();
  const mediaKey = await resolveStorageMediaKey(db, identity);
  if (!requested.length) return { mediaKey, requestId, claimed: [], alreadySent: [], inFlight: [] };

  const now = Date.now();
  const ttlSeconds = Math.min(3600, Math.max(60, Number(options.ttlSeconds || 900)));
  const claimedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM delivery_claims WHERE expires_at <= ?").bind(claimedAt),
  ];

  for (const channelId of requested) {
    if (options.force) {
      statements.push(db.prepare(
        `INSERT OR IGNORE INTO delivery_claims (media_key, channel_id, request_id, claimed_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(mediaKey, channelId, requestId, claimedAt, expiresAt));
    } else {
      statements.push(db.prepare(
        `INSERT OR IGNORE INTO delivery_claims (media_key, channel_id, request_id, claimed_at, expires_at)
         SELECT ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM media_deliveries WHERE media_key = ? AND channel_id = ?
         )`,
      ).bind(mediaKey, channelId, requestId, claimedAt, expiresAt, mediaKey, channelId));
    }
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/delivery_claims|no such table/i.test(message)) {
      throw new Error(
        "Atomic delivery claims are not initialized. Apply D1 migration 0002_delivery_claims.sql before using relay v2.8.",
      );
    }
    throw error;
  }

  const claimedRows = await db.prepare(
    `WITH requested_channels(value) AS (SELECT CAST(value AS TEXT) FROM json_each(?))
     SELECT channel_id FROM delivery_claims
     WHERE media_key = ? AND request_id = ?
       AND channel_id IN (SELECT value FROM requested_channels)`,
  ).bind(JSON.stringify(requested), mediaKey, requestId).all<{ channel_id: string }>();
  const claimed = new Set((claimedRows.results || []).map((row) => row.channel_id));
  const alreadySent = options.force ? new Set<string>() : await getAlreadyDeliveredChannels(db, mediaKey, requested);
  const inFlight = requested.filter((channelId) => !claimed.has(channelId) && !alreadySent.has(channelId));

  return {
    mediaKey,
    requestId,
    claimed: requested.filter((channelId) => claimed.has(channelId)),
    alreadySent: requested.filter((channelId) => alreadySent.has(channelId)),
    inFlight,
  };
}

export async function releaseDeliveryClaims(
  db: D1Database,
  plan: Pick<DeliveryClaimPlan, "mediaKey" | "requestId">,
  channels?: string[],
): Promise<void> {
  const requested = [...new Set((channels || []).map((channel) => channel.trim()).filter(Boolean))];
  if (requested.length) {
    await db.prepare(
      `WITH requested_channels(value) AS (SELECT CAST(value AS TEXT) FROM json_each(?))
       DELETE FROM delivery_claims
       WHERE media_key = ? AND request_id = ?
         AND channel_id IN (SELECT value FROM requested_channels)`,
    ).bind(JSON.stringify(requested), plan.mediaKey, plan.requestId).run();
    return;
  }
  await db.prepare("DELETE FROM delivery_claims WHERE media_key = ? AND request_id = ?")
    .bind(plan.mediaKey, plan.requestId).run();
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
  if (options.provider) { conditions.push("provider = ?"); values.push(normalizeProviderKey(options.provider)); }
  if (options.mediaId) { conditions.push("provider_media_id = ?"); values.push(normalizeOpaqueMediaId(options.mediaId)); }
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
  const explicit = normalizeProviderKey(value);
  if (explicit) return explicit;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "x.com" || hostname.endsWith("twitter.com")) return "twitter";
    if (hostname.endsWith("instagram.com")) return "instagram";
    if (hostname.endsWith("tiktok.com")) return "tiktok";
    return normalizeProviderKey(hostname.replace(/^www\./, "")) || "generic";
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

function normalizeProviderKey(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._@-]+/g, "-").slice(0, 80);
}

function normalizeOpaqueMediaId(value: unknown): string {
  return String(value ?? "").trim().slice(0, 512);
}

function normalizeExplicitMediaKey(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.slice(0, 768);
}

function encodeMediaIdKey(value: string): string {
  const raw = normalizeOpaqueMediaId(value);
  if (!raw) return "unknown";
  // URI encoding is deterministic and lossless for opaque/case-sensitive IDs.
  // Keep very long values bounded with a hash-like suffix generated from bytes.
  const encoded = encodeURIComponent(raw);
  if (encoded.length <= 512) return encoded;
  const prefix = encoded.slice(0, 400);
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${prefix}~${hash.toString(16).padStart(8, "0")}`;
}

function normalizeLegacyKeyPart(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._:@-]+/g, "-").slice(0, 240);
}

async function shortSha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
