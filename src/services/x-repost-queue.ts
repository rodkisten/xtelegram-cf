import type { Env } from "../types";

export type XRepostStatus = "queued" | "claimed" | "posted" | "cancelled";

export interface XRepostItem {
  id: string;
  source_key: string;
  source_url: string;
  caption: string;
  media_url: string | null;
  media_object_key: string | null;
  telegram_message_url: string | null;
  status: XRepostStatus;
  scheduled_at: number;
  notified_at: number | null;
  claimed_at: number | null;
  lease_until: number;
  claim_token: string | null;
  post_url: string | null;
  posted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface XRepostEnqueueInput {
  sourceUrl: string;
  caption?: string;
  hashtags?: string[] | string;
  mediaUrl?: string | null;
  telegramMessageUrl?: string | null;
  scheduledAt?: number | null;
}

const MIN_DELAY_SECONDS = 10 * 60;
const MIN_SPACING_SECONDS = 45 * 60;
const MAX_SPACING_SECONDS = 75 * 60;
const CLAIM_SECONDS = 2 * 60 * 60;
const MAX_CAPTION_CHARS = 280;
const SOURCE_PATTERN = /^\/(?:([A-Za-z0-9_]{1,15})\/status|i\/status)\/(\d+)(?:\/.*)?$/i;

export function identifyXSource(value: string): { key: string; url: string } | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.protocol !== "https:" || !["x.com", "twitter.com", "mobile.twitter.com"].includes(host)) {
      return null;
    }
    const match = url.pathname.match(SOURCE_PATTERN);
    if (!match) return null;
    return {
      key: `x:${match[2]}`,
      url: match[1] ? `https://x.com/${match[1]}/status/${match[2]}`
        : `https://x.com/i/status/${match[2]}`,
    };
  } catch {
    return null;
  }
}

/**
 * Clean captions for reposting without changing original Telegram delivery text.
 * Keep existing @/user credits as literal text; remove active @user mentions,
 * links and "Abrir no X". Preserve other hashtags and finish with exactly one
 * #dorkis10. This is idempotent, including for captions already stored in D1.
 */
