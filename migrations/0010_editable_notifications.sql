-- Durable edit-in-place Telegram notification registry.
-- One Telegram message per (chat, topic, logical notification key).
-- A conditional lease prevents concurrent Cloudflare isolates from sending twice.
-- sequence prevents late/out-of-order workflow and job events from overwriting a
-- newer status. A failed Telegram edit does not advance sequence.
CREATE TABLE IF NOT EXISTS notification_messages (
  chat_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL DEFAULT 0,
  notification_key TEXT NOT NULL,
  message_id INTEGER,
  sequence INTEGER NOT NULL DEFAULT -1,
  state TEXT NOT NULL DEFAULT 'processing'
    CHECK (state IN ('processing', 'sent', 'failed')),
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (chat_id, thread_id, notification_key)
);
CREATE INDEX IF NOT EXISTS notification_messages_updated_idx
  ON notification_messages (updated_at);
