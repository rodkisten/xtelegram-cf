import {
  checkStoredMediaDeliveries,
  resolveMediaIdentity,
  findStoredMedia,
  getAlreadyDeliveredChannels,
  getStoredMedia,
  persistSuccessfulDeliveries,
  requireRelayDb,
} from "./db";
import {
  inferTelegramMediaType,
  prepareMedia,
  resolveConcurrency,
  resolveHlsMaxMediaBytes,
  resolveMaxMediaBytes,
} from "./media";
import {
  normalizeOptionalSourceUrl,
  normalizePublicHttpUrl,
} from "./lib/http";
import {
  sendTelegramMediaGroupUrl,
  sendTelegramUpload,
  sendTelegramUrl,
  validateEnvironment,
} from "./telegram";
import { resolveSocialMedia, SocialResolverError, toRelayMediaType } from "./social";
import type {
  AlbumMediaType,
  Env,
  MediaType,
  ParseMode,
  PreparedMedia,
  RelayAlbumInput,
  RelayInput,
  TelegramApiResult,
  TelegramMessage,
} from "./types";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const ALLOWED_PARSE_MODES = new Set<ParseMode>([
  "HTML",
  "MarkdownV2",
]);

const ALLOWED_MEDIA_TYPES = new Set<MediaType>([
  "video",
  "audio",
  "document",
  "photo",
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handleOptions();
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealth();
    }

    if (request.method === "POST" && url.pathname === "/media/check") {
      return handleMediaCheck(request, env);
    }

    if (request.method === "GET" && (url.pathname === "/media" || url.pathname.startsWith("/media/"))) {
      return handleMediaQuery(request, env);
    }

    if (request.method === "POST" && url.pathname === "/send") {
      return handleSend(request, env);
    }

    if (request.method === "POST" && url.pathname === "/resolve") {
      return handleResolve(request, env, false);
    }

    if (request.method === "POST" && url.pathname === "/resolve-and-send") {
      return handleResolve(request, env, true);
    }

    if (request.method === "POST" && url.pathname === "/batch") {
      return handleBatch(request, env);
    }

    return json(
      {
        ok: false,
        error: "Not found",
      },
      404,
    );
  },
};

interface ResolveRequestBody {
  url?: unknown; sourceUrl?: unknown; channel?: unknown; channels?: unknown;
  caption?: unknown; parseMode?: unknown; metadata?: unknown;
  mediaId?: unknown; mediaKey?: unknown; force?: unknown;
}

async function handleResolve(request: Request, env: Env, send: boolean): Promise<Response> {
  //if (!isAuthorized(request, env)) return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
  let body: ResolveRequestBody;
  try { body = (await request.json()) as ResolveRequestBody; } catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }
  const sourceUrl = typeof body.url === "string" ? body.url.trim() : typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const normalized = normalizePublicHttpUrl(sourceUrl);
  if (!normalized) return json({ ok: false, error: "url/sourceUrl must be a public HTTP(S) URL" }, 400);
  let resolution;
  try { resolution = await resolveSocialMedia(normalized.href, env); } catch (error) {
    return json({ ok: false, error: getErrorMessage(error), stage: "social-resolver", attempts: error instanceof SocialResolverError ? error.attempts : undefined }, 422);
  }
  if (!send) return json({ ok: true, ...resolution });

  const channels = normalizeResolveChannels(body);
  const caption = typeof body.caption === "string" ? body.caption : resolution.caption || resolution.title || "";
  const parseMode = ALLOWED_PARSE_MODES.has(body.parseMode as ParseMode) ? body.parseMode as ParseMode : null;
  const common = { sourceUrl: resolution.sourceUrl, pageUrl: resolution.sourceUrl, provider: resolution.source, caption, parseMode, channels, mediaId: typeof body.mediaId === "string" ? body.mediaId : undefined, mediaKey: typeof body.mediaKey === "string" ? body.mediaKey : undefined, force: body.force === true, metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : { resolver: resolution.resolver } };
  const albumCompatible = resolution.media.length >= 2 && resolution.media.every((item) => item.type === "photo" || item.type === "video");
  if (albumCompatible) {
    const relayBody = {
      ...common,
      mediaItems: resolution.media.map((item) => ({
        mediaUrl: item.url,
        mediaType: toRelayMediaType(item.type),
      })),
    };
    const response = await handleSend(cloneAuthorizedJsonRequest(request, relayBody), env);
    return mergeResolveResponse(response, resolution);
  }

  const deliveries: unknown[] = [];
  for (const item of resolution.media) {
    const response = await handleSend(
      cloneAuthorizedJsonRequest(request, {
        ...common,
        mediaUrl: item.url,
        mediaType: toRelayMediaType(item.type),
        mediaHeaders: item.mediaHeaders,
        mediaKey: common.mediaKey ? `${common.mediaKey}:${item.index}` : undefined,
        mediaId: common.mediaId ? `${common.mediaId}:${item.index}` : undefined,
      }),
      env,
    );
    const result = await response.json();
    deliveries.push({ media: item, status: response.status, result });
    if (!response.ok) return json({ ok: false, stage: "resolved-delivery", resolution, deliveries }, response.status);
  }
  return json({ ok: true, message: `Resolved and sent ${deliveries.length} media item(s)`, resolution, deliveries });
}

function normalizeResolveChannels(body: ResolveRequestBody): string[] {
  const values: string[] = [];
  if (typeof body.channel === "string") values.push(body.channel);
  if (Array.isArray(body.channels)) for (const value of body.channels) if (typeof value === "string") values.push(value);
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function cloneAuthorizedJsonRequest(request: Request, body: unknown): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  const authorization = request.headers.get("Authorization"); if (authorization) headers.set("Authorization", authorization);
  return new Request(new URL("/send", request.url), { method: "POST", headers, body: JSON.stringify(body) });
}
async function mergeResolveResponse(response: Response, resolution: unknown): Promise<Response> {
  const payload = (await response.json()) as Record<string, unknown>; return json({ ...payload, resolution }, response.status);
}



interface MediaCheckBody {
  items?: unknown;
  channel?: unknown;
  channels?: unknown;
}

type MediaCheckInputObject = {
  mediaKey?: unknown;
  provider?: unknown;
  mediaId?: unknown;
  url?: unknown;
  sourceUrl?: unknown;
  pageUrl?: unknown;
  mediaUrl?: unknown;
};

type NormalizedMediaCheckInput = {
  index: number;
  input: unknown;
  identity: Awaited<ReturnType<typeof resolveMediaIdentity>>;
};

const MAX_MEDIA_CHECK_ITEMS = 100;
const MAX_MEDIA_CHECK_CHANNELS = 100;

async function handleMediaCheck(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
  }

  let body: MediaCheckBody;
  try {
    body = await request.json() as MediaCheckBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return json({ ok: false, error: "items must be a non-empty array" }, 400);
  }
  if (body.items.length > MAX_MEDIA_CHECK_ITEMS) {
    return json({ ok: false, error: `items can contain at most ${MAX_MEDIA_CHECK_ITEMS} entries` }, 400);
  }

  const channelValidation = normalizeTelegramChannels(body.channel, body.channels);
  if (!channelValidation.ok) {
    return json({ ok: false, error: channelValidation.error }, 400);
  }
  const requestedChannels = [...new Set(channelValidation.value)];
  if (requestedChannels.length > MAX_MEDIA_CHECK_CHANNELS) {
    return json({ ok: false, error: `channels can contain at most ${MAX_MEDIA_CHECK_CHANNELS} entries` }, 400);
  }

  let db: D1Database;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }

  const valid: NormalizedMediaCheckInput[] = [];
  const invalid = new Map<number, string>();

  await Promise.all(body.items.map(async (input, index) => {
    try {
      const identityInput = normalizeMediaCheckIdentityInput(input);
      if (!identityInput) {
        invalid.set(index, "Provide a mediaKey, provider + mediaId, or an HTTP(S) URL");
        return;
      }
      const identity = await resolveMediaIdentity(identityInput);
      valid.push({ index, input, identity });
    } catch (error) {
      invalid.set(index, getErrorMessage(error));
    }
  }));
  valid.sort((left, right) => left.index - right.index);

  const validByIndex = new Map(valid.map((item) => [item.index, item]));
  const uniqueIdentities = [...new Map(valid.map((item) => [item.identity.key, item.identity])).values()];
  const records = await checkStoredMediaDeliveries(db, uniqueIdentities, requestedChannels);

  const results = body.items.map((input, index) => {
    const validationError = invalid.get(index);
    if (validationError) {
      return {
        index,
        input,
        valid: false,
        exists: false,
        error: validationError,
        channels: [],
        ...(requestedChannels.length ? { requestedChannels: buildRequestedChannelStatus(requestedChannels, []) } : {}),
      };
    }

    const normalized = validByIndex.get(index)!;
    const record = records.get(normalized.identity.key);
    const deliveries = record?.deliveries ?? [];

    return {
      index,
      input,
      valid: true,
      mediaKey: normalized.identity.key,
      provider: normalized.identity.provider,
      mediaId: normalized.identity.providerMediaId,
      canonicalUrl: normalized.identity.canonicalUrl,
      exists: Boolean(record),
      media: record?.media ?? null,
      channels: deliveries,
      ...(requestedChannels.length
        ? { requestedChannels: buildRequestedChannelStatus(requestedChannels, deliveries) }
        : {}),
    };
  });

  const uniqueFound = uniqueIdentities.filter((identity) => records.has(identity.key)).length;
  const validCount = valid.length;
  const foundInputs = results.filter((item) => item.valid && item.exists).length;

  return json({
    ok: true,
    results,
    meta: {
      requested: body.items.length,
      valid: validCount,
      invalid: body.items.length - validCount,
      unique: uniqueIdentities.length,
      found: uniqueFound,
      missing: uniqueIdentities.length - uniqueFound,
      foundInputs,
      queryCount: uniqueIdentities.length ? 1 : 0,
      channelFilterCount: requestedChannels.length,
    },
  });
}

