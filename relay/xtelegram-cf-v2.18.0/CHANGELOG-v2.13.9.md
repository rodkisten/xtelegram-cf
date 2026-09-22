# v2.13.9

## Added

- Added streaming SHA-256 content identity for Worker-owned media downloads.
- Added persistent D1 exact media hashes and indexes for fast content-level deduplication.
- Added a cheap robustness fingerprint based on normalized media-byte distribution.
- Added conservative near-duplicate detection for recompressed/changed video copies when dimensions and content distribution remain sufficiently close.
- Duplicate responses now expose the match type, similarity score, SHA-256, source media key, Telegram channel/topic, and message IDs.

## Performance

- SHA-256 and the robustness fingerprint are calculated during the same download pass, avoiding a second full-media traversal.
- Exact SHA-256 matches skip the broader near-duplicate candidate scan.
- No additional media buffer is created solely for hashing.

## Compatibility

- Existing provider/media-key deduplication remains unchanged.
- `force=true` bypasses content-level duplicate blocking.
- Existing Telegram message/channel persistence remains the source for duplicate delivery details.
