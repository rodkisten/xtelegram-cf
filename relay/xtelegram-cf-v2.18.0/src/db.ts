import type { AlbumMediaType, Env, MediaType } from "./types";
import { parseTelegramDestination } from "./services/channels";
import { compareMediaFingerprints } from "./services/media-fingerprint";
import { buildPresentationSnapshot, serializePresentationSnapshot } from "./services/presentation-state";

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
  /** Legacy lossy keys accepted for backwards-compatible dedupe lookups. */
  legacyKeys: string[];
}

/**
 * Delivery history captured atomically with the pre-send claim query.
 *
 * Keeping the Telegram identifiers in the claim result avoids a second D1 round
 * trip when a duplicate is detected, which is especially valuable on the hot
 * request path of the relay.
 */
export interface DeliveryHistoryRecord {
  channelId: string;
  telegramChatId: string | null;
  messageThreadId: number | null;
  telegramChatTitle: string | null;
  firstMessageIds: number[];
  lastMessageIds: number[];
  sendCount: number;
  firstSentAt: string;
  lastSentAt: string;
  presentationJson: string | null;
  presentationUpdatedAt: string | null;
}

export interface DeliveryClaimResult {
  requestId: string;
  requested: string[];
  acquired: string[];
  alreadySent: string[];
  inProgress: string[];
  /** Existing Telegram delivery records for the requested channels. */
  alreadySentDeliveries: DeliveryHistoryRecord[];
  queryCount: number;
}

export interface PersistMediaInput {
  identity: MediaIdentity;
  sourceUrl: string | null;
  pageUrl: string | null;
  mediaType: MediaType | AlbumMediaType | "album";
  mediaCount: number;
  metadata: Record<string, string> | null;
  caption?: string | null;
  parseMode?: string | null;
  resolvedMediaUrl?: string | null;
  mediaStatus?: "pending" | "ready" | "sent";
  captionProvided?: boolean;
  metadataProvided?: boolean;
  mediaSha256?: string | null;
  mediaFingerprint?: string | null;
  mediaFingerprintVersion?: number | null;
  mediaByteLength?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  presentationMetadata?: Record<string, string> | null;
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
  message_thread_id: number | null;
  telegram_chat_title: string | null;
  first_message_ids_json: string;
  last_message_ids_json: string;
  send_count: number;
  first_sent_at: string;
  last_sent_at: string;
  presentation_json: string | null;
  presentation_updated_at: string | null;
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
  caption: string | null;
  caption_parse_mode: string | null;
  resolved_media_url: string | null;
  media_status: string;
  first_seen_at: string;
  updated_at: string;
  media_sha256?: string | null;
  media_fingerprint?: string | null;
  media_fingerprint_version?: number | null;
  media_byte_length?: number | null;
  media_width?: number | null;
  media_height?: number | null;
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
  const canonicalUrl = canonicalizeIdentityUrl(input.sourceUrl || input.pageUrl || input.mediaUrl || "");
  const explicitKey = normalizeExplicitMediaKey(input.mediaKey, provider);

  if (explicitKey) {
    const separator = explicitKey.indexOf(":");
    const explicitProvider = separator > 0 ? explicitKey.slice(0, separator) : provider;
    const explicitId = separator > 0 ? explicitKey.slice(separator + 1) : explicitKey;
    const normalizedProvider = normalizeProviderKey(explicitProvider) || provider;
    const providerMediaId = normalizeOpaqueMediaId(explicitId) || explicitKey;
    const key = `${normalizedProvider}:${providerMediaId}`;
    const legacyKey = legacyNormalizeKeyPart(input.mediaKey);
    return {
      key,
      provider: normalizedProvider,
      providerMediaId,
      canonicalUrl,
      legacyKeys: legacyKey && legacyKey !== key ? [legacyKey] : [],
    };
  }

  const explicitMediaId = normalizeOpaqueMediaId(input.mediaId);
  const extractedMediaId = extractProviderMediaId(provider, canonicalUrl);
  const providerMediaId = explicitMediaId || extractedMediaId || await shortSha256(canonicalUrl);
  const key = `${provider}:${providerMediaId}`;
  const legacyId = legacyNormalizeKeyPart(providerMediaId);
  const legacyKey = legacyId ? `${provider}:${legacyId}` : "";

  return {
    key,
    provider,
    providerMediaId,
    canonicalUrl,
    legacyKeys: legacyKey && legacyKey !== key ? [legacyKey] : [],
  };
}

