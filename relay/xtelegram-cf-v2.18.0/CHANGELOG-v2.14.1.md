# v2.14.1

- Fixes the Cloudflare build failure from v2.14.0 by including `src/lib/limit-error.ts`.
- `src/media.ts`, `src/routes/send/album.ts`, and `src/routes/send/multipart.ts` all depend on this module.
- Keeps all v2.14.0 aspect-ratio and caption invariants unchanged.
- `npm run typecheck` passes when overlaid on the v2.13.11 project base.
