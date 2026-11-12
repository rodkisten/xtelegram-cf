import { checkStoredMediaDeliveries, requireRelayDb, resolveMediaIdentity } from "../db";
import { normalizeMediaIdentityInput } from "../validation/media-identity";
import { resolveTelegramChatIdsForEnv } from "../services/channels";
import { cloneAuthorizedJsonRequest } from "../http/internal-request";
import { json } from "../http/response";
import { getErrorMessage } from "../lib/errors";
import { resolveCpuHeavyEnabled } from "../lib/cpu-policy";
import {
  debugChannelSummary,
  debugError,
  debugUrl,
  relayDebug,
  relayTraceId,
} from "../lib/debug";
import { normalizePublicHttpUrl } from "../lib/http";
import { aggregateTelegramMessageLinkFields } from "../lib/telegram-message-links";
import {
  buildSocialThumbnailResponse,
  buildThumbnailResponseFromUrl,
  resolveThumbnailMaxWidth,
  type ThumbnailResponseFields,
} from "../lib/thumbnail-response";
import { normalizeHashtags } from "../lib/hashtags";
import {
  resolveSocialMedia,
  SocialResolverError,
  toRelayMediaType,
  type SocialResolution,
} from "../social";
import type { Env } from "../types";
import {
  normalizeMetadata,
  hasProvidedField,
  normalizeRoutingUsernames,
  normalizeParseMode,
  normalizeTelegramChannels,
} from "../validation/common";
import { sendWithRecovery } from "../services/resolved-video-retry";
import { normalizeRelayForceValue } from "../validation/send";

interface ResolveRequestBody {
  url?: unknown;
  sourceUrl?: unknown;
  channel?: unknown;
  channels?: unknown;
  username?: unknown;
  usernames?: unknown;
  caption?: unknown;
  hashtags?: unknown;
  hashtag?: unknown;
  parseMode?: unknown;
  metadata?: unknown;
  mediaId?: unknown;
  mediaKey?: unknown;
  force?: unknown;
  force_cpu?: unknown;
  forceCpu?: unknown;
  include_thumbnail?: unknown;
  includeThumbnail?: unknown;
  thumbnail_max_bytes?: unknown;
  thumbnailMaxBytes?: unknown;
  thumbnail_max_width?: unknown;
  thumbnailMaxWidth?: unknown;
}

