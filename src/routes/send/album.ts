
import { persistKnownMedia, persistSuccessfulDeliveries, requireRelayDb } from "../../db";
import { json } from "../../http/response";
import { getErrorMessage } from "../../lib/errors";
import {
  debugChannelSummary,
  debugError,
  relayDebug,
} from "../../lib/debug";
import {
  prepareMedia,
  resolveConcurrency,
  resolveHlsMaxMediaBytes,
  resolveMaxMediaBytes,
  shouldPreferWorkerUploadForTelegram,
} from "../../media";
import {
  buildDeliveryConflict,
  createDeliveryPlan,
  markChannelsPersisted,
  releasePendingDeliveryClaims,
  retainSuccessfulClaimsUntilPersistence,
} from "../../services/delivery-plan";
import {
  resolveDefaultTelegramChatId,
  resolveTelegramChatIds,
} from "../../services/channels";
import { resolveSocialDeliveryContent } from "../../services/social-metadata";
import { toBlobArrayBuffer } from "../../services/telegram-delivery";
import {
  sendTelegramMediaGroupUpload,
  sendTelegramMediaGroupUrl,
  sendTelegramUpload,
  sendTelegramUrl,
} from "../../telegram";
import type {
  Env,
  PreparedUpload,
  RelayAlbumInput,
  RelayInput,
  TelegramApiResult,
  TelegramMessage,
} from "../../types";
import { resolveMultipartMaxTotalBytes } from "./multipart-utils";

type AlbumTransport =
  | "url"
  | "multipart-upload"
  | "ordered-single-url"
  | "ordered-single-upload";

interface TelegramAlbumBatchDelivery {
  requestedChatId: string;
  batchIndex: number;
  itemOffset: number;
  itemCount: number;
  result: TelegramApiResult<TelegramMessage[]>;
  transport: AlbumTransport;
  fallbackAttempted: boolean;
  orderedFallbackAttempted: boolean;
  fallbackError: string | null;
  /** A partial ordered fallback already has external side effects. */
  hadExternalSideEffect: boolean;
  attemptCount: number;
}

interface TelegramAlbumBatchAttempt {
  result: TelegramApiResult<TelegramMessage[]>;
  transport: AlbumTransport;
  fallbackAttempted: boolean;
  orderedFallbackAttempted: boolean;
  fallbackError: string | null;
  hadExternalSideEffect: boolean;
  attemptCount: number;
}

interface PreparedAlbumUpload {
  mediaType: RelayAlbumInput["items"][number]["mediaType"];
  file: Blob;
  filename: string;
  contentType: string;
}


interface AlbumVariantProbe {
  item: RelayAlbumInput["items"][number];
  originalIndex: number;
  groupKey: string | null;
  width: number | null;
  height: number | null;
  qualityScore: number;
  contentLength: number | null;
}

/**
 * Returns a stable quality-variant group only when the Worker has enough
 * evidence that multiple URLs are alternate renditions of the same media.
 *
 * This is intentionally conservative. A normal carousel must never be
 * collapsed merely because several items are videos. Explicit resolver
 * metadata wins; after that we recognize the stable asset identifiers used by
 * X/Twitter CDNs and, finally, URL paths that contain an explicit resolution
 * directory such as /1008x720/.
 */
function resolveAlbumVariantGroupKey(
  item: RelayAlbumInput["items"][number],
): string | null {
  const metadata = item.metadata || {};

  for (const key of [
    "variantGroup",
    "variant_group",
    "mediaSlot",
    "media_slot",
    "assetId",
    "asset_id",
    "videoId",
    "video_id",
    "sourceMediaId",
    "source_media_id",
  ]) {
    const value = String(metadata[key] || "").trim();
    if (value) return `metadata:${key}:${value}`;
  }

  if (item.mediaType !== "video") return null;

  const url = item.mediaUrl;
  const path = url.pathname;

  const twitterAsset = path.match(
    /\/(?:amplify_video|ext_tw_video)\/(\d+)(?:\/|$)/i,
  );
  if (twitterAsset?.[1]) {
    return `twitter-video:${twitterAsset[1]}`;
  }

  const tweetVideo = path.match(/\/tweet_video\/([^/]+?)(?:\.[a-z0-9]+)?$/i);
  if (tweetVideo?.[1]) {
    return `twitter-tweet-video:${tweetVideo[1]}`;
  }

  const resolutionSegment = path.match(/^(.*)\/(\d{2,5}x\d{2,5})\/[^/]+$/i);
  if (resolutionSegment?.[1]) {
    return `resolution-path:${url.hostname.toLowerCase()}:${resolutionSegment[1]}`;
  }

  return null;
}

function resolveAlbumVariantDimensions(
  item: RelayAlbumInput["items"][number],
): { width: number | null; height: number | null } {
  const metadata = item.metadata || {};

  const metadataWidth = Number(metadata.width || metadata.videoWidth || 0) || null;
  const metadataHeight = Number(metadata.height || metadata.videoHeight || 0) || null;

  if (metadataWidth && metadataHeight) {
    return { width: metadataWidth, height: metadataHeight };
  }

  const match = item.mediaUrl.href.match(/(?:^|[/_=:-])(\d{2,5})x(\d{2,5})(?:[/_.?&=-]|$)/i);
  if (!match) return { width: null, height: null };

  return {
    width: Number(match[1]) || null,
    height: Number(match[2]) || null,
  };
}

