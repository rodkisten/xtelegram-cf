import { resolveMediaIdentity } from "../db";
import { cloneAuthorizedJsonRequest } from "../http/internal-request";
import { json } from "../http/response";
import { getErrorMessage } from "../lib/errors";
import { normalizePublicHttpUrl } from "../lib/http";
import {
  resolveSocialMedia,
  SocialResolverError,
  toRelayMediaType,
  type SocialResolution,
} from "../social";
import type { Env } from "../types";
import {
  normalizeMetadata,
  normalizeParseMode,
  normalizeTelegramChannels,
} from "../validation/common";
import { handleSend } from "./send";

interface ResolveRequestBody {
  url?: unknown;
  sourceUrl?: unknown;
  channel?: unknown;
  channels?: unknown;
  caption?: unknown;
  parseMode?: unknown;
  metadata?: unknown;
  mediaId?: unknown;
  mediaKey?: unknown;
  force?: unknown;
}

export async function handleResolve(
  request: Request,
  env: Env,
  send: boolean,
): Promise<Response> {
  let body: ResolveRequestBody;
  try {
    body = (await request.json()) as ResolveRequestBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const sourceUrl =
    typeof body.url === "string"
      ? body.url.trim()
      : typeof body.sourceUrl === "string"
        ? body.sourceUrl.trim()
        : "";
  const normalized = normalizePublicHttpUrl(sourceUrl);
  if (!normalized) {
    return json({ ok: false, error: "url/sourceUrl must be a public HTTP(S) URL" }, 400);
  }

  // Preserve a handle captured from X's DOM/network payload. It is used only
  // as a last resort if the internal /i/status/:id route cannot be upgraded
  // through public syndication before a third-party media resolver is called.
  const requestMetadata = normalizeMetadata(body.metadata);
  const twitterHandleHint = firstTwitterHandleHint(requestMetadata);

  let resolution: SocialResolution;
  try {
    resolution = await resolveSocialMedia(normalized.href, env, {
      twitterHandleHint,
    });
  } catch (error) {
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

  if (!send) return json({ ok: true, ...resolution });

  const channelValidation = normalizeTelegramChannels(body.channel, body.channels);
  if (!channelValidation.ok) {
    return json({ ok: false, error: channelValidation.error }, 400);
  }

  const parseMode = normalizeParseMode(body.parseMode);
  if (body.parseMode && !parseMode) {
    return json({ ok: false, error: "Invalid parseMode. Allowed values: HTML, MarkdownV2" }, 400);
  }

  const caption =
    typeof body.caption === "string"
      ? body.caption
      : resolution.caption || resolution.title || "";
  const explicitMediaId = typeof body.mediaId === "string" ? body.mediaId.trim() : "";
  const explicitMediaKey = typeof body.mediaKey === "string" ? body.mediaKey.trim() : "";
  const metadata = {
    ...(requestMetadata ?? {}),
    resolver: requestMetadata?.resolver || resolution.resolver,
  };
  const common = {
    sourceUrl: resolution.sourceUrl,
    pageUrl: resolution.sourceUrl,
    provider: resolution.source,
    caption,
    parseMode,
    channels: channelValidation.value,
    mediaId: explicitMediaId || undefined,
    mediaKey: explicitMediaKey || undefined,
    force: body.force === true,
    metadata,
  };

  const albumCompatible =
    resolution.media.length >= 2 &&
    resolution.media.every((item) => item.type === "photo" || item.type === "video");

  if (albumCompatible) {
    const response = await handleSend(
      cloneAuthorizedJsonRequest(request, {
        ...common,
        mediaItems: resolution.media.map((item) => ({
          mediaUrl: item.url,
          mediaType: toRelayMediaType(item.type),
          mediaHeaders: item.mediaHeaders,
        })),
      }),
      env,
    );
    return mergeResolveResponse(response, resolution);
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
    const response = await handleSend(
      cloneAuthorizedJsonRequest(request, {
        ...common,
        ...perItemIdentity,
        mediaUrl: item.url,
        mediaType: toRelayMediaType(item.type),
        mediaHeaders: item.mediaHeaders,
      }),
      env,
    );
    const result = await response.json();
    deliveries.push({ media: item, status: response.status, result });
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

  return json(
    {
      ok: succeeded > 0,
      partial,
      message:
        succeeded === deliveries.length
          ? `Resolved and sent ${deliveries.length} media item(s)`
          : `Resolved ${deliveries.length} media item(s); ${succeeded} delivery item(s) succeeded`,
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
): Promise<Response> {
  const payload = (await response.json()) as Record<string, unknown>;
  return json({ ...payload, resolution }, response.status);
}
