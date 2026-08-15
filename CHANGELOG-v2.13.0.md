# v2.13.0 — Telegram forum topic routing

- Added compact Telegram destination syntax `<chat_id>:<message_thread_id>`.
- Kept `<chat_id>` and `@channel` destinations backwards-compatible.
- Username routing JSON now accepts topic destinations.
- Deduplication and delivery claims use the full destination key, so topics in the same supergroup are independent.
- `sendVideo`, `sendPhoto`, `sendAudio`, `sendDocument`, `sendMediaGroup`, URL sends, multipart uploads, album fallbacks, and ordered single fallbacks forward `message_thread_id` when configured.
- Added D1 migration `0004_message_thread_id.sql` and persistence of `message_thread_id` alongside Telegram chat/message IDs.
- Caption reconciliation remains topic-aware through the persisted delivery identity. Telegram `editMessageCaption` does not accept `message_thread_id`; the stored `chat_id + message_id` identifies the exact message.
- Updated `wrangler.toml` with topic-routing examples and retained the existing username mappings.
