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
}

interface ThumbnailCandidate {
  url: string;
  source: string;
  headers: Record<string, string>;
}

interface ThumbnailOptions {
  includeBase64?: boolean;
  maxBytes?: number | null;
}

interface ThumbnailFetchSuccess {
  ok: true;
  url: string;
  base64: string;
  mimeType: string;
  bytes: number;
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

  if (!includeBase64) {
    return emptyThumbnailResponse({
      thumbnail_url: first.url,
      thumbnail_source: first.source,
    });
  }

  const maxBytes = resolveThumbnailMaxBytes(env, options.maxBytes);
  let lastError: string | null = null;

  for (const candidate of candidates.slice(0, RELAY_LIMITS.thumbnailCandidateMax)) {
    const fetched = await fetchThumbnail(candidate, maxBytes);
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
    };
  }

  return emptyThumbnailResponse({
    thumbnail_url: first.url,
    thumbnail_source: first.source,
    thumbnail_error: lastError || "thumbnail_fetch_failed",
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
    });
  };

  for (const item of resolution.media) {
    add(item.thumbnail, "resolver_thumbnail");
    for (const variant of item.variants || []) {
      add(variant.thumbnail, "resolver_variant_thumbnail");
    }
  }

  // Photo posts already are images, so the selected media is a valid fallback
  // when the provider does not expose a dedicated poster/cover URL.
  for (const item of resolution.media) {
    if (item.type === "photo") {
      add(item.url, "resolved_photo", item.mediaHeaders);
    }
  }

  return output;
}

async function fetchThumbnail(
  candidate: ThumbnailCandidate,
  maxBytes: number,
): Promise<ThumbnailFetchSuccess | ThumbnailFetchFailure> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("thumbnail fetch timeout"),
    RELAY_LIMITS.thumbnailFetchTimeoutMs,
  );

  try {
    const response = await fetchPublic(candidate.url, {
      method: "GET",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...candidate.headers,
      },
      signal: controller.signal,
    });

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

    return {
      ok: true,
      url: response.url || candidate.url,
      base64: bytesToBase64(bytes),
      mimeType,
      bytes: bytes.byteLength,
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