function albumVariantQualityScore(
  item: RelayAlbumInput["items"][number],
): number {
  const dimensions = resolveAlbumVariantDimensions(item);
  if (dimensions.width && dimensions.height) {
    return dimensions.width * dimensions.height;
  }

  const metadata = item.metadata || {};
  const bitrate = Number(
    metadata.bitrate || metadata.bitRate || metadata.videoBitrate || 0,
  );
  if (Number.isFinite(bitrate) && bitrate > 0) return bitrate;

  const quality = String(metadata.quality || metadata.resolution || "");
  const qualityNumber = Number(quality.match(/(\d{3,5})/)?.[1] || 0);
  return qualityNumber > 0 ? qualityNumber : 0;
}

/**
 * Determines the remote payload size without downloading the entire video.
 * HEAD is preferred. Some signed CDNs reject HEAD, so a one-byte Range request
 * is used as a safe fallback and Content-Range is inspected for total length.
 */
async function probeAlbumVariantContentLength(
  item: RelayAlbumInput["items"][number],
): Promise<number | null> {
  const headers = new Headers(item.mediaHeaders || {});

  const parseResponseLength = (response: Response): number | null => {
    const contentRange = response.headers.get("content-range") || "";
    const rangeMatch = contentRange.match(/\/(\d+)\s*$/);
    if (rangeMatch?.[1]) {
      const total = Number(rangeMatch[1]);
      if (Number.isFinite(total) && total > 0) return total;
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    return Number.isFinite(contentLength) && contentLength > 0
      ? contentLength
      : null;
  };

  try {
    const response = await fetch(item.mediaUrl.href, {
      method: "HEAD",
      headers,
      redirect: "follow",
    });
    if (response.ok) {
      const length = parseResponseLength(response);
      if (length) return length;
    }
  } catch {
    // Try the bounded Range request below.
  }

  try {
    const rangeHeaders = new Headers(headers);
    rangeHeaders.set("Range", "bytes=0-0");

    const response = await fetch(item.mediaUrl.href, {
      method: "GET",
      headers: rangeHeaders,
      redirect: "follow",
    });

    try {
      await response.body?.cancel();
    } catch {
      // The size headers are already available; cancelling is best effort.
    }

    if (response.ok || response.status === 206) {
      return parseResponseLength(response);
    }
  } catch {
    // Unknown remote size. Existing media preparation remains the final guard.
  }

  return null;
}

/**
 * Collapses resolver quality variants before any Telegram album planning.
 *
 * For every recognized rendition group we sort highest quality first, probe
 * the remote size, and select the first rendition that fits MAX_MEDIA_BYTES.
 * When the best quality is too large the next quality is tried automatically,
 * continuing until a fitting rendition is found. If size cannot be measured,
 * the highest-quality unknown candidate is preferred. If every measured
 * rendition exceeds the limit, the smallest rendition is retained so the
 * existing preparation/limit path can produce its normal controlled fallback.
 */
async function selectBestAlbumQualityVariants(
  input: RelayAlbumInput,
  env: Env,
  traceId: string,
): Promise<RelayAlbumInput> {
  if (input.items.length < 2) return input;

  const groups = new Map<string, AlbumVariantProbe[]>();
  const groupByIndex = new Map<number, string>();

  input.items.forEach((item, originalIndex) => {
    const groupKey = resolveAlbumVariantGroupKey(item);
    if (!groupKey) return;

    const dimensions = resolveAlbumVariantDimensions(item);
    const probe: AlbumVariantProbe = {
      item,
      originalIndex,
      groupKey,
      width: dimensions.width,
      height: dimensions.height,
      qualityScore: albumVariantQualityScore(item),
      contentLength: null,
    };

    const group = groups.get(groupKey) || [];
    group.push(probe);
    groups.set(groupKey, group);
    groupByIndex.set(originalIndex, groupKey);
  });

  const variantGroups = [...groups.entries()].filter(([, items]) => items.length > 1);
  if (!variantGroups.length) return input;

  const maxBytes = resolveMaxMediaBytes(env);
  const selectedByGroup = new Map<string, AlbumVariantProbe>();
  const diagnostics: Array<Record<string, unknown>> = [];

  for (const [groupKey, candidates] of variantGroups) {
    const ordered = [...candidates].sort((left, right) => {
      if (right.qualityScore !== left.qualityScore) {
        return right.qualityScore - left.qualityScore;
      }
      return left.originalIndex - right.originalIndex;
    });

    let selected: AlbumVariantProbe | null = null;
    let firstUnknown: AlbumVariantProbe | null = null;

    for (const candidate of ordered) {
      candidate.contentLength = await probeAlbumVariantContentLength(candidate.item);

      if (candidate.contentLength === null) {
        if (!firstUnknown) firstUnknown = candidate;
        continue;
      }

      if (candidate.contentLength <= maxBytes) {
        selected = candidate;
        break;
      }
    }

    if (!selected && firstUnknown) {
      selected = firstUnknown;
    }

    if (!selected) {
      selected = [...ordered].sort((left, right) => {
        const leftBytes = left.contentLength ?? Number.POSITIVE_INFINITY;
        const rightBytes = right.contentLength ?? Number.POSITIVE_INFINITY;
        return leftBytes - rightBytes;
      })[0] || ordered[ordered.length - 1]!;
    }

    selectedByGroup.set(groupKey, selected);

    diagnostics.push({
      groupKey,
      maxBytes,
      selectedIndex: selected.originalIndex,
      selectedUrl: selected.item.mediaUrl.href,
      selectedResolution:
        selected.width && selected.height
          ? `${selected.width}x${selected.height}`
          : null,
      selectedBytes: selected.contentLength,
      variants: ordered.map((candidate) => ({
        index: candidate.originalIndex,
        resolution:
          candidate.width && candidate.height
            ? `${candidate.width}x${candidate.height}`
            : null,
        bytes: candidate.contentLength,
        fits: candidate.contentLength === null
          ? null
          : candidate.contentLength <= maxBytes,
      })),
    });
  }

  const emittedGroups = new Set<string>();
  const items: RelayAlbumInput["items"] = [];

  input.items.forEach((item, index) => {
    const groupKey = groupByIndex.get(index);
    const selected = groupKey ? selectedByGroup.get(groupKey) : null;

    if (!groupKey || !selected) {
      items.push(item);
      return;
    }

    if (emittedGroups.has(groupKey)) return;
    emittedGroups.add(groupKey);
    items.push(selected.item);
  });

  if (items.length === input.items.length) return input;

  relayDebug(env, traceId, "album.quality-variants-collapsed", {
    originalItemCount: input.items.length,
    selectedItemCount: items.length,
    removedVariantCount: input.items.length - items.length,
    maxBytes,
    groups: diagnostics,
  });

  return {
    ...input,
    items,
  };
}

function albumItemToRelayInput(
  input: RelayAlbumInput,
  item: RelayAlbumInput["items"][number],
): RelayInput {
  return {
    mediaUrl: item.mediaUrl,
    sourceUrl: input.sourceUrl,
    pageUrl: input.pageUrl,
    provider: input.provider,
    title: input.title,
    text: input.text,
    caption: item.caption || input.caption,
    parseMode: item.parseMode ?? input.parseMode,
    mediaType: item.mediaType,
    mediaHeaders: item.mediaHeaders,
    channels: [],
    metadata: item.metadata ?? input.metadata,
    mediaId: input.mediaId,
    mediaKey: input.mediaKey,
    force: input.force,
  };
}

function albumUploadFilename(
  prepared: PreparedUpload,
  item: RelayAlbumInput["items"][number],
  index: number,
): string {
  const raw = String(prepared.filename || "").trim();
  if (/\.[a-z0-9]{2,8}$/i.test(raw)) return raw;
  const extension = item.mediaType === "photo" ? "jpg" : "mp4";
  return `${raw || `album-${index + 1}`}.${extension}`;
}

function shouldRetryAlbumAsUpload(result: TelegramApiResult<TelegramMessage[]>): boolean {
  if (result.ok) return false;
  // Network failures and 5xx replies are ambiguous: another Telegram call
  // could duplicate a message. These are definitive Bot API rejections.
  return [400, 413, 415].includes(Number(result.httpStatus || 0));
}

function isMixedPhotoVideoBatch(batch: RelayAlbumInput["items"]): boolean {
  let hasPhoto = false;
  let hasVideo = false;
  for (const item of batch) {
    if (item.mediaType === "photo") hasPhoto = true;
    if (item.mediaType === "video") hasVideo = true;
  }
  return hasPhoto && hasVideo;
}

function allowsOrderedMixedFallback(input: RelayAlbumInput): boolean {
  const value = String(input.metadata?.allowOrderedSingleFallback || "").trim().toLowerCase();
  return value !== "false" && value !== "0" && value !== "off";
}

function batchPrefersWorkerUpload(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
): boolean {
  return batch.some((item) =>
    shouldPreferWorkerUploadForTelegram(
      albumItemToRelayInput(input, item),
      item.mediaUrl.href,
    ),
  );
}

function itemCaption(
  input: RelayAlbumInput,
  item: RelayAlbumInput["items"][number],
  index: number,
  batchIndex: number,
): string {
  return item.caption || (index === 0 && batchIndex === 0 ? input.caption : "");
}

function itemParseMode(
  input: RelayAlbumInput,
  item: RelayAlbumInput["items"][number],
  index: number,
  batchIndex: number,
): RelayAlbumInput["parseMode"] {
  if (item.caption) return item.parseMode ?? (batchIndex === 0 ? input.parseMode : null);
  return index === 0 && batchIndex === 0 ? input.parseMode : null;
}

function appendFallbackContext<T>(
  result: TelegramApiResult<T>,
  context: string,
): TelegramApiResult<T> {
  if (result.ok) return result;
  return {
    ...result,
    description: [context, result.description || "Telegram rejected the ordered fallback."].join(" "),
  };
}

async function prepareAlbumUploads(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  env: Env,
): Promise<PreparedAlbumUpload[]> {
  const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
  const uploadBudget = resolveMultipartMaxTotalBytes(
    env.MULTIPART_MAX_TOTAL_BYTES,
    maxMediaBytes,
  );
  const uploads: PreparedAlbumUpload[] = [];
  let totalBytes = 0;

  // Keep memory bounded while retaining exactly the source order.
  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index]!;
    const prepared = await prepareMedia(albumItemToRelayInput(input, item), {
      maxMediaBytes,
      concurrency: resolveConcurrency(env.HLS_CONCURRENCY),
      hlsMaxMediaBytes: resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES),
      forceUpload: true,
    });
    if (prepared.type !== "upload") {
      throw new Error(`Album item ${index + 1} did not produce an uploadable file.`);
    }

    totalBytes += prepared.bytes.byteLength;
    if (totalBytes > uploadBudget) {
      throw new Error(
        `Album upload fallback is ${totalBytes} bytes, above the safe ${uploadBudget} byte Worker forwarding budget.`,
      );
    }

    uploads.push({
      mediaType: item.mediaType,
      file: new Blob([toBlobArrayBuffer(prepared.bytes)], { type: prepared.contentType }),
      filename: albumUploadFilename(prepared, item, index),
      contentType: prepared.contentType,
    });
  }

  return uploads;
}

