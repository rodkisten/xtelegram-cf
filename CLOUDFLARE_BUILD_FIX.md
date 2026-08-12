# Cloudflare build notes

The v2.8.1 archive includes a `package-lock.json` synchronized with
`package.json`. Cloudflare can therefore use its normal deterministic install:

```bash
npm ci
npm run typecheck
npm run build
```

`node_modules` is deliberately not committed or included in the release ZIP.
The Worker build is expected to install the lockfile dependencies itself.

This release also avoids the newer TypeScript/Web Crypto `Uint8Array` typing
issue in AES-128 HLS decryption and multipart uploads. ArrayBuffer-backed
media remains zero-copy; only sliced or SharedArrayBuffer-backed views are
copied to their exact byte range before they cross a Web Crypto/Blob boundary.
