CREATE TABLE IF NOT EXISTS github_notify_activities (
  run_key TEXT PRIMARY KEY NOT NULL,
  activity_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);