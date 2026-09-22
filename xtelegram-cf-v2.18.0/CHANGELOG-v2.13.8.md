# v2.13.8

## Improved

- Persisted Telegram delivery records now surface the exact `channelId`,
  `telegramChatId`, `messageThreadId`, and Telegram `messageIds` when a duplicate
  media delivery is skipped.
- Duplicate detection reuses the same atomic D1 delivery lookup used by the
  delivery claim, avoiding an additional database round trip on the hot path.
- Single-media and album responses now expose a `duplicates` array suitable for
  Scriptable, Shortcuts, and other clients.
- Forced resends still bypass duplicate blocking, while retaining the previous
  delivery metadata in the claim result for future response/observability use.

## Compatibility

- No migration is required. The implementation reuses the existing
  `media_deliveries` message-id/channel persistence introduced by the relay's
  existing delivery history schema.
