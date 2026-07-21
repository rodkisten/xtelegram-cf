const MAX_PLAYLIST_DEPTH = 8;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const HLS_CONTENT_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
]);

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
]);

const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "wav",
  "flac",
]);

const ALLOWED_PARSE_MODES = new Set([
  "HTML",
  "MarkdownV2",
]);

export default {
  async fetch(request, env) {
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

function handleHealth() {
  return json({
    ok: true,
    service: "generic-telegram-media-relay",
    status: "online",
    timestamp: new Date().toISOString(),
  });
}

async function handleSend(request, env) {
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

  let body;

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
  let resolved;

  try {
    resolved = await resolveMediaSource(input.mediaUrl, {
      depth: 0,
      visited: new Set(),
      headers: input.mediaHeaders,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: getErrorMessage(error),
        stage: "resolve-media",
        source: {
          inputUrl: input.mediaUrl.href,
          sourceUrl: input.sourceUrl,
        },
      },
      422,
    );
  }

  if (resolved.type !== "file") {
    return json(
      {
        ok: false,
        error:
          "The highest-quality HLS variant is still a segmented playlist " +
          "and cannot be sent to Telegram as a direct file URL.",
        stage: "resolve-playlist",
        source: {
          inputUrl: input.mediaUrl.href,
          sourceUrl: input.sourceUrl,
          playlistUrl: resolved.url,
        },
        playlist: {
          selectedBitrate: resolved.selectedBitrate,
          selectedResolution: resolved.selectedResolution,
          segmentCount: resolved.segmentCount,
        },
      },
      422,
    );
  }

  const telegramRequest = buildTelegramRequest({
    mediaUrl: resolved.url,
    mediaType: input.mediaType,
    contentType: resolved.contentType,
    caption: input.caption,
    parseMode: input.parseMode,
    env,
  });

  console.log("[media-relay] Sending media", {
    inputUrl: input.mediaUrl.href,
    resolvedUrl: resolved.url,
    sourceUrl: input.sourceUrl,
    method: telegramRequest.method,
    selectedBitrate: resolved.selectedBitrate,
    selectedResolution: resolved.selectedResolution,
    metadata: input.metadata,
  });

  const telegramResult = await sendTelegramMedia({
    botToken: env.TELEGRAM_BOT_TOKEN,
    method: telegramRequest.method,
    payload: telegramRequest.payload,
  });

  if (!telegramResult.ok) {
    console.error("[media-relay] Telegram rejected media", {
      inputUrl: input.mediaUrl.href,
      resolvedUrl: resolved.url,
      method: telegramRequest.method,
      telegram: telegramResult,
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
          resolvedUrl: resolved.url,
          sourceUrl: input.sourceUrl,
        },
        resolution: {
          selectedBitrate: resolved.selectedBitrate,
          selectedResolution: resolved.selectedResolution,
          playlistDepth: resolved.playlistDepth,
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
      resolvedUrl: resolved.url,
      sourceUrl: input.sourceUrl,
    },
    resolution: {
      selectedBitrate: resolved.selectedBitrate,
      selectedResolution: resolved.selectedResolution,
      playlistDepth: resolved.playlistDepth,
    },
    telegram: {
      method: telegramRequest.method,
      messageId: message?.message_id ?? null,
      chatId: message?.chat?.id ?? null,
      chatTitle: message?.chat?.title ?? null,
    },
    metadata: input.metadata,
  });
}

function validateEnvironment(env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return "Missing TELEGRAM_BOT_TOKEN secret";
  }

  if (!env.TELEGRAM_CHAT_ID) {
    return "Missing TELEGRAM_CHAT_ID secret";
  }

  if (!env.RELAY_TOKEN) {
    return "Missing RELAY_TOKEN secret";
  }

  return null;
}

function isAuthorized(request, env) {
  const authorization = request.headers.get("Authorization");

  if (!authorization) {
    return false;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return false;
  }

  return safeTokenEqual(match[1].trim(), String(env.RELAY_TOKEN));
}

function safeTokenEqual(left, right) {
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

function validateRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      error: "Request body must be an object",
    };
  }

  const rawMediaUrl =
    body.mediaUrl ??
    body.videoUrl ??
    body.fileUrl ??
    body.url;

  const mediaUrl = normalizePublicHttpUrl(rawMediaUrl);

  if (!mediaUrl) {
    return {
      ok: false,
      error: "Invalid mediaUrl or videoUrl",
    };
  }

  const sourceUrl = normalizeOptionalSourceUrl(
    body.sourceUrl ?? body.tweetUrl,
  );
  const parseMode = normalizeParseMode(body.parseMode);

  if (body.parseMode && !parseMode) {
    return {
      ok: false,
      error: "Invalid parseMode. Allowed values: HTML, MarkdownV2",
    };
  }

  const mediaType = normalizeMediaType(body.mediaType);

  if (body.mediaType && !mediaType) {
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
      caption: normalizeCaption(body.caption),
      parseMode,
      mediaType,
      mediaHeaders: normalizeMediaHeaders(body.mediaHeaders),
      metadata: normalizeMetadata(body.metadata),
    },
  };
}

function normalizePublicHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  let url;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  if (isBlockedHostname(url.hostname)) {
    return null;
  }

  return url;
}

function normalizeOptionalSourceUrl(value) {
  if (value == null || value === "") {
    return null;
  }

  try {
    const url = new URL(String(value));

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function isBlockedHostname(hostname) {
  const host = String(hostname).toLowerCase();

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return true;
  }

  if (host === "::1" || host === "[::1]") {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);

  if (!ipv4) {
    return false;
  }

  const parts = ipv4.slice(1).map(Number);

  if (parts.some((part) => part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function normalizeCaption(value) {
  if (value == null) {
    return "";
  }

  return typeof value === "string" ? value.trim() : String(value);
}

function normalizeParseMode(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value);

  return ALLOWED_PARSE_MODES.has(normalized) ? normalized : null;
}

function normalizeMediaType(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).toLowerCase();

  return ["video", "audio", "document"].includes(normalized)
    ? normalized
    : null;
}

function normalizeMediaHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const allowed = new Set([
    "accept",
    "accept-language",
    "authorization",
    "referer",
    "user-agent",
  ]);
  const headers = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = String(key).toLowerCase();

    if (!allowed.has(normalizedKey)) {
      continue;
    }

    if (rawValue == null) {
      continue;
    }

    headers[key] = String(rawValue);
  }

  return headers;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const metadata = {};

  for (const [key, rawValue] of Object.entries(value)) {
    if (rawValue == null) {
      continue;
    }

    if (
      typeof rawValue === "string" ||
      typeof rawValue === "number" ||
      typeof rawValue === "boolean"
    ) {
      metadata[String(key).slice(0, 100)] = String(rawValue).slice(0, 2000);
    }
  }

  return metadata;
}

async function resolveMediaSource(inputUrl, state) {
  if (state.depth > MAX_PLAYLIST_DEPTH) {
    throw new Error("Too many nested HLS playlists");
  }

  const normalizedUrl = normalizePublicHttpUrl(inputUrl.href || inputUrl);

  if (!normalizedUrl) {
    throw new Error("Resolved media URL is not allowed");
  }

  if (state.visited.has(normalizedUrl.href)) {
    throw new Error("Circular HLS playlist reference detected");
  }

  state.visited.add(normalizedUrl.href);

  if (!looksLikeHlsUrl(normalizedUrl)) {
    const probe = await probeMediaUrl(normalizedUrl, state.headers);

    if (!probe.isPlaylist) {
      return {
        type: "file",
        url: probe.url,
        contentType: probe.contentType,
        selectedBitrate: null,
        selectedResolution: null,
        playlistDepth: state.depth,
      };
    }

    return resolveHlsUrl(new URL(probe.url), state);
  }

  return resolveHlsUrl(normalizedUrl, state);
}

async function probeMediaUrl(url, headers) {
  try {
    const response = await fetch(url.href, {
      method: "HEAD",
      headers,
      redirect: "follow",
    });
    const contentType = getBaseContentType(response.headers.get(
      "content-type",
    ));
    const finalUrl = response.url || url.href;

    return {
      url: finalUrl,
      contentType,
      isPlaylist:
        HLS_CONTENT_TYPES.has(contentType) || looksLikeHlsUrl(finalUrl),
    };
  } catch {
    return {
      url: url.href,
      contentType: "",
      isPlaylist: looksLikeHlsUrl(url),
    };
  }
}

