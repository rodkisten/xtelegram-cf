-- One rerun request per GitHub run, preventing double-taps and repeated callbacks.
CREATE TABLE IF NOT EXISTS github_rerun_requests (
  run_id TEXT PRIMARY KEY,
  repository TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
