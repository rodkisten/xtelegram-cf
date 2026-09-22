PRAGMA foreign_keys = ON;

-- Persistent registry for Telegram destinations discovered from Bot API updates.
-- The compact channel_key is the canonical dedupe key: <channel_id> or
-- <channel_id>:<message_thread_id>.
CREATE TABLE IF NOT EXISTS telegram_channel_registry (
  channel_key TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_thread_id INTEGER,
  name TEXT,
  title TEXT,
  username TEXT,
  source TEXT NOT NULL DEFAULT 'telegram_api',
  sources_json TEXT NOT NULL DEFAULT '["telegram_api"]',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_channel_registry_channel
  ON telegram_channel_registry(channel_id);

CREATE INDEX IF NOT EXISTS idx_telegram_channel_registry_last_seen
  ON telegram_channel_registry(last_seen_at DESC);
