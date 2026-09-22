# v2.13.0

- Added resolver registry for Twitter/X, TikTok, Reddit and Instagram.
- Twitter/X fallback chain: FxTwitter -> VXTwitter -> Twirrl -> DTwitter -> configured Cobalt -> configured yt-dlp service.
- TikTok fallback chain: TikWM -> DTikTok -> configured Cobalt -> configured yt-dlp service.
- Reddit fallback chain: native Reddit JSON/reddit_video/gallery -> configured Cobalt -> configured yt-dlp service.
- Instagram keeps ZoraaHub and gains configured Cobalt/yt-dlp fallbacks.
- Added normalized author/caption metadata and richer media variants with contentLength/bitrate.
- TikWM keeps HD and SD variants so the existing relay size-selection path can choose a smaller file.
- Cobalt is opt-in via COBALT_API_URL because the upstream project explicitly does not provide a public hosted API for integrations.
- yt-dlp is opt-in via YTDLP_API_URL because binaries cannot execute inside a Cloudflare Worker.
- Existing Twirrl, DTwitter, DTikTok and ZoraaHub behavior remains available.
