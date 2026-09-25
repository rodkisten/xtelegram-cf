import { RELAY_LIMITS } from "../config/constants";
import type { SocialResolution } from "../social";
import type { Env } from "../types";
import { fetchPublic, normalizePublicHttpUrl } from "./http";

export interface ThumbnailResponseFields {
  thumbnail_url: string | null;
  thumbnail_base64: string | null;
  thumbnail_mime_type: string | null;
  thumbnail_bytes: number | null;
  thumbnail_source: string | null;
  thumbnail_included: boolean;
  thumbnail_error: string | null;
  thumbnail_width: number | null;
  thumbnail_height: number | null;
  thumbnail_source_width: number | null;
  thumbnail_source_height: number | null;
  thumbnail_resized: boolean;
}

interface ThumbnailCandidate {
  url: string;
  source: string;
  headers: Record<string, string>;
  sourceWidth: number | null;
  sourceHeight: number | null;
}

interface ThumbnailOptions {
  includeBase64?: boolean;
  maxBytes?: number | null;
  maxWidth?: number | null;
}

interface ThumbnailFetchSuccess {
  ok: true;
  url: string;
  base64: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  resized: boolean;
}

interface ThumbnailFetchFailure {
  ok: false;
  error: string;
}

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export function emptyThumbnailResponse(
  overrides: Partial<ThumbnailResponseFields> = {},
): ThumbnailResponseFields {
  return {
    thumbnail_url: null,
    thumbnail_base64: null,
    thumbnail_mime_type: null,
    thumbnail_bytes: null,
    thumbnail_source: null,
    thumbnail_included: false,
    thumbnail_error: null,
    thumbnail_width: null,
    thumbnail_height: null,
    thumbnail_source_width: null,
    thumbnail_source_height: null,
    thumbnail_resized: false,
    ...overrides,
  };
}


export function firstThumbnailResponseFields(values: unknown[]): ThumbnailResponseFields {
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const url = cleanString(record.thumbnail_url);
    const base64 = cleanString(record.thumbnail_base64);
    if (!url && !base64) continue;
    return {
      thumbnail_url: url,
      thumbnail_base64: base64,
      thumbnail_mime_type: cleanString(record.thumbnail_mime_type),
      thumbnail_bytes: positiveInteger(record.thumbnail_bytes),
      thumbnail_source: cleanString(record.thumbnail_source),
      thumbnail_included: record.thumbnail_included === true || Boolean(base64),
      thumbnail_error: cleanString(record.thumbnail_error),
      thumbnail_width: positiveInteger(record.thumbnail_width),
      thumbnail_height: positiveInteger(record.thumbnail_height),
      thumbnail_source_width: positiveInteger(record.thumbnail_source_width),
      thumbnail_source_height: positiveInteger(record.thumbnail_source_height),
      thumbnail_resized: record.thumbnail_resized === true,
    };
  }
  return emptyThumbnailResponse();
}

export function resolveThumbnailMaxBytes(
  env: Env,
  requested?: number | null,
): number {
  const configured = positiveInteger(env.THUMBNAIL_BASE64_MAX_BYTES);
  const desired = positiveInteger(requested) ?? configured ?? RELAY_LIMITS.thumbnailBase64DefaultBytes;
  return Math.min(RELAY_LIMITS.thumbnailBase64HardBytes, Math.max(1, desired));
}

export function resolveThumbnailMaxWidth(
  env: Env,
  requested?: number | null,
): number {
  const configured = positiveInteger(env.THUMBNAIL_MAX_WIDTH);
  const desired = positiveInteger(requested) ?? configured ?? RELAY_LIMITS.thumbnailMaxWidthDefault;
  return Math.min(RELAY_LIMITS.thumbnailMaxWidthHard, Math.max(1, desired));
}

export function firstSocialThumbnailUrl(resolution: SocialResolution): string | null {
  return collectSocialThumbnailCandidates(resolution)[0]?.url ?? null;
}

