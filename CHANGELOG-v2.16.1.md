# v2.16.1 - Optional hashtags

- Adds optional `hashtags` support to `/send`, `/resolve-and-send`, `/batch`, albums and multipart uploads.
- Accepts either an array (`["rod", "#video"]`) or a comma/whitespace-separated string (`"#rod #video, front_end"`).
- Adds a missing leading `#`, normalizes invalid separators to `_`, and removes duplicates case-insensitively.
- Hashtags are appended after the final enriched/social caption, so they do not suppress metadata enrichment.
- If caption + hashtags would exceed Telegram's 1024-character caption limit, the base caption is shortened first so every requested hashtag is preserved.
- MarkdownV2 hashtags are escaped safely; if fitting requires truncating a formatted caption, only that overflow case falls back to plain text to avoid malformed entities.
- Batch-level hashtags are inherited by items unless an item supplies its own `hashtags`.
- No CPU-heavy behavior is added; normalization is bounded and linear over at most 40 hashtags.
