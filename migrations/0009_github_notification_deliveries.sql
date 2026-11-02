-- GitHub webhook retry/dedup registry.
-- Re-deliveries for successful X-GitHub-Delivery IDs are ignored.
CREATE TABLE IF NOT EXISTS github_notification_deliveries (
  delivery_id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL DEFAULT 'processing' CHECK (state IN ('processing', 'sent', 'failed')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS github_notification_deliveries_updated_idx
  ON github_notification_deliveries (updated_at);
