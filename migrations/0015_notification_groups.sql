CREATE TABLE IF NOT EXISTS notification_group_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 chat_id TEXT NOT NULL,
 thread_id INTEGER NOT NULL DEFAULT 0,
 group_key TEXT NOT NULL,
 event_key TEXT NOT NULL,
 title TEXT NOT NULL,
 detail TEXT NOT NULL,
 severity TEXT NOT NULL,
 created_at INTEGER NOT NULL DEFAULT (unixepoch()),
 UNIQUE(chat_id, thread_id, group_key, event_key)
);
CREATE INDEX IF NOT EXISTS notification_group_lookup ON notification_group_events(chat_id, thread_id, group_key, id);
