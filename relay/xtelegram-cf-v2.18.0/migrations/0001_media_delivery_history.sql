PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media (
  media_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_media_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  source_url TEXT,
  page_url TEXT,
  media_type TEXT NOT NULL,
  media_count INTEGER NOT NULL DEFAULT 1 CHECK (media_count >= 1),
  metadata_json TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_provider_id
  ON media(provider, provider_media_id);
CREATE INDEX IF NOT EXISTS idx_media_canonical_url
  ON media(canonical_url);
CREATE INDEX IF NOT EXISTS idx_media_updated_at
  ON media(updated_at DESC);

CREATE TABLE IF NOT EXISTS media_deliveries (
  media_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  telegram_chat_id TEXT,
  telegram_chat_title TEXT,
  first_message_ids_json TEXT NOT NULL DEFAULT '[]',
  last_message_ids_json TEXT NOT NULL DEFAULT '[]',
  send_count INTEGER NOT NULL DEFAULT 1 CHECK (send_count >= 1),
  first_sent_at TEXT NOT NULL,
  last_sent_at TEXT NOT NULL,
  PRIMARY KEY (media_key, channel_id),
  FOREIGN KEY (media_key) REFERENCES media(media_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_media_deliveries_channel
  ON media_deliveries(channel_id, last_sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_deliveries_last_sent
  ON media_deliveries(last_sent_at DESC);
