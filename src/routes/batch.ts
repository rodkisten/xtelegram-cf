import {
  checkStoredMediaDeliveries,
  requireRelayDb,
  resolveMediaIdentity,
  type MediaIdentity,
} from "../db";
import {
  DEFAULT_BATCH_CONCURRENCY,
  MAX_BATCH_CONCURRENCY,
  MAX_BATCH_ITEMS,
} from "../config/constants";
import { cloneAuthorizedJsonRequest } from "../http/internal-request";
import { json } from "../http/response";
import { mapWithConcurrency } from "../lib/concurrency";
import { getErrorMessage } from "../lib/errors";
import {
  resolveDefaultTelegramChatId,
  resolveTelegramChatIds,
} from "../services/channels";
import { detectSocialProvider } from "../social";
import type { Env } from "../types";
import { normalizeTelegramChannels } from "../validation/common";
import { normalizeMediaIdentityInput } from "../validation/media-identity";
import { handleResolve } from "./resolve";
import { handleSend } from "./send";

interface BatchBody {
  links?: unknown;
  items?: unknown;
  channel?: unknown;
  channels?: unknown;
  force?: unknown;
  caption?: unknown;
  parseMode?: unknown;
  metadata?: unknown;
  concurrency?: unknown;
}

type BatchSkip = {
  channelId: string;
  reason: "already_sent" | "duplicate_in_batch";
  duplicateOfIndex?: number;
};

interface BatchPreparedItem {
  index: number;
  input: Record<string, unknown>;
  payload: Record<string, unknown>;
  channels: string[];
  force: boolean;
  identity: MediaIdentity | null;
  isDirect: boolean;
  preSkipped: BatchSkip[];
}

