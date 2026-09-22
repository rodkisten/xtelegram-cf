# Changelog v2.13.4

## Performance

- Overlapped single-send media preparation with social metadata enrichment.
- Raced X syndication metadata against X HTML metadata and abort the losing request.
- Skipped the redundant HLS `HEAD` probe when the input URL is already an explicit `.m3u8`.
- Downloaded independent HLS video and audio renditions concurrently.
- Parallelized Telegram URL deliveries and bounded Worker-owned upload concurrency.
- Preserved existing D1 idempotency, delivery ordering within each result array, and media-size safety limits.

## Validation

- TypeScript typecheck must pass with `npm run typecheck`.
- No public API contract was intentionally renamed or removed.