function normalizeMediaCheckIdentityInput(input: unknown): {
  mediaKey?: string | null;
  provider?: string | null;
  mediaId?: string | null;
  sourceUrl?: string | null;
  pageUrl?: string | null;
  mediaUrl?: string | null;
} | null {
  if (typeof input === "string") {
    const value = input.trim();
    if (!value) return null;
    const url = normalizePublicHttpUrl(value);
    return url ? { sourceUrl: url.href } : value.includes(":") ? { mediaKey: value } : null;
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const item = input as MediaCheckInputObject;
  const mediaKey = typeof item.mediaKey === "string" ? item.mediaKey.trim() : "";
  const provider = typeof item.provider === "string" ? item.provider.trim() : "";
  const mediaId = typeof item.mediaId === "string" ? item.mediaId.trim() : "";
  const rawUrl = [item.url, item.sourceUrl, item.pageUrl, item.mediaUrl].find((value) => typeof value === "string" && value.trim()) as string | undefined;
  const normalizedUrl = rawUrl ? normalizePublicHttpUrl(rawUrl) : null;

  if (mediaKey) return { mediaKey, provider: provider || null, mediaId: mediaId || null, sourceUrl: normalizedUrl?.href ?? null };
  if (provider && mediaId) return { provider, mediaId, sourceUrl: normalizedUrl?.href ?? null };
  if (normalizedUrl) return { provider: provider || null, mediaId: mediaId || null, sourceUrl: normalizedUrl.href };
  return null;
}

function buildRequestedChannelStatus(
  requestedChannels: string[],
  deliveries: Array<{ channelId: string; sendCount: number; firstSentAt: string; lastSentAt: string }>,
): Record<string, { sent: boolean; sendCount: number; firstSentAt: string | null; lastSentAt: string | null }> {
  const byChannel = new Map(deliveries.map((delivery) => [delivery.channelId, delivery]));
  return Object.fromEntries(requestedChannels.map((channelId) => {
    const delivery = byChannel.get(channelId);
    return [channelId, delivery
      ? { sent: true, sendCount: delivery.sendCount, firstSentAt: delivery.firstSentAt, lastSentAt: delivery.lastSentAt }
      : { sent: false, sendCount: 0, firstSentAt: null, lastSentAt: null }];
  }));
}

async function handleMediaQuery(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
  let db: D1Database;
  try { db = requireRelayDb(env); } catch (error) { return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500); }
  const url = new URL(request.url);
  const pathKey = url.pathname.startsWith("/media/") ? decodeURIComponent(url.pathname.slice("/media/".length)) : "";
  const key = pathKey || url.searchParams.get("key") || "";
  if (key) {
    const record = await getStoredMedia(db, key);
    return record ? json({ ok: true, ...record }) : json({ ok: false, error: "Media not found", key }, 404);
  }
  const limitValue = Number(url.searchParams.get("limit") || 25);
  const items = await findStoredMedia(db, {
    provider: url.searchParams.get("provider"),
    mediaId: url.searchParams.get("mediaId"),
    sourceUrl: url.searchParams.get("sourceUrl"),
    limit: Number.isFinite(limitValue) ? limitValue : 25,
  });
  return json({ ok: true, count: items.length, items });
}

interface BatchBody {
  links?: unknown;
  items?: unknown;
  channel?: unknown;
  channels?: unknown;
  force?: unknown;
  caption?: unknown;
  parseMode?: unknown;
  metadata?: unknown;
  concurrency?: unknown;
}

type BatchPreparedItem = {
  index: number;
  input: Record<string, unknown>;
  payload: Record<string, unknown>;
  channels: string[];
  force: boolean;
  identity: Awaited<ReturnType<typeof resolveMediaIdentity>> | null;
  isDirect: boolean;
  preSkipped: Array<{ channelId: string; reason: "already_sent" | "duplicate_in_batch" }>;
};

const MAX_BATCH_ITEMS = 50;
const DEFAULT_BATCH_CONCURRENCY = 3;
const MAX_BATCH_CONCURRENCY = 5;

