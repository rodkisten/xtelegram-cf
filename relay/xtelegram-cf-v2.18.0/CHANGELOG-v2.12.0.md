# v2.12.0

- Added optional `username` / `usernames` routing to every Telegram send path.
- Added `TELEGRAM_USERNAME_CHANNEL_MAP_JSON` for server-side username-to-chat routing.
- Mapping keys are case-insensitive and may contain comma-separated usernames.
- Explicit `channel` / `channels` and mapped chats are merged and deduplicated before delivery claims and Telegram side effects.
- Batch, resolve-and-send, single media, albums, multipart uploads and media/check now understand username routing.
- `media/check` keeps routing optional and preserves its read-all-deliveries behavior when no channel/username routing is supplied.
- Migrated Wrangler configuration from `wrangler.jsonc` to `wrangler.toml` and added a routing example.