export async function buildSocialThumbnailResponse(
  resolution: SocialResolution,
  env: Env,
  options: ThumbnailOptions = {},
): Promise<ThumbnailResponseFields> {
  const candidates = collectSocialThumbnailCandidates(resolution);
  if (!candidates.length) return emptyThumbnailResponse();

  return buildThumbnailResponse(candidates, env, options);
}

export async function buildThumbnailResponseFromUrl(
  url: string,
  env: Env,
  options: ThumbnailOptions & { source?: string } = {},
): Promise<ThumbnailResponseFields> {
  const normalized = normalizePublicHttpUrl(url);
  if (!normalized) {
    return emptyThumbnailResponse({
      thumbnail_error: "invalid_thumbnail_url",
    });
  }

  return buildThumbnailResponse([
    {
      url: normalized.href,
      source: options.source || "stored_metadata",
      headers: thumbnailHeadersForUrl(normalized.href),
      sourceWidth: null,
      sourceHeight: null,
    },
  ], env, options);
}

async function buildThumbnailResponse(
  candidates: ThumbnailCandidate[],
  env: Env,
  options: ThumbnailOptions,
): Promise<ThumbnailResponseFields> {
  const first = candidates[0]!;
  const includeBase64 = options.includeBase64 !== false;
  const maxWidth = resolveThumbnailMaxWidth(env, options.maxWidth);

  if (!includeBase64) {
    return emptyThumbnailResponse({
      thumbnail_url: first.url,
      thumbnail_source: first.source,
      thumbnail_source_width: first.sourceWidth,
      thumbnail_source_height: first.sourceHeight,
    });
  }

  const maxBytes = resolveThumbnailMaxBytes(env, options.maxBytes);
  let lastError: string | null = null;

  for (const candidate of candidates.slice(0, RELAY_LIMITS.thumbnailCandidateMax)) {
    const fetched = await fetchThumbnail(candidate, maxBytes, maxWidth);
    if (!fetched.ok) {
      lastError = fetched.error;
      continue;
    }

    return {
      thumbnail_url: fetched.url,
      thumbnail_base64: fetched.base64,
      thumbnail_mime_type: fetched.mimeType,
      thumbnail_bytes: fetched.bytes,
      thumbnail_source: candidate.source,
      thumbnail_included: true,
      thumbnail_error: null,
      thumbnail_width: fetched.width,
      thumbnail_height: fetched.height,
      thumbnail_source_width: candidate.sourceWidth,
      thumbnail_source_height: candidate.sourceHeight,
      thumbnail_resized: fetched.resized,
    };
  }

  return emptyThumbnailResponse({
    thumbnail_url: first.url,
    thumbnail_source: first.source,
    thumbnail_error: lastError || "thumbnail_fetch_failed",
    thumbnail_source_width: first.sourceWidth,
    thumbnail_source_height: first.sourceHeight,
  });
}

function collectSocialThumbnailCandidates(
  resolution: SocialResolution,
): ThumbnailCandidate[] {
  const output: ThumbnailCandidate[] = [];
  const seen = new Set<string>();

  const add = (
    rawUrl: string | null | undefined,
    source: string,
    headers?: Record<string, string>,
    sourceWidth?: number | null,
    sourceHeight?: number | null,
  ) => {
    const normalized = normalizePublicHttpUrl(rawUrl);
    if (!normalized || seen.has(normalized.href)) return;
    seen.add(normalized.href);
    output.push({
      url: normalized.href,
      source,
      headers: headers && Object.keys(headers).length
        ? headers
        : thumbnailHeadersForUrl(normalized.href),
      sourceWidth: positiveInteger(sourceWidth),
      sourceHeight: positiveInteger(sourceHeight),
    });
  };

  for (const item of resolution.media) {
    add(item.thumbnail, "resolver_thumbnail", undefined, item.width, item.height);
    for (const variant of item.variants || []) {
      add(variant.thumbnail, "resolver_variant_thumbnail", undefined, variant.width, variant.height);
    }
  }

  // Photo posts already are images, so the selected media is a valid fallback
  // when the provider does not expose a dedicated poster/cover URL.
  for (const item of resolution.media) {
    if (item.type === "photo") {
      add(item.url, "resolved_photo", item.mediaHeaders, item.width, item.height);
    }
  }

  return output;
}

