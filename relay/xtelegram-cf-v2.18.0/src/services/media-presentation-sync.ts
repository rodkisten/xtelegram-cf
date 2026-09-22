import { sanitizeDeliveryCaption } from "../lib/social-caption";
import {
  acquireDeliveryClaims,
  releaseDeliveryClaims,
  updateDeliveryPresentationSnapshots,
  type DeliveryHistoryRecord,
} from "../db";
import { editTelegramMessageCaption } from "../telegram";
import type { ParseMode } from "../types";
import {
  buildPresentationSnapshot,
  comparePresentationSnapshots,
  extractCustomMetadataFromStored,
  mergePresentationSnapshot,
  parsePresentationSnapshot,
  serializePresentationSnapshot,
  type PresentationSnapshot,
} from "./presentation-state";

export interface StoredMediaPresentation {
  sourceUrl?: string | null;
  canonicalUrl?: string | null;
  pageUrl?: string | null;
  caption?: string | null;
  parseMode?: ParseMode | string | null;
  metadata?: unknown;
}

export interface PresentationSyncResult {
  changes: ReturnType<typeof comparePresentationSnapshots>["changes"];
  channelId: string;
  chatId: string | null;
  messageId: number | null;
  compared: boolean;
  changed: boolean;
  captionChanged: boolean;
  parseModeChanged: boolean;
  metadataChanged: boolean;
  metadataAdded: string[];
  metadataRemoved: string[];
  metadataChangedKeys: string[];
  edited: boolean;
  persisted: boolean;
  skipped: boolean;
  reason: "unchanged" | "metadata_only" | "edited" | "telegram_already_current" | "missing_message" | "edit_failed" | "update_in_progress";
  error: string | null;
}

/**
 * Compare the desired caption/custom metadata against what was last confirmed
 * for every Telegram delivery. Only call editMessageCaption when the rendered
 * caption or parse mode actually differs. Metadata-only changes are persisted
 * without issuing a redundant Telegram edit.
 */
export async function reconcileTelegramPresentation(options: {
  db: D1Database;
  mediaKey: string;
  botToken: string;
  caption: string;
  parseMode: ParseMode | null;
  captionProvided: boolean;
  metadata: Record<string, string> | null;
  metadataProvided: boolean;
  storedMedia: StoredMediaPresentation | null;
  deliveries: DeliveryHistoryRecord[];
}): Promise<PresentationSyncResult[]> {
  if (!options.deliveries.length) return [];
  const identity = { key: options.mediaKey, provider: "", providerMediaId: "", canonicalUrl: "", legacyKeys: [] };
  // The same claim table serializes sends and edits. Read the snapshot inside
  // the claim transaction so two overlapping calls never compare a stale copy.
  const claim = await acquireDeliveryClaims(options.db, identity,
    options.deliveries.map((delivery) => delivery.channelId), { force: true });
  try {
    const acquired = new Set(claim.acquired);
    const current = claim.alreadySentDeliveries.filter((delivery) => acquired.has(delivery.channelId));
    const results = await reconcileClaimedPresentation({ ...options, deliveries: current });
    for (const delivery of options.deliveries.filter((item) => !acquired.has(item.channelId))) {
      results.push({
        channelId: delivery.channelId, chatId: delivery.telegramChatId,
        messageId: firstMessageId(delivery), compared: false, changed: false,
        captionChanged: false, parseModeChanged: false, metadataChanged: false,
        metadataAdded: [], metadataRemoved: [], metadataChangedKeys: [], changes: [],
        edited: false, persisted: false, skipped: true, reason: "update_in_progress",
        error: "Another request is sending or editing this destination. Retry this payload later.",
      });
    }
    return results;
  } finally {
    await releaseDeliveryClaims(options.db, identity, claim.requestId, claim.acquired);
  }
}