export async function handleResolve(
  request: Request,
  env: Env,
  send: boolean,
): Promise<Response> {
  const traceId = relayTraceId(request);
  let body: ResolveRequestBody;
  try {
    body = (await request.json()) as ResolveRequestBody;
  } catch {
    relayDebug(env, traceId, "resolve.invalid-json", { send });
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const sourceUrl =
    typeof body.url === "string"
      ? body.url.trim()
      : typeof body.sourceUrl === "string"
        ? body.sourceUrl.trim()
        : "";
  const forceCpu = resolveCpuHeavyEnabled(env, request, body.force_cpu ?? body.forceCpu);
  const forceValue = normalizeRelayForceValue(body.force);
  const normalized = normalizePublicHttpUrl(sourceUrl);
  if (!normalized) {
    relayDebug(env, traceId, "resolve.invalid-source-url", {
      send,
      sourceUrl: debugUrl(sourceUrl),
    });
    return json({ ok: false, error: "url/sourceUrl must be a public HTTP(S) URL" }, 400);
  }

  const includeThumbnail = resolveIncludeThumbnail(
    body.include_thumbnail ?? body.includeThumbnail,
    true,
  );
  const thumbnailMaxBytes = resolveRequestedThumbnailMaxBytes(
    body.thumbnail_max_bytes ?? body.thumbnailMaxBytes,
  );
  const thumbnailMaxWidth = resolveRequestedThumbnailMaxWidth(
    env,
    body.thumbnail_max_width ?? body.thumbnailMaxWidth,
  );

  // An existing delivery needs only a caption edit, even if the source CDN or
  // resolver is offline. Route through /send's normal dedupe before resolving.
  if (send && forceValue === false) {
    const channels = normalizeTelegramChannels(body.channel, body.channels);
    const usernames = normalizeRoutingUsernames(body.username, body.usernames);
    if (!channels.ok) return json({ ok: false, error: channels.error }, 400);
    if (!usernames.ok) return json({ ok: false, error: usernames.error }, 400);
    const destinations = resolveTelegramChatIdsForEnv(env, channels.value, usernames.value);
    const identityInput = normalizeMediaIdentityInput({ ...body, sourceUrl: normalized.href });
    if (destinations.length && identityInput) {
      try {
        const identity = await resolveMediaIdentity(identityInput);
        const records = await checkStoredMediaDeliveries(requireRelayDb(env), [identity], destinations);
        const record = records.get(identity.key);
        if (record && destinations.every((channel) => record.deliveries.some((d) => d.channelId === channel))) {
          const response = await sendWithRecovery(cloneAuthorizedJsonRequest(request, {
            ...body, mediaUrl: normalized.href, sourceUrl: normalized.href,
            mediaKey: record.media.key, provider: record.media.provider, channels: destinations,
          }), env);

          const storedMetadata = record.media.metadata && typeof record.media.metadata === "object"
            ? record.media.metadata as Record<string, unknown>
            : null;
          const storedThumbnailUrl = typeof storedMetadata?.socialThumbnailUrl === "string"
            ? storedMetadata.socialThumbnailUrl
            : "";
          if (!includeThumbnail || !storedThumbnailUrl) return response;

          const thumbnail = await buildThumbnailResponseFromUrl(storedThumbnailUrl, env, {
            includeBase64: true,
            maxBytes: thumbnailMaxBytes,
            maxWidth: thumbnailMaxWidth,
            source: "stored_metadata",
          });
          return mergeJsonResponse(response, thumbnail);
        }
      } catch (error) {
        return json({ ok: false, error: getErrorMessage(error), stage: "presentation-preflight" }, 500);
      }
    }
  }

  // Preserve a handle captured from X's DOM/network payload. It is used only
  // as a last resort if the internal /i/status/:id route cannot be upgraded
  // through public syndication before a third-party media resolver is called.
  const requestMetadata = normalizeMetadata(body.metadata);
  const twitterHandleHint = firstTwitterHandleHint(requestMetadata);
  relayDebug(env, traceId, "resolve.input-normalized", {
    send,
    sourceUrl: debugUrl(normalized.href),
    hasCaption: typeof body.caption === "string" && body.caption.trim().length > 0,
    requestedChannelCount: Array.isArray(body.channels) ? body.channels.length : body.channel ? 1 : 0,
    metadataKeys: Object.keys(requestMetadata || {}).slice(0, 24),
    hasTwitterHandleHint: Boolean(twitterHandleHint),
    force: forceValue,
    forceCpu,
  });

  let resolution: SocialResolution;
  try {
    resolution = await resolveSocialMedia(normalized.href, env, {
      twitterHandleHint,
      traceId,
    });
  } catch (error) {
    relayDebug(env, traceId, "resolve.social-failed", {
      send,
      sourceUrl: debugUrl(normalized.href),
      error: debugError(error),
      attempts: error instanceof SocialResolverError
        ? error.attempts.map((attempt) => ({
            provider: attempt.provider,
            ok: attempt.ok,
            durationMs: attempt.durationMs,
            error: attempt.error || null,
          }))
        : [],
    });
    return json(
      {
        ok: false,
        error: getErrorMessage(error),
        stage: "social-resolver",
        attempts: error instanceof SocialResolverError ? error.attempts : undefined,
      },
      422,
    );
  }

  relayDebug(env, traceId, "resolve.social-succeeded", {
    send,
    provider: resolution.source,
    resolver: resolution.resolver,
    sourceUrl: debugUrl(resolution.sourceUrl),
    mediaCount: resolution.media.length,
    mediaTypes: resolution.media.map((item) => item.type),
  });

  const thumbnail = await buildSocialThumbnailResponse(resolution, env, {
    includeBase64: includeThumbnail,
    maxBytes: thumbnailMaxBytes,
    maxWidth: thumbnailMaxWidth,
  });
  relayDebug(env, traceId, "resolve.thumbnail", {
    requested: includeThumbnail,
    available: Boolean(thumbnail.thumbnail_url),
    included: thumbnail.thumbnail_included,
    bytes: thumbnail.thumbnail_bytes,
    source: thumbnail.thumbnail_source,
    error: thumbnail.thumbnail_error,
  });

  if (!send) return json({ ok: true, ...thumbnail, ...resolution });

  const channelValidation = normalizeTelegramChannels(body.channel, body.channels);
  if (!channelValidation.ok) {
    relayDebug(env, traceId, "resolve.invalid-channels", { error: channelValidation.error });
    return json({ ok: false, error: channelValidation.error }, 400);
  }

  const usernameValidation = normalizeRoutingUsernames(body.username, body.usernames);
  if (!usernameValidation.ok) {
    relayDebug(env, traceId, "resolve.invalid-usernames", { error: usernameValidation.error });
    return json({ ok: false, error: usernameValidation.error }, 400);
  }

  const hashtagValidation = normalizeHashtags(body.hashtags ?? body.hashtag);
  if (!hashtagValidation.ok) {
    relayDebug(env, traceId, "resolve.invalid-hashtags", { error: hashtagValidation.error });
    return json({ ok: false, error: hashtagValidation.error }, 400);
  }

  const parseMode = normalizeParseMode(body.parseMode);
  if (body.parseMode && !parseMode) {
    relayDebug(env, traceId, "resolve.invalid-parse-mode", { parseMode: String(body.parseMode) });
    return json({ ok: false, error: "Invalid parseMode. Allowed values: HTML, MarkdownV2" }, 400);
  }

  const explicitCaption = typeof body.caption === "string" ? body.caption.trim() : "";
  const resolvedCaption = typeof resolution.caption === "string" ? resolution.caption.trim() : "";
  const captionExplicit = hasProvidedField(body, "caption");
  const caption = captionExplicit ? explicitCaption : resolvedCaption || resolution.sourceUrl;
  const explicitMediaId = typeof body.mediaId === "string" ? body.mediaId.trim() : "";
  const explicitMediaKey = typeof body.mediaKey === "string" ? body.mediaKey.trim() : "";
  const metadata = {
    ...(requestMetadata ?? {}),
    resolver: requestMetadata?.resolver || resolution.resolver,
    ...(resolution.authorName ? { socialAuthorName: resolution.authorName } : {}),
    ...(resolution.authorUsername ? { socialAuthorUsername: resolution.authorUsername } : {}),
    ...(resolution.caption ? { socialResolvedCaption: resolution.caption } : {}),
    ...(resolution.title ? { socialResolvedTitle: resolution.title } : {}),
    ...(thumbnail.thumbnail_url ? { socialThumbnailUrl: thumbnail.thumbnail_url } : {}),
  };
  const common = {
    sourceUrl: resolution.sourceUrl,
    pageUrl: resolution.sourceUrl,
    provider: resolution.source,
    caption,
    captionExplicit,
    hashtags: hashtagValidation.value,
    parseMode: captionExplicit ? parseMode : null,
    channels: channelValidation.value,
    usernames: usernameValidation.value,
    mediaId: explicitMediaId || undefined,
    mediaKey: explicitMediaKey || undefined,
    force: forceValue,
    force_cpu: forceCpu,
    metadata,
    metadataProvided: hasProvidedField(body, "metadata"),
    presentationMetadata: requestMetadata,
  };

  const albumCompatible =
    resolution.media.length >= 2 &&
    resolution.media.every((item) => item.type === "photo" || item.type === "video");

  if (albumCompatible) {
    relayDebug(env, traceId, "resolve.dispatch-album", {
      mediaCount: resolution.media.length,
      channelCount: channelValidation.value.length,
    });
    const response = await sendWithRecovery(
      cloneAuthorizedJsonRequest(request, {
        ...common,
        mediaItems: resolution.media.map((item) => ({
          mediaUrl: item.url,
          mediaType: toRelayMediaType(item.type),
          mediaHeaders: item.mediaHeaders,
          mediaVariants: item.variants.map((variant) => ({
            mediaUrl: variant.url,
            quality: variant.quality,
            width: variant.width,
            height: variant.height,
            contentLength: variant.contentLength,
            bitrate: variant.bitrate,
            mediaHeaders: variant.mediaHeaders,
          })),
          metadata: {
            ...metadata,
            ...(item.width ? { resolvedWidth: String(item.width) } : {}),
            ...(item.height ? { resolvedHeight: String(item.height) } : {}),
            ...(item.quality ? { resolvedQuality: item.quality } : {}),
            ...(item.contentLength ? { resolvedContentLength: String(item.contentLength) } : {}),
            ...(item.bitrate ? { resolvedBitrate: String(item.bitrate) } : {}),
          },
        })),
      }),
      env,
    );
    relayDebug(env, traceId, "resolve.album-result", { status: response.status });
    return mergeResolveResponse(response, resolution, thumbnail);
  }

  const parentIdentity =
    resolution.media.length > 1 && !explicitMediaId && !explicitMediaKey
      ? await resolveMediaIdentity({
          provider: resolution.source,
          sourceUrl: resolution.sourceUrl,
        })
      : null;

  const deliveries: Array<{
    media: SocialResolution["media"][number];
    status: number;
    result: unknown;
  }> = [];

  for (const item of resolution.media) {
    const perItemIdentity = resolvePerItemIdentity({
      itemIndex: item.index,
      explicitMediaId,
      explicitMediaKey,
      parentMediaKey: parentIdentity?.key || "",
      mediaCount: resolution.media.length,
    });
    relayDebug(env, traceId, "resolve.dispatch-item", {
      itemIndex: item.index,
      mediaType: item.type,
      mediaUrl: debugUrl(item.url),
      channelCount: channelValidation.value.length,
    });
    const response = await sendWithRecovery(
      cloneAuthorizedJsonRequest(request, {
        ...common,
        ...perItemIdentity,
        mediaUrl: item.url,
        mediaType: toRelayMediaType(item.type),
        mediaHeaders: item.mediaHeaders,
        mediaVariants: item.variants.map((variant) => ({
          mediaUrl: variant.url,
          quality: variant.quality,
          width: variant.width,
          height: variant.height,
          contentLength: variant.contentLength,
          bitrate: variant.bitrate,
          mediaHeaders: variant.mediaHeaders,
        })),
        metadata: {
          ...metadata,
          ...(item.width ? { resolvedWidth: String(item.width) } : {}),
          ...(item.height ? { resolvedHeight: String(item.height) } : {}),
          ...(item.quality ? { resolvedQuality: item.quality } : {}),
          ...(item.contentLength ? { resolvedContentLength: String(item.contentLength) } : {}),
          ...(item.bitrate ? { resolvedBitrate: String(item.bitrate) } : {}),
        },
      }),
      env,
    );
    const result = await response.json();
    deliveries.push({ media: item, status: response.status, result });
    relayDebug(env, traceId, "resolve.item-result", {
      itemIndex: item.index,
      mediaType: item.type,
      status: response.status,
      channels: debugChannelSummary((result as Record<string, unknown>)?.channels),
    });
  }

  // /send owns the D1-aware channel contract. When a social URL expands into
  // multiple non-album deliveries, preserve that same contract at the outer
  // /resolve-and-send response instead of returning only deliveries[]. The
  // userscript and /batch both consume channels at the top level to decide
  // whether the post actually reached a requested Telegram chat.
  const channels = aggregateResolvedDeliveryChannels(
    deliveries,
    channelValidation.value,
  );
  const messageLinks = aggregateTelegramMessageLinkFields(
    deliveries.map((delivery) => delivery.result),
  );
  const succeeded = deliveries.filter((delivery) => delivery.status >= 200 && delivery.status < 300).length;
  const allConflicts = deliveries.length > 0 && deliveries.every((delivery) => delivery.status === 409);
  const allRequestedCovered =
    channels.requested.length > 0 &&
    channels.requested.every((channelId) => channels.covered.includes(channelId));
  const hasChannelFailure = channels.notSent.some(
    (entry) => entry.reason !== "already_sent" && entry.reason !== "duplicate_in_batch",
  );
  const partial =
    (succeeded > 0 && succeeded < deliveries.length) ||
    (succeeded > 0 && (!allRequestedCovered || hasChannelFailure));
  const status =
    succeeded > 0 && !partial
      ? 200
      : succeeded > 0
        ? 207
        : allConflicts
          ? 409
          : 502;

  relayDebug(env, traceId, "resolve.completed", {
    status,
    deliveryCount: deliveries.length,
    succeeded,
    partial,
    channels: debugChannelSummary(channels),
  });

  return json(
    {
      ok: succeeded > 0,
      ...messageLinks,
      partial,
      message:
        succeeded === deliveries.length
          ? `Resolved and sent ${deliveries.length} media item(s)`
          : `Resolved ${deliveries.length} media item(s); ${succeeded} delivery item(s) succeeded`,
      ...thumbnail,
      resolution,
      deliveries,
      channels,
    },
    status,
  );
}

function firstTwitterHandleHint(metadata: Record<string, string> | null): string {
  if (!metadata) return "";
  for (const key of ["twitterAuthor", "author", "screenName", "username"]) {
    const value = String(metadata[key] || "").trim().replace(/^@+/, "");
    if (/^[A-Za-z0-9_]{1,15}$/.test(value)) return value;
  }
  return "";
}

type ResolveChannelFailure = {
  channelId: string;
  reason: string;
  error?: string;
  httpStatus?: number | null;
};

type ResolveChannelDetail = {
  requested: string[];
  attempted: string[];
  inserted: string[];
  covered: string[];
  notSent: ResolveChannelFailure[];
};

function aggregateResolvedDeliveryChannels(
  deliveries: Array<{ status: number; result: unknown }>,
  fallbackRequested: string[],
): {
  requested: string[];
  attempted: string[];
  inserted: string[];
  covered: string[];
  notSent: ResolveChannelFailure[];
} {
  const parts = deliveries.map((delivery) => ({
    status: delivery.status,
    ...readResolveChannelDetail(delivery.result),
  }));
  const requested = uniqueStrings([
    ...fallbackRequested,
    ...parts.flatMap((part) => part.requested),
  ]);
  const attempted = uniqueStrings(parts.flatMap((part) => part.attempted));
  const inserted: string[] = [];
  const covered: string[] = [];
  const notSent: ResolveChannelFailure[] = [];

  for (const channelId of requested) {
    const relevant = parts.filter((part) =>
      part.requested.includes(channelId) ||
      (!part.requested.length && fallbackRequested.includes(channelId)),
    );
    const allCovered = relevant.length > 0 && relevant.every(
      (part) => part.covered.includes(channelId),
    );

    if (allCovered) {
      covered.push(channelId);
      if (relevant.some((part) => part.inserted.includes(channelId))) {
        inserted.push(channelId);
      } else {
        notSent.push({ channelId, reason: "already_sent" });
      }
      continue;
    }

    const failures = relevant.flatMap((part) =>
      part.notSent.filter((entry) => entry.channelId === channelId && entry.reason !== "already_sent"),
    );
    if (failures.length) {
      notSent.push(...failures);
    } else {
      notSent.push({
        channelId,
        reason: "delivery_unconfirmed",
        error: "The resolver did not return a D1-confirmed delivery result for this channel.",
      });
    }
  }

  return {
    requested,
    attempted,
    inserted: uniqueStrings(inserted),
    covered: uniqueStrings(covered),
    notSent: uniqueChannelFailures(notSent),
  };
}

function readResolveChannelDetail(value: unknown): ResolveChannelDetail {
  const result = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const source = result.channels && typeof result.channels === "object" && !Array.isArray(result.channels)
    ? result.channels as Record<string, unknown>
    : {};
  const notSent = Array.isArray(source.notSent)
    ? source.notSent.map(readResolveChannelFailure).filter(
      (entry): entry is ResolveChannelFailure => entry !== null,
    )
    : [];
  const inserted = stringArray(source.inserted);
  const alreadySent = notSent
    .filter((entry) => entry.reason === "already_sent")
    .map((entry) => entry.channelId);
  return {
    requested: stringArray(source.requested),
    attempted: stringArray(source.attempted),
    inserted,
    covered: uniqueStrings([...stringArray(source.covered), ...inserted, ...alreadySent]),
    notSent,
  };
}

function readResolveChannelFailure(value: unknown): ResolveChannelFailure | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const channelId = String(source.channelId ?? source.channel ?? source.chatId ?? "").trim();
  if (!channelId) return null;
  const error = String(source.error ?? source.description ?? "").trim();
  const httpStatus = Number(source.httpStatus ?? source.status ?? 0);
  return {
    channelId,
    reason: String(source.reason || "telegram_error").trim() || "telegram_error",
    ...(error ? { error } : {}),
    ...(Number.isFinite(httpStatus) && httpStatus > 0 ? { httpStatus } : {}),
  };
}

