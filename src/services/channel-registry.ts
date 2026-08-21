import {
  getTelegramUpdates,
} from "../telegram";
import {
  parseTelegramDestination,
  parseUsernameChannelMap,
  resolveDefaultTelegramChatId,
} from "./channels";
import type { Env } from "../types";

const KNOWN_FALLBACK_DESTINATION = "-1003991698263:65";
const MAX_TELEGRAM_UPDATE_BATCH = 100;
export type { ChannelRegistrySource, ChannelRegistryEntry, RegistryCandidate } from "./channel-registry-utils";
import {
  extractTelegramUpdateCandidates,
  mergeChannelRegistryCandidates,
  parseSources,
  normalizeSource,
  preferredSource,
  type ChannelRegistryEntry,
  type RegistryCandidate,
  type ChannelRegistrySource,
} from "./channel-registry-utils";

interface StoredChannelRegistryRow {
  channel_key: string;
  channel_id: string;
  message_thread_id: number | null;
  name: string | null;
  title: string | null;
  username: string | null;
  source: string;
  sources_json: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface ChannelRegistryResponse {
  ok: true;
  channels: ChannelRegistryEntry[];
  count: number;
  metadata: {
    generatedAt: string;
    fallback: string;
    sources: Record<ChannelRegistrySource, number>;
    telegramApi: {
      attempted: boolean;
      ok: boolean;
      updateCount: number;
      persistedCount: number;
      error: string | null;
    };
    cache: {
      deliveryCount: number;
      registryCount: number;
    };
  };
}

/**
 * Builds a unified Telegram destination registry from configuration, delivery
 * history, persisted API discoveries, and the currently available Bot API
 * updates. No source is allowed to create duplicate channel/topic entries.
 *
 * @example
 * Input: configured `-100123:42` plus a Telegram update for the same topic.
 * Output: one entry keyed by `-100123:42` with merged names and sources.
 */
export async function buildChannelRegistry(
  env: Env,
): Promise<ChannelRegistryResponse> {
  const generatedAt = new Date().toISOString();
  const candidates: RegistryCandidate[] = [];

  addConfiguredCandidates(env, candidates);

  const cacheResult = await readCachedCandidates(env.RELAY_DB, candidates);
  const registryResult = await readStoredRegistry(env.RELAY_DB, candidates);

  let telegramApi = {
    attempted: true,
    ok: false,
    updateCount: 0,
    persistedCount: 0,
    error: null as string | null,
  };

  try {
    const result = await getTelegramUpdates(
      env.TELEGRAM_BOT_TOKEN,
      MAX_TELEGRAM_UPDATE_BATCH,
    );

    if (!result.ok) {
      telegramApi.error = result.description || "Telegram getUpdates failed";
    } else {
      telegramApi.ok = true;
      const updates = result.result || [];
      telegramApi.updateCount = updates.length;

      const discovered = updates.flatMap(extractTelegramUpdateCandidates);
      for (const candidate of discovered) {
        candidates.push(candidate);
      }

      telegramApi.persistedCount = await persistApiCandidates(
        env.RELAY_DB,
        discovered,
      );
    }
  } catch (error) {
    telegramApi.error = error instanceof Error ? error.message : String(error);
  }

  const channels = mergeChannelRegistryCandidates(candidates);
  const sourceCounts = {
    configured: 0,
    cached: 0,
    telegram_api: 0,
  };

  for (const channel of channels) {
    sourceCounts[channel.source] += 1;
  }

  return {
    ok: true,
    channels,
    count: channels.length,
    metadata: {
      generatedAt,
      fallback: KNOWN_FALLBACK_DESTINATION,
      sources: sourceCounts,
      telegramApi,
      cache: {
        deliveryCount: cacheResult,
        registryCount: registryResult,
      },
    },
  };
}

function addConfiguredCandidates(
  env: Env,
  output: RegistryCandidate[],
): void {
  addDestination(output, KNOWN_FALLBACK_DESTINATION, "configured");

  const defaultDestination = resolveDefaultTelegramChatId(env);
  if (defaultDestination) {
    addDestination(output, defaultDestination, "configured");
  }

  const usernameMap = parseUsernameChannelMap(
    env.TELEGRAM_USERNAME_CHANNEL_MAP_JSON,
  );

  for (const destinations of usernameMap.values()) {
    for (const destination of destinations) {
      addDestination(output, destination, "configured");
    }
  }
}

function addDestination(
  output: RegistryCandidate[],
  rawDestination: string,
  source: ChannelRegistrySource,
): void {
  const destination = parseTelegramDestination(rawDestination);
  if (!destination || !/^-?\d+$/.test(destination.chatId)) {
    return;
  }

  output.push({
    key: destination.key,
    channelId: destination.chatId,
    messageThreadId: destination.messageThreadId,
    source,
  });
}

async function readCachedCandidates(
  db: D1Database | undefined,
  output: RegistryCandidate[],
): Promise<number> {
  if (!db) return 0;

  try {
    const result = await db.prepare(
      `SELECT
         channel_id,
         telegram_chat_id,
         message_thread_id,
         telegram_chat_title,
         MAX(last_sent_at) AS last_seen_at
       FROM media_deliveries
       GROUP BY channel_id, telegram_chat_id, message_thread_id
       ORDER BY last_seen_at DESC`,
    ).all<{
      channel_id: string;
      telegram_chat_id: string | null;
      message_thread_id: number | null;
      telegram_chat_title: string | null;
      last_seen_at: string | null;
    }>();

    const rows = result.results || [];
    for (const row of rows) {
      const parsed = parseTelegramDestination(row.channel_id);
      const channelId = String(
        row.telegram_chat_id || parsed?.chatId || "",
      ).trim();

      if (!/^-?\d+$/.test(channelId)) continue;

      const threadId =
        row.message_thread_id ??
        parsed?.messageThreadId ??
        null;
      const key = threadId == null
        ? channelId
        : `${channelId}:${threadId}`;

      output.push({
        key,
        channelId,
        messageThreadId: threadId,
        title: row.telegram_chat_title || null,
        source: "cached",
        firstSeenAt: row.last_seen_at || null,
        lastSeenAt: row.last_seen_at || null,
      });
    }

    return rows.length;
  } catch {
    // /channels remains useful even when an old/missing migration prevents
    // reading the optional cache table.
    return 0;
  }
}

async function readStoredRegistry(
  db: D1Database | undefined,
  output: RegistryCandidate[],
): Promise<number> {
  if (!db) return 0;

  try {
    const result = await db.prepare(
      `SELECT
         channel_key,
         channel_id,
         message_thread_id,
         name,
         title,
         username,
         source,
         sources_json,
         first_seen_at,
         last_seen_at
       FROM telegram_channel_registry
       ORDER BY last_seen_at DESC`,
    ).all<StoredChannelRegistryRow>();

    for (const row of result.results || []) {
      const sources = parseSources(row.sources_json);
      const source = preferredSource(
        sources.length ? sources : [normalizeSource(row.source)],
      );

      output.push({
        key: row.channel_key,
        channelId: row.channel_id,
        messageThreadId: row.message_thread_id,
        name: row.name,
        title: row.title,
        username: row.username,
        source,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
      });
    }

    return result.results?.length || 0;
  } catch {
    // The migration is additive. A deployment that has not applied it yet
    // must not lose configured/cached channel discovery.
    return 0;
  }
}

async function persistApiCandidates(
  db: D1Database | undefined,
  candidates: RegistryCandidate[],
): Promise<number> {
  if (!db || !candidates.length) return 0;

  const unique = mergeChannelRegistryCandidates(candidates);
  if (!unique.length) return 0;

  const now = new Date().toISOString();
  const statements = unique.map((candidate) =>
    db.prepare(
      `INSERT INTO telegram_channel_registry (
         channel_key,
         channel_id,
         message_thread_id,
         name,
         title,
         username,
         source,
         sources_json,
         first_seen_at,
         last_seen_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'telegram_api', ?, ?, ?)
       ON CONFLICT(channel_key) DO UPDATE SET
         name = COALESCE(NULLIF(excluded.name, ''), telegram_channel_registry.name),
         title = COALESCE(NULLIF(excluded.title, ''), telegram_channel_registry.title),
         username = COALESCE(NULLIF(excluded.username, ''), telegram_channel_registry.username),
         source = 'telegram_api',
         sources_json = excluded.sources_json,
         first_seen_at = CASE
           WHEN telegram_channel_registry.first_seen_at < excluded.first_seen_at
             THEN telegram_channel_registry.first_seen_at
           ELSE excluded.first_seen_at
         END,
         last_seen_at = CASE
           WHEN telegram_channel_registry.last_seen_at > excluded.last_seen_at
             THEN telegram_channel_registry.last_seen_at
           ELSE excluded.last_seen_at
         END`,
    ).bind(
      candidate.key,
      candidate.channelId,
      candidate.messageThreadId,
      candidate.name || null,
      candidate.title || null,
      candidate.username || null,
      JSON.stringify(["telegram_api"]),
      candidate.firstSeenAt || now,
      candidate.lastSeenAt || now,
    ),
  );

  await db.batch(statements);
  return unique.length;
}
