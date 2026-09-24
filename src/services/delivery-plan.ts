import {
  acquireDeliveryClaims,
  releaseDeliveryClaims,
  resolveMediaIdentity,
  resolveStoredMediaIdentity,
  type ContentDuplicateMatch,
  type DeliveryClaimResult,
  type MediaIdentity,
  type MediaIdentityInput,
} from "../db";
import type { Env } from "../types";
import { buildStoredTelegramMessageLinkFields } from "../lib/telegram-message-links";

export type DeliverySkip =
  | { channelId: string; reason: "already_sent" }
  | { channelId: string; reason: "delivery_in_progress" }
  | { channelId: string; reason: "content_duplicate" };

export interface DeliveryPlan {
  db: D1Database;
  identity: MediaIdentity;
  claim: DeliveryClaimResult;
  requestedChannels: string[];
  channelsToSend: string[];
  skippedAlreadySent: Array<{ channelId: string; reason: "already_sent" }>;
  skippedInProgress: Array<{ channelId: string; reason: "delivery_in_progress" }>;
  skippedContentDuplicates: Array<{ channelId: string; reason: "content_duplicate" }>;
  contentDuplicates: ContentDuplicateMatch[];
  identityAliasQueries: number;
  releaseChannels: Set<string>;
  force: boolean;
}

export async function createDeliveryPlan(options: {
  db: D1Database;
  env: Env;
  identityInput: MediaIdentityInput;
  channels: string[];
  force: boolean;
}): Promise<DeliveryPlan> {
  const resolvedIdentity = await resolveMediaIdentity(options.identityInput);
  const identityAliasQueries = resolvedIdentity.legacyKeys.length ? 1 : 0;
  const identity = await resolveStoredMediaIdentity(options.db, resolvedIdentity);
  const claim = await acquireDeliveryClaims(options.db, identity, options.channels, {
    force: options.force,
    ttlMs: resolveDeliveryClaimTtlMs(options.env),
  });
  const channelsToSend = claim.acquired;

  return {
    db: options.db,
    identity,
    claim,
    requestedChannels: options.channels,
    channelsToSend,
    skippedAlreadySent: claim.alreadySent.map((channelId) => ({
      channelId,
      reason: "already_sent" as const,
    })),
    skippedInProgress: claim.inProgress.map((channelId) => ({
      channelId,
      reason: "delivery_in_progress" as const,
    })),
    skippedContentDuplicates: [],
    contentDuplicates: [],
    identityAliasQueries,
    releaseChannels: new Set(channelsToSend),
    force: options.force,
  };
}

/**
 * Once Telegram accepted a side effect, do not release that channel's claim
 * until D1 persistence commits. If persistence fails, the claim surviving until
 * TTL protects an immediate retry from duplicating the external side effect.
 */

/**
 * Removes channels that already contain the same Worker-owned media according
 * to content identity. Existing provider/media-key dedupe remains untouched;
 * this is an additional post-resolution safety net for changed URLs and
 * recompressed copies.
 *
 * @example
 * applyContentDuplicateMatches(plan, matches);
 * // Duplicate destinations move out of channelsToSend and into the response.
 */
export function applyContentDuplicateMatches(
  plan: DeliveryPlan,
  matches: ContentDuplicateMatch[],
): void {
  if (plan.force || !matches.length) return;
  const duplicateChannels = new Set(matches.flatMap((match) => match.deliveries.map((delivery) => delivery.channelId)));
  if (!duplicateChannels.size) return;

  const remaining = plan.channelsToSend.filter((channelId) => !duplicateChannels.has(channelId));
  for (const channelId of plan.channelsToSend) {
    if (!duplicateChannels.has(channelId)) continue;
    if (!plan.skippedContentDuplicates.some((entry) => entry.channelId === channelId)) {
      plan.skippedContentDuplicates.push({ channelId, reason: "content_duplicate" });
    }
    plan.releaseChannels.add(channelId);
  }
  plan.channelsToSend = remaining;
  plan.contentDuplicates = matches;
}

/**
 * Once Telegram accepted a side effect, do not release that channel's claim
 * until D1 persistence commits. If persistence fails, the claim surviving until
 * TTL protects an immediate retry from duplicating the external side effect.
 *
 * @example
 * retainSuccessfulClaimsUntilPersistence(plan, ["-1001"]);
 * // The successful channel remains claimed until persistence finishes.
 */
export function retainSuccessfulClaimsUntilPersistence(
  plan: DeliveryPlan,
  successfulChannels: Iterable<string>,
): void {
  for (const channelId of successfulChannels) plan.releaseChannels.delete(channelId);
}

/** Mark only channels whose successful external side effects were committed to D1. */
export function markChannelsPersisted(
  plan: DeliveryPlan,
  persistedChannels: Iterable<string>,
): void {
  for (const channelId of persistedChannels) {
    if (plan.channelsToSend.includes(channelId)) plan.releaseChannels.add(channelId);
  }
}

