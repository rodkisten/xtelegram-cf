-- X repost queue: preparation and confirmation happen on the iPhone, not via X's API.
-- Deliberately separate from Telegram deliveries, so existing history and dedupe remain untouched.
CREATE TABLE IF NOT EXISTS x_repost_queue (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  media_object_key TEXT,
  telegram_message_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'claimed', 'posted', 'cancelled')),
  scheduled_at INTEGER NOT NULL,
  notified_at INTEGER,
  claimed_at INTEGER,
  lease_until INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  post_url TEXT,
  posted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS x_repost_queue_due_idx
  ON x_repost_queue (status, scheduled_at, lease_until);
CREATE INDEX IF NOT EXISTS x_repost_queue_created_idx
  ON x_repost_queue (created_at DESC);