async function handleBatch(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
  }

  let body: BatchBody;
  try {
    body = await request.json() as BatchBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const rawItems = Array.isArray(body.items) ? body.items : Array.isArray(body.links) ? body.links : null;
  if (!rawItems?.length) {
    return json({ ok: false, error: "Batch requires a non-empty links[] or items[] array." }, 400);
  }
  if (rawItems.length > MAX_BATCH_ITEMS) {
    return json({ ok: false, error: `A batch can contain at most ${MAX_BATCH_ITEMS} links/items.` }, 400);
  }

  const channelValidation = normalizeTelegramChannels(body.channel, body.channels);
  if (!channelValidation.ok) return json({ ok: false, error: channelValidation.error }, 400);
  const sharedChannels = resolveTelegramChatIds(channelValidation.value, env.TELEGRAM_CHAT_ID);
  if (!sharedChannels.length) return json({ ok: false, error: "No Telegram channel was provided." }, 400);

  let db: D1Database;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }

  const invalidResults = new Map<number, Record<string, unknown>>();
  const prepared: BatchPreparedItem[] = [];

  await Promise.all(rawItems.map(async (raw, index) => {
    const item = typeof raw === "string"
      ? { url: raw }
      : raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : null;

    if (!item) {
      invalidResults.set(index, { index, ok: false, status: 400, error: "Batch item must be a URL string or object." });
      return;
    }

    const itemChannelsValidation = item.channel !== undefined || item.channels !== undefined
      ? normalizeTelegramChannels(item.channel, item.channels)
      : { ok: true as const, value: sharedChannels };
    if (!itemChannelsValidation.ok) {
      invalidResults.set(index, { index, ok: false, status: 400, error: itemChannelsValidation.error });
      return;
    }

    const channels = resolveTelegramChatIds(
      itemChannelsValidation.value.length ? itemChannelsValidation.value : sharedChannels,
      env.TELEGRAM_CHAT_ID,
    );
    if (!channels.length) {
      invalidResults.set(index, { index, ok: false, status: 400, error: "No Telegram channel was provided for this batch item." });
      return;
    }

    const force = item.force === true || (item.force === undefined && body.force === true);
    const payload: Record<string, unknown> = {
      ...item,
      channels,
      force,
      caption: item.caption ?? body.caption,
      parseMode: item.parseMode ?? body.parseMode,
      metadata: item.metadata ?? body.metadata,
    };
    delete payload.channel;

    const isDirect = "mediaUrl" in payload || "photoUrl" in payload || "videoUrl" in payload ||
      "fileUrl" in payload || "mediaItems" in payload || "mediaUrls" in payload || "photoUrls" in payload;

    let identity: Awaited<ReturnType<typeof resolveMediaIdentity>> | null = null;
    try {
      const identityInput = normalizeMediaCheckIdentityInput(payload);
      if (identityInput) identity = await resolveMediaIdentity(identityInput);
    } catch {
      // Identity can still be resolved later by /send after a social resolver runs.
      // We only skip the batch preflight for this item.
    }

    prepared.push({ index, input: item, payload, channels, force, identity, isDirect, preSkipped: [] });
  }));
  prepared.sort((left, right) => left.index - right.index);

  // One D1 query for every non-forced item whose identity is already known.
  // This replaces the old "one duplicate lookup per item" batch behavior.
  const preflightItems = prepared.filter((item) => !item.force && item.identity);
  const preflightIdentities = [...new Map(
    preflightItems.map((item) => [item.identity!.key, item.identity!]),
  ).values()];
  const preflightChannels = [...new Set(preflightItems.flatMap((item) => item.channels))];
  const existing = preflightIdentities.length
    ? await checkStoredMediaDeliveries(db, preflightIdentities, preflightChannels)
    : new Map();

  // Prevent duplicate media/channel combinations inside the same request from
  // being scheduled twice. force=true intentionally bypasses this protection.
  const scheduledByMediaKey = new Map<string, Set<string>>();
  for (const item of prepared) {
    if (item.force || !item.identity) continue;
    const existingChannels = new Set((existing.get(item.identity.key)?.deliveries ?? []).map((delivery: { channelId: string }) => delivery.channelId));
    const scheduled = scheduledByMediaKey.get(item.identity.key) ?? new Set<string>();
    const preSkipped: BatchPreparedItem["preSkipped"] = [];
    for (const channelId of item.channels) {
      if (existingChannels.has(channelId)) preSkipped.push({ channelId, reason: "already_sent" });
      else if (scheduled.has(channelId)) preSkipped.push({ channelId, reason: "duplicate_in_batch" });
    }
    item.preSkipped = preSkipped;
    const skippedChannelIds = new Set(item.preSkipped.map((entry) => entry.channelId));
    const channelsToSchedule = item.channels.filter((channelId) => !skippedChannelIds.has(channelId));
    channelsToSchedule.forEach((channelId) => scheduled.add(channelId));
    scheduledByMediaKey.set(item.identity.key, scheduled);
    item.payload.channels = channelsToSchedule;
  }

  const concurrency = normalizeBatchConcurrency(body.concurrency);
  const processed = await mapWithConcurrency(prepared, concurrency, async (item) => {
    const channelsToSend = Array.isArray(item.payload.channels)
      ? item.payload.channels.filter((value): value is string => typeof value === "string")
      : item.channels;

    if (!item.force && item.identity && channelsToSend.length === 0) {
      return {
        index: item.index,
        ok: false,
        partial: false,
        conflict: true,
        status: 409,
        error: "Media was already sent to every requested Telegram channel or duplicated inside this batch.",
        media: item.identity,
        channels: {
          requested: item.channels,
          attempted: [],
          inserted: [],
          notSent: item.preSkipped,
        },
      } as Record<string, unknown>;
    }

    const internal = cloneAuthorizedJsonRequest(request, item.payload);
    const response = item.isDirect ? await handleSend(internal, env) : await handleResolve(internal, env, true);
    const result = await response.json() as Record<string, unknown>;
    const merged = mergeBatchPreflightResult(result, item.channels, item.preSkipped);
    return { index: item.index, status: response.status, ...merged };
  });

  const resultByIndex = new Map<number, Record<string, unknown>>();
  for (const result of processed) resultByIndex.set(Number(result.index), result);
  for (const [index, result] of invalidResults) resultByIndex.set(index, result);
  const results = rawItems.map((_, index) => resultByIndex.get(index) ?? {
    index,
    ok: false,
    status: 500,
    error: "Batch item did not produce a result.",
  });

  const succeeded = results.filter((item) => item.ok === true).length;
  const conflicts = results.filter((item) => item.status === 409 || item.conflict === true).length;
  const failed = results.length - succeeded;
  const insertedChannels = results.reduce((total, item) => {
    const channels = item.channels as { inserted?: unknown } | undefined;
    return total + (Array.isArray(channels?.inserted) ? channels.inserted.length : 0);
  }, 0);
  const skippedAlreadySent = results.reduce((total, item) => {
    const channels = item.channels as { notSent?: unknown } | undefined;
    if (!Array.isArray(channels?.notSent)) return total;
    return total + channels.notSent.filter((failure) =>
      failure && typeof failure === "object" && (failure as { reason?: unknown }).reason === "already_sent"
    ).length;
  }, 0);
  const skippedDuplicateInBatch = results.reduce((total, item) => {
    const channels = item.channels as { notSent?: unknown } | undefined;
    if (!Array.isArray(channels?.notSent)) return total;
    return total + channels.notSent.filter((failure) =>
      failure && typeof failure === "object" && (failure as { reason?: unknown }).reason === "duplicate_in_batch"
    ).length;
  }, 0);
  const status = succeeded === results.length ? 200 : succeeded > 0 ? 207 : conflicts === results.length ? 409 : 502;

  return json({
    ok: succeeded > 0,
    partial: succeeded > 0 && failed > 0,
    summary: {
      requested: results.length,
      succeeded,
      failed,
      conflicts,
      insertedChannels,
      skippedAlreadySent,
      skippedDuplicateInBatch,
      preflightQueries: preflightIdentities.length ? 1 : 0,
      concurrency,
    },
    results,
  }, status);
}

