-- Zernio submissions are isolated from Telegram delivery and the pre-existing X queue.
-- A queue item may have at most one submission per platform, regardless of retries.
-- In-flight and uncertain outcomes block all automated resubmission.
CREATE TABLE IF NOT EXISTS x_repost_zernio_submissions (
  queue_id TEXT NOT NULL REFERENCES x_repost_queue(id),
  platform TEXT NOT NULL CHECK (platform IN ('twitter', 'instagram')),
  account_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preparing'
    CHECK (status IN (
      'preparing', 'failed_preflight', 'submitting', 'uncertain',
      'scheduled', 'publishing', 'published', 'failed'
    )),
  remote_post_id TEXT,
  platform_post_url TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(queue_id, platform),
  UNIQUE(idempotency_key)
);
CREATE INDEX IF NOT EXISTS x_repost_zernio_status_idx
  ON x_repost_zernio_submissions(status, updated_at);
