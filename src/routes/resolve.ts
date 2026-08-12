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

  let resolution: SocialResolution;
  try {
    resolution = await resolveSocialMedia(normalized.href, env);
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
  const metadata = normalizeMetadata(body.metadata) ?? { resolver: resolution.resolver };
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

  const succeeded = deliveries.filter((delivery) => delivery.status >= 200 && delivery.status < 300).length;
  const allConflicts = deliveries.length > 0 && deliveries.every((delivery) => delivery.status === 409);
  const status =
    succeeded === deliveries.length
      ? 200
      : succeeded > 0
        ? 207
        : allConflicts
          ? 409
          : 502;

  return json(
    {
      ok: succeeded > 0,
      partial: succeeded > 0 && succeeded < deliveries.length,
      message:
        succeeded === deliveries.length
          ? `Resolved and sent ${deliveries.length} media item(s)`
          : `Resolved ${deliveries.length} media item(s); ${succeeded} delivery item(s) succeeded`,
      resolution,
      deliveries,
    },
    status,
  );
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
