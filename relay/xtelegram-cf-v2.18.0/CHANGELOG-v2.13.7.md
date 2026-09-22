# v2.13.7

## Added

- Added authenticated `GET /channels`.
- Added a unified Telegram channel/topic registry combining:
  - the configured fallback `-1003991698263:65`;
  - configured default and username-map destinations;
  - destinations already present in D1 delivery history;
  - destinations persisted from Telegram Bot API updates;
  - currently available `getUpdates` data.
- Forum topics are represented by `channel_id:message_thread_id` and use
  `forum_topic_created.name` as the preferred topic name.
- Registry entries expose `source`, merged `sources`, channel/title/username
  metadata, and cache/API diagnostics for Apple Shortcuts.
- Added a persistent D1 registry migration for Telegram API discoveries.

## Improved

- When an X/Twitter video is detected above the Worker upload budget and is
  also above the medium-quality fallback threshold, the relay now asks Twirrl
  for another variant and attempts the medium-quality URL.
- The fallback still parses the actual downloaded container dimensions before
  sending, preserving the aspect-ratio protection introduced in v2.13.6.
- If the medium variant cannot be downloaded safely within the configured
  Worker budget, the original failure path is retained.