export function identityLookupKeys(identity: MediaIdentity | string): string[] {
  if (typeof identity === "string") return [identity].filter(Boolean);
  return [...new Set([identity.key, ...(identity.legacyKeys || [])].filter(Boolean))];
}

/**
 * Reuse an already-persisted legacy key when upgrading from the pre-2.8 lossy
 * identity format. This prevents one logical post from being split across two
 * media rows after the identity migration.
 */
export async function resolveStoredMediaIdentity(
  db: D1Database,
  identity: MediaIdentity,
): Promise<MediaIdentity> {
  const keys = identityLookupKeys(identity);
  if (keys.length <= 1) return identity;
  const row = await db.prepare(
    `SELECT media_key FROM media
     WHERE media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?1))
     ORDER BY CASE WHEN media_key = ?2 THEN 0 ELSE 1 END
     LIMIT 1`,
  ).bind(JSON.stringify(keys), identity.key).first<{ media_key: string }>();
  const storedKey = String(row?.media_key || "");
  if (!storedKey || storedKey === identity.key) return identity;
  return {
    ...identity,
    key: storedKey,
    legacyKeys: [...new Set([identity.key, ...identity.legacyKeys].filter((key) => key && key !== storedKey))],
  };
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
  const uniqueIdentities = [...new Map(identities.map((identity) => [identity.key, identity])).values()];
  if (!uniqueIdentities.length) return new Map();

  const lookupKeys = [...new Set(uniqueIdentities.flatMap(identityLookupKeys))];
  const requestedChannels = [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))];
  const channelJoin = requestedChannels.length
    ? " AND d.channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?2))"
    : "";

  // Arrays are bound as JSON and expanded by json_each(). This keeps the bound
  // parameter count constant even for 100 media keys + many channels, avoiding
  // D1's prepared-statement variable ceiling while retaining indexed lookups.
  const statement = db.prepare(
    `SELECT
      m.media_key, m.provider, m.provider_media_id, m.canonical_url,
      m.source_url, m.page_url, m.media_type, m.media_count,
      m.metadata_json, m.caption, m.caption_parse_mode, m.resolved_media_url, m.media_status,
      m.first_seen_at, m.updated_at,
      d.channel_id, d.telegram_chat_id, d.message_thread_id, d.telegram_chat_title,
      d.first_message_ids_json, d.last_message_ids_json,
      d.send_count, d.first_sent_at, d.last_sent_at,
      d.presentation_json, d.presentation_updated_at
     FROM media AS m
     LEFT JOIN media_deliveries AS d
       ON d.media_key = m.media_key${channelJoin}
     WHERE m.media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?1))`,
  );
  const result = requestedChannels.length
    ? await statement.bind(JSON.stringify(lookupKeys), JSON.stringify(requestedChannels)).all<StoredMediaRow & Partial<StoredDeliveryRow>>()
    : await statement.bind(JSON.stringify(lookupKeys)).all<StoredMediaRow & Partial<StoredDeliveryRow>>();

  const byStoredKey = new Map<string, MediaCheckRecord>();
  for (const row of result.results || []) {
    let record = byStoredKey.get(row.media_key);
    if (!record) {
      record = { media: formatMediaRow(row), deliveries: [] };
      byStoredKey.set(row.media_key, record);
    }
    if (row.channel_id) {
      record.deliveries.push(formatDeliveryRow({
        channel_id: row.channel_id,
        telegram_chat_id: row.telegram_chat_id ?? null,
        message_thread_id: row.message_thread_id ?? null,
        telegram_chat_title: row.telegram_chat_title ?? null,
        first_message_ids_json: row.first_message_ids_json ?? "[]",
        last_message_ids_json: row.last_message_ids_json ?? "[]",
        send_count: row.send_count ?? 1,
        first_sent_at: row.first_sent_at ?? "",
        last_sent_at: row.last_sent_at ?? "",
        presentation_json: row.presentation_json ?? null,
        presentation_updated_at: row.presentation_updated_at ?? null,
      }));
    }
  }

  const records = new Map<string, MediaCheckRecord>();
  for (const identity of uniqueIdentities) {
    const matches = identityLookupKeys(identity)
      .map((key) => byStoredKey.get(key))
      .filter((record): record is MediaCheckRecord => Boolean(record));
    if (!matches.length) continue;

    const preferred = matches.find((record) => record.media.key === identity.key) || matches[0]!;
    const deliveriesByChannel = new Map<string, ReturnType<typeof formatDeliveryRow>>();
    for (const match of matches) {
      for (const delivery of match.deliveries) {
        const previous = deliveriesByChannel.get(delivery.channelId);
        if (!previous) {
          deliveriesByChannel.set(delivery.channelId, delivery);
          continue;
        }
        const previousLast = Date.parse(previous.lastSentAt || "") || 0;
        const nextLast = Date.parse(delivery.lastSentAt || "") || 0;
        const newer = nextLast >= previousLast ? delivery : previous;
        const firstSentAt = [previous.firstSentAt, delivery.firstSentAt]
          .filter(Boolean)
          .sort()[0] || newer.firstSentAt;
        const lastSentAt = [previous.lastSentAt, delivery.lastSentAt]
          .filter(Boolean)
          .sort()
          .at(-1) || newer.lastSentAt;
        deliveriesByChannel.set(delivery.channelId, {
          ...newer,
          sendCount: Math.max(0, Number(previous.sendCount || 0)) + Math.max(0, Number(delivery.sendCount || 0)),
          firstSentAt,
          lastSentAt,
        });
      }
    }
    records.set(identity.key, {
      media: preferred.media,
      deliveries: [...deliveriesByChannel.values()].sort((a, b) => String(b.lastSentAt).localeCompare(String(a.lastSentAt))),
    });
  }
  return records;
}