async function resolveHlsUrl(url, state) {
  const playlist = await fetchHlsPlaylist(url, state.headers);
  const parsed = parseHlsPlaylist(playlist.text, playlist.url);

  if (parsed.type === "master") {
    const variants = [...parsed.variants].sort(compareHlsVariants);
    let bestPlaylistResult = null;
    let lastError = null;

    for (const variant of variants) {
      try {
        const result = await resolveMediaSource(new URL(variant.url), {
          depth: state.depth + 1,
          visited: new Set(state.visited),
          headers: state.headers,
        });

        result.selectedBitrate =
          result.selectedBitrate ?? variant.bitrate ?? null;
        result.selectedResolution =
          result.selectedResolution ?? variant.resolution ?? null;

        if (result.type === "file") {
          return result;
        }

        bestPlaylistResult ??= result;
      } catch (error) {
        lastError = error;
      }
    }

    if (bestPlaylistResult) {
      return bestPlaylistResult;
    }

    throw lastError || new Error("No usable HLS variant was found");
  }

  const directFile = findDirectFileInMediaPlaylist(parsed);

  if (directFile) {
    return {
      type: "file",
      url: directFile,
      contentType: inferContentTypeFromUrl(directFile),
      selectedBitrate: null,
      selectedResolution: null,
      playlistDepth: state.depth,
    };
  }

  return {
    type: "playlist",
    url: playlist.url,
    contentType: "application/vnd.apple.mpegurl",
    selectedBitrate: null,
    selectedResolution: null,
    playlistDepth: state.depth,
    segmentCount: parsed.segments.length,
  };
}

