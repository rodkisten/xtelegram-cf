# v2.16.0 — zero-buffer fast path

- Fast mode no longer downloads ordinary remote media into Worker memory.
- Single videos with resolver-provided width/height use Telegram URL delivery directly.
- If the selected video is above Telegram's remote URL ceiling, the resolver quality ladder walks downward until a rendition fits.
- If no remote rendition fits, fast mode returns a controlled `cpu_heavy_disabled` response instead of buffering the file and risking Error 1102.
- `force_cpu=true` keeps the existing Worker-owned multipart path for exceptional cases.
- Album fast mode no longer silently falls back to multipart buffering after a remote URL rejection.
- Album URL delivery now forwards resolver-provided video width/height.
- Reduced warm-isolate social metadata cache from 500 to 128 entries.

The key invariant is now: `ENABLE_CPU_HEAVY=false` means no full remote-media buffering in the normal social-video path.
