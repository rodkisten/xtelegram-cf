# v2.14.0

## Video geometry invariant

- Telegram video delivery is now fail-closed at the final transport boundary.
- `sendVideo`, video uploads and `sendMediaGroup` refuse any video without valid `width` and `height`.
- MP4 rotation parsing now tolerates fixed-point rounding/scaling in the track transform matrix instead of requiring exact matrix values.
- WebM/Matroska now prefers `DisplayWidth` / `DisplayHeight` when present instead of blindly using encoded pixel dimensions.
- Social resolver `width` / `height` values are propagated into `/send` as geometry hints.
- Worker-parsed dimensions remain authoritative; resolver hints only repair a reciprocal aspect-ratio mismatch (the classic missed 90/270-degree rotation case) or provide a fallback when the container parser cannot determine dimensions.

## Caption invariant

- Every delivery with an original `sourceUrl` / `pageUrl` now has a deterministic caption fallback.
- If no useful caption can be enriched, the original source URL is sent rather than an empty caption.
- Social caption enrichment now recognizes Twitter/X, Instagram, TikTok, Reddit and YouTube.
- `/resolve-and-send` propagates resolver author/title/caption metadata so Telegram caption enrichment can reuse it without another network request.
- TikTok metadata can fall back to TikWM, Reddit to its JSON post representation and YouTube to oEmbed.
- Every Telegram album chunk receives the post caption; chunks after the first are no longer captionless.
- Ordered single-message album fallbacks and multipart multi-file sends now attach the caption to every standalone Telegram message.

## Social resolver registry

- Preserves the extended resolver chains added previously:
  - Twitter/X: FxTwitter -> VXTwitter -> Twirrl -> DTwitter -> optional Cobalt -> optional yt-dlp service.
  - TikTok: TikWM -> DTikTok -> optional Cobalt -> optional yt-dlp service.
  - Reddit: native Reddit media -> optional Cobalt -> optional yt-dlp service.
  - YouTube: oEmbed metadata -> configured Piped -> optional Cobalt -> optional yt-dlp service.
  - Instagram: ZoraaHub -> optional Cobalt -> optional yt-dlp service.
- Restores the original `SocialResolveOptions` contract used by `/resolve`, including X `/i/status/:id` canonicalization and trace logging.

## Validation

- `npm run typecheck` passes.
- Added regression coverage for noisy MP4 rotation matrices, WebM display dimensions, Telegram's final video-geometry gate and caption URL fallback.
