PRAGMA foreign_keys = ON;

-- Media knowledge is independent from Telegram delivery. A post can be known
-- (and have a caption) before its downloadable media URL has been resolved.
ALTER TABLE media ADD COLUMN caption TEXT;
ALTER TABLE media ADD COLUMN caption_parse_mode TEXT;
ALTER TABLE media ADD COLUMN resolved_media_url TEXT;
ALTER TABLE media ADD COLUMN media_status TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_media_status_updated
  ON media(media_status, updated_at DESC);

-- Rows created by previous versions only existed after a successful Telegram
-- delivery, so backfill them as sent rather than leaving them as pending.
UPDATE media
SET media_status = 'sent'
WHERE EXISTS (
  SELECT 1 FROM media_deliveries d WHERE d.media_key = media.media_key
);
