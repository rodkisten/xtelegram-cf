import { sanitizeDeliveryCaption } from "../lib/social-caption";
import { normalizeOptionalSourceUrl, normalizePublicHttpUrl } from "../lib/http";
import { normalizeHashtags } from "../lib/hashtags";
import type { AlbumMediaType, RelayAlbumInput, RelayForceMode, RelayInput, RelayMediaVariant } from "../types";
import {
  normalizeCaption,
  hasProvidedField,
  normalizeMediaHeaders,
  normalizeMediaType,
  normalizeMetadata,
  normalizeNullableText,
  normalizeOptionalText,
  normalizeParseMode,
  normalizeTelegramChannels,
  normalizeRoutingUsernames,
  resolvePayloadCaption,
  resolveOriginalSourceUrl,
} from "./common";

export type SendValidationResult =
  | { ok: true; value: RelayInput }
  | { ok: false; error: string };

export function validateRequestBody(body: unknown): SendValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Request body must be an object" };
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
    return { ok: false, error: "Invalid mediaUrl, photoUrl, or videoUrl" };
  }

  const pageUrl = normalizeOptionalSourceUrl(record.pageUrl);
  const sourceUrl = resolveOriginalSourceUrl(record);
  const parseMode = normalizeParseMode(record.parseMode);

  if (record.parseMode && !parseMode) {
    return { ok: false, error: "Invalid parseMode. Allowed values: HTML, MarkdownV2" };
  }

  const mediaType = normalizeMediaType(record.mediaType);
  if (record.mediaType && !mediaType) {
    return { ok: false, error: "Invalid mediaType. Use photo, video, audio, or document" };
  }

  const channelValidation = normalizeTelegramChannels(record.channel, record.channels);
  if (!channelValidation.ok) return { ok: false, error: channelValidation.error };
  const usernameValidation = normalizeRoutingUsernames(record.username, record.usernames);
  if (!usernameValidation.ok) return { ok: false, error: usernameValidation.error };

  const mediaHeaders = normalizeMediaHeaders(record.mediaHeaders);
  const mediaVariants = normalizeRelayMediaVariants(record.mediaVariants, mediaHeaders);
  const hashtagValidation = normalizeHashtags(record.hashtags ?? record.hashtag);
  if (!hashtagValidation.ok) return { ok: false, error: hashtagValidation.error };

  const forceMode = normalizeRelayForceMode(record.force);

  return {
    ok: true,
    value: {
      mediaUrl,
      sourceUrl,
      pageUrl,
      provider: normalizeNullableText(record.provider, 120),
      title: normalizeOptionalText(record.title, 1000),
      text: normalizeOptionalText(record.text, 20_000),
      caption: resolvePayloadCaption(record),
      captionExplicit: resolveCaptionExplicitFlag(record),
      hashtags: hashtagValidation.value,
      parseMode: resolveCaptionExplicitFlag(record) ? parseMode : null,
      mediaType,
      mediaHeaders,
      mediaVariants,
      channels: channelValidation.value,
      usernames: usernameValidation.value,
      metadata: normalizeMetadata(record.metadata),
      metadataProvided: record.metadataProvided !== false && hasProvidedField(record, "metadata"),
      presentationMetadata: normalizeMetadata(hasProvidedField(record, "presentationMetadata")
        ? record.presentationMetadata : record.metadata),
      mediaId: normalizeNullableText(record.mediaId, 240),
      mediaKey: normalizeNullableText(record.mediaKey, 300),
      force: forceMode !== null,
      forceMode,
      forceCpu: record.force_cpu === true || record.forceCpu === true,
    },
  };
}

export type AlbumValidationResult =
  | { kind: "none" }
  | { kind: "valid"; value: RelayAlbumInput }
  | { kind: "invalid"; error: string };