export async function handleBatch(request: Request, env: Env): Promise<Response> {
  const batchStartedAt = Date.now();
  let body: BatchBody;
  try {
    body = (await request.json()) as BatchBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const rawItems = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.links)
      ? body.links
      : null;
  if (!rawItems?.length) {
    return json(
      { ok: false, error: "Batch requires a non-empty links[] or items[] array." },
      400,
    );
  }
  if (rawItems.length > MAX_BATCH_ITEMS) {
    return json(
      { ok: false, error: `A batch can contain at most ${MAX_BATCH_ITEMS} links/items.` },
      400,
    );
  }

  const channelValidation = normalizeTelegramChannels(body.channel, body.channels);
  if (!channelValidation.ok) return json({ ok: false, error: channelValidation.error }, 400);

  const sharedChannels = resolveTelegramChatIds(
    channelValidation.value,
    resolveDefaultTelegramChatId(env),
  );
  if (!sharedChannels.length) {
    return json({ ok: false, error: "No Telegram channel was provided." }, 400);
  }

  let db: D1Database;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage(error), stage: "database" }, 500);
  }

  const invalidResults = new Map<number, Record<string, unknown>>();
  const prepared: BatchPreparedItem[] = [];

  await Promise.all(
    rawItems.map(async (raw, index) => {
      const item =
        typeof raw === "string"
          ? { url: raw }
          : raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : null;

      if (!item) {
        invalidResults.set(index, {
          index,
          ok: false,
          status: 400,
          error: "Batch item must be a URL string or object.",
        });
        return;
      }

      const itemChannelsValidation =
        item.channel !== undefined || item.channels !== undefined
          ? normalizeTelegramChannels(item.channel, item.channels)
          : ({ ok: true, value: sharedChannels } as const);
      if (!itemChannelsValidation.ok) {
        invalidResults.set(index, {
          index,
          ok: false,
          status: 400,
          error: itemChannelsValidation.error,
        });
        return;
      }

      const channels = resolveTelegramChatIds(
        itemChannelsValidation.value.length
          ? itemChannelsValidation.value
          : sharedChannels,
        resolveDefaultTelegramChatId(env),
      );
      if (!channels.length) {
        invalidResults.set(index, {
          index,
          ok: false,
          status: 400,
          error: "No Telegram channel was provided for this batch item.",
        });
        return;
      }

      const force = item.force === true || (item.force === undefined && body.force === true);
      const payload: Record<string, unknown> = {
        ...item,
        channels,
        force,
        caption: item.caption ?? body.caption,
        parseMode: item.parseMode ?? body.parseMode,
        metadata: item.metadata ?? body.metadata,
      };
      delete payload.channel;

      const plainUrl = typeof payload.url === "string" ? payload.url.trim() : "";
      const isDirect =
        "mediaUrl" in payload ||
        "photoUrl" in payload ||
        "videoUrl" in payload ||
        "fileUrl" in payload ||
        "mediaItems" in payload ||
        "mediaUrls" in payload ||
        "photoUrls" in payload ||
        "mediaType" in payload ||
        (Boolean(plainUrl) && !detectSocialProvider(plainUrl));

      let identity: MediaIdentity | null = null;
      try {
        const identityInput = normalizeMediaIdentityInput(payload);
        if (identityInput) identity = await resolveMediaIdentity(identityInput);
      } catch {
        // /send or the social resolver can still establish the identity later.
        // Only the cheap batch preflight is skipped for this item.
      }

      prepared.push({
        index,
        input: item,
        payload,
        channels,
        force,
        identity,
        isDirect,
        preSkipped: [],
      });
    }),
  );
  prepared.sort((left, right) => left.index - right.index);

  const preflightItems = prepared.filter((item) => !item.force && item.identity);
  const preflightIdentities = [
    ...new Map(preflightItems.map((item) => [item.identity!.key, item.identity!])).values(),
  ];
  const preflightChannels = [...new Set(preflightItems.flatMap((item) => item.channels))];
  const preflightStartedAt = Date.now();
  let existing: Awaited<ReturnType<typeof checkStoredMediaDeliveries>>;
  try {
    existing = preflightIdentities.length
      ? await checkStoredMediaDeliveries(db, preflightIdentities, preflightChannels)
      : new Map();
  } catch (error) {
    return json(
      { ok: false, error: getErrorMessage(error), stage: "batch-preflight" },
      500,
    );
  }
  const preflightDurationMs = Date.now() - preflightStartedAt;

  for (const item of preflightItems) {
    const storedKey = existing.get(item.identity!.key)?.media.key;
    if (storedKey && storedKey !== item.identity!.key) item.payload.mediaKey = storedKey;
  }

  // force bypasses historical delivery dedupe, but never duplicates the exact
  // same media/channel pair twice inside one batch request.
  const scheduledByMediaKey = new Map<string, Map<string, number>>();
  for (const item of prepared) {
    if (!item.identity) continue;

    const storedKey = !item.force ? existing.get(item.identity.key)?.media.key : undefined;
    const schedulingKey = storedKey || item.identity.key;
    const existingChannels = item.force
      ? new Set<string>()
      : new Set(
          (existing.get(item.identity.key)?.deliveries ?? []).map(
            (delivery) => delivery.channelId,
          ),
        );
    const scheduled = scheduledByMediaKey.get(schedulingKey) ?? new Map<string, number>();
    const preSkipped: BatchSkip[] = [];

    for (const channelId of item.channels) {
      if (existingChannels.has(channelId)) {
        preSkipped.push({ channelId, reason: "already_sent" });
        continue;
      }
      const duplicateOfIndex = scheduled.get(channelId);
      if (duplicateOfIndex !== undefined) {
        preSkipped.push({
          channelId,
          reason: "duplicate_in_batch",
          duplicateOfIndex,
        });
      }
    }

    item.preSkipped = preSkipped;
    const skippedChannelIds = new Set(preSkipped.map((entry) => entry.channelId));
    const channelsToSchedule = item.channels.filter(
      (channelId) => !skippedChannelIds.has(channelId),
    );
    channelsToSchedule.forEach((channelId) => scheduled.set(channelId, item.index));
    scheduledByMediaKey.set(schedulingKey, scheduled);
    item.payload.channels = channelsToSchedule;
  }

  const concurrency = normalizeBatchConcurrency(body.concurrency);
  const processingStartedAt = Date.now();
  const processed = await mapWithConcurrency(prepared, concurrency, async (item) => {
    const channelsToSend = Array.isArray(item.payload.channels)
      ? item.payload.channels.filter((value): value is string => typeof value === "string")
      : item.channels;

    if (item.identity && channelsToSend.length === 0) {
      return {
        index: item.index,
        ok: false,
        partial: false,
        conflict: true,
        status: 409,
        error:
          "Media was already sent to every requested Telegram channel or duplicated inside this batch.",
        media: item.identity,
        channels: {
          requested: item.channels,
          attempted: [],
          inserted: [],
          notSent: item.preSkipped,
        },
      } as Record<string, unknown>;
    }

    try {
      const internal = cloneAuthorizedJsonRequest(request, item.payload);
      const response = item.isDirect
        ? await handleSend(internal, env)
        : await handleResolve(internal, env, true);
      const result = (await response.json()) as Record<string, unknown>;
      const merged = mergeBatchPreflightResult(result, item.channels, item.preSkipped);
      return { index: item.index, status: response.status, ...merged };
    } catch (error) {
      console.error("[media-relay] Batch item crashed", {
        index: item.index,
        error: getErrorMessage(error),
      });
      return {
        index: item.index,
        ok: false,
        status: 500,
        stage: "batch-item",
        error: getErrorMessage(error),
        channels: {
          requested: item.channels,
          attempted: channelsToSend,
          inserted: [],
          notSent: item.preSkipped,
        },
      };
    }
  });

  const resultByIndex = new Map<number, Record<string, unknown>>();
  for (const result of processed) resultByIndex.set(Number(result.index), result);
  for (const [index, result] of invalidResults) resultByIndex.set(index, result);
  const results = rawItems.map(
    (_, index) =>
      resultByIndex.get(index) ?? {
        index,
        ok: false,
        status: 500,
        error: "Batch item did not produce a result.",
      },
  );

  const succeeded = results.filter((item) => item.ok === true).length;
  const conflicts = results.filter(
    (item) => item.status === 409 || item.conflict === true,
  ).length;
  const failed = results.length - succeeded;
  const insertedChannels = sumChannelArray(results, "inserted");
  const skippedAlreadySent = countNotSentReason(results, "already_sent");
  const skippedDuplicateInBatch = countNotSentReason(results, "duplicate_in_batch");
  const telegramAttempts = sumMetric(results, "telegramAttempts");
  const identityAliasQueries = sumMetric(results, "identityAliasQueries");
  const claimQueries = sumMetric(results, "claimQueries");
  const dbRoundTrips =
    (preflightIdentities.length ? 1 : 0) + sumMetric(results, "dbRoundTrips");
  const dbStatements =
    (preflightIdentities.length ? 1 : 0) + sumMetric(results, "dbStatements");
  const mediaResolutions = prepared.filter((item) => {
    const channels = Array.isArray(item.payload.channels) ? item.payload.channels : [];
    return !item.isDirect && channels.length > 0;
  }).length;
  const processingDurationMs = Date.now() - processingStartedAt;
  const status = resolveBatchStatus(results, succeeded, conflicts);

  return json(
    {
      ok: succeeded > 0,
      partial: succeeded > 0 && failed > 0,
      summary: {
        requested: results.length,
        succeeded,
        failed,
        conflicts,
        insertedChannels,
        skippedAlreadySent,
        skippedDuplicateInBatch,
        preflightQueries: preflightIdentities.length ? 1 : 0,
        identityAliasQueries,
        claimQueries,
        dbRoundTrips,
        dbStatements,
        mediaResolutions,
        telegramAttempts,
        concurrency,
        preflightDurationMs,
        processingDurationMs,
        durationMs: Date.now() - batchStartedAt,
      },
      results,
    },
    status,
  );
}

