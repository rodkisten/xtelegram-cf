-- Multi-provider X publisher. One logical job per X source, regardless of provider.
-- Reservations count as budget usage even if a provider rejects a request.
CREATE TABLE IF NOT EXISTS x_publish_jobs (
  queue_id TEXT PRIMARY KEY REFERENCES x_repost_queue(id),
  provider TEXT CHECK (provider IN ('buffer', 'zernio', 'x')),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (
    status IN ('ready','submitting','pending','media_processing','published','uncertain','blocked')
  ),
  tried TEXT NOT NULL DEFAULT '',
  remote_id TEXT,
  media_id TEXT,
  post_url TEXT,
  error_code TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS x_publish_jobs_status ON x_publish_jobs(status, next_attempt_at, updated_at);

CREATE TABLE IF NOT EXISTS x_publish_slots (
  queue_id TEXT PRIMARY KEY REFERENCES x_repost_queue(id),
  account_key TEXT NOT NULL DEFAULT 'x-primary',
  reserved_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS x_publish_slots_time ON x_publish_slots(account_key, reserved_at);

CREATE TABLE IF NOT EXISTS x_publish_control (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO x_publish_control(id) VALUES (1);

CREATE TABLE IF NOT EXISTS x_publish_buffer_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS x_publish_buffer_calls_time ON x_publish_buffer_calls(created_at);

CREATE TABLE IF NOT EXISTS x_publish_notifications (
  queue_id TEXT PRIMARY KEY REFERENCES x_repost_queue(id),
  status TEXT NOT NULL CHECK(status IN ('sending','sent','uncertain')),
  provider TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
