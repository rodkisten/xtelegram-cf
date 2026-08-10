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

    if (request.method === "POST" && url.pathname === "/send") {
      return handleSend(request, env);
    }

    if (request.method === "POST" && url.pathname === "/resolve") {
      return handleResolve(request, env, false);
    }

    if (request.method === "POST" && url.pathname === "/resolve-and-send") {
      return handleResolve(request, env, true);
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
}

async function handleResolve(request: Request, env: Env, send: boolean): Promise<Response> {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
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
  const common = { sourceUrl: resolution.sourceUrl, pageUrl: resolution.sourceUrl, provider: resolution.source, caption, parseMode, channels, metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : { resolver: resolution.resolver } };
  const albumCompatible = resolution.media.length >= 2 && resolution.media.every((item) => item.type === "photo" || item.type === "video");
  if (albumCompatible) {
    const relayBody = { ...common, mediaItems: resolution.media.map((item) => ({ mediaUrl: item.url, mediaType: toRelayMediaType(item.type) })) };
    const response = await handleSend(cloneAuthorizedJsonRequest(request, relayBody), env);
    return mergeResolveResponse(response, resolution);
  }

  const deliveries: unknown[] = [];
  for (const item of resolution.media) {
    const response = await handleSend(cloneAuthorizedJsonRequest(request, { ...common, mediaUrl: item.url, mediaType: toRelayMediaType(item.type) }), env);
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

function handleHealth(): Response {
  return json({
    ok: true,
    service: "generic-telegram-media-relay",
    version: "2.4.0",
    status: "online",
    runtime: "typescript-hls-remux-photo-album",
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
    chatIds,
    prepared,
    mediaType,
    caption: input.caption,
    parseMode: input.parseMode,
  });
  const failedDeliveries = deliveries.filter(
    (deliveryResult) => !deliveryResult.result.ok,
  );

  if (failedDeliveries.length) {
    console.error("[media-relay] Telegram rejected one or more deliveries", {
      inputUrl: input.mediaUrl.href,
      delivery,
      mediaType,
      channels: chatIds,
      failedDeliveries,
      metadata: input.metadata,
    });

    return json(
      {
        ok: false,
        error:
          failedDeliveries[0]?.result.description ||
          "Telegram rejected one or more media deliveries",
        stage: "telegram",
        source: {
          inputUrl: input.mediaUrl.href,
          resolvedUrl:
            prepared.type === "file"
              ? prepared.url
              : prepared.sourceUrl,
          sourceUrl: input.sourceUrl,
        },
        channels: chatIds,
        resolution: {
          selectedBitrate: prepared.selectedBitrate,
          selectedResolution: prepared.selectedResolution,
          playlistDepth: prepared.playlistDepth,
        },
        processing: buildProcessingResult(prepared),
        telegram: {
          method: getTelegramMethodName(mediaType),
          deliveries: deliveries.map(formatTelegramDelivery),
        },
        metadata: input.metadata,
      },
      502,
    );
  }

  const firstMessage = deliveries[0]?.result.result;

  return json({
    ok: true,
    message:
      chatIds.length === 1
        ? "Media sent to Telegram"
        : `Media sent to ${chatIds.length} Telegram channels`,
    source: {
      inputUrl: input.mediaUrl.href,
      resolvedUrl:
        prepared.type === "file"
          ? prepared.url
          : prepared.sourceUrl,
      sourceUrl: input.sourceUrl,
    },
    channels: chatIds,
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
  });
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

  const batches: RelayAlbumInput["items"][] = [];
  let batchCursor = 0;

  while (batchCursor < input.items.length) {
    const remaining = input.items.length - batchCursor;
    const batchSize = remaining > 10 && remaining % 10 === 1 ? 9 : Math.min(10, remaining);
    batches.push(input.items.slice(batchCursor, batchCursor + batchSize));
    batchCursor += batchSize;
  }

  const deliveries: TelegramAlbumBatchDelivery[] = [];

  for (const chatId of chatIds) {
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

  const failed = deliveries.filter((delivery) => !delivery.result.ok);
  const formatted = deliveries.map((delivery) => ({
    requestedChatId: delivery.requestedChatId,
    batchIndex: delivery.batchIndex,
    itemOffset: delivery.itemOffset,
    itemCount: delivery.itemCount,
    ok: delivery.result.ok,
    httpStatus: delivery.result.httpStatus ?? null,
    error: delivery.result.ok
      ? null
      : delivery.result.description || "Telegram rejected sendMediaGroup",
    messageIds: Array.isArray(delivery.result.result)
      ? delivery.result.result.map((message) => message?.message_id ?? null)
      : [],
  }));

  if (failed.length) {
    console.error("[media-relay] Telegram rejected one or more album batches", {
      sourceUrl: input.sourceUrl,
      pageUrl: input.pageUrl,
      provider: input.provider,
      channels: chatIds,
      items: input.items.map((item) => ({
        url: item.mediaUrl.href,
        mediaType: item.mediaType,
      })),
      deliveries: formatted,
      metadata: input.metadata,
    });

    return json(
      {
        ok: false,
        error:
          failed[0]?.result.description ||
          "Telegram rejected one or more album batches",
        stage: "telegram-media-group",
        source: {
          sourceUrl: input.sourceUrl,
          pageUrl: input.pageUrl,
        },
        channels: chatIds,
        media: {
          count: input.items.length,
          batches: batches.length,
          items: input.items.map((item, index) => ({
            index,
            mediaType: item.mediaType,
            mediaUrl: item.mediaUrl.href,
          })),
        },
        telegram: {
          method: "sendMediaGroup",
          deliveries: formatted,
        },
        metadata: input.metadata,
      },
      502,
    );
  }

  return json({
    ok: true,
    message:
      chatIds.length === 1
        ? `Album with ${input.items.length} media items sent to Telegram`
        : `Album with ${input.items.length} media items sent to ${chatIds.length} Telegram channels`,
    mode: "telegram-media-group",
    source: {
      sourceUrl: input.sourceUrl,
      pageUrl: input.pageUrl,
    },
    channels: chatIds,
    media: {
      count: input.items.length,
      batches: batches.length,
      items: input.items.map((item, index) => ({
        index,
        mediaType: item.mediaType,
        mediaUrl: item.mediaUrl.href,
      })),
    },
    telegram: {
      method: "sendMediaGroup",
      deliveries: formatted,
    },
    metadata: input.metadata,
  });
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

    for (const chatId of chatIds) {
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
        channels: chatIds,
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
    channels: chatIds,
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