export async function getAlreadyDeliveredChannels(
  db: D1Database,
  identity: MediaIdentity | string,
  channels: string[],
): Promise<Set<string>> {
  const requested = [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))];
  if (!requested.length) return new Set();
  const keys = identityLookupKeys(identity);
  const result = await db
    .prepare(
      `SELECT DISTINCT channel_id FROM media_deliveries
       WHERE media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?1))
         AND channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?2))`,
    )
    .bind(JSON.stringify(keys), JSON.stringify(requested))
    .all<{ channel_id: string }>();
  return new Set((result.results || []).map((row) => row.channel_id));
}

export async function acquireDeliveryClaims(
  db: D1Database,
  identity: MediaIdentity,
  channels: string[],
  options: { requestId?: string; ttlMs?: number; force?: boolean } = {},
): Promise<DeliveryClaimResult> {
  const requested = [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))];
  const requestId = options.requestId || crypto.randomUUID();
  if (!requested.length) {
    return {
      requestId,
      requested: [],
      acquired: [],
      alreadySent: [],
      inProgress: [],
      alreadySentDeliveries: [],
      queryCount: 0,
    };
  }

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + Math.max(30_000, options.ttlMs || 30 * 60_000)).toISOString(); // generous TTL covers slow HLS/social resolution without expiring mid-flight
  const lookupKeys = identityLookupKeys(identity);

  const claimInsert = options.force
    ? db.prepare(
        `INSERT OR IGNORE INTO delivery_claims (media_key, channel_id, request_id, claimed_at, expires_at)
         SELECT ?1, CAST(c.value AS TEXT), ?2, ?3, ?4
         FROM json_each(?5) AS c`,
      ).bind(identity.key, requestId, now, expiresAt, JSON.stringify(requested))
    : db.prepare(
        `INSERT OR IGNORE INTO delivery_claims (media_key, channel_id, request_id, claimed_at, expires_at)
         SELECT ?1, CAST(c.value AS TEXT), ?2, ?3, ?4
         FROM json_each(?5) AS c
         WHERE NOT EXISTS (
           SELECT 1 FROM media_deliveries d
           WHERE d.media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?6))
             AND d.channel_id = CAST(c.value AS TEXT)
         )`,
      ).bind(identity.key, requestId, now, expiresAt, JSON.stringify(requested), JSON.stringify(lookupKeys));

  // Always fetch the existing delivery rows. For force=true they are not used
  // to block the send, but retaining them lets the response explain exactly
  // which previous Telegram messages will be superseded by the forced resend.
  const deliveredLookup = db.prepare(
    `SELECT
       channel_id, telegram_chat_id, message_thread_id, telegram_chat_title,
       first_message_ids_json, last_message_ids_json, send_count,
       first_sent_at, last_sent_at, presentation_json, presentation_updated_at
     FROM media_deliveries
     WHERE media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?1))
       AND channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?2))
     ORDER BY last_sent_at DESC`,
  ).bind(JSON.stringify(lookupKeys), JSON.stringify(requested));

  const results = await db.batch([
    db.prepare("DELETE FROM delivery_claims WHERE expires_at <= ?1").bind(now),
    claimInsert,
    db.prepare(
      `SELECT channel_id, request_id FROM delivery_claims
       WHERE media_key = ?1
         AND channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?2))`,
    ).bind(identity.key, JSON.stringify(requested)),
    deliveredLookup,
  ]);

  const claimRows = (results[2]?.results || []) as Array<{ channel_id: string; request_id: string }>;
  const deliveredRows = (results[3]?.results || []) as Array<StoredDeliveryRow>;
  const alreadySentDeliveries = deliveredRows.map(formatDeliveryHistoryRecord);
  const deliveredChannels = new Set(alreadySentDeliveries.map((delivery) => delivery.channelId));
  const alreadySent = options.force ? new Set<string>() : deliveredChannels;
  const acquired = new Set(claimRows.filter((row) => row.request_id === requestId).map((row) => row.channel_id));
  const inProgress = requested.filter((channelId) => !alreadySent.has(channelId) && !acquired.has(channelId));

  return {
    requestId,
    requested,
    acquired: requested.filter((channelId) => acquired.has(channelId)),
    alreadySent: requested.filter((channelId) => alreadySent.has(channelId)),
    inProgress,
    alreadySentDeliveries,
    queryCount: 4,
  };
}