interface OrderedSinglesAttempt {
  result: TelegramApiResult<TelegramMessage[]>;
  hadExternalSideEffect: boolean;
  attemptCount: number;
  /** A URL retry is only safe before any item has been accepted. */
  safeToTryUrls: boolean;
}

async function sendPreparedAlbumItemsIndividually(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  uploads: PreparedAlbumUpload[],
  env: Env,
  chatId: string,
  batchIndex: number,
): Promise<OrderedSinglesAttempt> {
  const sent: TelegramMessage[] = [];

  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index]!;
    const item = batch[index]!;
    const result = await sendTelegramUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      file: upload.file,
      filename: upload.filename,
      contentType: upload.contentType,
      mediaType: upload.mediaType,
      caption: itemCaption(input, item, index, batchIndex),
      parseMode: itemParseMode(input, item, index, batchIndex),
    });
    if (!result.ok) {
      return {
        result: appendFallbackContext(
          { ...result, result: sent },
          `Ordered mixed-media upload fallback sent ${sent.length}/${batch.length} item(s) before item ${index + 1} failed.`,
        ),
        hadExternalSideEffect: sent.length > 0,
        attemptCount: index + 1,
        safeToTryUrls:
          sent.length === 0 && [400, 413, 415].includes(Number(result.httpStatus || 0)),
      };
    }
    if (result.result) sent.push(result.result);
  }

  return {
    result: {
      ok: true,
      result: sent,
      httpStatus: 200,
      requestMethod: "sendPhoto/sendVideo",
    },
    hadExternalSideEffect: sent.length > 0,
    attemptCount: uploads.length,
    safeToTryUrls: false,
  };
}