async function fetchHlsPlaylist(url, headers) {
  const response = await fetch(url.href, {
    method: "GET",
    headers: {
      Accept:
        "application/vnd.apple.mpegurl, application/x-mpegurl, text/plain",
      ...headers,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} while loading HLS playlist`,
    );
  }

  const contentLength = Number(response.headers.get("content-length")) || 0;

  if (contentLength > MAX_PLAYLIST_BYTES) {
    throw new Error("HLS playlist exceeds the relay size limit");
  }

  const text = await response.text();

  if (new TextEncoder().encode(text).byteLength > MAX_PLAYLIST_BYTES) {
    throw new Error("HLS playlist exceeds the relay size limit");
  }

  if (!text.trimStart().startsWith("#EXTM3U")) {
    throw new Error("The media URL did not return a valid HLS playlist");
  }

  return {
    url: response.url || url.href,
    text,
  };
}

function parseHlsPlaylist(text, playlistUrl) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const variants = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }

    const attributes = parseHlsAttributes(
      line.slice("#EXT-X-STREAM-INF:".length),
    );
    let uri = null;

    for (let next = index + 1; next < lines.length; next += 1) {
      if (!lines[next].startsWith("#")) {
        uri = resolveRelativeUrl(lines[next], playlistUrl);
        break;
      }
    }

    if (!uri) {
      continue;
    }

    const resolution = parseResolution(attributes.RESOLUTION);
    const averageBandwidth = Number(attributes["AVERAGE-BANDWIDTH"] || 0);
    const bandwidth = Number(attributes.BANDWIDTH || 0);

    variants.push({
      url: uri,
      bitrate: averageBandwidth || bandwidth || 0,
      peakBitrate: bandwidth || averageBandwidth || 0,
      resolution,
      width: resolution?.width || 0,
      height: resolution?.height || 0,
      codecs: attributes.CODECS || "",
    });
  }

  if (variants.length > 0) {
    return {
      type: "master",
      variants,
    };
  }

  const segments = [];
  let pendingByteRange = null;

  for (const line of lines) {
    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      pendingByteRange = line.slice("#EXT-X-BYTERANGE:".length);
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    const url = resolveRelativeUrl(line, playlistUrl);

    if (!url) {
      continue;
    }

    segments.push({
      url,
      byteRange: pendingByteRange,
    });
    pendingByteRange = null;
  }

  return {
    type: "media",
    segments,
  };
}

function parseHlsAttributes(value) {
  const attributes = {};
  const expression = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match = null;

  while ((match = expression.exec(String(value)))) {
    let attributeValue = match[2].trim();

    if (attributeValue.startsWith('"') && attributeValue.endsWith('"')) {
      attributeValue = attributeValue.slice(1, -1);
    }

    attributes[match[1].toUpperCase()] = attributeValue;
  }

  return attributes;
}

function parseResolution(value) {
  const match = String(value || "").match(/^(\d+)x(\d+)$/i);

  if (!match) {
    return null;
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
    label: `${match[1]}x${match[2]}`,
  };
}

function compareHlsVariants(left, right) {
  const bitrateDifference = Number(right.bitrate) - Number(left.bitrate);

  if (bitrateDifference !== 0) {
    return bitrateDifference;
  }

  const rightPixels = Number(right.width) * Number(right.height);
  const leftPixels = Number(left.width) * Number(left.height);
  const pixelDifference = rightPixels - leftPixels;

  if (pixelDifference !== 0) {
    return pixelDifference;
  }

  return Number(right.peakBitrate) - Number(left.peakBitrate);
}

function findDirectFileInMediaPlaylist(playlist) {
  if (!playlist.segments.length) {
    return null;
  }

  const uniqueUrls = [
    ...new Set(playlist.segments.map((segment) => segment.url)),
  ];

  if (uniqueUrls.length !== 1) {
    return null;
  }

  const onlyUrl = uniqueUrls[0];

  if (!looksLikeDirectMediaFile(onlyUrl)) {
    return null;
  }

  if (playlist.segments.length === 1) {
    return onlyUrl;
  }

  const allByteRanges = playlist.segments.every((segment) => {
    return Boolean(segment.byteRange);
  });

  return allByteRanges ? onlyUrl : null;
}

function resolveRelativeUrl(value, baseUrl) {
  try {
    const url = new URL(String(value), baseUrl);

    return normalizePublicHttpUrl(url.href)?.href || null;
  } catch {
    return null;
  }
}

function looksLikeHlsUrl(value) {
  const url = value instanceof URL ? value : new URL(String(value));

  return /\.m3u8(?:$|[?#])/i.test(url.href);
}

function looksLikeDirectMediaFile(value) {
  return /\.(mp4|m4v|mov|webm|mp3|m4a|aac|ogg|oga|wav|flac)(?:$|[?#])/i
    .test(String(value));
}

function getBaseContentType(value) {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function getFileExtension(value) {
  try {
    const pathname = new URL(String(value)).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,8})$/i);

    return match?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}

function inferContentTypeFromUrl(value) {
  const extension = getFileExtension(value);

  if (VIDEO_EXTENSIONS.has(extension)) {
    return extension === "webm" ? "video/webm" : "video/mp4";
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    if (extension === "mp3") {
      return "audio/mpeg";
    }

    return `audio/${extension}`;
  }

  return "application/octet-stream";
}

function buildTelegramRequest(options) {
  const inferredType = inferTelegramMediaType(
    options.mediaUrl,
    options.contentType,
  );
  const mediaType = options.mediaType || inferredType;
  const payload = {
    chat_id: options.env.TELEGRAM_CHAT_ID,
  };
  let method;

  if (mediaType === "audio") {
    method = "sendAudio";
    payload.audio = options.mediaUrl;
  } else if (mediaType === "document") {
    method = "sendDocument";
    payload.document = options.mediaUrl;
  } else {
    method = "sendVideo";
    payload.video = options.mediaUrl;
    payload.supports_streaming = true;
  }

  if (options.caption) {
    payload.caption = options.caption;
  }

  if (options.parseMode) {
    payload.parse_mode = options.parseMode;
  }

  return {
    method,
    payload,
  };
}

function inferTelegramMediaType(mediaUrl, contentType) {
  const type = getBaseContentType(contentType);

  if (type.startsWith("video/")) {
    return "video";
  }

  if (type.startsWith("audio/")) {
    return "audio";
  }

  const extension = getFileExtension(mediaUrl);

  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }

  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }

  return "document";
}

async function sendTelegramMedia(options) {
  const endpoint =
    "https://api.telegram.org/bot" +
    `${options.botToken}/${options.method}`;
  let response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options.payload),
    });
  } catch (error) {
    return {
      ok: false,
      description: getErrorMessage(error),
    };
  }

  let result;

  try {
    result = await response.json();
  } catch {
    return {
      ok: false,
      httpStatus: response.status,
      description: `Telegram returned HTTP ${response.status}`,
    };
  }

  if (!response.ok || !result?.ok) {
    return {
      ...result,
      ok: false,
      httpStatus: response.status,
      description:
        result?.description ||
        `Telegram returned HTTP ${response.status}`,
    };
  }

  return result;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...CORS_HEADERS,
      "Cache-Control": "no-store",
    },
  });
}