export async function releaseDeliveryClaims(
  db: D1Database,
  identity: MediaIdentity | string,
  requestId: string,
  channels?: string[],
): Promise<void> {
  const key = typeof identity === "string" ? identity : identity.key;
  const requested = [...new Set((channels || []).map((channel) => channel.trim()).filter(Boolean))];
  if (requested.length) {
    await db.prepare(
      `DELETE FROM delivery_claims
       WHERE media_key = ?1 AND request_id = ?2
         AND channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?3))`,
    ).bind(key, requestId, JSON.stringify(requested)).run();
    return;
  }
  await db.prepare("DELETE FROM delivery_claims WHERE media_key = ?1 AND request_id = ?2").bind(key, requestId).run();
}

export interface PersistKnownMediaInput {
  identity: MediaIdentity;
  sourceUrl?: string | null;
  pageUrl?: string | null;
  mediaType?: MediaType | AlbumMediaType | "album" | "pending";
  mediaCount?: number;
  metadata?: Record<string, string> | null;
  caption?: string | null;
  parseMode?: string | null;
  resolvedMediaUrl?: string | null;
  mediaStatus?: "pending" | "ready" | "sent";
  captionProvided?: boolean;
  metadataProvided?: boolean;
  mediaSha256?: string | null;
  mediaFingerprint?: string | null;
  mediaFingerprintVersion?: number | null;
  mediaByteLength?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
}

/**
 * Persist knowledge about a media item without claiming it was delivered.
 * This is the caption-first half of the relay reconciliation model.
 */
export async function persistKnownMedia(
  db: D1Database,
  input: PersistKnownMediaInput,
): Promise<void> {
  const now = new Date().toISOString();
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  const caption = String(input.caption || "").trim() || null;
  const status = input.mediaStatus || (input.resolvedMediaUrl ? "ready" : "pending");

  await db.prepare(
    `INSERT INTO media (
      media_key, provider, provider_media_id, canonical_url, source_url, page_url,
      media_type, media_count, metadata_json, caption, caption_parse_mode,
      resolved_media_url, media_status, media_sha256, media_fingerprint,
      media_fingerprint_version, media_byte_length, media_width, media_height,
      first_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(media_key) DO UPDATE SET
      canonical_url = excluded.canonical_url,
      source_url = COALESCE(excluded.source_url, media.source_url),
      page_url = COALESCE(excluded.page_url, media.page_url),
      media_type = CASE WHEN excluded.media_type = 'pending' THEN media.media_type ELSE excluded.media_type END,
      media_count = MAX(media.media_count, excluded.media_count),
      metadata_json = CASE WHEN ?22 THEN excluded.metadata_json ELSE COALESCE(excluded.metadata_json, media.metadata_json) END,
      caption = CASE WHEN ?23 THEN excluded.caption ELSE COALESCE(NULLIF(excluded.caption, ''), media.caption) END,
      caption_parse_mode = CASE
        WHEN ?23 OR NULLIF(excluded.caption, '') IS NOT NULL THEN excluded.caption_parse_mode
        ELSE media.caption_parse_mode
      END,
      resolved_media_url = COALESCE(excluded.resolved_media_url, media.resolved_media_url),
      media_sha256 = COALESCE(excluded.media_sha256, media.media_sha256),
      media_fingerprint = COALESCE(excluded.media_fingerprint, media.media_fingerprint),
      media_fingerprint_version = COALESCE(excluded.media_fingerprint_version, media.media_fingerprint_version),
      media_byte_length = COALESCE(excluded.media_byte_length, media.media_byte_length),
      media_width = COALESCE(excluded.media_width, media.media_width),
      media_height = COALESCE(excluded.media_height, media.media_height),
      media_status = CASE
        WHEN media.media_status = 'sent' THEN 'sent'
        WHEN excluded.media_status = 'ready' THEN 'ready'
        ELSE media.media_status
      END,
      updated_at = excluded.updated_at`,
  ).bind(
    input.identity.key,
    input.identity.provider,
    input.identity.providerMediaId,
    input.identity.canonicalUrl,
    input.sourceUrl || null,
    input.pageUrl || null,
    input.mediaType || "pending",
    Math.max(1, input.mediaCount || 1),
    metadataJson,
    caption,
    caption ? input.parseMode || null : null,
    input.resolvedMediaUrl || null,
    status,
    input.mediaSha256 || null,
    input.mediaFingerprint || null,
    input.mediaFingerprintVersion ?? null,
    input.mediaByteLength ?? null,
    input.mediaWidth ?? null,
    input.mediaHeight ?? null,
    now,
    now,
    input.metadataProvided === true ? 1 : 0,
    input.captionProvided === true ? 1 : 0,
  ).run();
}