async function sendAlbumItemsIndividually(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  env: Env,
  chatId: string,
  batchIndex: number,
): Promise<OrderedSinglesAttempt> {
  const sent: TelegramMessage[] = [];
  const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);

  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index]!;
    let prepared: PreparedUpload;
    try {
      const candidate = await prepareMedia(albumItemToRelayInput(input, item), {
        maxMediaBytes,
        concurrency: resolveConcurrency(env.HLS_CONCURRENCY),
        hlsMaxMediaBytes: resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES),
        forceUpload: true,
      });
      if (candidate.type !== "upload") {
        throw new Error(`Album item ${index + 1} did not produce an uploadable file.`);
      }
      prepared = candidate;
    } catch (error) {
      return {
        result: {
          ok: false,
          result: sent,
          description: `Ordered mixed-media upload fallback sent ${sent.length}/${batch.length} item(s) before Worker preparation of item ${index + 1} failed: ${getErrorMessage(error)}`,
        },
        hadExternalSideEffect: sent.length > 0,
        attemptCount: index,
        safeToTryUrls: sent.length === 0,
      };
    }

    const result = await sendTelegramUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      file: new Blob([toBlobArrayBuffer(prepared.bytes)], { type: prepared.contentType }),
      filename: albumUploadFilename(prepared, item, index),
      contentType: prepared.contentType,
      mediaType: item.mediaType,
      caption: itemCaption(input, item, index, batchIndex),
      parseMode: itemParseMode(input, item, index, batchIndex),
    });
    if (!result.ok) {
      return {
        result: appendFallbackContext(
          { ...result, result: sent },
          `Ordered mixed-media upload fallback sent ${sent.length}/${batch.length} item(s) before item ${index + 1} failed.`,
        ),
        hadExternalSideEffect: sent.length > 0,
        attemptCount: index + 1,
        // An ambiguous network/5xx result might have already reached Telegram.
        safeToTryUrls:
          sent.length === 0 && [400, 413, 415].includes(Number(result.httpStatus || 0)),
      };
    }
    if (result.result) sent.push(result.result);
  }

  return {
    result: {
      ok: true,
      result: sent,
      httpStatus: 200,
      requestMethod: "sendPhoto/sendVideo",
    },
    hadExternalSideEffect: sent.length > 0,
    attemptCount: batch.length,
    safeToTryUrls: false,
  };
}