async function fetchThumbnail(
  candidate: ThumbnailCandidate,
  maxBytes: number,
  maxWidth: number,
): Promise<ThumbnailFetchSuccess | ThumbnailFetchFailure> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("thumbnail fetch timeout"),
    RELAY_LIMITS.thumbnailFetchTimeoutMs,
  );

  try {
    const response = await fetchThumbnailWithResize(candidate, maxWidth, controller.signal);

    if (!response.ok) {
      try { await response.body?.cancel(); } catch {}
      return { ok: false, error: `thumbnail_http_${response.status}` };
    }

    const declared = positiveInteger(response.headers.get("content-length"));
    if (declared != null && declared > maxBytes) {
      try { await response.body?.cancel(); } catch {}
      return { ok: false, error: "thumbnail_too_large" };
    }

    const mimeType = normalizeImageMimeType(
      response.headers.get("content-type"),
      response.url || candidate.url,
    );
    if (!mimeType) {
      try { await response.body?.cancel(); } catch {}
      return { ok: false, error: "thumbnail_not_image" };
    }

    const bytes = await readBoundedBody(response, maxBytes);
    if (!bytes) return { ok: false, error: "thumbnail_too_large" };

    const dimensions = extractImageDimensions(bytes, mimeType);
    const resized = inferThumbnailResized(
      candidate.sourceWidth,
      candidate.sourceHeight,
      dimensions.width,
      dimensions.height,
      maxWidth,
    );

    return {
      ok: true,
      url: response.url || candidate.url,
      base64: bytesToBase64(bytes),
      mimeType,
      bytes: bytes.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      resized,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.name === "AbortError"
        ? "thumbnail_timeout"
        : "thumbnail_fetch_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchThumbnailWithResize(
  candidate: ThumbnailCandidate,
  maxWidth: number,
  signal: AbortSignal,
): Promise<Response> {
  const baseInit = {
    method: "GET",
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      ...candidate.headers,
    },
    signal,
  } as RequestInit;

  try {
    return await fetchPublic(candidate.url, {
      ...baseInit,
      cf: {
        image: {
          width: maxWidth,
          fit: "scale-down",
          quality: RELAY_LIMITS.thumbnailResizeQuality,
          format: "jpeg",
          metadata: "none",
          anim: false,
        },
      },
    } as RequestInit & { cf: unknown });
  } catch {
    return fetchPublic(candidate.url, baseInit);
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength <= maxBytes ? bytes : null;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel("thumbnail byte limit exceeded"); } catch {}
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function normalizeImageMimeType(
  contentType: string | null,
  url: string,
): string | null {
  const normalized = String(contentType || "")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();

  if (normalized.startsWith("image/")) return normalized;

  let pathname = "";
  try { pathname = new URL(url).pathname.toLowerCase(); } catch {}
  if (/\.jpe?g$/.test(pathname)) return "image/jpeg";
  if (/\.png$/.test(pathname)) return "image/png";
  if (/\.webp$/.test(pathname)) return "image/webp";
  if (/\.gif$/.test(pathname)) return "image/gif";
  if (/\.avif$/.test(pathname)) return "image/avif";
  return null;
}

function extractImageDimensions(
  bytes: Uint8Array,
  mimeType: string,
): { width: number | null; height: number | null } {
  try {
    if (mimeType === "image/png") return extractPngDimensions(bytes);
    if (mimeType === "image/gif") return extractGifDimensions(bytes);
    if (mimeType === "image/webp") return extractWebpDimensions(bytes);
    if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
      return extractJpegDimensions(bytes);
    }
  } catch {}
  return { width: null, height: null };
}

