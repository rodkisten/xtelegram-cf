import {
  acquireDeliveryClaims,
  releaseDeliveryClaims,
  resolveMediaIdentity,
  resolveStoredMediaIdentity,
  type DeliveryClaimResult,
  type MediaIdentity,
  type MediaIdentityInput,
} from "../db";
import type { Env } from "../types";

export type DeliverySkip =
  | { channelId: string; reason: "already_sent" }
  | { channelId: string; reason: "delivery_in_progress" };

export interface DeliveryPlan {
  db: D1Database;
  identity: MediaIdentity;
  claim: DeliveryClaimResult;
  requestedChannels: string[];
  channelsToSend: string[];
  skippedAlreadySent: Array<{ channelId: string; reason: "already_sent" }>;
  skippedInProgress: Array<{ channelId: string; reason: "delivery_in_progress" }>;
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
  const notSent = [...plan.skippedAlreadySent, ...plan.skippedInProgress];
  const hasInProgress = plan.skippedInProgress.length > 0;
  return {
    ok: false,
    conflict: true,
    error: hasInProgress
      ? `${subject} delivery is already in progress for the requested Telegram channel(s).`
      : `${subject} was already sent to every requested Telegram channel.`,
    media: plan.identity,
    channels: {
      requested: plan.requestedChannels,
      attempted: [],
      inserted: [],
      notSent,
    },
    hint: hasInProgress
      ? "Wait for the in-flight delivery to complete before retrying."
      : "Pass force=true to resend and increment send_count.",
    metrics: {
      identityAliasQueries: plan.identityAliasQueries,
      claimQueries: plan.claim.queryCount,
      claimedChannels: 0,
    },
  };
}

function resolveDeliveryClaimTtlMs(env: Env): number {
  const rawSeconds = Number(env.DELIVERY_CLAIM_TTL_SECONDS || 1800);
  const seconds = Number.isFinite(rawSeconds)
    ? Math.min(3600, Math.max(60, Math.floor(rawSeconds)))
    : 1800;
  return seconds * 1000;
}
