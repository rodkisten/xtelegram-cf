-- Durable per-run attempt coordination and terminal tombstones.
CREATE TABLE IF NOT EXISTS github_notify_run_states (
  run_key TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing','active','completed','failed')),
  activity_id TEXT,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS github_notify_run_states_lease_idx ON github_notify_run_states(state, lease_until);
