PRAGMA foreign_keys = ON;

-- Short-lived idempotency claims prevent two concurrent requests from both
-- passing dedupe and producing duplicate Telegram side effects.
CREATE TABLE IF NOT EXISTS delivery_claims (
  media_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (media_key, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_claims_expires
  ON delivery_claims(expires_at);