function stringArray(value: unknown): string[] {
  return uniqueStrings(Array.isArray(value) ? value : []);
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function uniqueChannelFailures(values: ResolveChannelFailure[]): ResolveChannelFailure[] {
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = `${entry.channelId}\u001f${entry.reason}\u001f${entry.error || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolvePerItemIdentity(options: {
  itemIndex: number;
  explicitMediaId: string;
  explicitMediaKey: string;
  parentMediaKey: string;
  mediaCount: number;
}): { mediaId?: string; mediaKey?: string } {
  if (options.mediaCount <= 1) {
    return {
      mediaId: options.explicitMediaId || undefined,
      mediaKey: options.explicitMediaKey || undefined,
    };
  }

  if (options.explicitMediaKey) {
    return { mediaKey: `${options.explicitMediaKey}:${options.itemIndex}` };
  }
  if (options.explicitMediaId) {
    return { mediaId: `${options.explicitMediaId}:${options.itemIndex}` };
  }

  // A post can resolve to heterogeneous media that Telegram cannot send as one
  // album (for example video + audio). Give each child a stable key so they do
  // not collide on the parent post identity in D1.
  return options.parentMediaKey
    ? { mediaKey: `${options.parentMediaKey}:${options.itemIndex}` }
    : {};
}

async function mergeResolveResponse(
  response: Response,
  resolution: SocialResolution,
  thumbnail: ThumbnailResponseFields,
): Promise<Response> {
  const payload = (await response.json()) as Record<string, unknown>;
  return json({ ...payload, ...thumbnail, resolution }, response.status);
}

async function mergeJsonResponse(
  response: Response,
  fields: object,
): Promise<Response> {
  const payload = (await response.json()) as Record<string, unknown>;
  return json({ ...payload, ...fields }, response.status);
}

function resolveIncludeThumbnail(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function resolveRequestedThumbnailMaxBytes(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function resolveRequestedThumbnailMaxWidth(env: Env, value: unknown): number {
  const number = Number(value);
  return resolveThumbnailMaxWidth(env, Number.isFinite(number) && number > 0 ? Math.floor(number) : null);
}
