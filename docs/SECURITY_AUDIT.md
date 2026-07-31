# Production dependency audit

Command:

```bash
npm audit --omit=dev
npm audit --omit=dev --audit-level=high
```

Do **not** run `npm audit fix --force` automatically — npm proposes regressing `next` to 9.x or jumping AI SDK to v7, both breaking.

## Classification of current production findings

| Package | Severity | Direct / transitive | Prod / dev | Currently exploitable here? | Action |
|---|---|---|---|---|---|
| `postcss` (via `next`) | high | transitive | production | **Not applicable** for this app’s threat model: advisories concern attacker-controlled CSS stringify / source-map loading during CSS processing. Candidate/admin content is not fed through PostCSS as untrusted stylesheets. | Requires `next` major upgrade path that vendors a fixed `postcss`. Blocked pending Next.js release that pulls `postcss > 8.5.17` without a forced downgrade. |
| `sharp` (via `next`) | high | transitive | production | **Not applicable** in default deployment: sharp is used by Next image optimization for local assets. We do not process attacker-uploaded images through sharp. | Requires Next.js bump that depends on `sharp >= 0.35.0`. |
| `next` | high (inherited) | direct | production | Inherited from `postcss` / `sharp` only. | Stay on Next 15.x until a nonbreaking patch ships fixed deps; Next 16 is a separate upgrade project. |
| `@ai-sdk/provider-utils` / `@ai-sdk/*` / `ai` | low (resource consumption advisory in audit tree) | direct + transitive | production | Low severity in `--omit=dev` report; fix requires `ai@7` breaking change. | Defer AI SDK major upgrade. Track separately. |
| `jsondiffpatch` (via `ai`) | moderate | transitive | production | XSS in HTML formatter — not used to render untrusted HTML in this app. | Defer with AI SDK upgrade. |

## Build policy

CI runs `npm audit --omit=dev --audit-level=high` through `scripts/check-prod-audit.mjs`.

* **Allowed:** only the documented accepted package names above (`postcss`, `sharp`, `next`).
* **Blocked:** any other production high/critical advisory.

Safe nonbreaking updates were attempted (`npm audit fix --omit=dev`); none cleared the high findings without `--force`.