function normalizeBatchConcurrency(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : DEFAULT_BATCH_CONCURRENCY;
  if (!Number.isFinite(numeric)) return DEFAULT_BATCH_CONCURRENCY;
  return Math.min(MAX_BATCH_CONCURRENCY, Math.max(1, Math.floor(numeric)));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function mergeBatchPreflightResult(
  result: Record<string, unknown>,
  requestedChannels: string[],
  preSkipped: Array<{ channelId: string; reason: "already_sent" | "duplicate_in_batch" }>,
): Record<string, unknown> {
  if (!preSkipped.length) return result;

  const channels = result.channels && typeof result.channels === "object" && !Array.isArray(result.channels)
    ? result.channels as Record<string, unknown>
    : {};
  const attempted = Array.isArray(channels.attempted) ? channels.attempted : [];
  const inserted = Array.isArray(channels.inserted) ? channels.inserted : [];
  const notSent = Array.isArray(channels.notSent) ? channels.notSent : [];
  const mergedNotSent = [
    ...preSkipped,
    ...notSent,
  ];

  return {
    ...result,
    partial: inserted.length > 0 && mergedNotSent.length > 0,
    channels: {
      ...channels,
      requested: requestedChannels,
      attempted,
      inserted,
      notSent: mergedNotSent,
    },
  };
}

function handleHealth(): Response {
  return json({
    ok: true,
    service: "generic-telegram-media-relay",
    version: "2.7.0",
    status: "online",
    runtime: "typescript-hls-remux-photo-album-d1-dedupe-batch-send",
    timestamp: new Date().toISOString(),
  });
}

async function handleSend(request: Request, env: Env): Promise<Response> {
  const configurationError = validateEnvironment(env);

  if (configurationError) {
    return json(
      {
        ok: false,
        error: configurationError,
      },
      500,
    );
  }

  if (!isAuthorized(request, env)) {
    return json(
      {
        ok: false,
        error: "Unauthorized",
        stage: "authorization",
        details: {
          expectedScheme: "Authorization: Bearer <RELAY_TOKEN>",
          authorizationHeaderPresent: Boolean(request.headers.get("Authorization")),
        },
      },
      401,
    );
  }

  const contentType = request.headers.get("Content-Type") || "";

  if (/^multipart\/form-data\b/i.test(contentType)) {
    return handleMultipartSend(request, env);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: "Invalid JSON body",
      },
      400,
    );
  }

  const albumValidation = validateAlbumRequestBody(body);

  if (albumValidation.kind === "invalid") {
    return json(
      {
        ok: false,
        error: albumValidation.error,
      },
      400,
    );
  }

  if (albumValidation.kind === "valid") {
    return handleJsonAlbumSend(albumValidation.value, env);
  }

  const validation = validateRequestBody(body);

  if (!validation.ok) {
    return json(
      {
        ok: false,
        error: validation.error,
      },
      400,
    );
  }

  const input = validation.value;
  const chatIds = resolveTelegramChatIds(
    input.channels,
    env.TELEGRAM_CHAT_ID,
  );

  if (!chatIds.length) {
    return json(
      {
        ok: false,
        error:
          "No Telegram channel was provided. Send channel/channels in the request or configure TELEGRAM_CHAT_ID as the default.",
      },
      400,
    );
  }

  let db: D1Database;
  try { db = requireRelayDb(env); } catch (error) {
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }

  const identity = await resolveMediaIdentity({
    provider: input.provider,
    mediaId: input.mediaId,
    mediaKey: input.mediaKey,
    sourceUrl: input.sourceUrl,
    pageUrl: input.pageUrl,
    mediaUrl: input.mediaUrl.href,
  });
  const alreadyDelivered = input.force
    ? new Set<string>()
    : await getAlreadyDeliveredChannels(db, identity.key, chatIds);
  const channelsToSend = input.force
    ? chatIds
    : chatIds.filter((chatId) => !alreadyDelivered.has(chatId));
  const skippedAlreadySent = chatIds
    .filter((chatId) => alreadyDelivered.has(chatId))
    .map((channelId) => ({ channelId, reason: "already_sent" as const }));

  if (!channelsToSend.length) {
    return json({
      ok: false,
      conflict: true,
      error: "Media was already sent to every requested Telegram channel.",
      media: identity,
      channels: { requested: chatIds, inserted: [], notSent: skippedAlreadySent },
      hint: "Pass force=true to resend and increment send_count.",
    }, 409);
  }

  const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
  const concurrency = resolveConcurrency(env.HLS_CONCURRENCY);
  const hlsMaxMediaBytes = resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES);
  let prepared: PreparedMedia;

  try {
    prepared = await prepareMedia(input, {
      maxMediaBytes,
      hlsMaxMediaBytes,
      concurrency,
      signal: request.signal,
    });
  } catch (error) {
    console.error("[media-relay] Failed to prepare media", {
      inputUrl: input.mediaUrl.href,
      sourceUrl: input.sourceUrl,
      channels: chatIds,
      error: getErrorMessage(error),
      metadata: input.metadata,
    });

    return json(
      {
        ok: false,
        error: getErrorMessage(error),
        stage: "prepare-media",
        source: {
          inputUrl: input.mediaUrl.href,
          sourceUrl: input.sourceUrl,
        },
        channels: chatIds,
        metadata: input.metadata,
      },
      422,
    );
  }

  const mediaType =
    input.mediaType ||
    (prepared.type === "file"
      ? inferTelegramMediaType(prepared.url, prepared.contentType)
      : prepared.mediaType);
  const delivery =
    prepared.type === "file"
      ? "telegram-url"
      : "multipart-upload";

  console.log("[media-relay] Sending media", {
    inputUrl: input.mediaUrl.href,
    sourceUrl: input.sourceUrl,
    channels: chatIds,
    delivery,
    mediaType,
    resolvedUrl:
      prepared.type === "file"
        ? prepared.url
        : prepared.sourceUrl,
    selectedBitrate: prepared.selectedBitrate,
    selectedResolution: prepared.selectedResolution,
    playlistDepth: prepared.playlistDepth,
    size:
      prepared.type === "file"
        ? prepared.contentLength
        : prepared.bytes.byteLength,
    hls: prepared.type === "file" ? false : prepared.hls,
    remuxed: prepared.type === "file" ? false : prepared.remuxed,
    metadata: input.metadata,
  });

  const deliveries = await sendPreparedMediaToChats({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatIds: channelsToSend,
    prepared,
    mediaType,
    caption: input.caption,
    parseMode: input.parseMode,
  });
  const failedDeliveries = deliveries.filter((deliveryResult) => !deliveryResult.result.ok);
  const successfulDeliveries = deliveries.filter((deliveryResult) => deliveryResult.result.ok);
  const insertedChannelIds = await persistSuccessfulDeliveries(db, {
    identity,
    sourceUrl: input.sourceUrl,
    pageUrl: input.pageUrl,
    mediaType,
    mediaCount: 1,
    metadata: input.metadata,
    deliveries: successfulDeliveries.map((deliveryResult) => ({
      requestedChatId: deliveryResult.requestedChatId,
      telegramChatId: deliveryResult.result.result?.chat?.id ?? null,
      telegramChatTitle: deliveryResult.result.result?.chat?.title ?? null,
      messageIds: [deliveryResult.result.result?.message_id ?? null],
    })),
  });
  const failedChannels = failedDeliveries.map((deliveryResult) => ({
    channelId: deliveryResult.requestedChatId,
    reason: "telegram_error" as const,
    error: deliveryResult.result.description || "Telegram rejected the media request",
    httpStatus: deliveryResult.result.httpStatus ?? null,
  }));
  const notSent = [...skippedAlreadySent, ...failedChannels];
  const firstMessage = successfulDeliveries[0]?.result.result;
  const payload = {
    ok: successfulDeliveries.length > 0,
    partial: notSent.length > 0,
    conflict: successfulDeliveries.length === 0 && skippedAlreadySent.length > 0,
    message: successfulDeliveries.length > 0
      ? `Media sent to ${successfulDeliveries.length} Telegram channel(s)`
      : "Media was not sent to Telegram",
    media: identity,
    source: {
      inputUrl: input.mediaUrl.href,
      resolvedUrl: prepared.type === "file" ? prepared.url : prepared.sourceUrl,
      sourceUrl: input.sourceUrl,
    },
    channels: {
      requested: chatIds,
      attempted: channelsToSend,
      inserted: insertedChannelIds,
      notSent,
    },
    resolution: {
      selectedBitrate: prepared.selectedBitrate,
      selectedResolution: prepared.selectedResolution,
      playlistDepth: prepared.playlistDepth,
    },
    processing: buildProcessingResult(prepared),
    telegram: {
      method: getTelegramMethodName(mediaType),
      messageId: firstMessage?.message_id ?? null,
      chatId: firstMessage?.chat?.id ?? null,
      chatTitle: firstMessage?.chat?.title ?? null,
      deliveries: deliveries.map(formatTelegramDelivery),
    },
    metadata: input.metadata,
  };

  if (!successfulDeliveries.length) {
    console.error("[media-relay] Telegram rejected every attempted delivery", { media: identity, notSent });
    return json(payload, 502);
  }

  return json(payload, notSent.length ? 207 : 200);
}

interface TelegramAlbumBatchDelivery {
  requestedChatId: string;
  batchIndex: number;
  itemOffset: number;
  itemCount: number;
  result: TelegramApiResult<TelegramMessage[]>;
}

