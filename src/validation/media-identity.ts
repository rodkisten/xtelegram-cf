import type { MediaIdentityInput } from "../db";
import { normalizePublicHttpUrl } from "../lib/http";

export type MediaCheckInputObject = {
  mediaKey?: unknown;
  provider?: unknown;
  mediaId?: unknown;
  url?: unknown;
  sourceUrl?: unknown;
  pageUrl?: unknown;
  mediaUrl?: unknown;
};

export function normalizeMediaIdentityInput(input: unknown): MediaIdentityInput | null {
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
  const rawUrl = [item.url, item.sourceUrl, item.pageUrl, item.mediaUrl].find(
    (value) => typeof value === "string" && value.trim(),
  ) as string | undefined;
  const normalizedUrl = rawUrl ? normalizePublicHttpUrl(rawUrl) : null;

  if (mediaKey) {
    return {
      mediaKey,
      provider: provider || null,
      mediaId: mediaId || null,
      sourceUrl: normalizedUrl?.href ?? null,
    };
  }
  if (provider && mediaId) {
    return { provider, mediaId, sourceUrl: normalizedUrl?.href ?? null };
  }
  if (normalizedUrl) {
    return { provider: provider || null, mediaId: mediaId || null, sourceUrl: normalizedUrl.href };
  }
  return null;
}