export async function persistSuccessfulDeliveries(
  db: D1Database,
  input: PersistMediaInput,
): Promise<string[]> {
  if (!input.deliveries.length) return [];
  const now = new Date().toISOString();
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  const presentationJson = serializePresentationSnapshot(buildPresentationSnapshot({
    caption: input.caption || "",
    parseMode: input.parseMode || null,
    metadata: input.presentationMetadata ?? null,
  }));
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO media (
        media_key, provider, provider_media_id, canonical_url, source_url, page_url,
        media_type, media_count, metadata_json, caption, caption_parse_mode,
        resolved_media_url, media_status, media_sha256, media_fingerprint,
        media_fingerprint_version, media_byte_length, media_width, media_height,
        first_seen_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_key) DO UPDATE SET
        canonical_url = excluded.canonical_url,
        source_url = COALESCE(excluded.source_url, media.source_url),
        page_url = COALESCE(excluded.page_url, media.page_url),
        media_type = excluded.media_type,
        media_count = excluded.media_count,
        metadata_json = COALESCE(excluded.metadata_json, media.metadata_json),
        caption = COALESCE(NULLIF(excluded.caption, ''), media.caption),
        caption_parse_mode = CASE
          WHEN NULLIF(excluded.caption, '') IS NOT NULL THEN excluded.caption_parse_mode
          ELSE media.caption_parse_mode
        END,
        resolved_media_url = COALESCE(excluded.resolved_media_url, media.resolved_media_url),
        media_sha256 = COALESCE(excluded.media_sha256, media.media_sha256),
        media_fingerprint = COALESCE(excluded.media_fingerprint, media.media_fingerprint),
        media_fingerprint_version = COALESCE(excluded.media_fingerprint_version, media.media_fingerprint_version),
        media_byte_length = COALESCE(excluded.media_byte_length, media.media_byte_length),
        media_width = COALESCE(excluded.media_width, media.media_width),
        media_height = COALESCE(excluded.media_height, media.media_height),
        media_status = CASE
          WHEN excluded.media_status = 'sent' THEN 'sent'
          WHEN media.media_status = 'sent' THEN 'sent'
          ELSE excluded.media_status
        END,
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
      input.caption || null,
      input.parseMode || null,
      input.resolvedMediaUrl || null,
      input.mediaStatus || "sent",
      input.mediaSha256 || null,
      input.mediaFingerprint || null,
      input.mediaFingerprintVersion ?? null,
      input.mediaByteLength ?? null,
      input.mediaWidth ?? null,
      input.mediaHeight ?? null,
      now,
      now,
    ),
  ];

  for (const delivery of input.deliveries) {
    const messageIds = JSON.stringify(delivery.messageIds.filter((id): id is number => typeof id === "number"));
    statements.push(
      db.prepare(
        `INSERT INTO media_deliveries (
          media_key, channel_id, telegram_chat_id, message_thread_id, telegram_chat_title,
          first_message_ids_json, last_message_ids_json, send_count, first_sent_at, last_sent_at,
          presentation_json, presentation_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(media_key, channel_id) DO UPDATE SET
          telegram_chat_id = excluded.telegram_chat_id,
          message_thread_id = excluded.message_thread_id,
          telegram_chat_title = COALESCE(excluded.telegram_chat_title, media_deliveries.telegram_chat_title),
          last_message_ids_json = excluded.last_message_ids_json,
          send_count = media_deliveries.send_count + 1,
          last_sent_at = excluded.last_sent_at,
          presentation_json = excluded.presentation_json,
          presentation_updated_at = excluded.presentation_updated_at`,
      ).bind(
        input.identity.key,
        delivery.requestedChatId,
        delivery.telegramChatId == null ? null : String(delivery.telegramChatId),
        parseTelegramDestination(delivery.requestedChatId)?.messageThreadId ?? null,
        delivery.telegramChatTitle,
        messageIds,
        messageIds,
        now,
        now,
        presentationJson,
        now,
      ),
    );
  }

  await db.batch(statements);
  return input.deliveries.map((delivery) => delivery.requestedChatId);
}