function normalizeBatchConcurrency(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : DEFAULT_BATCH_CONCURRENCY;
  if (!Number.isFinite(numeric)) return DEFAULT_BATCH_CONCURRENCY;
  return Math.min(MAX_BATCH_CONCURRENCY, Math.max(1, Math.floor(numeric)));
}

function mergeBatchPreflightResult(
  result: Record<string, unknown>,
  requestedChannels: string[],
  preSkipped: BatchSkip[],
): Record<string, unknown> {
  if (!preSkipped.length) return result;

  const channels =
    result.channels && typeof result.channels === "object" && !Array.isArray(result.channels)
      ? (result.channels as Record<string, unknown>)
      : {};
  const attempted = Array.isArray(channels.attempted) ? channels.attempted : [];
  const inserted = Array.isArray(channels.inserted) ? channels.inserted : [];
  const notSent = Array.isArray(channels.notSent) ? channels.notSent : [];
  const mergedNotSent = [...preSkipped, ...notSent];

  return {
    ...result,
    partial: inserted.length > 0 && mergedNotSent.length > 0,
    channels: {
      ...channels,
      requested: requestedChannels,
      attempted,
      inserted,
      notSent: mergedNotSent,
    },
  };
}

function sumChannelArray(results: Record<string, unknown>[], key: string): number {
  return results.reduce((total, item) => {
    const channels = item.channels as Record<string, unknown> | undefined;
    return total + (Array.isArray(channels?.[key]) ? channels[key].length : 0);
  }, 0);
}

function countNotSentReason(results: Record<string, unknown>[], reason: string): number {
  return results.reduce((total, item) => {
    const channels = item.channels as { notSent?: unknown } | undefined;
    if (!Array.isArray(channels?.notSent)) return total;
    return (
      total +
      channels.notSent.filter(
        (failure) =>
          failure &&
          typeof failure === "object" &&
          (failure as { reason?: unknown }).reason === reason,
      ).length
    );
  }, 0);
}

function sumMetric(results: Record<string, unknown>[], key: string): number {
  return results.reduce((total, item) => {
    const metrics =
      item.metrics && typeof item.metrics === "object"
        ? (item.metrics as Record<string, unknown>)
        : {};
    return total + (Number(metrics[key] || 0) || 0);
  }, 0);
}

function resolveBatchStatus(
  results: Record<string, unknown>[],
  succeeded: number,
  conflicts: number,
): number {
  if (succeeded === results.length) return 200;
  if (succeeded > 0) return 207;
  if (conflicts === results.length) return 409;
  if (results.length > 0 && results.every((item) => Number(item.status) === 400)) return 400;
  return 502;
}
