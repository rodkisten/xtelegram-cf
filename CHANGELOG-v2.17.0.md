# v2.17.0 — iOS direct-upload fallback

- Adds authenticated `POST /media/register` so Telegram deliveries performed outside the Worker can be reconciled into the existing D1 media/delivery history.
- Extends controlled limit responses with a complete client fallback contract:
  - resolved download URL;
  - required media headers;
  - all known quality variants and sizes;
  - configurable client compression target;
  - caption / parse mode / provider / media identity / destination metadata;
  - `/media/register` endpoint hint.
- Adds `CLIENT_COMPRESS_TARGET_BYTES` (default `47000000`) for a safe direct Bot API upload target.
- Keeps CPU-heavy Worker processing disabled by default. `force_cpu=true` is still supported as an explicit per-request override.
- The intended oversized-video flow is now CDN -> a-Shell/FFmpeg -> Telegram directly, followed by a tiny `/media/register` reconciliation call. Large media bytes do not return through Cloudflare.
- `/media/register` is retry-safe for the same media/channel/message id and stores Telegram `file_id` / `file_unique_id` in metadata when supplied.
- No D1 migration is required.
