CREATE TABLE IF NOT EXISTS notification_retention (
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  delete_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS notification_retention_due ON notification_retention(status, delete_at);
