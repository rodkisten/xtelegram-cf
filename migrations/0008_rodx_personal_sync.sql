PRAGMA foreign_keys = ON;

-- Personal RodX data is NOT authorized with the shared RELAY_TOKEN.
CREATE TABLE IF NOT EXISTS rodx_users (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS rodx_tokens (
  token_sha256 TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES rodx_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rodx_tokens_user ON rodx_tokens(user_id);

CREATE TABLE IF NOT EXISTS rodx_snapshots (
  user_id TEXT NOT NULL REFERENCES rodx_users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  data_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, account)
);
CREATE TABLE IF NOT EXISTS rodx_history (
  user_id TEXT NOT NULL REFERENCES rodx_users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  query_sha256 TEXT NOT NULL,
  query TEXT NOT NULL,
  sort TEXT NOT NULL DEFAULT 'top',
  source TEXT NOT NULL DEFAULT 'search',
  first_used INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, account, query_sha256)
);
CREATE INDEX IF NOT EXISTS idx_rodx_history_recent ON rodx_history(user_id, account, last_used DESC);
CREATE TABLE IF NOT EXISTS rodx_seen (
  user_id TEXT NOT NULL REFERENCES rodx_users(id) ON DELETE CASCADE,
  account TEXT NOT NULL,
  tweet_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, account, tweet_id)
);
CREATE INDEX IF NOT EXISTS idx_rodx_seen_recent ON rodx_seen(user_id, account, seen_at DESC);
