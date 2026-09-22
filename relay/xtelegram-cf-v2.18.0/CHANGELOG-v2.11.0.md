# v2.11.0 — Caption-first media reconciliation

## Added

- Persist media knowledge independently from Telegram delivery.
- Media lifecycle: `pending` → `ready` → `sent`.
- Persist `caption`, caption parse mode, resolved media URL and lifecycle status in D1.
- `POST /media/check` can now receive `caption`, `parseMode` and `metadata` on each item.
- A caption received before a media URL creates/updates a pending media record.
- If the media was already delivered, `/media/check` updates its Telegram caption through `editMessageCaption` using the stored chat/message IDs.
- Existing delivery history is backfilled to `sent` by migration `0003_caption_pending_media.sql`.
- Single-media resolution is persisted as `ready` before the Telegram side effect, so failed sends remain resumable.

## Changed

- Explicit caller captions are authoritative. Social metadata enrichment is only used when no caption was supplied.
- Successful Telegram sends now persist the final caption, parse mode and resolved media URL together with delivery IDs.