export async function releasePendingDeliveryClaims(plan: DeliveryPlan): Promise<void> {
  if (!plan.releaseChannels.size) return;
  await releaseDeliveryClaims(
    plan.db,
    plan.identity,
    plan.claim.requestId,
    [...plan.releaseChannels],
  );
  plan.releaseChannels.clear();
}

export function buildDeliveryConflict(plan: DeliveryPlan, subject = "Media") {
  const notSent = [...plan.skippedAlreadySent, ...plan.skippedContentDuplicates, ...plan.skippedInProgress];
  const hasInProgress = plan.skippedInProgress.length > 0;
  const hasContentDuplicate = plan.skippedContentDuplicates.length > 0;
  const duplicateDeliveries = getAlreadySentDeliveryDetails(plan);
  const messageLinks = getExistingTelegramMessageLinkFields(plan);
  return {
    ok: false,
    ...messageLinks,
    conflict: true,
    error: hasInProgress
      ? `${subject} delivery is already in progress for the requested Telegram channel(s).`
      : hasContentDuplicate
        ? `${subject} matches media already delivered to the requested Telegram channel(s).`
        : `${subject} was already sent to every requested Telegram channel.`,
    media: plan.identity,
    channels: {
      requested: plan.requestedChannels,
      attempted: [],
      inserted: [],
      notSent,
    },
    duplicates: duplicateDeliveries,
    hint: hasInProgress
      ? "Wait for the in-flight delivery to complete before retrying."
      : "Pass force=true to resend and increment send_count.",
    contentDuplicates: plan.contentDuplicates.map(formatContentDuplicate),
    metrics: {
      identityAliasQueries: plan.identityAliasQueries,
      claimQueries: plan.claim.queryCount,
      claimedChannels: 0,
    },
  };
}

/**
 * Returns the persisted Telegram destination/message information for channels
 * skipped as duplicates by the current delivery plan.
 *
 * @example
 * Input: a plan that skipped channel `-1001` after finding message `42`.
 * Output: `[{ channelId: "-1001", messageIds: [42], ... }]`.
 */
export function getAlreadySentDeliveryDetails(plan: DeliveryPlan) {
  const skippedChannels = new Set(plan.skippedAlreadySent.map((entry) => entry.channelId));
  return plan.claim.alreadySentDeliveries
    .filter((delivery) => skippedChannels.has(delivery.channelId))
    .map(formatDuplicateDelivery);
}

/** Flat Telegram message fields for D1-backed duplicates/presentation-only paths. */
export function getAlreadySentTelegramMessageLinkFields(plan: DeliveryPlan) {
  const skippedChannels = new Set(plan.skippedAlreadySent.map((entry) => entry.channelId));
  return buildStoredTelegramMessageLinkFields(
    plan.claim.alreadySentDeliveries.filter((delivery) => skippedChannels.has(delivery.channelId)),
  );
}

/**
 * Returns links for any existing Telegram message that caused a delivery conflict,
 * including provider-key duplicates and content-level duplicates.
 */
export function getExistingTelegramMessageLinkFields(plan: DeliveryPlan) {
  const alreadySent = plan.claim.alreadySentDeliveries.filter((delivery) =>
    plan.skippedAlreadySent.some((entry) => entry.channelId === delivery.channelId));
  const contentDuplicates = plan.contentDuplicates.flatMap((match) => match.deliveries);
  return buildStoredTelegramMessageLinkFields([...alreadySent, ...contentDuplicates]);
}

/** Formats content-level duplicate evidence for clients such as Scriptable and Shortcuts. */
function formatContentDuplicate(match: ContentDuplicateMatch) {
  return {
    matchType: match.matchType,
    similarity: Number(match.similarity.toFixed(4)),
    mediaKey: match.mediaKey,
    provider: match.provider,
    sourceUrl: match.sourceUrl,
    pageUrl: match.pageUrl,
    mediaSha256: match.mediaSha256,
    mediaByteLength: match.mediaByteLength,
    deliveries: match.deliveries.map(formatDuplicateDelivery),
  };
}

function formatDuplicateDelivery(delivery: DeliveryClaimResult["alreadySentDeliveries"][number]) {
  const messageLinks = buildStoredTelegramMessageLinkFields([delivery]);
  return {
    ...messageLinks,
    channelId: delivery.channelId,
    telegramChatId: delivery.telegramChatId,
    messageThreadId: delivery.messageThreadId,
    telegramChatTitle: delivery.telegramChatTitle,
    messageIds: delivery.lastMessageIds.length ? delivery.lastMessageIds : delivery.firstMessageIds,
    firstMessageIds: delivery.firstMessageIds,
    lastMessageIds: delivery.lastMessageIds,
    sendCount: delivery.sendCount,
    firstSentAt: delivery.firstSentAt,
    lastSentAt: delivery.lastSentAt,
  };
}

function resolveDeliveryClaimTtlMs(env: Env): number {
  const rawSeconds = Number(env.DELIVERY_CLAIM_TTL_SECONDS || 1800);
  const seconds = Number.isFinite(rawSeconds)
    ? Math.min(3600, Math.max(60, Math.floor(rawSeconds)))
    : 1800;
  return seconds * 1000;
}
