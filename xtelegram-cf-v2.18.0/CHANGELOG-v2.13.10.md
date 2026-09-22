# v2.13.10

## Fixed

- Eliminated the CPU-heavy pure-TypeScript SHA-256 implementation that could push large video sends over Cloudflare Workers CPU limits.
- Exact media hashes now use native Web Crypto: `crypto.DigestStream("SHA-256")` for streamed downloads and `crypto.subtle.digest()` for already-buffered/remuxed media.
- The near-duplicate byte-distribution fingerprint now has a strict fixed sampling budget (8,192 sampled bytes maximum) instead of iterating over every byte of the video.
- Fingerprint version bumped to `2`; existing v1 fingerprints remain stored but are not compared against v2 signatures.

## Performance

- SHA-256 CPU work is moved to the Workers runtime's native crypto implementation.
- JavaScript fingerprint work is O(1) with respect to media size after the fixed sampling budget is reached.
- No second media download was introduced.
- Exact SHA-256 D1 lookup and existing delivery-claim behavior are unchanged.

## Validation

- `npm run typecheck` passes.
- Media fingerprint tests pass, including the standard SHA-256 `abc` test vector and the bounded-sampling assertion.
- The repository's pre-existing Node test-runner extensionless-import issue still affects `tests/delivery-duplicate.test.ts`; unrelated test suites pass.