function extractPngDimensions(bytes: Uint8Array): { width: number | null; height: number | null } {
  if (bytes.byteLength < 24) return { width: null, height: null };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d || bytes[5] !== 0x0a || bytes[6] !== 0x1a || bytes[7] !== 0x0a
  ) {
    return { width: null, height: null };
  }
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function extractGifDimensions(bytes: Uint8Array): { width: number | null; height: number | null } {
  if (bytes.byteLength < 10) return { width: null, height: null };
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") return { width: null, height: null };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint16(6, true),
    height: view.getUint16(8, true),
  };
}

function extractJpegDimensions(bytes: Uint8Array): { width: number | null; height: number | null } {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { width: null, height: null };
  }

  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) break;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 1 >= bytes.byteLength) break;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.byteLength) break;
    const isSof = (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    );
    if (isSof && length >= 7) {
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      return { width, height };
    }
    offset += length;
  }

  return { width: null, height: null };
}

function extractWebpDimensions(bytes: Uint8Array): { width: number | null; height: number | null } {
  if (bytes.byteLength < 30) return { width: null, height: null };
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const webp = String.fromCharCode(...bytes.subarray(8, 12));
  if (riff !== "RIFF" || webp !== "WEBP") return { width: null, height: null };

  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (chunk === "VP8X" && bytes.byteLength >= 30) {
    const width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16);
    const height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16);
    return { width, height };
  }

  if (chunk === "VP8 " && bytes.byteLength >= 30) {
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }

  if (chunk === "VP8L" && bytes.byteLength >= 25) {
    const b0 = bytes[21]!;
    const b1 = bytes[22]!;
    const b2 = bytes[23]!;
    const b3 = bytes[24]!;
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }

  return { width: null, height: null };
}

function inferThumbnailResized(
  sourceWidth: number | null,
  sourceHeight: number | null,
  finalWidth: number | null,
  finalHeight: number | null,
  maxWidth: number,
): boolean {
  if (sourceWidth && finalWidth && sourceWidth > finalWidth) return true;
  if (sourceHeight && finalHeight && sourceHeight > finalHeight) return true;
  if (finalWidth && finalWidth > maxWidth) return true;
  return false;
}

function thumbnailHeadersForUrl(url: string): Record<string, string> {
  let hostname = "";
  try { hostname = new URL(url).hostname.toLowerCase(); } catch {
    return { "User-Agent": USER_AGENT };
  }

  if (hostname === "pbs.twimg.com" || hostname.endsWith(".twimg.com")) {
    return { "User-Agent": USER_AGENT, Referer: "https://x.com/" };
  }
  if (
    hostname.endsWith(".tiktok.com") ||
    hostname.endsWith(".tiktokcdn.com") ||
    hostname.endsWith(".tiktokcdn-us.com")
  ) {
    return { "User-Agent": USER_AGENT, Referer: "https://www.tiktok.com/" };
  }
  if (hostname.endsWith(".cdninstagram.com") || hostname.endsWith(".fbcdn.net")) {
    return { "User-Agent": USER_AGENT, Referer: "https://www.instagram.com/" };
  }
  if (
    hostname.endsWith(".redditmedia.com") ||
    hostname.endsWith(".redd.it") ||
    hostname.endsWith(".reddit.com")
  ) {
    return { "User-Agent": USER_AGENT, Referer: "https://www.reddit.com/" };
  }
  if (
    hostname.endsWith(".googleusercontent.com") ||
    hostname.endsWith(".ytimg.com") ||
    hostname.endsWith(".youtube.com")
  ) {
    return { "User-Agent": USER_AGENT, Referer: "https://www.youtube.com/" };
  }

  return { "User-Agent": USER_AGENT };
}

function cleanString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}
