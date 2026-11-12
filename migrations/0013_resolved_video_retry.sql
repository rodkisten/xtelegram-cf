CREATE TABLE IF NOT EXISTS resolved_video_retry (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  last_result_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resolved_video_retry_due ON resolved_video_retry(status, next_attempt_at);