export async function updateDeliveryPresentationSnapshots(
  db: D1Database,
  mediaKey: string,
  updates: Array<{ channelId: string; presentationJson: string }>,
): Promise<void> {
  if (!updates.length) return;
  const now = new Date().toISOString();
  const statements = updates.map((update) =>
    db.prepare(
      `UPDATE media_deliveries
       SET presentation_json = ?3, presentation_updated_at = ?4
       WHERE media_key = ?1 AND channel_id = ?2`,
    ).bind(mediaKey, update.channelId, update.presentationJson, now),
  );
  await db.batch(statements);
}


export interface ContentDuplicateMatch {
  matchType: "exact_hash" | "robust_fingerprint";
  similarity: number;
  mediaKey: string;
  provider: string;
  sourceUrl: string | null;
  pageUrl: string | null;
  mediaSha256: string | null;
  mediaFingerprint: string | null;
  mediaByteLength: number | null;
  deliveries: DeliveryHistoryRecord[];
}

/**
 * Finds previously delivered Worker-owned media by exact SHA-256 first and then
 * by a deliberately conservative robustness fingerprint. The query is scoped
 * to requested channels so content-level dedupe preserves the relay's existing
 * per-destination delivery semantics.
 *
 * @example
 * const matches = await findContentDuplicateMatches(db, {
 *   mediaKey: "twitter:123",
 *   sha256: "...",
 *   fingerprint: "...",
 *   fingerprintVersion: 1,
 *   byteLength: 8_000_000,
 *   width: 1080,
 *   height: 1920,
 * }, ["-1001:65"]);
 * // Returns only previously delivered matches for that destination.
 */
