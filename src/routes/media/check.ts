import {
  checkStoredMediaDeliveries,
  persistKnownMedia,
  requireRelayDb,
  resolveMediaIdentity,
  type MediaIdentity,
} from "../../db";
import {
  MAX_MEDIA_CHECK_CHANNELS,
  MAX_MEDIA_CHECK_ITEMS,
} from "../../config/constants";
import { json } from "../../http/response";
import { getErrorMessage } from "../../lib/errors";
import { debugError, relayDebug, relayTraceId } from "../../lib/debug";
import { normalizeMediaIdentityInput } from "../../validation/media-identity";
import {
  normalizeCaption,
  normalizeMetadata,
  normalizeParseMode,
  normalizeRoutingUsernames,
  normalizeTelegramChannels,
} from "../../validation/common";
import { syncCaptionToTelegramDeliveries } from "../../services/media-caption-sync";
import { resolveTelegramChatIdsForEnv } from "../../services/channels";
import type { Env } from "../../types";

interface MediaCheckBody {
  items?: unknown;
  channel?: unknown;
  channels?: unknown;
  username?: unknown;
  usernames?: unknown;
}

interface NormalizedMediaCheckInput {
  index: number;
  input: unknown;
  identity: MediaIdentity;
  caption: string;
  parseMode: import("../../types").ParseMode | null;
  metadata: Record<string, string> | null;
  sourceUrl: string | null;
  pageUrl: string | null;
  requestedChannels: string[];
}

