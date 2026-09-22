import type { ParseMode } from "../types";

export interface PresentationSnapshot {
  caption: string;
  parseMode: ParseMode | null;
  metadata: Record<string, string> | null;
}

export interface PresentationDiff {
  changes: Array<{ field: string; before: string | null; after: string | null }>;
  changed: boolean;
  captionChanged: boolean;
  parseModeChanged: boolean;
  metadataChanged: boolean;
  metadataAdded: string[];
  metadataRemoved: string[];
  metadataChangedKeys: string[];
}

const RELAY_MANAGED_METADATA_KEYS = new Set([
  "socialPlatform",
  "socialOrigin",
  "socialSourceUrl",
  "socialAuthor",
  "socialCaption",
  "socialMetadataStrategy",
  "socialMetadataEnriched",
  "telegramFileId",
  "telegramFileUniqueId",
  "directClientUpload",
]);

export function buildPresentationSnapshot(options: {
  caption: string | null | undefined;
  parseMode: ParseMode | string | null | undefined;
  metadata: Record<string, string> | null | undefined;
}): PresentationSnapshot {
  return {
    caption: normalizeCaption(options.caption),
    parseMode: normalizeParseMode(options.parseMode),
    metadata: normalizePresentationMetadata(options.metadata),
  };
}

export function mergePresentationSnapshot(
  previous: PresentationSnapshot | null,
  patch: {
    caption?: string | null;
    parseMode?: ParseMode | string | null;
    captionProvided: boolean;
    metadata?: Record<string, string> | null;
    metadataProvided: boolean;
  },
): PresentationSnapshot {
  const base = previous || buildPresentationSnapshot({ caption: "", parseMode: null, metadata: null });
  return buildPresentationSnapshot({
    caption: patch.captionProvided ? patch.caption ?? "" : base.caption,
    parseMode: patch.captionProvided ? patch.parseMode ?? null : base.parseMode,
    metadata: patch.metadataProvided ? patch.metadata ?? null : base.metadata,
  });
}

export function serializePresentationSnapshot(snapshot: PresentationSnapshot): string {
  return JSON.stringify({
    caption: snapshot.caption,
    parseMode: snapshot.parseMode,
    metadata: snapshot.metadata,
  });
}

export function parsePresentationSnapshot(value: unknown): PresentationSnapshot | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return buildPresentationSnapshot({
      caption: typeof parsed.caption === "string" ? parsed.caption : "",
      parseMode: typeof parsed.parseMode === "string" ? parsed.parseMode : null,
      metadata: parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
        ? Object.fromEntries(
            Object.entries(parsed.metadata as Record<string, unknown>)
              .filter(([, item]) => item !== null && item !== undefined)
              .map(([key, item]) => [key, String(item)]),
          )
        : null,
    });
  } catch {
    return null;
  }
}

export function comparePresentationSnapshots(
  previous: PresentationSnapshot | null,
  next: PresentationSnapshot,
): PresentationDiff {
  if (!previous) {
    const nextKeys = Object.keys(next.metadata || {});
    return {
      changes: [
        { field: "caption", before: null, after: next.caption },
        ...Object.entries(next.metadata || {}).map(([key, value]) => ({
          field: `metadata.${key}`, before: null, after: value,
        })),
      ],
      changed: true,
      captionChanged: true,
      parseModeChanged: Boolean(next.parseMode),
      metadataChanged: nextKeys.length > 0,
      metadataAdded: nextKeys,
      metadataRemoved: [],
      metadataChangedKeys: [],
    };
  }

  const before = previous.metadata || {};
  const after = next.metadata || {};
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));
  const metadataAdded = [...afterKeys].filter((key) => !beforeKeys.has(key)).sort();
  const metadataRemoved = [...beforeKeys].filter((key) => !afterKeys.has(key)).sort();
  const metadataChangedKeys = [...afterKeys]
    .filter((key) => beforeKeys.has(key) && before[key] !== after[key])
    .sort();
  const captionChanged = previous.caption !== next.caption;
  const parseModeChanged = previous.parseMode !== next.parseMode;
  const metadataChanged = Boolean(
    metadataAdded.length || metadataRemoved.length || metadataChangedKeys.length,
  );

  return {
    changes: [
      ...(captionChanged ? [{ field: "caption", before: previous.caption, after: next.caption }] : []),
      ...(parseModeChanged ? [{ field: "parseMode", before: previous.parseMode, after: next.parseMode }] : []),
      ...[...new Set([...beforeKeys, ...afterKeys])].sort()
        .filter((key) => before[key] !== after[key])
        .map((key) => ({ field: `metadata.${key}`, before: before[key] ?? null, after: after[key] ?? null })),
    ],
    changed: captionChanged || parseModeChanged || metadataChanged,
    captionChanged,
    parseModeChanged,
    metadataChanged,
    metadataAdded,
    metadataRemoved,
    metadataChangedKeys,
  };
}

/**
 * Older media rows stored enriched relay metadata in one JSON object. Remove
 * keys owned exclusively by the relay so the first post-migration comparison
 * approximates the original custom metadata payload instead of producing a
 * false positive from scraper bookkeeping.
 */
export function extractCustomMetadataFromStored(
  metadata: unknown,
): Record<string, string> | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(metadata as Record<string, unknown>)) {
    if (RELAY_MANAGED_METADATA_KEYS.has(key) || key.startsWith("compression_")) continue;
    if (raw === null || raw === undefined || typeof raw === "object") continue;
    output[key] = String(raw);
  }
  return normalizePresentationMetadata(output);
}

function normalizePresentationMetadata(
  metadata: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!metadata) return null;
  const entries = Object.entries(metadata)
    .filter(([key, value]) => Boolean(key) && value !== null && value !== undefined)
    .map(([key, value]) => [String(key), String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? Object.fromEntries(entries) : null;
}

function normalizeCaption(value: string | null | undefined): string {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

function normalizeParseMode(value: ParseMode | string | null | undefined): ParseMode | null {
  return value === "HTML" || value === "MarkdownV2" ? value : null;
}
