import {
  checkStoredMediaDeliveries,
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
import { normalizeMediaIdentityInput } from "../../validation/media-identity";
import { normalizeTelegramChannels } from "../../validation/common";
import type { Env } from "../../types";

interface MediaCheckBody {
  items?: unknown;
  channel?: unknown;
  channels?: unknown;
}

interface NormalizedMediaCheckInput {
  index: number;
  input: unknown;
  identity: MediaIdentity;
}

export async function handleMediaCheck(request: Request, env: Env): Promise<Response> {
  const startedAt = Date.now();
  let body: MediaCheckBody;
  try {
    body = (await request.json()) as MediaCheckBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return json({ ok: false, error: "items must be a non-empty array" }, 400);
  }
  if (body.items.length > MAX_MEDIA_CHECK_ITEMS) {
    return json(
      { ok: false, error: `items can contain at most ${MAX_MEDIA_CHECK_ITEMS} entries` },
      400,
    );
  }

  const channelValidation = normalizeTelegramChannels(body.channel, body.channels, { maxChannels: MAX_MEDIA_CHECK_CHANNELS });
  if (!channelValidation.ok) return json({ ok: false, error: channelValidation.error }, 400);

  const requestedChannels = [...new Set(channelValidation.value)];
  if (requestedChannels.length > MAX_MEDIA_CHECK_CHANNELS) {
    return json(
      {
        ok: false,
        error: `channels can contain at most ${MAX_MEDIA_CHECK_CHANNELS} entries`,
      },
      400,
    );
  }

  let db: D1Database;
  try {
    db = requireRelayDb(env);
  } catch (error) {
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
        valid.push({ index, input, identity: await resolveMediaIdentity(identityInput) });
      } catch (error) {
        invalid.set(index, getErrorMessage(error));
      }
    }),
  );
  valid.sort((left, right) => left.index - right.index);

  const validByIndex = new Map(valid.map((item) => [item.index, item]));
  const uniqueIdentities = [
    ...new Map(valid.map((item) => [item.identity.key, item.identity])).values(),
  ];

  let records;
  try {
    records = await checkStoredMediaDeliveries(db, uniqueIdentities, requestedChannels);
  } catch (error) {
    return json(
      { ok: false, error: getErrorMessage(error), stage: "database-query" },
      500,
    );
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
      ...(requestedChannels.length
        ? { requestedChannels: buildRequestedChannelStatus(requestedChannels, deliveries) }
        : {}),
    };
  });

  const uniqueFound = uniqueIdentities.filter((identity) => records.has(identity.key)).length;
  const validCount = valid.length;
  const foundInputs = results.filter((item) => item.valid && item.exists).length;

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
