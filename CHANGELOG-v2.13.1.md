# v2.13.1 — Universal source-link caption fallback

- Guarantees that requests without an explicit `caption` include the best known source link in the generated Telegram caption.
- Prefers stable/original post URLs and recognizes `pageUrl`, `sourceUrl`, `tweetUrl`, `postUrl`, `storyUrl`, `reelUrl`, `tiktokUrl`, `originalUrl`, `permalink`, `shareUrl`, and `canonicalUrl`.
- Falls back to the direct media URL only when no original/source URL was provided, so Telegram never receives an empty generated caption when the relay knows a URL.
- Adds `captionExplicit` to distinguish caller-authored captions from relay-generated fallback captions. This fixes social metadata enrichment being skipped when the validation layer had already generated a URL fallback.
- Applies the same behavior to single media, albums, multipart uploads, batch requests, and resolver-driven sends.
- Multipart identity/persistence now also recognizes the expanded original URL aliases.
