# Production dependency audit

Command:

```bash
npm audit --omit=dev
node scripts/check-prod-audit.mjs
```

Do **not** run `npm audit fix --force` automatically — npm proposes regressing `next` to 9.x or jumping AI SDK to v7, both breaking.

## Accepted advisories (exact)

Allowlist is by **advisory URL / GHSA id**, not package name:

| Advisory | Package | Notes |
|---|---|---|
| https://github.com/advisories/GHSA-qx2v-qp2m-jg93 | postcss | XSS via CSS stringify — not applicable (no untrusted CSS pipeline) |
| https://github.com/advisories/GHSA-6g55-p6wh-862q | postcss | sourceMappingURL disclosure — not applicable |
| https://github.com/advisories/GHSA-r28c-9q8g-f849 | postcss | source map path traversal — not applicable |
| https://github.com/advisories/GHSA-f88m-g3jw-g9cj | sharp | libvips CVEs — not applicable (no attacker image uploads via sharp) |

`next` high severity is accepted **only** when its complete `via` chain is string references to `postcss` and/or `sharp` (no direct Next.js advisory objects).

## Build policy

* Any **critical** advisory fails.
* Any high/critical on an unexpected package fails.
* A new PostCSS/Sharp advisory URL fails.
* A direct Next.js advisory object fails.
* Malformed audit JSON fails closed.

Policy implementation: `scripts/audit-policy.mjs` (tested by fixtures).