export function validateAlbumRequestBody(body: unknown): AlbumValidationResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { kind: "none" };

  const record = body as Record<string, unknown>;
  const rawItems = Array.isArray(record.mediaItems)
    ? record.mediaItems
    : Array.isArray(record.mediaUrls)
      ? record.mediaUrls
      : Array.isArray(record.photoUrls)
        ? record.photoUrls.map((mediaUrl) => ({ mediaUrl, mediaType: "photo" }))
        : null;

  if (!rawItems) return { kind: "none" };
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
    return { kind: "invalid", error: "Invalid parseMode. Allowed values: HTML, MarkdownV2" };
  }

  const items: RelayAlbumInput["items"] = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const rawItem = rawItems[index];
    let rawUrl: unknown = rawItem;
    let rawType: unknown = null;
    let rawCaption: unknown = null;
    let rawItemParseMode: unknown = null;
    let itemMetadata: unknown = null;
    let itemMediaHeaders: unknown = record.mediaHeaders;

    if (rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)) {
      const item = rawItem as Record<string, unknown>;
      rawUrl = item.mediaUrl ?? item.photoUrl ?? item.videoUrl ?? item.url;
      rawType = item.mediaType ?? (item.photoUrl ? "photo" : item.videoUrl ? "video" : null);
      rawCaption = item.caption;
      rawItemParseMode = item.parseMode ?? item.parse_mode;
      itemMetadata = item.metadata;
      itemMediaHeaders = item.mediaHeaders ?? item.headers ?? record.mediaHeaders;
    }

    const mediaUrl = normalizePublicHttpUrl(rawUrl);
    if (!mediaUrl) {
      return { kind: "invalid", error: `Invalid public media URL at mediaItems[${index}].` };
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

    const normalizedItemHeaders = normalizeMediaHeaders(itemMediaHeaders);
    const itemVariants = rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)
      ? normalizeRelayMediaVariants((rawItem as Record<string, unknown>).mediaVariants, normalizedItemHeaders)
      : [];

    items.push({
      mediaUrl,
      mediaType,
      caption: sanitizeDeliveryCaption(itemCaption, itemParseMode, resolveOriginalSourceUrl(record)),
      parseMode: itemParseMode,
      mediaHeaders: normalizedItemHeaders,
      mediaVariants: itemVariants,
      metadata: normalizeMetadata(itemMetadata),
    });
  }

  const channelValidation = normalizeTelegramChannels(record.channel, record.channels);
  if (!channelValidation.ok) return { kind: "invalid", error: channelValidation.error };
  const usernameValidation = normalizeRoutingUsernames(record.username, record.usernames);
  if (!usernameValidation.ok) return { kind: "invalid", error: usernameValidation.error };

  const pageUrl = normalizeOptionalSourceUrl(record.pageUrl);
  const explicitCaption = normalizeCaption(record.caption);
  const hashtagValidation = normalizeHashtags(record.hashtags ?? record.hashtag);
  if (!hashtagValidation.ok) return { kind: "invalid", error: hashtagValidation.error };
  const forceMode = normalizeRelayForceMode(record.force);

  return {
    kind: "valid",
    value: {
      items,
      sourceUrl: resolveOriginalSourceUrl(record),
      pageUrl,
      provider: normalizeNullableText(record.provider, 120),
      title: normalizeOptionalText(record.title, 1000),
      text: normalizeOptionalText(record.text, 20_000),
      caption: resolvePayloadCaption(record),
      captionExplicit: resolveCaptionExplicitFlag(record),
      hashtags: hashtagValidation.value,
      parseMode: resolveCaptionExplicitFlag(record) ? parseMode : null,
      channels: channelValidation.value,
      usernames: usernameValidation.value,
      metadata: normalizeMetadata(record.metadata),
      metadataProvided: record.metadataProvided !== false && hasProvidedField(record, "metadata"),
      presentationMetadata: normalizeMetadata(hasProvidedField(record, "presentationMetadata")
        ? record.presentationMetadata : record.metadata),
      mediaId: normalizeNullableText(record.mediaId, 240),
      mediaKey: normalizeNullableText(record.mediaKey, 300),
      force: forceMode !== null,
      forceMode,
      forceCpu: record.force_cpu === true || record.forceCpu === true,
    },
  };
}

export function normalizeRelayForceMode(value: unknown): RelayForceMode {
  if (value === true) return "resend";
  if (typeof value === "string" && value.trim().toLowerCase() === "forward") return "forward";
  return null;
}

export function normalizeRelayForceValue(value: unknown): boolean | "forward" {
  const mode = normalizeRelayForceMode(value);
  return mode === "forward" ? "forward" : mode === "resend";
}

function normalizeRelayMediaVariants(
  value: unknown,
  fallbackHeaders: Record<string, string>,
): RelayMediaVariant[] {
  if (!Array.isArray(value)) return [];

  const variants: RelayMediaVariant[] = [];
  const seen = new Set<string>();

  for (const raw of value.slice(0, 48)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const mediaUrl = normalizePublicHttpUrl(record.mediaUrl ?? record.url);
    if (!mediaUrl || seen.has(mediaUrl.href)) continue;
    seen.add(mediaUrl.href);

    variants.push({
      mediaUrl,
      quality: normalizeNullableText(record.quality, 120),
      width: normalizePositiveInteger(record.width),
      height: normalizePositiveInteger(record.height),
      contentLength: normalizePositiveInteger(record.contentLength ?? record.size ?? record.filesize),
      bitrate: normalizePositiveInteger(record.bitrate),
      mediaHeaders: normalizeMediaHeaders(record.mediaHeaders ?? record.headers ?? fallbackHeaders),
    });
  }

  return variants;
}

function normalizePositiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : null;
}

function resolveCaptionExplicitFlag(record: Record<string, unknown>): boolean {
  if (record.captionExplicit === false) return false;
  return hasProvidedField(record, "caption");
}

function normalizeAlbumMediaType(value: unknown, mediaUrl: string): AlbumMediaType | null {
  if (value) {
    const normalized = String(value).toLowerCase();
    return normalized === "photo" || normalized === "video" ? normalized : null;
  }

  return /\.(mp4|m4v|mov|webm)(?:$|[?#])/i.test(mediaUrl) ? "video" : "photo";
}
