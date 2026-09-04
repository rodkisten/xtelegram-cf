import type { MediaIdentityInput } from "../../db";
import { RELAY_LIMITS } from "../../config/constants";
import type { MediaType, VideoMetadata } from "../../types";

export interface MultipartPayload {
  channel?: string | number;
  channels?: Array<string | number> | string | number;
  username?: string;
  usernames?: string[] | string;
  caption?: string;
  parseMode?: string;
  mediaType?: string;
  title?: string;
  text?: string;
  pageUrl?: string;
  frameUrl?: string;
  sourceUrl?: string;
  tweetUrl?: string;
  postUrl?: string;
  storyUrl?: string;
  reelUrl?: string;
  tiktokUrl?: string;
  originalUrl?: string;
  permalink?: string;
  shareUrl?: string;
  canonicalUrl?: string;
  mediaUrl?: string;
  photoUrl?: string;
  videoUrl?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
  mediaId?: string;
  mediaKey?: string;
  force?: boolean;
}

export interface UploadedFileRecord {
  field: string;
  file: File;
  mediaType: MediaType;
  videoMetadata?: VideoMetadata | null;
}

export function collectUploadedFiles(
  form: FormData,
  requestedMediaType: MediaType | null,
): UploadedFileRecord[] {
  const uploadedFiles: UploadedFileRecord[] = [];

  form.forEach((value, field) => {
    if (!(value instanceof File) || value.size === 0) return;
    uploadedFiles.push({
      field,
      file: value,
      mediaType:
        field === "audioFile"
          ? "audio"
          : requestedMediaType || inferUploadedFileMediaType(value),
    });
  });

  return uploadedFiles;
}

export function buildMultipartIdentityInput(
  payload: MultipartPayload,
): MediaIdentityInput {
  const originalUrl =
    payload.pageUrl ||
    payload.sourceUrl ||
    payload.tweetUrl ||
    payload.postUrl ||
    payload.storyUrl ||
    payload.reelUrl ||
    payload.tiktokUrl ||
    payload.originalUrl ||
    payload.permalink ||
    payload.shareUrl ||
    payload.canonicalUrl ||
    null;
  const stableUrl =
    originalUrl ||
    payload.mediaUrl ||
    payload.photoUrl ||
    payload.videoUrl ||
    null;

  if (payload.mediaKey || payload.mediaId || stableUrl) {
    return {
      provider: payload.provider || "multipart",
      mediaId: payload.mediaId || null,
      mediaKey: payload.mediaKey || null,
      sourceUrl: originalUrl,
      pageUrl: payload.pageUrl || null,
      mediaUrl: stableUrl,
    };
  }

  // Filename + size is not a safe content identity and caused false duplicate
  // conflicts. Without a stable client/source identity, prefer no dedupe over a
  // false positive. Clients that need multipart dedupe should provide mediaKey,
  // provider+mediaId, sourceUrl or pageUrl.
  return {
    provider: payload.provider || "multipart",
    mediaId: `upload-${crypto.randomUUID()}`,
  };
}

export function inferUploadedFileMediaType(file: File): MediaType {
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

export function inferUploadedContentType(filename: string): string {
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

export function sanitizeUploadedFilename(value: string, index: number): string {
  const normalized = String(value || `media-${index + 1}`)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return normalized || `media-${index + 1}.mp4`;
}

export function resolveMultipartMaxTotalBytes(
  rawValue: string | undefined,
  perFileMaximum: number,
): number {
  const configured = Number(rawValue);
  const fallback = Math.min(
    RELAY_LIMITS.workerMultipartTotalDefaultBytes,
    perFileMaximum * 2,
  );
  if (!Number.isFinite(configured)) return fallback;
  return Math.min(
    RELAY_LIMITS.workerMultipartTotalHardBytes,
    Math.max(perFileMaximum, Math.floor(configured)),
  );
}

export function collectFormFieldNames(form: FormData): string[] {
  const fields = new Set<string>();
  form.forEach((_value, key) => fields.add(key));
  return [...fields];
}
