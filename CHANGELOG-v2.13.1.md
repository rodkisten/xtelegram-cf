# v2.13.1

- Added YouTube to the unified social resolver registry.
- YouTube chain: YouTube oEmbed metadata -> Piped `/streams/:videoId` -> configured Cobalt -> configured yt-dlp service.
- Supports `youtube.com/watch`, `youtu.be`, `/shorts/`, `/embed/` and `/live/` URLs.
- Piped defaults to `https://pipedapi.kavin.rocks` and can be overridden with `PIPED_API_URL`.
- Piped contributes only muxed/progressive video streams; adaptive video-only tracks are intentionally skipped so Telegram never receives a silent/incomplete video.
- YouTube metadata from oEmbed/Piped is preserved while the registry continues looking for usable media.
- YouTube/Googlevideo CDN requests receive a YouTube Referer header.
