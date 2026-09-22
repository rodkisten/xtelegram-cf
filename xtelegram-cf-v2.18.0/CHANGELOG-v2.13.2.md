# v2.13.2

- Restored the exported `resolveTwitterMediumMedia()` contract consumed by `src/media.ts`.
- Preserves the existing oversized Twitter/X fallback: re-query Twirrl, prefer explicit medium labels (`480p`, `540p`, `720p`, `medium`, etc.), otherwise choose the middle rung by pixel area.
- Keeps aspect ratio as the first ranking constraint when Twirrl exposes source geometry.
- Keeps all resolver-registry additions: FxTwitter, VXTwitter, TikWM, Reddit native, YouTube oEmbed/Piped, optional Cobalt, optional yt-dlp service.
- `src/social.ts` and `src/types.ts` pass strict TypeScript checking.
