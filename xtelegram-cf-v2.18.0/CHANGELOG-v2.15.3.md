# v2.15.3

- CPU-heavy processing is now opt-in.
- Added global `ENABLE_CPU_HEAVY` flag. Default: `false`.
- Added per-request `force_cpu=true` override for JSON, query strings, batch items, resolve-and-send, and multipart payload/form fields.
- Fast mode skips full content hashing, robustness fingerprinting, content-level duplicate scans, HLS download/remux/transmux, and deep video-container dimension parsing.
- Resolver-provided width/height is reused so common social-video paths stay fast while preserving Telegram aspect ratio.
- If dimensions are missing in fast mode, the Worker returns a controlled `cpu_heavy_disabled` response instead of parsing the container.
- If media is HLS in fast mode, the Worker returns a controlled `cpu_heavy_disabled` response before downloading segments.
- `force_cpu=true` re-enables container parsing, HLS processing/transmux, full SHA-256 + fingerprint content identity, and content-level duplicate detection for that request.
- `ENABLE_CPU_HEAVY=true` enables the same behavior globally.
- Existing Worker memory/file-size safety limits remain active even in CPU-heavy mode.
