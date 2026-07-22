import {
  inferTelegramMediaType,
  prepareMedia,
  resolveConcurrency,
  resolveMaxMediaBytes,
} from "./media";
import {
  normalizeOptionalSourceUrl,
  normalizePublicHttpUrl,
} from "./lib/http";
import {
  sendTelegramUpload,
  sendTelegramUrl,
  validateEnvironment,
} from "./telegram";
import type {
  Env,
  MediaType,
  ParseMode,
  PreparedMedia,
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

    return json(
      {
        ok: false,
        error: "Not found",
      },
      404,
    );
  },
};

function handleHealth(): Response {
  return json({
    ok: true,
    service: "generic-telegram-media-relay",
    status: "online",
    runtime: "typescript-hls-remux",
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
      },
      401,
    );
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
  let prepared: PreparedMedia;

  try {
    prepared = await prepareMedia(input, {
      maxMediaBytes,
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
            bytes: options.prepared.bytes,
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
  return mediaType === "audio"
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
    record.videoUrl ??
    record.fileUrl ??
    record.url;
  const mediaUrl = normalizePublicHttpUrl(rawMediaUrl);

  if (!mediaUrl) {
    return {
      ok: false,
      error: "Invalid mediaUrl or videoUrl",
    };
  }

  const sourceUrl = normalizeOptionalSourceUrl(
    record.sourceUrl ?? record.tweetUrl,
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
      error: "Invalid mediaType. Use video, audio, or document",
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
      caption: normalizeCaption(record.caption),
      parseMode,
      mediaType,
      mediaHeaders: normalizeMediaHeaders(record.mediaHeaders),
      channels: channelValidation.value,
      metadata: normalizeMetadata(record.metadata),
    },
  };
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
