# v2.18.0 — presentation de-para + Telegram edit

## What changed

- Added per-delivery presentation snapshots in D1 (`presentation_json`, `presentation_updated_at`).
- Duplicate requests with explicit custom caption, hashtags, or metadata now compare the new presentation against the last confirmed state for each Telegram destination.
- `editMessageCaption` runs only when the rendered caption or parse mode is actually different.
- Metadata-only changes update D1/presentation state without issuing a Telegram no-op edit.
- Failed Telegram edits do not advance that channel's presentation snapshot, so a later retry remains eligible.
- Legacy delivery rows with no snapshot use the existing media caption/metadata as the comparison baseline and are backfilled safely.
- New sends persist the presentation snapshot together with the Telegram delivery.
- Reconciliation is wired into single sends, albums, multipart uploads, `/media/check`, and idempotent `/media/register` retries.
- `force=true` keeps its existing resend semantics and bypasses presentation edit reconciliation.

## API response

Presentation reconciliation responses include a summary:

```json
{
  "presentation": {
    "compared": 1,
    "changed": 1,
    "edited": 1,
    "metadataOnly": 0,
    "unchanged": 0,
    "failed": 0
  }
}
```

Per-destination `presentationResults` expose whether caption, parse mode, or metadata changed and which metadata keys were added, removed, or changed.

## Migration

Apply before deploying this version:

```bash
npm run db:migrate:remote
```

Migration file: `migrations/0007_delivery_presentation_state.sql`.