async function sendAlbumUrlsIndividually(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  env: Env,
  chatId: string,
  batchIndex: number,
): Promise<OrderedSinglesAttempt> {
  const sent: TelegramMessage[] = [];

  for (let index = 0; index < batch.length; index += 1) {
    const item = batch[index]!;
    const result = await sendTelegramUrl({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      mediaUrl: item.mediaUrl.href,
      mediaType: item.mediaType,
      caption: itemCaption(input, item, index, batchIndex),
      parseMode: itemParseMode(input, item, index, batchIndex),
    });
    if (!result.ok) {
      return {
        result: appendFallbackContext(
          { ...result, result: sent },
          `Emergency ordered mixed-media URL fallback sent ${sent.length}/${batch.length} item(s) before item ${index + 1} failed.`,
        ),
        hadExternalSideEffect: sent.length > 0,
        attemptCount: index + 1,
        safeToTryUrls: false,
      };
    }
    if (result.result) sent.push(result.result);
  }

  return {
    result: {
      ok: true,
      result: sent,
      httpStatus: 200,
      requestMethod: "sendPhoto/sendVideo",
    },
    hadExternalSideEffect: sent.length > 0,
    attemptCount: batch.length,
    safeToTryUrls: false,
  };
}

async function sendAlbumBatch(
  input: RelayAlbumInput,
  batch: RelayAlbumInput["items"],
  env: Env,
  chatId: string,
  batchIndex: number,
): Promise<TelegramAlbumBatchAttempt> {
  let preferredUploadAttempted = false;
  let preferredUploadError: string | null = null;

  // X videos are a special case: Telegram's remote fetch has no way to carry
  // the X Referer and may rematerialize an incompatible rendition. Preserve
  // the native album by sending the same ordered bytes as attach:// first.
  if (batchPrefersWorkerUpload(input, batch)) {
    try {
      const uploads = await prepareAlbumUploads(input, batch, env);
      const uploaded = await sendTelegramMediaGroupUpload({
        botToken: env.TELEGRAM_BOT_TOKEN,
        chatId,
        items: uploads,
        caption: batchIndex === 0 ? input.caption : "",
        parseMode: batchIndex === 0 ? input.parseMode : null,
      });
      preferredUploadAttempted = true;

      if (uploaded.ok) {
        return {
          result: uploaded,
          transport: "multipart-upload",
          fallbackAttempted: false,
          orderedFallbackAttempted: false,
          fallbackError: null,
          hadExternalSideEffect: true,
          attemptCount: 1,
        };
      }

      // Do not retry an ambiguous upload result with URL delivery; it could
      // create a duplicate album. Definitive Bot API rejections are safe to
      // continue through the existing URL → upload fallback tree.
      if (!shouldRetryAlbumAsUpload(uploaded)) {
        return {
          result: uploaded,
          transport: "multipart-upload",
          fallbackAttempted: false,
          orderedFallbackAttempted: false,
          fallbackError: uploaded.description || "Telegram rejected the preferred X upload",
          hadExternalSideEffect: false,
          attemptCount: 1,
        };
      }
      preferredUploadError = uploaded.description || "Telegram rejected the preferred X upload";
    } catch (error) {
      // Preparation has no Telegram side effect. Keep URL-first as the safe
      // escape hatch for a file too large for Worker memory/upload limits.
      preferredUploadError = getErrorMessage(error);
    }
  }

  const priorAttemptCount = preferredUploadAttempted ? 1 : 0;
  let direct: TelegramApiResult<TelegramMessage[]>;
  try {
    direct = await sendTelegramMediaGroupUrl({
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
  } catch (error) {
    return {
      result: {
        ok: false,
        description: `Unexpected exception while sending media group: ${getErrorMessage(error)}`,
      },
      transport: "url",
      fallbackAttempted: Boolean(preferredUploadError),
      orderedFallbackAttempted: false,
      fallbackError: preferredUploadError,
      hadExternalSideEffect: false,
      attemptCount: 1 + priorAttemptCount,
    };
  }

  if (!shouldRetryAlbumAsUpload(direct)) {
    return {
      result: direct,
      transport: "url",
      fallbackAttempted: Boolean(preferredUploadError),
      orderedFallbackAttempted: false,
      fallbackError: preferredUploadError,
      hadExternalSideEffect: direct.ok,
      attemptCount: 1 + priorAttemptCount,
    };
  }

  const mixedFallback = isMixedPhotoVideoBatch(batch) && allowsOrderedMixedFallback(input);

  try {
    const uploads = await prepareAlbumUploads(input, batch, env);
    const uploaded = await sendTelegramMediaGroupUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      items: uploads,
      caption: batchIndex === 0 ? input.caption : "",
      parseMode: batchIndex === 0 ? input.parseMode : null,
    });
    if (uploaded.ok) {
      return {
        result: uploaded,
        transport: "multipart-upload",
        fallbackAttempted: true,
        orderedFallbackAttempted: false,
        fallbackError: null,
        hadExternalSideEffect: true,
        attemptCount: 2 + priorAttemptCount,
      };
    }

    // Both group variants were definitively rejected. Telegram accepts these
    // same items individually on problematic mixed photo/video payloads.
    if (mixedFallback && shouldRetryAlbumAsUpload(uploaded)) {
      const ordered = await sendPreparedAlbumItemsIndividually(
        input,
        batch,
        uploads,
        env,
        chatId,
        batchIndex,
      );
      return {
        result: appendFallbackContext(
          ordered.result,
          `Telegram rejected the mixed media group by URL and multipart (${direct.description || "URL rejected"}; ${uploaded.description || "multipart rejected"}).`,
        ),
        transport: "ordered-single-upload",
        fallbackAttempted: true,
        orderedFallbackAttempted: true,
        fallbackError: ordered.result.ok
          ? null
          : ordered.result.description || "Ordered mixed-media upload fallback failed",
        hadExternalSideEffect: ordered.hadExternalSideEffect,
        attemptCount: 2 + priorAttemptCount + ordered.attemptCount,
      };
    }

    return {
      result: {
        ...uploaded,
        description: [
          "Telegram rejected both album transports.",
          `URL: ${direct.description || "unknown error"}`,
          `multipart: ${uploaded.description || "unknown error"}`,
        ].join(" "),
      },
      transport: "multipart-upload",
      fallbackAttempted: true,
      orderedFallbackAttempted: false,
      fallbackError: uploaded.description || "Telegram rejected multipart upload",
      hadExternalSideEffect: false,
      attemptCount: 2 + priorAttemptCount,
    };
  } catch (error) {
    const fallbackError = getErrorMessage(error);
    if (mixedFallback) {
      const ordered = await sendAlbumItemsIndividually(input, batch, env, chatId, batchIndex);
      const urlFallback = !ordered.result.ok && ordered.safeToTryUrls
        ? await sendAlbumUrlsIndividually(input, batch, env, chatId, batchIndex)
        : null;
      const finalAttempt = urlFallback || ordered;
      return {
        result: appendFallbackContext(
          finalAttempt.result,
          `The Worker could not prepare a multipart mixed-media album (${fallbackError}).`,
        ),
        transport: urlFallback ? "ordered-single-url" : "ordered-single-upload",
        fallbackAttempted: true,
        orderedFallbackAttempted: true,
        fallbackError: finalAttempt.result.ok
          ? null
          : finalAttempt.result.description || "Ordered mixed-media fallback failed",
        hadExternalSideEffect: finalAttempt.hadExternalSideEffect,
        attemptCount: 1 + priorAttemptCount + ordered.attemptCount + (urlFallback ? urlFallback.attemptCount : 0),
      };
    }
    return {
      result: {
        ...direct,
        description: [
          direct.description || "Telegram rejected the URL album.",
          `Worker multipart fallback failed: ${fallbackError}`,
        ].join(" "),
      },
      transport: "url",
      fallbackAttempted: true,
      orderedFallbackAttempted: false,
      fallbackError,
      hadExternalSideEffect: false,
      attemptCount: 1 + priorAttemptCount,
    };
  }
}