export function sanitizeRepostCaption(
  text: string,
  hashtags: string[] | string = [],
  maxChars = MAX_CAPTION_CHARS,
): string {
  const entities: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  };
  const cleaned = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/(?:p|div|li|section)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, entity: string) => {
      if (entity[0] !== "#") return entities[entity.toLowerCase()] ?? full;
      const hex = entity[1]?.toLowerCase() === "x";
      const point = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : full;
    })
    // Keep Markdown link labels (except the banned CTA), discard their destinations.
    .replace(/\[([^\]]+)\]\(\s*(?:https?:\/\/|www\.)[^)\s]+\s*\)/gi, "$1")
    .replace(/\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"'“”]+/gi, "")
    .replace(/\b(?:mailto:)?[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "")
    // Also remove bare-domain links such as x.com/user/status/123 or t.co/abc.
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,24}(?::\d+)?(?:\/[^\s<>"'“”]*)?/gi, "")
    // Existing @/credits are NOT active mentions and must survive unchanged.
    .replace(/(^|[^\w/@])@[a-z0-9_]{1,30}(?![\w/])/gi, "$1")
    .replace(/^[ \t]*(?:🔗[ \t]*)?abrir\s+no\s+x[ \t]*:?[ \t]*$/gim, "")
    .replace(/\babrir\s+no\s+x\b[ \t]*:?[ \t]*/gi, "")
    // Remove earlier instances so the default hashtag appears just once at the end.
    .replace(/#dorkis10(?![\p{L}\p{N}_])/giu, "")
    .replace(/^[ \t]*(?:créditos?|credits?|via)\s*:\s*$/gim, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Move an existing optional-tag paragraph back into the suffix before rebuilding it.
  // Without this, a second pass moves #dorkis10 to its own paragraph.
  const suffixMatch = cleaned.match(/(?:^|\\n\\n)(#[\\p{L}\\p{N}_]+(?: #[\\p{L}\\p{N}_]+)*)$/u);
  const preservedTags = suffixMatch ? suffixMatch[1].split(" ") : [];
  const bodyText = suffixMatch ? cleaned.slice(0, suffixMatch.index).trimEnd() : cleaned;
  const requestedTags = Array.isArray(hashtags) ? hashtags : String(hashtags).split(/[\\s,;]+/);
  const candidates = [...preservedTags, ...requestedTags];
  const existing = new Set(Array.from(bodyText.matchAll(/#[\p{L}\p{N}_]+/gu),
    match => match[0].toLocaleLowerCase()));
  const appended: string[] = [];
  let suffixLength = Array.from("#dorkis10").length;

  for (const raw of candidates) {
    const candidate = String(raw || "").trim().replace(/^#+/, "");
    if (!candidate || !/^[\p{L}\p{N}_]+$/u.test(candidate)) continue;
    const hashtag = "#" + candidate;
    const normalized = hashtag.toLocaleLowerCase();
    if (normalized === "#dorkis10" || existing.has(normalized)) continue;
    const additional = Array.from(hashtag).length + 1; // space before the default tag
    if (suffixLength + additional > maxChars) continue;
    existing.add(normalized);
    appended.push(hashtag);
    suffixLength += additional;
  }

  const suffix = [...appended, "#dorkis10"].join(" ");
  const allowed = Math.max(0, Math.floor(maxChars) - Array.from(suffix).length - (bodyText ? 2 : 0));
  const sourceChars = Array.from(bodyText);
  const body = sourceChars.length > allowed
    ? sourceChars.slice(0, Math.max(0, allowed - 1)).join("").trimEnd() + (allowed ? "…" : "")
    : cleaned;
  return [body, suffix].filter(Boolean).join("\n\n");
}

export function transformXRepostCaption(text: string, hashtags: string[] | string = []): string {
  return sanitizeRepostCaption(text, hashtags);
}

function publicMediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function repostDb(env: Env): D1Database {
  if (!env.RELAY_DB) throw new Error("Missing RELAY_DB binding.");
  return env.RELAY_DB;
}

export async function enqueueXRepost(env: Env, input: XRepostEnqueueInput): Promise<XRepostItem> {
  const source = identifyXSource(input.sourceUrl);
  if (!source) throw new Error("A public X/Twitter status URL is required.");
  const db = repostDb(env);
  const now = Math.floor(Date.now() / 1000);
  const requested = Number(input.scheduledAt);
  const earliest = Math.max(now + MIN_DELAY_SECONDS, Number.isFinite(requested) && requested > 0
    ? Math.floor(requested) : now + MIN_DELAY_SECONDS);
  const last = await db.prepare(
    "SELECT MAX(scheduled_at) AS last_at FROM x_repost_queue WHERE status IN ('queued', 'claimed')"
  ).first<{ last_at: number | null }>();
  const spacing = MIN_SPACING_SECONDS + Math.floor(
    Math.random() * (MAX_SPACING_SECONDS - MIN_SPACING_SECONDS + 1)
  );
  const scheduledAt = Math.max(earliest, (Number(last?.last_at) || now) + spacing);
  const id = crypto.randomUUID();
  const caption = transformXRepostCaption(input.caption || "", input.hashtags);
  const mediaUrl = publicMediaUrl(input.mediaUrl);
  const telegramUrl = publicMediaUrl(input.telegramMessageUrl);

  await db.prepare(`
    INSERT INTO x_repost_queue
      (id, source_key, source_url, caption, media_url, telegram_message_url, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      media_url = COALESCE(x_repost_queue.media_url, excluded.media_url),
      telegram_message_url = COALESCE(x_repost_queue.telegram_message_url, excluded.telegram_message_url),
      caption = CASE WHEN x_repost_queue.caption = '' AND x_repost_queue.status = 'queued'
        THEN excluded.caption ELSE x_repost_queue.caption END,
      updated_at = unixepoch()
  `).bind(id, source.key, source.url, caption, mediaUrl, telegramUrl, scheduledAt).run();

  const row = await db.prepare("SELECT * FROM x_repost_queue WHERE source_key = ?")
    .bind(source.key).first<XRepostItem>();
  if (!row) throw new Error("Could not enqueue X repost.");
  return { ...row, caption: transformXRepostCaption(row.caption) };
}

export async function listXReposts(
  env: Env,
  status: XRepostStatus | null = null,
  limit = 30,
): Promise<XRepostItem[]> {
  const db = repostDb(env);
  const count = Math.min(100, Math.max(1, Math.floor(limit) || 30));
  const query = status
    ? db.prepare("SELECT * FROM x_repost_queue WHERE status = ? ORDER BY scheduled_at ASC LIMIT ?")
        .bind(status, count)
    : db.prepare("SELECT * FROM x_repost_queue ORDER BY created_at DESC LIMIT ?").bind(count);
  return (await query.all<XRepostItem>()).results.map(row => ({
    ...row,
    caption: transformXRepostCaption(row.caption),
  }));
}

export async function claimDueXRepost(env: Env): Promise<XRepostItem | null> {
  const db = repostDb(env);
  const now = Math.floor(Date.now() / 1000);
  const token = crypto.randomUUID();
  const result = await db.prepare(`
    UPDATE x_repost_queue SET
      status = 'claimed', claimed_at = ?, claim_token = ?, lease_until = ?, updated_at = ?
    WHERE id = (
      SELECT id FROM x_repost_queue
      WHERE (status = 'queued' OR (status = 'claimed' AND lease_until < ?))
        AND scheduled_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM x_publish_jobs j WHERE j.queue_id=x_repost_queue.id
            AND j.status NOT IN ('blocked')
        )
        AND NOT EXISTS (
          SELECT 1 FROM x_repost_zernio_submissions z
          WHERE z.queue_id = x_repost_queue.id AND z.platform = 'twitter'
            AND z.status NOT IN ('failed_preflight', 'failed')
        )
      ORDER BY scheduled_at ASC
      LIMIT 1
    )
    RETURNING *
  `).bind(now, token, now + CLAIM_SECONDS, now, now, now).first<XRepostItem>();
  return result ? { ...result, caption: transformXRepostCaption(result.caption) } : null;
}

export async function transitionXRepost(
  env: Env,
  id: string,
  action: "posted" | "release" | "cancel" | "reschedule",
  claimToken?: string,
  postUrl?: string,
  scheduledAt?: number,
): Promise<XRepostItem | null> {
  const db = repostDb(env);
  const now = Math.floor(Date.now() / 1000);
  const safeId = String(id || "").trim();
  if (!safeId) return null;

  if (action === "posted" || action === "release") {
    if (!claimToken) return null;
    const post = action === "posted" ? "posted" : "queued";
    const url = action === "posted" && identifyXSource(postUrl || "") ? String(postUrl) : null;
    return (await db.prepare(`
      UPDATE x_repost_queue SET
        status = ?, post_url = ?, posted_at = ?, claim_token = NULL, lease_until = 0,
        updated_at = ?, notified_at = CASE WHEN ? = 'queued' THEN NULL ELSE notified_at END
      WHERE id = ? AND status = 'claimed' AND claim_token = ?
      RETURNING *
    `).bind(post, url, action === "posted" ? now : null, now, post, safeId, claimToken)
      .first<XRepostItem>()) || null;
  }

  if (action === "cancel") {
    return (await db.prepare(`
      UPDATE x_repost_queue SET
        status = 'cancelled', claim_token = NULL, lease_until = 0, updated_at = ?
      WHERE id = ? AND status IN ('queued', 'claimed')
      RETURNING *
    `).bind(now, safeId).first<XRepostItem>()) || null;
  }

  const requested = Number(scheduledAt);
  if (!Number.isFinite(requested) || requested < now + MIN_DELAY_SECONDS) {
    throw new Error("scheduledAt must be at least 10 minutes in the future.");
  }
  return (await db.prepare(`
    UPDATE x_repost_queue SET
      status = 'queued', scheduled_at = ?, notified_at = NULL,
      claim_token = NULL, lease_until = 0, updated_at = ?
    WHERE id = ? AND status IN ('queued', 'claimed')
    RETURNING *
  `).bind(Math.floor(requested), now, safeId).first<XRepostItem>()) || null;
}