export async function handleMediaCheck(request: Request, env: Env): Promise<Response> {
  const traceId = relayTraceId(request);
  const startedAt = Date.now();
  let body: MediaCheckBody;
  try {
    body = (await request.json()) as MediaCheckBody;
  } catch {
    relayDebug(env, traceId, "media-check.invalid-json", {});
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    relayDebug(env, traceId, "media-check.empty", {});
    return json({ ok: false, error: "items must be a non-empty array" }, 400);
  }
  if (body.items.length > MAX_MEDIA_CHECK_ITEMS) {
    relayDebug(env, traceId, "media-check.too-large", { itemCount: body.items.length });
    return json(
      { ok: false, error: `items can contain at most ${MAX_MEDIA_CHECK_ITEMS} entries` },
      400,
    );
  }

  const channelValidation = normalizeTelegramChannels(body.channel, body.channels, { maxChannels: MAX_MEDIA_CHECK_CHANNELS });
  if (!channelValidation.ok) {
    relayDebug(env, traceId, "media-check.invalid-channels", { error: channelValidation.error });
    return json({ ok: false, error: channelValidation.error }, 400);
  }
  const usernameValidation = normalizeRoutingUsernames(body.username, body.usernames);
  if (!usernameValidation.ok) {
    relayDebug(env, traceId, "media-check.invalid-usernames", { error: usernameValidation.error });
    return json({ ok: false, error: usernameValidation.error }, 400);
  }
  const hasTopLevelRouting =
    body.channel !== undefined || body.channels !== undefined ||
    body.username !== undefined || body.usernames !== undefined;

  let db: D1Database;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    relayDebug(env, traceId, "media-check.database-unavailable", { error: debugError(error) });
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }

  const valid: NormalizedMediaCheckInput[] = [];
  const invalid = new Map<number, string>();

  await Promise.all(
    body.items.map(async (input, index) => {
      try {
        const identityInput = normalizeMediaIdentityInput(input);
        if (!identityInput) {
          invalid.set(index, "Provide a mediaKey, provider + mediaId, or an HTTP(S) URL");
          return;
        }
        const record = input && typeof input === "object" && !Array.isArray(input)
          ? input as Record<string, unknown>
          : {};
        const hasPerItemRouting =
          record.channel !== undefined || record.channels !== undefined ||
          record.username !== undefined || record.usernames !== undefined;
        const itemChannelValidation =
          record.channel !== undefined || record.channels !== undefined
            ? normalizeTelegramChannels(record.channel, record.channels, { maxChannels: MAX_MEDIA_CHECK_CHANNELS })
            : hasPerItemRouting
              ? ({ ok: true, value: [] as string[] } as const)
              : channelValidation;
        if (!itemChannelValidation.ok) {
          invalid.set(index, itemChannelValidation.error);
          return;
        }
        const itemUsernameValidation = hasPerItemRouting
          ? normalizeRoutingUsernames(record.username, record.usernames)
          : usernameValidation;
        if (!itemUsernameValidation.ok) {
          invalid.set(index, itemUsernameValidation.error);
          return;
        }
        const hasItemRouting = hasTopLevelRouting || hasPerItemRouting;
        const itemRequestedChannels = hasItemRouting
          ? resolveTelegramChatIdsForEnv(env, itemChannelValidation.value, itemUsernameValidation.value)
          : [];
        if (itemRequestedChannels.length > MAX_MEDIA_CHECK_CHANNELS) {
          invalid.set(index, `channels can contain at most ${MAX_MEDIA_CHECK_CHANNELS} entries`);
          return;
        }

        const caption = normalizeCaption(record.caption);
        const parseMode = caption ? normalizeParseMode(record.parseMode ?? record.parse_mode) : null;
        if (caption && (record.parseMode || record.parse_mode) && !parseMode) {
          invalid.set(index, "Invalid parseMode. Allowed values: HTML, MarkdownV2");
          return;
        }
        const sourceUrl = typeof record.sourceUrl === "string" ? record.sourceUrl :
          typeof record.url === "string" ? record.url : null;
        const pageUrl = typeof record.pageUrl === "string" ? record.pageUrl : null;
        valid.push({
          index,
          input,
          identity: await resolveMediaIdentity(identityInput),
          caption,
          parseMode,
          metadata: normalizeMetadata(record.metadata),
          sourceUrl,
          pageUrl,
          requestedChannels: itemRequestedChannels,
        });
      } catch (error) {
        invalid.set(index, getErrorMessage(error));
      }
    }),
  );
  valid.sort((left, right) => left.index - right.index);

  // Caption-first reconciliation: a status probe may teach the relay about a
  // post before its downloadable media URL exists. Persist only entries that
  // actually carry useful mutable data; pure checks remain read-only.
  try {
    await Promise.all(valid.map(async (item) => {
      if (!item.caption && !item.metadata) return;
      await persistKnownMedia(db, {
        identity: item.identity,
        sourceUrl: item.sourceUrl,
        pageUrl: item.pageUrl,
        caption: item.caption || null,
        parseMode: item.parseMode,
        metadata: item.metadata,
        mediaStatus: "pending",
      });
    }));
  } catch (error) {
    relayDebug(env, traceId, "media-check.caption-persist-failed", { error: debugError(error) });
    return json({ ok: false, error: getErrorMessage(error), stage: "caption-persist" }, 500);
  }

  const requestedChannels = [...new Set(valid.flatMap((item) => item.requestedChannels))];

  relayDebug(env, traceId, "media-check.items-normalized", {
    requested: body.items.length,
    valid: valid.length,
    invalid: invalid.size,
    channelCount: requestedChannels.length,
  });

  const validByIndex = new Map(valid.map((item) => [item.index, item]));
  const uniqueIdentities = [
    ...new Map(valid.map((item) => [item.identity.key, item.identity])).values(),
  ];

  let records;
  try {
    records = await checkStoredMediaDeliveries(db, uniqueIdentities, requestedChannels);
  } catch (error) {
    relayDebug(env, traceId, "media-check.database-query-failed", { error: debugError(error) });
    return json(
      { ok: false, error: getErrorMessage(error), stage: "database-query" },
      500,
    );
  }

  const captionSyncByIndex = new Map<number, Awaited<ReturnType<typeof syncCaptionToTelegramDeliveries>>>();
  for (const item of valid) {
    if (!item.caption) continue;
    const record = records.get(item.identity.key);
    if (!record?.deliveries.length) continue;
    const sync = await syncCaptionToTelegramDeliveries({
      botToken: env.TELEGRAM_BOT_TOKEN,
      caption: item.caption,
      parseMode: item.parseMode,
      deliveries: record.deliveries.map((delivery) => ({
        channelId: delivery.channelId,
        telegramChatId: delivery.telegramChatId,
        lastMessageIds: delivery.lastMessageIds,
      })),
    });
    captionSyncByIndex.set(item.index, sync);
  }

  const results = body.items.map((input, index) => {
    const validationError = invalid.get(index);
    if (validationError) {
      return {
        index,
        input,
        valid: false,
        exists: false,
        error: validationError,
        channels: [],
        ...(requestedChannels.length
          ? { requestedChannels: buildRequestedChannelStatus(requestedChannels, []) }
          : {}),
      };
    }

    const normalized = validByIndex.get(index)!;
    const record = records.get(normalized.identity.key);
    const deliveries = record?.deliveries ?? [];

    return {
      index,
      input,
      valid: true,
      mediaKey: normalized.identity.key,
      storedMediaKey: record?.media.key ?? null,
      provider: normalized.identity.provider,
      mediaId: normalized.identity.providerMediaId,
      canonicalUrl: normalized.identity.canonicalUrl,
      exists: Boolean(record),
      media: record?.media ?? null,
      channels: deliveries,
      captionPersistence: normalized.caption
        ? { persisted: true, status: record?.media.status ?? "pending" }
        : null,
      telegramCaptionSync: captionSyncByIndex.get(index) ?? [],
      ...(normalized.requestedChannels.length
        ? { requestedChannels: buildRequestedChannelStatus(normalized.requestedChannels, deliveries) }
        : {}),
    };
  });

  const uniqueFound = uniqueIdentities.filter((identity) => records.has(identity.key)).length;
  const validCount = valid.length;
  const foundInputs = results.filter((item) => item.valid && item.exists).length;

  relayDebug(env, traceId, "media-check.completed", {
    requested: body.items.length,
    valid: validCount,
    invalid: body.items.length - validCount,
    unique: uniqueIdentities.length,
    found: uniqueFound,
    foundInputs,
    durationMs: Date.now() - startedAt,
  });

  return json({
    ok: true,
    results,
    meta: {
      requested: body.items.length,
      valid: validCount,
      invalid: body.items.length - validCount,
      unique: uniqueIdentities.length,
      found: uniqueFound,
      missing: uniqueIdentities.length - uniqueFound,
      foundInputs,
      queryCount: uniqueIdentities.length ? 1 : 0,
      channelFilterCount: requestedChannels.length,
      durationMs: Date.now() - startedAt,
    },
  });
}

function buildRequestedChannelStatus(
  requestedChannels: string[],
  deliveries: Array<{
    channelId: string;
    sendCount: number;
    firstSentAt: string;
    lastSentAt: string;
  }>,
): Record<
  string,
  {
    sent: boolean;
    sendCount: number;
    firstSentAt: string | null;
    lastSentAt: string | null;
  }
> {
  const byChannel = new Map(deliveries.map((delivery) => [delivery.channelId, delivery]));
  return Object.fromEntries(
    requestedChannels.map((channelId) => {
      const delivery = byChannel.get(channelId);
      return [
        channelId,
        delivery
          ? {
              sent: true,
              sendCount: delivery.sendCount,
              firstSentAt: delivery.firstSentAt,
              lastSentAt: delivery.lastSentAt,
            }
          : { sent: false, sendCount: 0, firstSentAt: null, lastSentAt: null },
      ];
    }),
  );
}