export async function handleJsonAlbumSend(
  input: RelayAlbumInput,
  env: Env,
  traceId = "album",
): Promise<Response> {
  input = await selectBestAlbumQualityVariants(input, env, traceId);

  relayDebug(env, traceId, "album.started", {
    provider: input.provider || null,
    itemCount: input.items.length,
    mediaTypes: input.items.map((item) => item.mediaType),
    requestedChannelCount: input.channels.length,
    force: input.force,
  });
  const chatIds = resolveTelegramChatIds(
    input.channels,
    resolveDefaultTelegramChatId(env),
  );

  if (!chatIds.length) {
    relayDebug(env, traceId, "album.no-channels", {});
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
  try {
    db = requireRelayDb(env);
  } catch (error) {
    relayDebug(env, traceId, "album.database-unavailable", { error: debugError(error) });
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }

  let plan;
  try {
    plan = await createDeliveryPlan({
      db,
      env,
      channels: chatIds,
      force: input.force,
      identityInput: {
        provider: input.provider,
        mediaId: input.mediaId,
        mediaKey: input.mediaKey,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        mediaUrl: input.items[0]?.mediaUrl.href || null,
      },
    });
  } catch (error) {
    relayDebug(env, traceId, "album.delivery-plan-failed", { error: debugError(error) });
    return json({ ok: false, error: getErrorMessage(error), stage: "delivery-plan" }, 500);
  }

  relayDebug(env, traceId, "album.delivery-plan-ready", {
    identityKey: plan.identity.key,
    channelsToSend: plan.channelsToSend.length,
    alreadySent: plan.skippedAlreadySent.length,
    inProgress: plan.skippedInProgress.length,
  });

  if (!plan.channelsToSend.length) {
    relayDebug(env, traceId, "album.delivery-conflict", {
      channels: debugChannelSummary(buildDeliveryConflict(plan, "Album").channels),
    });
    return json(buildDeliveryConflict(plan, "Album"), 409);
  }

  try {
    relayDebug(env, traceId, "album.social-metadata.started", {});
    const socialContent = await resolveSocialDeliveryContent({
      provider: input.provider,
      sourceUrl: input.sourceUrl,
      pageUrl: input.pageUrl,
      caption: input.caption,
      parseMode: input.parseMode,
      metadata: input.metadata,
    }, env);
    relayDebug(env, traceId, "album.social-metadata.completed", {
      captionLength: socialContent.caption.length,
      socialMetadataStrategy: socialContent.social?.strategy || null,
    });

    await persistKnownMedia(db, {
      identity: plan.identity,
      sourceUrl: input.sourceUrl,
      pageUrl: input.pageUrl,
      mediaType: "album",
      mediaCount: input.items.length,
      metadata: socialContent.metadata,
      caption: socialContent.caption || null,
      parseMode: socialContent.parseMode,
      mediaStatus: "ready",
    });

    // The fallback transports must use the same enriched caption and metadata
    // as the URL-first album path, so social delivery behavior stays intact.
    const deliveryInput: RelayAlbumInput = {
      ...input,
      // Social enrichment owns the single post caption. Clearing client-side
      // per-item captions ensures the first Telegram album entry receives the
      // enriched caption (or its URL-only fallback) instead of stale browser
      // text, while generic albums preserve their individual captions.
      items: socialContent.social
        ? input.items.map((item) => ({ ...item, caption: "", parseMode: null }))
        : input.items,
      caption: socialContent.caption,
      parseMode: socialContent.parseMode,
      metadata: socialContent.metadata,
    };
    const batches = chunkTelegramAlbum(deliveryInput.items);
    const deliveries: TelegramAlbumBatchDelivery[] = [];

    relayDebug(env, traceId, "album.telegram.started", {
      channelCount: plan.channelsToSend.length,
      batchCount: batches.length,
      mixedPhotoVideo: isMixedPhotoVideoBatch(deliveryInput.items),
    });

    for (const chatId of plan.channelsToSend) {
      let itemOffset = 0;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex]!;
        const attempt = await sendAlbumBatch(
          deliveryInput,
          batch,
          env,
          chatId,
          batchIndex,
        );

        relayDebug(env, traceId, "album.telegram-batch.completed", {
          batchIndex,
          itemCount: batch.length,
          transport: attempt.transport,
          ok: attempt.result.ok,
          httpStatus: attempt.result.httpStatus || null,
          fallbackAttempted: attempt.fallbackAttempted,
          orderedFallbackAttempted: attempt.orderedFallbackAttempted,
          error: attempt.result.ok ? null : attempt.result.description || null,
        });

        deliveries.push({
          requestedChatId: chatId,
          batchIndex,
          itemOffset,
          itemCount: batch.length,
          result: attempt.result,
          transport: attempt.transport,
          fallbackAttempted: attempt.fallbackAttempted,
          orderedFallbackAttempted: attempt.orderedFallbackAttempted,
          fallbackError: attempt.fallbackError,
          hadExternalSideEffect: attempt.hadExternalSideEffect,
          attemptCount: attempt.attemptCount,
        });
        itemOffset += batch.length;

        // Once a chunk failed, continuing would create more orphaned album
        // chunks that cannot be represented as one successful channel delivery.
        if (!attempt.result.ok) break;
      }
    }

    const formatted = deliveries.map((delivery) => ({
      requestedChatId: delivery.requestedChatId,
      batchIndex: delivery.batchIndex,
      itemOffset: delivery.itemOffset,
      itemCount: delivery.itemCount,
      transport: delivery.transport,
      fallbackAttempted: delivery.fallbackAttempted,
      orderedFallbackAttempted: delivery.orderedFallbackAttempted,
      fallbackError: delivery.fallbackError,
      hadExternalSideEffect: delivery.hadExternalSideEffect,
      attemptCount: delivery.attemptCount,
      ok: delivery.result.ok,
      httpStatus: delivery.result.httpStatus ?? null,
      error: delivery.result.ok
        ? null
        : delivery.result.description || "Telegram rejected sendMediaGroup",
      messageIds: Array.isArray(delivery.result.result)
        ? delivery.result.result.map((message) => message?.message_id ?? null)
        : [],
    }));

    const completedChannels = plan.channelsToSend.filter((chatId) => {
      const channelDeliveries = deliveries.filter((delivery) => delivery.requestedChatId === chatId);
      return (
        channelDeliveries.length === batches.length &&
        channelDeliveries.every((delivery) => delivery.result.ok)
      );
    });
    const channelsWithExternalSideEffects = new Set(
      deliveries
        .filter((delivery) => delivery.hadExternalSideEffect)
        .map((delivery) => delivery.requestedChatId),
    );
    retainSuccessfulClaimsUntilPersistence(plan, channelsWithExternalSideEffects);

    relayDebug(env, traceId, "album.telegram.completed", {
      attemptedBatches: deliveries.length,
      completedChannelCount: completedChannels.length,
      externalSideEffectChannelCount: channelsWithExternalSideEffects.size,
    });

    const failedChannels = plan.channelsToSend
      .filter((chatId) => !completedChannels.includes(chatId))
      .map((channelId) => {
        const channelDeliveries = deliveries.filter(
          (delivery) => delivery.requestedChatId === channelId,
        );
        const errors = channelDeliveries.filter((delivery) => !delivery.result.ok);
        return {
          channelId,
          reason: "telegram_error" as const,
          partialDelivery: channelDeliveries.some(
            (delivery) => delivery.result.ok || delivery.hadExternalSideEffect,
          ),
          errors: errors.map((delivery) => ({
            batchIndex: delivery.batchIndex,
            transport: delivery.transport,
            orderedFallbackAttempted: delivery.orderedFallbackAttempted,
            error: delivery.result.description || "Telegram rejected sendMediaGroup",
            httpStatus: delivery.result.httpStatus ?? null,
          })),
        };
      });

    let insertedChannelIds: string[] = [];
    try {
      relayDebug(env, traceId, "album.persist.started", {
        completedChannelCount: completedChannels.length,
      });
      insertedChannelIds = await persistSuccessfulDeliveries(db, {
        identity: plan.identity,
        sourceUrl: input.sourceUrl,
        pageUrl: input.pageUrl,
        mediaType: "album",
        mediaCount: input.items.length,
        metadata: socialContent.metadata,
        caption: socialContent.caption,
        parseMode: socialContent.parseMode,
        mediaStatus: "sent",
        deliveries: completedChannels.map((chatId) => {
          const channelDeliveries = deliveries.filter(
            (delivery) => delivery.requestedChatId === chatId,
          );
          const messages = channelDeliveries.flatMap((delivery) =>
            Array.isArray(delivery.result.result) ? delivery.result.result : [],
          );
          return {
            requestedChatId: chatId,
            telegramChatId: messages[0]?.chat?.id ?? null,
            telegramChatTitle: messages[0]?.chat?.title ?? null,
            messageIds: messages.map((message) => message.message_id ?? null),
          };
        }),
      });
      markChannelsPersisted(plan, insertedChannelIds);
    } catch (error) {
      relayDebug(env, traceId, "album.persist.failed", {
        identityKey: plan.identity.key,
        completedChannelCount: completedChannels.length,
        error: debugError(error),
      });
      return json(
        {
          ok: false,
          error: getErrorMessage(error),
          stage: "persist-delivery",
          warning:
            "Telegram accepted album chunks but D1 history could not be fully committed. Claims for channels with external side effects are retained until TTL.",
          media: plan.identity,
          channels: {
            requested: chatIds,
            attempted: plan.channelsToSend,
            inserted: [],
            telegramCompleted: completedChannels,
          },
        },
        500,
      );
    }

    relayDebug(env, traceId, "album.persist.completed", {
      insertedChannelCount: insertedChannelIds.length,
    });

    const notSent = [
      ...plan.skippedAlreadySent,
      ...plan.skippedInProgress,
      ...failedChannels,
    ];
    const usedOrderedSingleFallback = deliveries.some(
      (delivery) => delivery.transport === "ordered-single-url" || delivery.transport === "ordered-single-upload",
    );
    const payload = {
      ok: completedChannels.length > 0,
      partial: notSent.length > 0,
      media: plan.identity,
      message:
        completedChannels.length > 0
          ? `Album delivered completely to ${completedChannels.length} Telegram channel(s)${usedOrderedSingleFallback ? " using the ordered mixed-media fallback" : ""}`
          : "Album was not completely delivered to any Telegram channel",
      mode: usedOrderedSingleFallback
        ? "telegram-media-group-ordered-single-fallback"
        : "telegram-media-group",
      source: { sourceUrl: input.sourceUrl, pageUrl: input.pageUrl },
      channels: {
        requested: chatIds,
        attempted: plan.channelsToSend,
        inserted: insertedChannelIds,
        notSent,
      },
      mediaSet: {
        count: input.items.length,
        batches: batches.length,
        items: input.items.map((item, index) => ({
          index,
          mediaType: item.mediaType,
          mediaUrl: item.mediaUrl.href,
        })),
      },
      telegram: {
        method: usedOrderedSingleFallback
          ? "sendMediaGroup -> sendPhoto/sendVideo"
          : "sendMediaGroup",
        deliveries: formatted,
      },
      metadata: socialContent.metadata,
      socialMetadata: socialContent.social,
      metrics: {
        identityAliasQueries: plan.identityAliasQueries,
        claimQueries: plan.claim.queryCount,
        claimedChannels: plan.channelsToSend.length,
        telegramAttempts: deliveries.reduce(
          (total, delivery) => total + delivery.attemptCount,
          0,
        ),
        dbRoundTrips:
          plan.identityAliasQueries +
          1 +
          (completedChannels.length ? 1 : 0) +
          1,
        dbStatements:
          plan.identityAliasQueries +
          plan.claim.queryCount +
          (completedChannels.length ? 1 + completedChannels.length : 0) +
          1,
      },
    };

    const status = !completedChannels.length ? 502 : notSent.length ? 207 : 200;
    relayDebug(env, traceId, "album.completed", {
      status,
      usedOrderedSingleFallback,
      channels: debugChannelSummary(payload.channels),
    });
    return json(payload, status);
  } finally {
    await releasePendingDeliveryClaims(plan).catch((error) => {
      relayDebug(env, traceId, "album.claim-release.failed", {
        identityKey: plan.identity.key,
        error: debugError(error),
      });
    });
    relayDebug(env, traceId, "album.claim-release.completed", { identityKey: plan.identity.key });
  }
}

function chunkTelegramAlbum(
  items: RelayAlbumInput["items"],
): RelayAlbumInput["items"][] {
  const batches: RelayAlbumInput["items"][] = [];
  let cursor = 0;

  while (cursor < items.length) {
    const remaining = items.length - cursor;
    const batchSize = remaining > 10 && remaining % 10 === 1 ? 9 : Math.min(10, remaining);
    batches.push(items.slice(cursor, cursor + batchSize));
    cursor += batchSize;
  }

  return batches;
}
