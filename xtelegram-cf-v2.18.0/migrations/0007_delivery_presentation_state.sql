PRAGMA foreign_keys = ON;

-- Persist the exact presentation payload that was last confirmed on each
-- Telegram destination. This makes caption/metadata reconciliation idempotent
-- per channel: a failed edit remains retryable without resending the media.
ALTER TABLE media_deliveries ADD COLUMN presentation_json TEXT;
ALTER TABLE media_deliveries ADD COLUMN presentation_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_media_deliveries_presentation_updated
  ON media_deliveries(presentation_updated_at DESC);
