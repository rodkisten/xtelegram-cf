PRAGMA foreign_keys = ON;

-- Atomic pre-send reservation. A claim exists only while a request owns the
-- right to perform the external Telegram side effect for media+channel.
CREATE TABLE IF NOT EXISTS delivery_claims (
  media_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (media_key, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_claims_expires_at
  ON delivery_claims(expires_at);
CREATE INDEX IF NOT EXISTS idx_delivery_claims_request
  ON delivery_claims(request_id);