export async function findContentDuplicateMatches(
  db: D1Database,
  input: {
    mediaKey: string;
    sha256?: string | null;
    fingerprint?: string | null;
    fingerprintVersion?: number | null;
    byteLength?: number | null;
    width?: number | null;
    height?: number | null;
  },
  channels: string[],
): Promise<ContentDuplicateMatch[]> {
  const requestedChannels = [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))];
  if (!requestedChannels.length) return [];

  const matches = new Map<string, ContentDuplicateMatch>();
  const exactHash = String(input.sha256 || "").trim().toLowerCase();

  if (exactHash) {
    const result = await db.prepare(
      `SELECT
        m.media_key, m.provider, m.source_url, m.page_url,
        m.media_sha256, m.media_fingerprint, m.media_byte_length,
        d.channel_id, d.telegram_chat_id, d.message_thread_id, d.telegram_chat_title,
        d.first_message_ids_json, d.last_message_ids_json, d.send_count,
        d.first_sent_at, d.last_sent_at
       FROM media AS m
       INNER JOIN media_deliveries AS d ON d.media_key = m.media_key
       WHERE m.media_sha256 = ?1
         AND m.media_key <> ?2
         AND d.channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?3))
       ORDER BY d.last_sent_at DESC
       LIMIT 100`,
    ).bind(exactHash, input.mediaKey, JSON.stringify(requestedChannels)).all<StoredMediaRow & Partial<StoredDeliveryRow>>();

    mergeContentDuplicateRows(matches, result.results || [], "exact_hash", 1);
  }

  const fingerprint = String(input.fingerprint || "").trim().toLowerCase();
  const version = Number(input.fingerprintVersion || 0);
  // An exact hash is definitive. Avoid the broader candidate scan when one is
  // already present because that scan exists only for changed/recompressed media.
  if (!matches.size && fingerprint && version > 0) {
    const result = await db.prepare(
      `SELECT
        m.media_key, m.provider, m.source_url, m.page_url,
        m.media_sha256, m.media_fingerprint, m.media_fingerprint_version,
        m.media_byte_length, m.media_width, m.media_height,
        d.channel_id, d.telegram_chat_id, d.message_thread_id, d.telegram_chat_title,
        d.first_message_ids_json, d.last_message_ids_json, d.send_count,
        d.first_sent_at, d.last_sent_at
       FROM media AS m
       INNER JOIN media_deliveries AS d ON d.media_key = m.media_key
       WHERE m.media_type = 'video'
         AND m.media_fingerprint_version = ?1
         AND m.media_key <> ?2
         AND d.channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?3))
       ORDER BY d.last_sent_at DESC
       LIMIT 200`,
    ).bind(version, input.mediaKey, JSON.stringify(requestedChannels)).all<StoredMediaRow & Partial<StoredDeliveryRow>>();

    const inputSize = Number(input.byteLength || 0);
    for (const row of result.results || []) {
      const candidateFingerprint = String(row.media_fingerprint || "");
      if (!candidateFingerprint) continue;
      if (input.width && input.height && row.media_width && row.media_height) {
        const sameShape =
          input.width === row.media_width && input.height === row.media_height;
        if (!sameShape) continue;
      }
      const candidateSize = Number(row.media_byte_length || 0);
      if (inputSize > 0 && candidateSize > 0) {
        const ratio = Math.max(inputSize, candidateSize) / Math.min(inputSize, candidateSize);
        if (ratio > 2.8) continue;
      }
      const similarity = compareMediaFingerprints(fingerprint, candidateFingerprint);
      if (similarity < 0.985) continue;
      mergeContentDuplicateRows(matches, [row], "robust_fingerprint", similarity);
    }
  }

  return [...matches.values()].sort((left, right) => right.similarity - left.similarity);
}

/**
 * Merges duplicate-query rows into one media match while retaining every
 * relevant Telegram delivery attached to the candidate media row.
 *
 * @example
 * mergeContentDuplicateRows(map, rows, "exact_hash", 1);
 * // The map contains one candidate with all matching destination history.
 */
function mergeContentDuplicateRows(
  target: Map<string, ContentDuplicateMatch>,
  rows: Array<StoredMediaRow & Partial<StoredDeliveryRow>>,
  matchType: ContentDuplicateMatch["matchType"],
  similarity: number,
): void {
  for (const row of rows) {
    const delivery = row.channel_id
      ? formatDeliveryHistoryRecord({
          channel_id: row.channel_id,
          telegram_chat_id: row.telegram_chat_id ?? null,
          message_thread_id: row.message_thread_id ?? null,
          telegram_chat_title: row.telegram_chat_title ?? null,
          first_message_ids_json: row.first_message_ids_json ?? "[]",
          last_message_ids_json: row.last_message_ids_json ?? "[]",
          send_count: row.send_count ?? 1,
          first_sent_at: row.first_sent_at ?? "",
          last_sent_at: row.last_sent_at ?? "",
          presentation_json: row.presentation_json ?? null,
          presentation_updated_at: row.presentation_updated_at ?? null,
        })
      : null;
    const existing = target.get(row.media_key);
    if (!existing) {
      target.set(row.media_key, {
        matchType,
        similarity,
        mediaKey: row.media_key,
        provider: row.provider,
        sourceUrl: row.source_url ?? null,
        pageUrl: row.page_url ?? null,
        mediaSha256: row.media_sha256 ?? null,
        mediaFingerprint: row.media_fingerprint ?? null,
        mediaByteLength: row.media_byte_length ?? null,
        deliveries: delivery ? [delivery] : [],
      });
      continue;
    }

    existing.matchType = existing.matchType === "exact_hash" ? "exact_hash" : matchType;
    existing.similarity = Math.max(existing.similarity, similarity);
    if (delivery && !existing.deliveries.some((entry) => entry.channelId === delivery.channelId)) {
      existing.deliveries.push(delivery);
    }
  }
}