async function handleJsonAlbumSend(
  input: RelayAlbumInput,
  env: Env,
): Promise<Response> {
  const chatIds = resolveTelegramChatIds(input.channels, env.TELEGRAM_CHAT_ID);

  if (!chatIds.length) {
    return json(
      {
        ok: false,
        error:
          "No Telegram channel was provided. Send channel/channels in the request or configure TELEGRAM_CHAT_ID as the default.",
      },
      400,
    );
  }

  let db: D1Database;
  try { db = requireRelayDb(env); } catch (error) {
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }
  const identity = await resolveMediaIdentity({
    provider: input.provider,
    mediaId: input.mediaId,
    mediaKey: input.mediaKey,
    sourceUrl: input.sourceUrl,
    pageUrl: input.pageUrl,
    mediaUrl: input.items[0]?.mediaUrl.href || null,
  });
  const alreadyDelivered = input.force ? new Set<string>() : await getAlreadyDeliveredChannels(db, identity.key, chatIds);
  const channelsToSend = input.force ? chatIds : chatIds.filter((chatId) => !alreadyDelivered.has(chatId));
  const skippedAlreadySent = chatIds.filter((chatId) => alreadyDelivered.has(chatId)).map((channelId) => ({ channelId, reason: "already_sent" as const }));
  if (!channelsToSend.length) {
    return json({
      ok: false,
      conflict: true,
      error: "Media was already sent to every requested Telegram channel.",
      media: identity,
      channels: { requested: chatIds, inserted: [], notSent: skippedAlreadySent },
      hint: "Pass force=true to resend the album.",
    }, 409);
  }

  const batches: RelayAlbumInput["items"][] = [];
  let batchCursor = 0;

  while (batchCursor < input.items.length) {
    const remaining = input.items.length - batchCursor;
    const batchSize = remaining > 10 && remaining % 10 === 1 ? 9 : Math.min(10, remaining);
    batches.push(input.items.slice(batchCursor, batchCursor + batchSize));
    batchCursor += batchSize;
  }

  const deliveries: TelegramAlbumBatchDelivery[] = [];

  for (const chatId of channelsToSend) {
    let itemOffset = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex]!;
      const result = await sendTelegramMediaGroupUrl({
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId,
        items: batch.map((item) => ({
          mediaUrl: item.mediaUrl.href,
          mediaType: item.mediaType,
          caption: item.caption,
          parseMode: item.parseMode,
        })),
        caption: batchIndex === 0 ? input.caption : "",
        parseMode: batchIndex === 0 ? input.parseMode : null,
      });

      deliveries.push({
        requestedChatId: chatId,
        batchIndex,
        itemOffset,
        itemCount: batch.length,
        result,
      });
      itemOffset += batch.length;
    }
  }

  const formatted = deliveries.map((delivery) => ({
    requestedChatId: delivery.requestedChatId,
    batchIndex: delivery.batchIndex,
    itemOffset: delivery.itemOffset,
    itemCount: delivery.itemCount,
    ok: delivery.result.ok,
    httpStatus: delivery.result.httpStatus ?? null,
    error: delivery.result.ok ? null : delivery.result.description || "Telegram rejected sendMediaGroup",
    messageIds: Array.isArray(delivery.result.result)
      ? delivery.result.result.map((message) => message?.message_id ?? null)
      : [],
  }));
  const completedChannels = channelsToSend.filter((chatId) => {
    const channelDeliveries = deliveries.filter((delivery) => delivery.requestedChatId === chatId);
    return channelDeliveries.length === batches.length && channelDeliveries.every((delivery) => delivery.result.ok);
  });
  const failedChannels = channelsToSend.filter((chatId) => !completedChannels.includes(chatId)).map((channelId) => {
    const errors = deliveries.filter((delivery) => delivery.requestedChatId === channelId && !delivery.result.ok);
    return {
      channelId,
      reason: "telegram_error" as const,
      errors: errors.map((delivery) => ({ batchIndex: delivery.batchIndex, error: delivery.result.description || "Telegram rejected sendMediaGroup", httpStatus: delivery.result.httpStatus ?? null })),
    };
  });
  const insertedChannelIds = await persistSuccessfulDeliveries(db, {
    identity,
    sourceUrl: input.sourceUrl,
    pageUrl: input.pageUrl,
    mediaType: "album",
    mediaCount: input.items.length,
    metadata: input.metadata,
    deliveries: completedChannels.map((chatId) => {
      const channelDeliveries = deliveries.filter((delivery) => delivery.requestedChatId === chatId);
      const messages = channelDeliveries.flatMap((delivery) => Array.isArray(delivery.result.result) ? delivery.result.result : []);
      return {
        requestedChatId: chatId,
        telegramChatId: messages[0]?.chat?.id ?? null,
        telegramChatTitle: messages[0]?.chat?.title ?? null,
        messageIds: messages.map((message) => message.message_id ?? null),
      };
    }),
  });
  const notSent = [...skippedAlreadySent, ...failedChannels];
  const payload = {
    ok: completedChannels.length > 0,
    partial: notSent.length > 0,
    media: identity,
    message: completedChannels.length > 0
      ? `Album delivered completely to ${completedChannels.length} Telegram channel(s)`
      : "Album was not completely delivered to any Telegram channel",
    mode: "telegram-media-group",
    source: { sourceUrl: input.sourceUrl, pageUrl: input.pageUrl },
    channels: { requested: chatIds, attempted: channelsToSend, inserted: insertedChannelIds, notSent },
    mediaSet: {
      count: input.items.length,
      batches: batches.length,
      items: input.items.map((item, index) => ({ index, mediaType: item.mediaType, mediaUrl: item.mediaUrl.href })),
    },
    telegram: { method: "sendMediaGroup", deliveries: formatted },
    metadata: input.metadata,
  };
  if (!completedChannels.length) return json(payload, 502);
  return json(payload, notSent.length ? 207 : 200);
}

interface TelegramDelivery {
  requestedChatId: string;
  result: TelegramApiResult<TelegramMessage>;
}

async function sendPreparedMediaToChats(options: {
  botToken: string;
  chatIds: string[];
  prepared: PreparedMedia;
  mediaType: MediaType;
  caption: string;
  parseMode: ParseMode | null;
}): Promise<TelegramDelivery[]> {
  const deliveries: TelegramDelivery[] = [];

  // Send sequentially so a large multipart payload is not duplicated in memory
  // for several concurrent Bot API requests inside the same Worker isolate.
  for (const chatId of options.chatIds) {
    const result =
      options.prepared.type === "file"
        ? await sendTelegramUrl({
            botToken: options.botToken,
            chatId,
            mediaUrl: options.prepared.url,
            mediaType: options.mediaType,
            caption: options.caption,
            parseMode: options.parseMode,
          })
        : await sendTelegramUpload({
            botToken: options.botToken,
            chatId,
            file: new Blob([options.prepared.bytes], {
              type: options.prepared.contentType,
            }),
            filename: options.prepared.filename,
            contentType: options.prepared.contentType,
            mediaType: options.mediaType,
            caption: options.caption,
            parseMode: options.parseMode,
          });

    deliveries.push({
      requestedChatId: chatId,
      result,
    });
  }

  return deliveries;
}

function formatTelegramDelivery(delivery: TelegramDelivery) {
  const message = delivery.result.result;

  return {
    requestedChatId: delivery.requestedChatId,
    ok: delivery.result.ok,
    messageId: message?.message_id ?? null,
    chatId: message?.chat?.id ?? null,
    chatTitle: message?.chat?.title ?? null,
    error: delivery.result.ok
      ? null
      : delivery.result.description || "Telegram rejected the media request",
    httpStatus: delivery.result.httpStatus ?? null,
  };
}

function buildProcessingResult(prepared: PreparedMedia) {
  return prepared.type === "file"
    ? {
        delivery: "telegram-url",
        contentLength: prepared.contentLength,
        contentType: prepared.contentType,
      }
    : {
        delivery: "multipart-upload",
        filename: prepared.filename,
        contentType: prepared.contentType,
        size: prepared.bytes.byteLength,
        hls: prepared.hls,
        segmentCount: prepared.segmentCount,
        encrypted: prepared.encrypted,
        remuxed: prepared.remuxed,
      };
}

function getTelegramMethodName(mediaType: MediaType) {
  return mediaType === "photo"
    ? "sendPhoto"
    : mediaType === "audio"
      ? "sendAudio"
      : mediaType === "document"
        ? "sendDocument"
        : "sendVideo";
}

function resolveTelegramChatIds(
  requestedChannels: string[],
  defaultChatId?: string,
): string[] {
  if (requestedChannels.length) {
    return requestedChannels;
  }

  const fallback = String(defaultChatId || "").trim();

  return fallback ? [fallback] : [];
}

function isAuthorized(request: Request, env: Env): boolean {
  const authorization = request.headers.get("Authorization");

  if (!authorization) {
    return false;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    return false;
  }

  return safeTokenEqual(match[1].trim(), String(env.RELAY_TOKEN));
}

function safeTokenEqual(left: string, right: string): boolean {
  const a = String(left);
  const b = String(right);
  const maxLength = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;

  for (let index = 0; index < maxLength; index += 1) {
    const aCode = index < a.length ? a.charCodeAt(index) : 0;
    const bCode = index < b.length ? b.charCodeAt(index) : 0;

    difference |= aCode ^ bCode;
  }

  return difference === 0;
}

type ValidationResult =
  | {
      ok: true;
      value: RelayInput;
    }
  | {
      ok: false;
      error: string;
    };

