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
  const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
  const concurrency = resolveConcurrency(env.HLS_CONCURRENCY);
  let prepared;

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

  console.log("[media-relay] Sending media", {
    inputUrl: input.mediaUrl.href,
    sourceUrl: input.sourceUrl,
    delivery: prepared.type === "file" ? "telegram-url" : "multipart-upload",
    mediaType,
    resolvedUrl: prepared.type === "file" ? prepared.url : prepared.sourceUrl,
    selectedBitrate: prepared.selectedBitrate,
    selectedResolution: prepared.selectedResolution,
    playlistDepth: prepared.playlistDepth,
    size: prepared.type === "file" ? prepared.contentLength : prepared.bytes.byteLength,
    hls: prepared.type === "file" ? false : prepared.hls,
    remuxed: prepared.type === "file" ? false : prepared.remuxed,
    metadata: input.metadata,
  });

  let telegramResult: TelegramApiResult<TelegramMessage>;

  if (prepared.type === "file") {
    telegramResult = await sendTelegramUrl({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
      mediaUrl: prepared.url,
      mediaType,
      caption: input.caption,
      parseMode: input.parseMode,
    });
  } else {
    telegramResult = await sendTelegramUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
      bytes: prepared.bytes,
      filename: prepared.filename,
      contentType: prepared.contentType,
      mediaType,
      caption: input.caption,
      parseMode: input.parseMode,
    });
  }

  if (!telegramResult.ok) {
    console.error("[media-relay] Telegram rejected media", {
      inputUrl: input.mediaUrl.href,
      delivery: prepared.type === "file" ? "telegram-url" : "multipart-upload",
      mediaType,
      telegram: telegramResult,
      metadata: input.metadata,
    });

    return json(
      {
        ok: false,
        error:
          telegramResult.description ||
          "Telegram rejected the media request",
        stage: "telegram",
        telegram: telegramResult,
        source: {
          inputUrl: input.mediaUrl.href,
          resolvedUrl:
            prepared.type === "file"
              ? prepared.url
              : prepared.sourceUrl,
          sourceUrl: input.sourceUrl,
        },
        resolution: {
          selectedBitrate: prepared.selectedBitrate,
          selectedResolution: prepared.selectedResolution,
          playlistDepth: prepared.playlistDepth,
        },
        processing:
          prepared.type === "file"
            ? {
                delivery: "telegram-url",
                contentLength: prepared.contentLength,
              }
            : {
                delivery: "multipart-upload",
                size: prepared.bytes.byteLength,
                hls: prepared.hls,
                segmentCount: prepared.segmentCount,
                encrypted: prepared.encrypted,
                remuxed: prepared.remuxed,
              },
        metadata: input.metadata,
      },
      502,
    );
  }

  const message = telegramResult.result;

  return json({
    ok: true,
    message: "Media sent to Telegram",
    source: {
      inputUrl: input.mediaUrl.href,
      resolvedUrl:
        prepared.type === "file"
          ? prepared.url
          : prepared.sourceUrl,
      sourceUrl: input.sourceUrl,
    },
    resolution: {
      selectedBitrate: prepared.selectedBitrate,
      selectedResolution: prepared.selectedResolution,
      playlistDepth: prepared.playlistDepth,
    },
    processing:
      prepared.type === "file"
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
          },
    telegram: {
      method:
        mediaType === "audio"
          ? "sendAudio"
          : mediaType === "document"
            ? "sendDocument"
            : "sendVideo",
      messageId: message?.message_id ?? null,
      chatId: message?.chat?.id ?? null,
      chatTitle: message?.chat?.title ?? null,
    },
    metadata: input.metadata,
  });
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

  return {
    ok: true,
    value: {
      mediaUrl,
      sourceUrl,
      caption: normalizeCaption(record.caption),
      parseMode,
      mediaType,
      mediaHeaders: normalizeMediaHeaders(record.mediaHeaders),
      metadata: normalizeMetadata(record.metadata),
    },
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