export async function getStoredMedia(db: D1Database, mediaKey: string) {
  const rawKey = normalizeOpaqueMediaId(mediaKey);
  const legacyKey = legacyNormalizeKeyPart(rawKey);
  const keys = [...new Set([rawKey, legacyKey].filter(Boolean))];
  const media = await db
    .prepare(
      `SELECT * FROM media
       WHERE media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?1))
       ORDER BY CASE WHEN media_key = ?2 THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .bind(JSON.stringify(keys), rawKey)
    .first<StoredMediaRow>();
  if (!media) return null;
  const deliveries = await db
    .prepare("SELECT * FROM media_deliveries WHERE media_key = ? ORDER BY last_sent_at DESC")
    .bind(media.media_key)
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
  if (options.mediaId) {
    const opaqueId = normalizeOpaqueMediaId(options.mediaId);
    const legacyId = legacyNormalizeKeyPart(opaqueId);
    if (legacyId && legacyId !== opaqueId) {
      conditions.push("provider_media_id IN (?, ?)");
      values.push(opaqueId, legacyId);
    } else {
      conditions.push("provider_media_id = ?");
      values.push(opaqueId);
    }
  }
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
    caption: row.caption ?? null,
    parseMode: row.caption_parse_mode ?? null,
    resolvedMediaUrl: row.resolved_media_url ?? null,
    mediaSha256: row.media_sha256 ?? null,
    mediaFingerprint: row.media_fingerprint ?? null,
    mediaFingerprintVersion: row.media_fingerprint_version ?? null,
    mediaByteLength: row.media_byte_length ?? null,
    mediaWidth: row.media_width ?? null,
    mediaHeight: row.media_height ?? null,
    status: row.media_status || "sent",
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
  };
}


/**
 * Converts the D1 delivery row into the stable response shape used by duplicate
 * detection. The JSON message-id columns are deliberately parsed here so every
 * caller receives numeric Telegram message IDs rather than raw database strings.
 *
 * @example
 * Input: `{ channel_id: "-1001", last_message_ids_json: "[42]", ... }`
 * Output: `{ channelId: "-1001", lastMessageIds: [42], ... }`
 */
function formatDeliveryHistoryRecord(row: StoredDeliveryRow): DeliveryHistoryRecord {
  return {
    channelId: row.channel_id,
    telegramChatId: row.telegram_chat_id,
    messageThreadId: row.message_thread_id ?? null,
    telegramChatTitle: row.telegram_chat_title,
    firstMessageIds: numericMessageIds(row.first_message_ids_json),
    lastMessageIds: numericMessageIds(row.last_message_ids_json),
    sendCount: Math.max(0, Number(row.send_count || 0)),
    firstSentAt: row.first_sent_at || "",
    lastSentAt: row.last_sent_at || "",
    presentationJson: row.presentation_json ?? null,
    presentationUpdatedAt: row.presentation_updated_at ?? null,
  };
}

/** Parse a persisted Telegram message-id JSON array without allowing malformed data into the API. */
function numericMessageIds(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => typeof id === "number" && Number.isFinite(id))
      : [];
  } catch {
    return [];
  }
}

function formatDeliveryRow(row: StoredDeliveryRow) {
  return {
    channelId: row.channel_id,
    telegramChatId: row.telegram_chat_id,
    messageThreadId: row.message_thread_id ?? null,
    telegramChatTitle: row.telegram_chat_title,
    firstMessageIds: numericMessageIds(row.first_message_ids_json),
    lastMessageIds: numericMessageIds(row.last_message_ids_json),
    sendCount: row.send_count,
    firstSentAt: row.first_sent_at,
    lastSentAt: row.last_sent_at,
    presentationJson: row.presentation_json ?? null,
    presentationUpdatedAt: row.presentation_updated_at ?? null,
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
      // Instagram shortcodes are opaque/case-sensitive. Never lowercase them.
      return normalizeOpaqueMediaId(parsed.pathname.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/i)?.[1] || null);
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
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._@-]+/g, "-").slice(0, 120);
}

function normalizeOpaqueMediaId(value: unknown): string {
  // Provider IDs are opaque. Keep case and characters intact; only trim control
  // characters/whitespace and cap the key budget.
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 512);
}

function normalizeExplicitMediaKey(value: unknown, fallbackProvider: string): string {
  const raw = normalizeOpaqueMediaId(value);
  if (!raw) return "";
  const separator = raw.indexOf(":");
  if (separator <= 0) return `${fallbackProvider}:${raw}`;
  const provider = normalizeProviderKey(raw.slice(0, separator)) || fallbackProvider;
  const mediaId = normalizeOpaqueMediaId(raw.slice(separator + 1));
  return mediaId ? `${provider}:${mediaId}` : "";
}

function legacyNormalizeKeyPart(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._:@-]+/g, "-").slice(0, 240);
}

async function shortSha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