function validateRequestBody(body: unknown): ValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      error: "Request body must be an object",
    };
  }

  const record = body as Record<string, unknown>;
  const rawMediaUrl =
    record.mediaUrl ??
    record.photoUrl ??
    record.videoUrl ??
    record.fileUrl ??
    record.url;
  const mediaUrl = normalizePublicHttpUrl(rawMediaUrl);

  if (!mediaUrl) {
    return {
      ok: false,
      error: "Invalid mediaUrl, photoUrl, or videoUrl",
    };
  }

  const pageUrl = normalizeOptionalSourceUrl(record.pageUrl);
  const sourceUrl = normalizeOptionalSourceUrl(
    record.sourceUrl ?? record.tweetUrl ?? record.pageUrl,
  );
  const parseMode = normalizeParseMode(record.parseMode);

  if (record.parseMode && !parseMode) {
    return {
      ok: false,
      error: "Invalid parseMode. Allowed values: HTML, MarkdownV2",
    };
  }

  const mediaType = normalizeMediaType(record.mediaType);

  if (record.mediaType && !mediaType) {
    return {
      ok: false,
      error: "Invalid mediaType. Use photo, video, audio, or document",
    };
  }

  const channelValidation = normalizeTelegramChannels(
    record.channel,
    record.channels,
  );

  if (!channelValidation.ok) {
    return {
      ok: false,
      error: channelValidation.error,
    };
  }

  return {
    ok: true,
    value: {
      mediaUrl,
      sourceUrl,
      pageUrl,
      provider: normalizeOptionalText(record.provider, 120),
      title: normalizeOptionalText(record.title, 1000),
      text: normalizeOptionalText(record.text, 20_000),
      caption: resolvePayloadCaption(record),
      parseMode: normalizeCaption(record.caption) ? parseMode : null,
      mediaType,
      mediaHeaders: normalizeMediaHeaders(record.mediaHeaders),
      channels: channelValidation.value,
      metadata: normalizeMetadata(record.metadata),
      mediaId: normalizeNullableText(record.mediaId, 240),
      mediaKey: normalizeNullableText(record.mediaKey, 300),
      force: record.force === true,
    },
  };
}

type AlbumValidationResult =
  | { kind: "none" }
  | { kind: "valid"; value: RelayAlbumInput }
  | { kind: "invalid"; error: string };

function validateAlbumRequestBody(body: unknown): AlbumValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "none" };
  }

  const record = body as Record<string, unknown>;
  const rawItems = Array.isArray(record.mediaItems)
    ? record.mediaItems
    : Array.isArray(record.mediaUrls)
      ? record.mediaUrls
      : Array.isArray(record.photoUrls)
        ? record.photoUrls.map((mediaUrl) => ({ mediaUrl, mediaType: "photo" }))
        : null;

  if (!rawItems) {
    return { kind: "none" };
  }

  if (rawItems.length < 2) {
    return {
      kind: "invalid",
      error: "mediaItems/mediaUrls must contain at least 2 items for an album request.",
    };
  }

  if (rawItems.length > 100) {
    return {
      kind: "invalid",
      error: "A maximum of 100 media items can be relayed in one album request.",
    };
  }

  const parseMode = normalizeParseMode(record.parseMode);
  if (record.parseMode && !parseMode) {
    return {
      kind: "invalid",
      error: "Invalid parseMode. Allowed values: HTML, MarkdownV2",
    };
  }

  const items: RelayAlbumInput["items"] = [];

  for (let index = 0; index < rawItems.length; index += 1) {
    const rawItem = rawItems[index];
    let rawUrl: unknown = rawItem;
    let rawType: unknown = null;
    let rawCaption: unknown = null;
    let rawItemParseMode: unknown = null;
    let itemMetadata: unknown = null;

    if (rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)) {
      const item = rawItem as Record<string, unknown>;
      rawUrl = item.mediaUrl ?? item.photoUrl ?? item.videoUrl ?? item.url;
      rawType =
        item.mediaType ??
        (item.photoUrl ? "photo" : item.videoUrl ? "video" : null);
      rawCaption = item.caption;
      rawItemParseMode = item.parseMode ?? item.parse_mode;
      itemMetadata = item.metadata;
    }

    const mediaUrl = normalizePublicHttpUrl(rawUrl);
    if (!mediaUrl) {
      return {
        kind: "invalid",
        error: `Invalid public media URL at mediaItems[${index}].`,
      };
    }

    if (/\.m3u8(?:$|[?#])/i.test(mediaUrl.href) || /\.mpd(?:$|[?#])/i.test(mediaUrl.href)) {
      return {
        kind: "invalid",
        error: `Album item ${index + 1} is HLS/DASH. Albums require direct photo/video URLs; use the single-media endpoint for prepared streaming media.`,
      };
    }

    const mediaType = normalizeAlbumMediaType(rawType, mediaUrl.href);
    if (!mediaType) {
      return {
        kind: "invalid",
        error: `Invalid album mediaType at item ${index + 1}. Use photo or video.`,
      };
    }

    const itemCaption = normalizeCaption(rawCaption);
    const itemParseMode = itemCaption
      ? normalizeParseMode(rawItemParseMode ?? record.parseMode)
      : null;

    if (rawItemParseMode && !itemParseMode) {
      return {
        kind: "invalid",
        error: `Invalid parseMode at mediaItems[${index}]. Allowed values: HTML, MarkdownV2`,
      };
    }

    items.push({
      mediaUrl,
      mediaType,
      caption: itemCaption,
      parseMode: itemParseMode,
      metadata: normalizeMetadata(itemMetadata),
    });
  }

  const channelValidation = normalizeTelegramChannels(
    record.channel,
    record.channels,
  );
  if (!channelValidation.ok) {
    return { kind: "invalid", error: channelValidation.error };
  }

  const pageUrl = normalizeOptionalSourceUrl(record.pageUrl);
  const explicitCaption = normalizeCaption(record.caption);

  return {
    kind: "valid",
    value: {
      items,
      sourceUrl: normalizeOptionalSourceUrl(
        record.sourceUrl ?? record.tweetUrl ?? record.pageUrl,
      ),
      pageUrl,
      provider: normalizeOptionalText(record.provider, 120),
      title: normalizeOptionalText(record.title, 1000),
      text: normalizeOptionalText(record.text, 20_000),
      caption: resolvePayloadCaption(record),
      parseMode: explicitCaption ? parseMode : null,
      channels: channelValidation.value,
      metadata: normalizeMetadata(record.metadata),
      mediaId: normalizeNullableText(record.mediaId, 240),
      mediaKey: normalizeNullableText(record.mediaKey, 300),
      force: record.force === true,
    },
  };
}

function normalizeAlbumMediaType(
  value: unknown,
  mediaUrl: string,
): AlbumMediaType | null {
  if (value) {
    const normalized = String(value).toLowerCase();
    return normalized === "photo" || normalized === "video"
      ? normalized
      : null;
  }

  return /\.(mp4|m4v|mov|webm)(?:$|[?#])/i.test(mediaUrl)
    ? "video"
    : "photo";
}

type ChannelValidationResult =
  | {
      ok: true;
      value: string[];
    }
  | {
      ok: false;
      error: string;
    };

function normalizeTelegramChannels(
  channelValue: unknown,
  channelsValue: unknown,
): ChannelValidationResult {
  const hasChannel = channelValue !== undefined && channelValue !== null;
  const hasChannels = channelsValue !== undefined && channelsValue !== null;
  const values: unknown[] = [];

  if (hasChannel) {
    values.push(channelValue);
  }

  if (hasChannels) {
    if (Array.isArray(channelsValue)) {
      values.push(...channelsValue);
    } else {
      values.push(channelsValue);
    }
  }

  const channels: string[] = [];

  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") {
      return {
        ok: false,
        error:
          "Invalid Telegram channel. channel/channels must contain chat IDs or @channel usernames.",
      };
    }

    const normalized = String(value).trim();

    if (!normalized || normalized.length > 128 || /[\u0000-\u001F]/.test(normalized)) {
      return {
        ok: false,
        error: "Invalid Telegram channel value.",
      };
    }

    if (!channels.includes(normalized)) {
      channels.push(normalized);
    }
  }

  if (channels.length > 20) {
    return {
      ok: false,
      error: "A maximum of 20 Telegram channels can be targeted per request.",
    };
  }

  return {
    ok: true,
    value: channels,
  };
}

function normalizeNullableText(value: unknown, maximumLength: number): string | null {
  const normalized = normalizeOptionalText(value, maximumLength);
  return normalized || null;
}

function normalizeOptionalText(value: unknown, maximumLength: number): string {
  if (value == null) return "";
  return String(value).trim().slice(0, maximumLength);
}

function resolvePayloadCaption(record: Record<string, unknown>): string {
  const explicit = normalizeCaption(record.caption);
  if (explicit) return explicit;

  const title = normalizeOptionalText(record.title, 1000);
  const text = normalizeOptionalText(record.text, 20_000);
  const pageUrl = normalizeOptionalSourceUrl(
    record.pageUrl ?? record.sourceUrl ?? record.tweetUrl,
  );

  return [title, text, pageUrl || ""].filter(Boolean).join("\n\n");
}

