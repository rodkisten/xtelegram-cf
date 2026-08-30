# v2.15.0

- Added a first-class quality ladder to resolved social media.
- Resolvers preserve every known rendition in `variants[]` instead of discarding lower qualities.
- FxTwitter, Twirrl, TikWM, Piped and yt-dlp formats are collapsed into one logical media item with multiple variants.
- Unknown variant sizes are probed with bounded-concurrency HEAD/Range requests.
- Selection walks highest quality -> lower quality until a rendition fits the effective configured/Telegram upload limit.
- `prepareMedia()` receives the full variant ladder and retries the next lower rendition if the selected CDN file proves larger during the authoritative download.
- Applied hosted Telegram Bot API limits: URL photo 5 MiB, URL other 20 MiB, multipart photo 10 MiB, multipart other/video 50 MiB.
- Videos remain Worker-owned multipart uploads so real width/height can be inspected before `sendVideo`.
- Multipart and Telegram final-send guards now enforce Telegram's per-file ceiling as well as the Worker-configured ceiling.
- `/resolve-and-send` resolution output now exposes all known variants and their discovered sizes for visibility/debugging.
