import type { ParseMode } from "../types";

export const TELEGRAM_CAPTION_MAX_CHARS = 1024;
export const MAX_HASHTAGS_PER_REQUEST = 40;
export const MAX_HASHTAG_CHARS = 64;

export type HashtagValidationResult =
  | { ok: true; value: string[] }
  | { ok: false; error: string };

/**
 * Accepts either an array or a single comma/whitespace separated string.
 * Values may include or omit the leading #. Invalid hashtag separators are
 * normalized to underscores so `front-end` becomes `#front_end`.
 */
export function normalizeHashtags(value: unknown): HashtagValidationResult {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: [] };
  }

  const values = Array.isArray(value) ? value : [value];
  const tokens: string[] = [];

  for (const entry of values) {
    if (typeof entry !== "string") {
      return { ok: false, error: "hashtags must be a string or an array of strings." };
    }

    for (const part of entry.split(/[\s,]+/u)) {
      const normalized = normalizeHashtagToken(part);
      if (normalized) tokens.push(normalized);
    }
  }

  const hashtags: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const dedupeKey = token.toLocaleLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    hashtags.push(token);

    if (hashtags.length > MAX_HASHTAGS_PER_REQUEST) {
      return {
        ok: false,
        error: `A maximum of ${MAX_HASHTAGS_PER_REQUEST} hashtags can be appended per request.`,
      };
    }
  }

  // Telegram caps captions at 1024 characters. Validate using MarkdownV2,
  // which is the largest representation because # and _ require escaping.
  if (renderHashtagLine(hashtags, "MarkdownV2").length > TELEGRAM_CAPTION_MAX_CHARS) {
    return {
      ok: false,
      error: `The supplied hashtags alone exceed Telegram's ${TELEGRAM_CAPTION_MAX_CHARS}-character caption limit.`,
    };
  }

  return { ok: true, value: hashtags };
}

/**
 * Appends every normalized hashtag while keeping the Telegram caption valid.
 * If caption + hashtags would exceed Telegram's limit, the base caption is
 * shortened first. Formatting is only dropped in that overflow case so we
 * never cut an HTML/Markdown entity in half.
 */
export function appendHashtagsToCaption(
  caption: string,
  hashtags: string[],
  parseMode: ParseMode | null,
): { caption: string; parseMode: ParseMode | null } {
  if (!hashtags.length) return { caption, parseMode };

  const base = caption.trim();
  const renderedLine = renderHashtagLine(hashtags, parseMode);
  const separator = base ? "\n\n" : "";
  const combined = `${base}${separator}${renderedLine}`;

  if (combined.length <= TELEGRAM_CAPTION_MAX_CHARS) {
    return { caption: combined, parseMode };
  }

  // Preserve all requested hashtags. If the formatted caption has to be
  // shortened, convert only the base text to plain text before slicing so a
  // partially-cut HTML tag or Markdown escape cannot make Telegram reject it.
  const plainTags = renderHashtagLine(hashtags, null);
  const plainBase = stripFormatting(base, parseMode);
  const available = Math.max(
    0,
    TELEGRAM_CAPTION_MAX_CHARS - plainTags.length - (plainBase ? 2 : 0),
  );
  const fittedBase = truncateCodePoints(plainBase, available);

  return {
    caption: fittedBase ? `${fittedBase}\n\n${plainTags}` : plainTags,
    parseMode: null,
  };
}

export function renderHashtagLine(
  hashtags: string[],
  parseMode: ParseMode | null,
): string {
  if (!hashtags.length) return "";

  if (parseMode === "MarkdownV2") {
    return hashtags
      .map((tag) => `\\#${tag.replace(/_/g, "\\_")}`)
      .join(" ");
  }

  return hashtags.map((tag) => `#${tag}`).join(" ");
}

function normalizeHashtagToken(value: string): string {
  let token = value.normalize("NFKC").trim().replace(/^#+/u, "");
  if (!token) return "";

  token = token
    .replace(/[^\p{L}\p{M}\p{N}_]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_");

  if (!token) return "";
  return Array.from(token).slice(0, MAX_HASHTAG_CHARS).join("");
}

function stripFormatting(value: string, parseMode: ParseMode | null): string {
  if (!value || !parseMode) return value;

  if (parseMode === "HTML") {
    return decodeBasicHtmlEntities(value.replace(/<[^>]*>/g, ""));
  }

  return value
    .replace(/\\([_*\[\]()~`>#+\-=|{}.!])/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'");
}

function truncateCodePoints(value: string, maximum: number): string {
  if (maximum <= 0) return "";
  const points = Array.from(value.trim());
  if (points.length <= maximum) return points.join("");
  if (maximum === 1) return "…";
  return `${points.slice(0, maximum - 1).join("").trimEnd()}…`;
}
