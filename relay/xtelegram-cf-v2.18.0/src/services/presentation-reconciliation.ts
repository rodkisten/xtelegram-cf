import {
  checkStoredMediaDeliveries,
  type MediaIdentity,
} from "../db";
import type { Env, ParseMode } from "../types";
import {
  reconcileTelegramPresentation,
  summarizePresentationSync,
  type PresentationSyncResult,
} from "./media-presentation-sync";

export interface PresentationReconciliation {
  results: PresentationSyncResult[];
  summary: ReturnType<typeof summarizePresentationSync>;
}

export async function reconcileExistingMediaPresentation(options: {
  db: D1Database;
  env: Env;
  identity: MediaIdentity;
  channels: string[];
  caption: string;
  captionProvided: boolean;
  parseMode: ParseMode | null;
  metadata: Record<string, string> | null;
  metadataProvided: boolean;
}): Promise<PresentationReconciliation> {
  if (!options.channels.length) {
    const results: PresentationSyncResult[] = [];
    return { results, summary: summarizePresentationSync(results) };
  }

  const records = await checkStoredMediaDeliveries(
    options.db,
    [options.identity],
    options.channels,
  );
  const record = records.get(options.identity.key) || [...records.values()][0];
  if (!record?.deliveries.length) {
    const results: PresentationSyncResult[] = [];
    return { results, summary: summarizePresentationSync(results) };
  }

  const requested = new Set(options.channels);
  const deliveries = record.deliveries.filter((delivery) => requested.has(delivery.channelId));
  const results = await reconcileTelegramPresentation({
    db: options.db,
    mediaKey: record.media.key || options.identity.key,
    botToken: options.env.TELEGRAM_BOT_TOKEN,
    caption: options.caption,
    parseMode: options.parseMode,
    captionProvided: options.captionProvided,
    metadata: options.metadata,
    metadataProvided: options.metadataProvided,
    storedMedia: record.media,
    deliveries,
  });

  return { results, summary: summarizePresentationSync(results) };
}
