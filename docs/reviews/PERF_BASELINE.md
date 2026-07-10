# Performance baseline — first load & bundle (2026-07-10)

Bundle measured from the real production build (`pnpm --filter app build`, rolldown-vite). All
sizes are the reporter's own numbers; gzip in parentheses. Enforced in CI by
`scripts/check-bundle-budget.mjs` (wired into `azure-pipelines.yml`).

## Closing answer

**Which chunk still dominates first load, and why is it justified?**

`vendor-react` — **232.61 kB (74.53 kB gz)** — the React + React-DOM + React-Router runtime, now
pinned into its own chunk (this pass). It dominates because it *is* the framework every route needs;
isolating it means an app-code deploy doesn't invalidate it, so it's downloaded once and served from
cache across deploys (its hash only moves on a React/Router upgrade). The single **largest file
overall is `exceljs` (929.9 kB)**, but it is **not** on the first-load path — it's dynamically
imported only when a user exports a spreadsheet, so it never enters the initial critical bundle.

**Could any server-only secret or heavy library have leaked into the initial client bundle?**

No. The app declares **zero server SDKs** as dependencies — no `@azure/cosmos` (Cosmos is
`server/lib` only), no `@anthropic-ai/sdk` (Foundry/Claude is reached solely via `fetch('/api/ai/*')`
in the adapter; the browser holds no model key), no `firebase*` (removed in the cleanup). Secrets are
read from `process.env` in `server/lib/*` and never enter the Vite build; the only `VITE_*` values
inlined are public flags (`VITE_API_BASE`, optional `VITE_MAINTAINER_EMAIL`). The one heavy client
lib, `exceljs`, is genuinely browser-side (Excel export) and is kept **lazy** — out of first load.

## Measurement scope (be honest about this environment)

This repo cleanse/perf pass ran **without a running app, a browser, or a live Azure backend**
(Cosmos/Foundry creds absent; Playwright was removed in the cleanup). So:

- **Measured here (real):** the production **bundle** (chunk sizes, code-splitting, dependency
  graph) and a **static leak audit** of the client dependency set.
- **NOT measured here (needs a runtime harness):** field/lab **Web Vitals** (LCP/INP/CLS) on Home /
  Products / a Product workspace / Claims, and React **render counts**. Those require the app served
  against a backend + a browser (Lighthouse or the `web-vitals` lib). Targets + method are below; the
  numbers are deliberately left blank rather than fabricated.

## Bundle — before → after (this perf pass)

The change: `vite.config.ts` now pins the React runtime into a `vendor-react` chunk (routes were
already `React.lazy`, `exceljs` already dynamically imported).

| Chunk | Before | After | Note |
|---|---|---|---|
| entry `index` | 334.82 kB (105.38 gz) | **102.94 kB (31.86 gz)** | React extracted out of the entry |
| `vendor-react` | — | **232.61 kB (74.53 gz)** | new; stable, long-cache across app deploys |
| `src` (shared) | 149.40 kB (40.31 gz) | 149.40 kB (40.31 gz) | unchanged |
| `index.css` | 79.90 kB (17.60 gz) | 79.87 kB (17.59 gz) | unchanged (−0.03 from cleanup) |
| `exceljs` (lazy) | 929.90 kB (256.47 gz) | 929.90 kB (256.47 gz) | export-only, never first load |
| **Initial critical JS (gz)** | ~146 kB | **142.6 kB** (budget 175) | React now cacheable separately |

First-visit bytes are ~unchanged (React just moved chunks); the win is **cache stability** — a
routine app deploy re-downloads ~68 kB gz (`index` + `src`) instead of ~146 kB, because the 74.53 kB
gz `vendor-react` stays cached.

### First-load critical path (an authed `/app` route)
`rolldown-runtime` (0.56 gz) + `vendor-react` (74.53) + `src` (40.31) + entry `index` (31.86) +
`index.css` (17.59) + `AppShell` (14.20) + the route chunk (e.g. Home 6.16 / Products 6.40).

### Route/feature lazy chunks (gz KB)
Landing 5.01 · Home 6.16 · Products 6.40 · ProductWorkspace 10.89 · ProductOverview 5.01 ·
ProductCoverages 15.15 · ProductForms 3.59 · ProductPricing 16.15 · ProductStates 1.76 ·
ProductRules 10.21 · Builder 17.47 · Explorer 5.19 · Tasks 15.36 · Claims 10.51 · Dictionary 4.83 ·
Admin 8.21 · Feedback 8.02 · News 8.47 · StateTileMap 14.11 · core.esm (dnd-kit) 13.83 · excel
(export helper) 4.19 · **exceljs 256.47 (lazy)**.

## Budgets (enforced in CI — `scripts/check-bundle-budget.mjs`)

| Budget (gzipped) | Threshold | Current | 
|---|---|---|
| Initial critical JS (`index`+`vendor-react`+`src`+runtime) | ≤ 175 kB | 142.6 kB ✓ |
| Stylesheet (`index.css`) | ≤ 25 kB | 17.0 kB ✓ |
| Any single route/feature chunk (excl. lazy `exceljs`) | ≤ 25 kB | 17.0 kB (Builder) ✓ |
| `exceljs` remains a standalone lazy chunk (no eager leak) | required | present ✓ |

The check runs after `pnpm --filter app build` in `azure-pipelines.yml` and **fails the build**
(exit 1) on any breach. Raise a threshold only deliberately, with a note.

### Web Vitals targets (to enforce once a runtime harness exists)
LCP < 2.5 s · INP < 200 ms · CLS < 0.1, on Home / Products / a Product workspace / Claims. Method:
serve `app/dist` behind the `/api` host against a seeded Cosmos, drive it with Lighthouse CI or the
`web-vitals` lib, and fail the pipeline on regression vs. this file. **Deferred** — it needs a
browser + backend in CI (and a re-introduced headless-browser dep); not doable in this pass.

## Already in place (verified, not changed here)
- **Route-based code splitting** — every route is `React.lazy` under one `<Suspense>` (`App.tsx`).
- **`exceljs` is lazy** — a separate 930 kB chunk, imported only for spreadsheet export.
- **`prefers-reduced-motion`** — a global wildcard guard + explicit neutralisers (incl. the
  pricing-trace `.algo-pulse`/`.flow-pulse`) already exist in `index.css` (593–611).
- **App Service cache headers** — `server/server.js` sets `immutable` for hashed `/assets/*` and
  `no-cache` for `index.html`; this pass adds `no-cache` for `version.json` (VersionWatcher freshness).

## Deferred (need runtime verification or are larger refactors — flagged, not faked)
Prefetch-on-intent (hover/viewport route prefetch), list virtualization (Products/audit/dictionary/
search/RT-LD grids), content-shaped skeletons everywhere + View Transitions, optimistic-mutation
rollback on every write path, and the Web-Vitals CI check. Each needs a running app to prove
"before/after" honestly; landing them blind (and unmeasured) would violate the "measure, don't
speculate" rule these prompts set. The smart-polling runtime win shipped in this pass is documented
separately in `docs/reviews/POLLING.md`.