async function reconcileClaimedPresentation(
  options: Parameters<typeof reconcileTelegramPresentation>[0],
): Promise<PresentationSyncResult[]> {
  const legacyBase = options.storedMedia
    ? buildPresentationSnapshot({
        caption: options.storedMedia.caption || "",
        parseMode: options.storedMedia.parseMode || null,
        metadata: extractCustomMetadataFromStored(options.storedMedia.metadata),
      })
    : null;

  const updates: Array<{ channelId: string; presentationJson: string }> = [];
  const results: PresentationSyncResult[] = [];

  // Pin legacy baselines for every destination before any route changes the
  // shared media row. Untargeted channels must not appear edited on a later call.
  if (legacyBase) {
    await options.db.prepare(`UPDATE media_deliveries SET presentation_json = ?2
      WHERE media_key = ?1 AND presentation_json IS NULL`)
      .bind(options.mediaKey, serializePresentationSnapshot(legacyBase)).run();
  }

  for (const delivery of options.deliveries) {
    const storedSnapshot = parsePresentationSnapshot(delivery.presentationJson) || legacyBase;
    const desired = mergePresentationSnapshot(storedSnapshot, {
      caption: options.caption,
      parseMode: options.parseMode,
      captionProvided: options.captionProvided,
      metadata: options.metadata,
      metadataProvided: options.metadataProvided,
    });
    // Sanitize the desired state only: the old snapshot must stay intact so
    // already-published warnings produce a real edit rather than a false no-op.
    desired.caption = sanitizeDeliveryCaption(desired.caption, desired.parseMode,
      options.storedMedia?.sourceUrl || options.storedMedia?.pageUrl || options.storedMedia?.canonicalUrl);
    const desiredJson = serializePresentationSnapshot(desired);
    const diff = comparePresentationSnapshots(storedSnapshot, desired);
    const messageId = firstMessageId(delivery);
    const chatId = delivery.telegramChatId;

    if (!diff.changed) {
      if (!delivery.presentationJson) {
        updates.push({ channelId: delivery.channelId, presentationJson: desiredJson });
      }
      results.push(resultBase(delivery, messageId, diff, {
        edited: false,
        persisted: true,
        skipped: true,
        reason: "unchanged",
        error: null,
      }));
      continue;
    }

    // Telegram has no generic metadata surface for these messages. If custom
    // metadata changed but the rendered caption did not, persist the new state
    // and intentionally avoid a no-op editMessageCaption request.
    if (!diff.captionChanged && !diff.parseModeChanged) {
      updates.push({ channelId: delivery.channelId, presentationJson: desiredJson });
      results.push(resultBase(delivery, messageId, diff, {
        edited: false,
        persisted: true,
        skipped: true,
        reason: "metadata_only",
        error: null,
      }));
      continue;
    }

    if (!chatId || messageId == null) {
      // Backfill the known old state before the global media row is updated so
      // a later retry still sees this destination as stale.
      if (!delivery.presentationJson && storedSnapshot) {
        updates.push({
          channelId: delivery.channelId,
          presentationJson: serializePresentationSnapshot(storedSnapshot),
        });
      }
      results.push(resultBase(delivery, messageId, diff, {
        edited: false,
        persisted: false,
        skipped: true,
        reason: "missing_message",
        error: "Stored delivery does not have a Telegram chat/message id to edit.",
      }));
      continue;
    }

    const edit = await editTelegramMessageCaption({
      botToken: options.botToken,
      chatId,
      messageId,
      caption: desired.caption,
      parseMode: desired.parseMode,
    });
    const alreadyCurrent = !edit.ok && /message is not modified/i.test(edit.description || "");

    if (edit.ok || alreadyCurrent) {
      updates.push({ channelId: delivery.channelId, presentationJson: desiredJson });
      results.push(resultBase(delivery, messageId, diff, {
        edited: edit.ok,
        persisted: true,
        skipped: alreadyCurrent,
        reason: alreadyCurrent ? "telegram_already_current" : "edited",
        error: null,
      }));
      continue;
    }

    if (!delivery.presentationJson && storedSnapshot) {
      updates.push({
        channelId: delivery.channelId,
        presentationJson: serializePresentationSnapshot(storedSnapshot),
      });
    }
    results.push(resultBase(delivery, messageId, diff, {
      edited: false,
      persisted: false,
      skipped: false,
      reason: "edit_failed",
      error: edit.description || "Telegram rejected editMessageCaption.",
    }));
  }

  if (updates.length) {
    await updateDeliveryPresentationSnapshots(options.db, options.mediaKey, updates);
  }

  const previousCaption = options.storedMedia?.caption;
  if (previousCaption && results.length && results.every((result) => result.persisted)) {
    const cleaned = sanitizeDeliveryCaption(previousCaption,
      options.storedMedia?.parseMode === "HTML" || options.storedMedia?.parseMode === "MarkdownV2"
        ? options.storedMedia.parseMode : null,
      options.storedMedia?.sourceUrl || options.storedMedia?.pageUrl || options.storedMedia?.canonicalUrl);
    if (cleaned !== previousCaption) {
      await options.db.prepare(`UPDATE media SET caption = ?2
        WHERE media_key = ?1 AND caption = ?3`).bind(options.mediaKey, cleaned, previousCaption).run();
    }
  }
  return results;
}

export function summarizePresentationSync(results: PresentationSyncResult[]) {
  return {
    compared: results.filter((item) => item.compared).length,
    changed: results.filter((item) => item.changed).length,
    edited: results.filter((item) => item.edited).length,
    metadataOnly: results.filter((item) => item.reason === "metadata_only").length,
    unchanged: results.filter((item) => item.reason === "unchanged").length,
    failed: results.filter((item) => item.reason === "edit_failed" || item.reason === "missing_message" || item.reason === "update_in_progress").length,
  };
}

function firstMessageId(delivery: DeliveryHistoryRecord): number | null {
  const ids = delivery.lastMessageIds.length ? delivery.lastMessageIds : delivery.firstMessageIds;
  return ids.find((value) => Number.isFinite(value)) ?? null;
}

function resultBase(
  delivery: DeliveryHistoryRecord,
  messageId: number | null,
  diff: ReturnType<typeof comparePresentationSnapshots>,
  status: Pick<PresentationSyncResult, "edited" | "persisted" | "skipped" | "reason" | "error">,
): PresentationSyncResult {
  return {
    channelId: delivery.channelId,
    chatId: delivery.telegramChatId,
    messageId,
    compared: true,
    changed: diff.changed,
    captionChanged: diff.captionChanged,
    parseModeChanged: diff.parseModeChanged,
    metadataChanged: diff.metadataChanged,
    metadataAdded: diff.metadataAdded,
    metadataRemoved: diff.metadataRemoved,
    metadataChangedKeys: diff.metadataChangedKeys,
    changes: diff.changes,
    ...status,
  };
}