function normalizeCaption(value: unknown): string {
  if (value == null) {
    return "";
  }

  return typeof value === "string" ? value.trim() : String(value);
}

function normalizeParseMode(value: unknown): ParseMode | null {
  if (!value) {
    return null;
  }

  const normalized = String(value) as ParseMode;

  return ALLOWED_PARSE_MODES.has(normalized) ? normalized : null;
}

function normalizeMediaType(value: unknown): MediaType | null {
  if (!value) {
    return null;
  }

  const normalized = String(value).toLowerCase() as MediaType;

  return ALLOWED_MEDIA_TYPES.has(normalized) ? normalized : null;
}

function normalizeMediaHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

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

    if (!allowed.has(normalizedKey) || rawValue == null) {
      continue;
    }

    headers[key] = String(rawValue);
  }

  return headers;
}

function normalizeMetadata(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const metadata: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    if (rawValue == null) {
      continue;
    }

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
    },
  });
}


interface MultipartPayload {
  channel?: string | number;
  channels?: Array<string | number> | string | number;
  caption?: string;
  parseMode?: string;
  mediaType?: string;
  title?: string;
  text?: string;
  pageUrl?: string;
  frameUrl?: string;
  sourceUrl?: string;
  mediaUrl?: string;
  photoUrl?: string;
  videoUrl?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
  mediaId?: string;
  mediaKey?: string;
  force?: boolean;
}

interface UploadedFileRecord {
  field: string;
  file: File;
  mediaType: MediaType;
}

async function handleMultipartSend(request: Request, env: Env): Promise<Response> {
  let form: FormData;

  try {
    form = await request.formData();
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Could not parse multipart/form-data request.",
        stage: "parse-multipart",
        details: {
          reason: getErrorMessage(error),
          contentType: request.headers.get("Content-Type"),
          expectedFields: [
            "payload: JSON string",
            "file: one or more photo/video/audio/document files",
            "files: optional repeated file field",
            "audioFile: optional separate audio track",
          ],
        },
      },
      400,
    );
  }

  const rawPayload = form.get("payload");
  let payload: MultipartPayload = {};

  if (typeof rawPayload === "string" && rawPayload.trim()) {
    try {
      const parsed = JSON.parse(rawPayload);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("payload must decode to a JSON object");
      }

      payload = parsed as MultipartPayload;
    } catch (error) {
      return json(
        {
          ok: false,
          error: "Invalid JSON in multipart payload field.",
          stage: "parse-payload",
          details: {
            reason: getErrorMessage(error),
            payloadPreview: rawPayload.slice(0, 2000),
          },
        },
        400,
      );
    }
  }

  const channelValidation = normalizeTelegramChannels(
    payload.channel,
    payload.channels,
  );

  if (!channelValidation.ok) {
    return json(
      {
        ok: false,
        error: channelValidation.error,
        stage: "validate-channels",
        details: {
          channel: payload.channel ?? null,
          channels: payload.channels ?? null,
        },
      },
      400,
    );
  }

  const chatIds = resolveTelegramChatIds(
    channelValidation.value,
    env.TELEGRAM_CHAT_ID,
  );

  if (!chatIds.length) {
    return json(
      {
        ok: false,
        error: "No Telegram channel was provided.",
        stage: "validate-channels",
        details: {
          hint: "Send channel/channels inside payload or configure TELEGRAM_CHAT_ID.",
        },
      },
      400,
    );
  }

  const parseMode = normalizeParseMode(payload.parseMode);

  if (payload.parseMode && !parseMode) {
    return json(
      {
        ok: false,
        error: "Invalid parseMode. Allowed values: HTML, MarkdownV2",
        stage: "validate-payload",
        details: {
          received: payload.parseMode,
        },
      },
      400,
    );
  }

  const requestedMediaType = normalizeMediaType(payload.mediaType);

  if (payload.mediaType && !requestedMediaType) {
    return json(
      {
        ok: false,
        error: "Invalid mediaType. Use photo, video, audio, or document",
        stage: "validate-payload",
        details: {
          received: payload.mediaType,
        },
      },
      400,
    );
  }

  const uploadedFiles: UploadedFileRecord[] = [];

  form.forEach((value, field) => {
    if (!(value instanceof File) || value.size === 0) {
      return;
    }

    const mediaType =
      field === "audioFile"
        ? "audio"
        : requestedMediaType || inferUploadedFileMediaType(value);

    uploadedFiles.push({
      field,
      file: value,
      mediaType,
    });
  });

  if (!uploadedFiles.length) {
    return json(
      {
        ok: false,
        error: "Multipart request did not contain any non-empty files.",
        stage: "validate-files",
        details: {
          receivedFields: collectFormFieldNames(form),
          acceptedFileFields: ["file", "files", "audioFile", "any repeated File field"],
          hint: "Append one or more File/Blob values to FormData. Example: form.append('file', blob, 'video.mp4').",
        },
      },
      400,
    );
  }

  const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
  const oversized = uploadedFiles.filter(({ file }) => file.size > maxMediaBytes);

  if (oversized.length) {
    return json(
      {
        ok: false,
        error: "One or more uploaded files exceed the configured Worker upload limit.",
        stage: "validate-files",
        details: {
          maxMediaBytes,
          files: oversized.map(({ field, file }) => ({
            field,
            name: file.name,
            type: file.type,
            size: file.size,
          })),
        },
      },
      413,
    );
  }

  const multipartTotalBytes = uploadedFiles.reduce((sum, entry) => {
    return sum + entry.file.size;
  }, 0);
  const multipartMaxTotalBytes = resolveMultipartMaxTotalBytes(
    env.MULTIPART_MAX_TOTAL_BYTES,
    maxMediaBytes,
  );

  if (multipartTotalBytes > multipartMaxTotalBytes) {
    return json(
      {
        ok: false,
        error: "The combined multipart file size exceeds the safe per-request forwarding budget.",
        stage: "validate-files",
        details: {
          multipartTotalBytes,
          multipartMaxTotalBytes,
          recommendation:
            "Send one file per POST and wait for the response before sending the next file.",
          files: uploadedFiles.map(({ field, file }) => ({
            field,
            name: file.name,
            type: file.type,
            size: file.size,
          })),
        },
      },
      413,
    );
  }

  let db: D1Database;
  try { db = requireRelayDb(env); } catch (error) {
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }
  const multipartIdentityFallback = payload.sourceUrl || payload.pageUrl || payload.mediaUrl || payload.photoUrl || payload.videoUrl ||
    `multipart:${uploadedFiles.map(({ file }) => `${file.name}:${file.size}:${file.type}`).join("|")}`;
  const identity = await resolveMediaIdentity({
    provider: payload.provider || "multipart",
    mediaId: payload.mediaId || null,
    mediaKey: payload.mediaKey || null,
    sourceUrl: payload.sourceUrl || payload.pageUrl || null,
    pageUrl: payload.pageUrl || null,
    mediaUrl: multipartIdentityFallback,
  });
  const alreadyDelivered = payload.force === true ? new Set<string>() : await getAlreadyDeliveredChannels(db, identity.key, chatIds);
  const channelsToSend = payload.force === true ? chatIds : chatIds.filter((chatId) => !alreadyDelivered.has(chatId));
  const skippedAlreadySent = chatIds.filter((chatId) => alreadyDelivered.has(chatId)).map((channelId) => ({ channelId, reason: "already_sent" as const }));
  if (!channelsToSend.length) {
    return json({
      ok: false,
      conflict: true,
      error: "Media was already sent to every requested Telegram channel.",
      media: identity,
      channels: { requested: chatIds, inserted: [], notSent: skippedAlreadySent },
      hint: "Pass force=true in the multipart payload to resend.",
    }, 409);
  }

  const caption = resolvePayloadCaption(payload as Record<string, unknown>);
  const deliveries: Array<{
    fileIndex: number;
    field: string;
    filename: string;
    contentType: string;
    size: number;
    mediaType: MediaType;
    requestedChatId: string;
    result: TelegramApiResult<TelegramMessage>;
  }> = [];

  for (let fileIndex = 0; fileIndex < uploadedFiles.length; fileIndex += 1) {
    const uploaded = uploadedFiles[fileIndex]!;

    for (const chatId of channelsToSend) {
      let result: TelegramApiResult<TelegramMessage>;

      try {
        result = await sendTelegramUpload({
          botToken: env.TELEGRAM_BOT_TOKEN,
          chatId,
          file: uploaded.file,
          filename: sanitizeUploadedFilename(uploaded.file.name, fileIndex),
          contentType: uploaded.file.type || inferUploadedContentType(uploaded.file.name),
          mediaType: uploaded.mediaType,
          caption: fileIndex === 0 ? caption : "",
          parseMode: fileIndex === 0 ? parseMode : null,
        });
      } catch (error) {
        result = {
          ok: false,
          description: `Unexpected exception while forwarding uploaded file: ${getErrorMessage(error)}`,
        };
      }

      deliveries.push({
        fileIndex,
        field: uploaded.field,
        filename: uploaded.file.name,
        contentType: uploaded.file.type || inferUploadedContentType(uploaded.file.name),
        size: uploaded.file.size,
        mediaType: uploaded.mediaType,
        requestedChatId: chatId,
        result,
      });
    }
  }

  const failed = deliveries.filter((entry) => !entry.result.ok);
  const succeeded = deliveries.filter((entry) => entry.result.ok);
  const completedChannels = channelsToSend.filter((chatId) => {
    const channelDeliveries = deliveries.filter((entry) => entry.requestedChatId === chatId);
    return channelDeliveries.length === uploadedFiles.length && channelDeliveries.every((entry) => entry.result.ok);
  });
  const failedChannels = channelsToSend.filter((chatId) => !completedChannels.includes(chatId)).map((channelId) => ({
    channelId,
    reason: "telegram_error" as const,
    errors: deliveries.filter((entry) => entry.requestedChatId === channelId && !entry.result.ok).map((entry) => ({
      fileIndex: entry.fileIndex,
      error: entry.result.description || "Telegram rejected uploaded media",
      httpStatus: entry.result.httpStatus ?? null,
    })),
  }));
  const insertedChannelIds = await persistSuccessfulDeliveries(db, {
    identity,
    sourceUrl: payload.sourceUrl || payload.pageUrl || null,
    pageUrl: payload.pageUrl || null,
    mediaType: uploadedFiles.length > 1 ? "album" : uploadedFiles[0]!.mediaType,
    mediaCount: uploadedFiles.length,
    metadata: normalizeMetadata(payload.metadata),
    deliveries: completedChannels.map((chatId) => {
      const messages = deliveries.filter((entry) => entry.requestedChatId === chatId && entry.result.ok).map((entry) => entry.result.result).filter((message): message is TelegramMessage => Boolean(message));
      return {
        requestedChatId: chatId,
        telegramChatId: messages[0]?.chat?.id ?? null,
        telegramChatTitle: messages[0]?.chat?.title ?? null,
        messageIds: messages.map((message) => message.message_id ?? null),
      };
    }),
  });
  const notSent = [...skippedAlreadySent, ...failedChannels];

  const formattedDeliveries = deliveries.map((entry) => ({
    fileIndex: entry.fileIndex,
    field: entry.field,
    filename: entry.filename,
    contentType: entry.contentType,
    size: entry.size,
    mediaType: entry.mediaType,
    requestedChatId: entry.requestedChatId,
    ok: entry.result.ok,
    telegramMethod: entry.result.requestMethod || getTelegramMethodName(entry.mediaType),
    httpStatus: entry.result.httpStatus ?? null,
    telegramErrorCode: entry.result.error_code ?? null,
    description: entry.result.description ?? null,
    parameters: entry.result.parameters ?? null,
    rawResponse: entry.result.rawResponse ?? null,
    messageId: entry.result.result?.message_id ?? null,
    chatId: entry.result.result?.chat?.id ?? null,
    chatTitle: entry.result.result?.chat?.title ?? null,
  }));

  if (failed.length) {
    console.error("[media-relay] Multipart forwarding partially or fully failed", {
      files: uploadedFiles.map(({ field, file, mediaType }) => ({
        field,
        name: file.name,
        size: file.size,
        type: file.type,
        mediaType,
      })),
      channels: chatIds,
      deliveries: formattedDeliveries,
      payload,
    });

    return json(
      {
        ok: false,
        error:
          succeeded.length > 0
            ? `${failed.length} of ${deliveries.length} Telegram deliveries failed.`
            : "All Telegram deliveries failed.",
        stage: "telegram-forward",
        summary: {
          filesReceived: uploadedFiles.length,
          channelsRequested: chatIds.length,
          deliveriesAttempted: deliveries.length,
          deliveriesSucceeded: succeeded.length,
          deliveriesFailed: failed.length,
        },
        files: uploadedFiles.map(({ field, file, mediaType }, index) => ({
          index,
          field,
          filename: file.name,
          contentType: file.type || inferUploadedContentType(file.name),
          size: file.size,
          mediaType,
        })),
        media: identity,
        channels: { requested: chatIds, attempted: channelsToSend, inserted: insertedChannelIds, notSent },
        telegram: {
          deliveries: formattedDeliveries,
        },
        payload,
      },
      succeeded.length > 0 ? 207 : 502,
    );
  }

  return json({
    ok: true,
    message:
      uploadedFiles.length === 1
        ? "Uploaded file forwarded to Telegram"
        : `${uploadedFiles.length} uploaded files forwarded to Telegram`,
    mode: "multipart-file-forward",
    summary: {
      filesReceived: uploadedFiles.length,
      channelsRequested: chatIds.length,
      deliveriesAttempted: deliveries.length,
      deliveriesSucceeded: succeeded.length,
      deliveriesFailed: 0,
    },
    files: uploadedFiles.map(({ field, file, mediaType }, index) => ({
      index,
      field,
      filename: file.name,
      contentType: file.type || inferUploadedContentType(file.name),
      size: file.size,
      mediaType,
    })),
    media: identity,
    channels: { requested: chatIds, attempted: channelsToSend, inserted: insertedChannelIds, notSent },
    telegram: {
      deliveries: formattedDeliveries,
    },
    payload,
  });
}

