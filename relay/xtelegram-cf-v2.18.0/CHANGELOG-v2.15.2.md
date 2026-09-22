# v2.15.2 · Error 1102 resource hardening

- Treats Cloudflare Error 1102 as both a CPU and memory problem.
- Worker-owned direct uploads default to a 16 MiB resource-safe buffer (configurable, hard-capped at 24 MiB).
- The quality ladder uses that effective Worker budget, so it tries the next lower rendition before falling back to the client.
- HLS buffering defaults to 8 MiB (hard cap 12 MiB).
- MPEG-TS -> MP4 transmuxing is disabled by default; it returns the existing controlled client fallback instead of entering mux.js CPU-heavy work.
- Upload delivery to multiple Telegram destinations is serialized to avoid duplicate large multipart buffers in one isolate.
- `/batch` media execution is serialized (concurrency 1) and HLS fetch concurrency is capped at 2 so one request cannot hold several media bodies at once.
- Multipart requests above ~34 MiB are rejected before request.formData() when Content-Length is available; combined file budgets are capped at 32 MiB.
- Resolver-provided video dimensions are trusted before scanning full video buffers, preserving aspect ratio while avoiding unnecessary container parsing.
- Exact content SHA-256 is limited to 2 MiB; bounded fingerprint sampling drops to 2,048 samples.
- Debug is disabled by default. When enabled, normal steps are deterministically sampled at 5%, while failure/error/limit events are always logged.
- MP4/WebM metadata parsing work budgets are reduced. Large videos use bounded 2 MiB head + 4 MiB tail probes instead of a full-file scan/copy.
