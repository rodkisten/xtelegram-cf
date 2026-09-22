PRAGMA foreign_keys = ON;

-- Telegram forum topics share one supergroup chat_id. Keep the compact
-- destination key in channel_id for idempotency and persist the parsed topic
-- separately for diagnostics/reconciliation.
ALTER TABLE media_deliveries ADD COLUMN message_thread_id INTEGER;

-- Existing rows were sent without an explicit topic and therefore remain NULL.
-- New rows use channel_id=<chat_id>:<message_thread_id>, so the existing
-- PRIMARY KEY(media_key, channel_id) already deduplicates per chat + topic.
CREATE INDEX IF NOT EXISTS idx_media_deliveries_chat_thread
  ON media_deliveries(telegram_chat_id, message_thread_id, last_sent_at DESC);