function inferUploadedFileMediaType(file: File): MediaType {
  const contentType = String(file.type || "").toLowerCase();
  const filename = String(file.name || "").toLowerCase();

  if (contentType.startsWith("image/") || /\.(jpe?g|png|webp|avif|gif)$/i.test(filename)) {
    return "photo";
  }

  if (contentType.startsWith("video/") || /\.(mp4|m4v|mov|webm)$/i.test(filename)) {
    return "video";
  }

  if (contentType.startsWith("audio/") || /\.(mp3|m4a|aac|ogg|oga|wav|flac)$/i.test(filename)) {
    return "audio";
  }

  return "document";
}

function inferUploadedContentType(filename: string): string {
  const value = String(filename || "").toLowerCase();

  if (/\.jpe?g$/i.test(value)) return "image/jpeg";
  if (/\.png$/i.test(value)) return "image/png";
  if (/\.webp$/i.test(value)) return "image/webp";
  if (/\.avif$/i.test(value)) return "image/avif";
  if (/\.gif$/i.test(value)) return "image/gif";
  if (/\.mp4$/i.test(value)) return "video/mp4";
  if (/\.webm$/i.test(value)) return "video/webm";
  if (/\.(m4v|mov)$/i.test(value)) return "video/mp4";
  if (/\.mp3$/i.test(value)) return "audio/mpeg";
  if (/\.m4a$/i.test(value)) return "audio/mp4";
  if (/\.aac$/i.test(value)) return "audio/aac";

  return "application/octet-stream";
}

function sanitizeUploadedFilename(value: string, index: number): string {
  const normalized = String(value || `media-${index + 1}`)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  return normalized || `media-${index + 1}.mp4`;
}

function resolveMultipartMaxTotalBytes(
  rawValue: string | undefined,
  perFileMaximum: number,
): number {
  const configured = Number(rawValue);
  const fallback = Math.min(64_000_000, perFileMaximum * 2);

  if (!Number.isFinite(configured)) {
    return fallback;
  }

  return Math.min(80_000_000, Math.max(perFileMaximum, Math.floor(configured)));
}

function collectFormFieldNames(form: FormData): string[] {
  const fields: string[] = [];

  form.forEach((_value, key) => {
    if (!fields.includes(key)) {
      fields.push(key);
    }
  });

  return fields;
}
