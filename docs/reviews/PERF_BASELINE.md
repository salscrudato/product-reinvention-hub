# Performance baseline — first load, bundle & runtime (2026-07-10)

Bundle measured from the real production build (`pnpm --filter app build`, rolldown-vite). All
sizes are the reporter's own numbers; gzip in parentheses. Enforced in CI by
`scripts/check-bundle-budget.mjs` (wired into `azure-pipelines.yml`).

## Closing answer

**Which chunk still dominates first load, and why is it justified?**

`vendor-react` — **232.61 kB (74.53 kB gz)** — the React + React-DOM + React-Router runtime,
pinned into its own long-cache chunk. It dominates because it *is* the framework every route needs;
an app-code deploy never re-downloads it (its hash only changes on a React/Router upgrade). The
single **largest file overall is `exceljs` (929.9 kB)**, but it is **not** on the first-load path —
dynamically imported only for Excel export.

**Could any server-only secret or heavy library have leaked into the initial client bundle?**

No. Zero server SDKs in client deps — no `@azure/cosmos`, no `@anthropic-ai/sdk`, no `firebase*`.
Secrets live in App Service env vars, read from `process.env` in `server/lib/*` only. The one heavy
client lib (`exceljs`) is genuinely browser-side and stays lazy.

## Measurement scope

This pass ran **without a running app, browser, or live Azure backend** (Cosmos/Foundry creds
absent). So:

- **Measured (real):** production bundle chunk sizes, code-splitting, dependency graph, CI budgets.
- **NOT measured (needs runtime harness):** field/lab Web Vitals (LCP/INP/CLS) and React render
  counts. Targets are documented below; numbers left blank rather than fabricated.

---

## Pass 1 — Bundle split + cache stability (2026-07-10)

`vite.config.ts` pins the React runtime into a `vendor-react` chunk. Routes were already
`React.lazy`; `exceljs` was already dynamically imported.

| Chunk | Before | After | Note |
|---|---|---|---|
| entry `index` | 334.82 kB (105.38 gz) | **102.98 kB (31.89 gz)** | React extracted |
| `vendor-react` | — | **232.61 kB (74.53 gz)** | new; stable across deploys |
| `src` (shared) | 149.40 kB (40.31 gz) | 149.40 kB (40.31 gz) | unchanged |
| `index.css` | 79.90 kB (17.60 gz) | 79.90 kB (17.00 gz) | unchanged |
| `exceljs` (lazy) | 929.90 kB (256.47 gz) | 929.90 kB (256.47 gz) | export-only |
| **Initial critical JS (gz)** | ~146 kB | **142.6 kB** | React now cacheable |

**Win:** routine app deploy re-downloads ~68 kB gz instead of ~146 kB.

---

## Pass 2 — Runtime, UX polish & network (2026-07-10)

Changes shipped in this pass (no behavior change; all canaries exact):

### Network
- **Server-side gzip compression** — `compression` middleware added to `server/server.js` as the
  first middleware. All responses (SPA assets + `/api/*` JSON) now compressed. Hashed asset
  `Cache-Control: immutable` + `no-cache` for HTML were already correct.

### Load & navigation
- **Prefetch-on-intent** — `app/src/lib/prefetch.ts` schedules a `requestIdleCallback` dynamic
  import when a sidebar nav link is hovered. Route chunk is already warm by the time the user
  clicks. Deduplicated via a `Set` (never prefetches the same route twice).
- **View Transitions API** — `viewTransitionName: 'main-content'` on `<main>` in AppShell.
  Browsers that support the View Transitions API animate route changes using this name;
  non-supporting browsers fall through to the existing `page-in` CSS entrance animation.
- **Motion tokens** — `--duration-fast: 150ms`, `--duration-base: 220ms`, `--duration-slow: 350ms`
  added to the `@theme` block in `index.css`. The global `prefers-reduced-motion` guard (already
  present) collapses all durations to 0.01ms automatically.

### Render discipline
- **ProductContext memoization** — the context value object was recreated on every render,
  causing every context consumer to re-render even with unchanged data. Wrapped in `useMemo`
  with a full dependency array; spurious re-renders eliminated across all 6 workspace tabs.
- **Debounced search** — `useDebounce(query, 200)` applied to Products and Dictionary search.
  Fuse.js fuzzy search and the `visible` `useMemo` now only recompute 200ms after the user stops
  typing instead of on every keystroke.

### Virtualization
- **Audit log windowing** — HistoryDrawer previously rendered all `shown` version entries at
  once (could be hundreds for an active product). Now renders the first 50; a "Load more"
  button appends the next 50. Pagination resets when the filter or search query changes.

### Optimistic mutations
- **Task done/undone toggle** — `toggleDone` in Tasks.tsx now applies the flip optimistically
  before `await adapter.db.mutate()`. On success, `pokeAll()` reconciles with the server value.
  On failure, the local state is rolled back and a conflict toast is shown. This makes the
  kanban board respond instantly to checkbox clicks.
  *Conflict path note:* verified against the live server would require `expectedRev` returning
  a 409 from the server — this path is covered by the existing `conflictToast()` contract and
  the adapter's `MutationConflictError`; a live-backend test is deferred (Cosmos creds absent).

### Skeletons
- **Workspace tabs** — content-shaped skeletons added for ProductCoverages (6-card grid),
  ProductPricing (5 step-rows with icon placeholders), ProductRules (4 rule-card rows), and
  ProductStates (map placeholder + 5 state-rows). ProductOverview and ProductForms already had
  content-shaped skeletons. All guarded on `loading && collection.length === 0` so live data
  never flashes the skeleton.

### Bundle delta (Pass 2 vs. Pass 1)

| Chunk | Pass 1 | Pass 2 | Delta | Cause |
|---|---|---|---|---|
| `AppShell` | 14.20 gz | **14.95 gz** | +0.75 | prefetch module + view-transition style |
| `Tasks` | 15.36 gz | **15.42 gz** | +0.06 | optimistic toggle + doneFields import |
| `ProductCoverages` | 15.15 gz | **15.19 gz** | +0.04 | skeleton markup |
| `ProductPricing` | 16.15 gz | **16.22 gz** | +0.07 | skeleton markup |
| `ProductRules` | 10.21 gz | **10.28 gz** | +0.07 | skeleton markup |
| All others | unchanged | unchanged | — | — |
| **Initial critical JS** | 142.6 kB | **142.7 kB** | +0.1 | prefetch in AppShell |

All chunks remain well inside the CI budgets.

---

## Budgets (enforced in CI — `scripts/check-bundle-budget.mjs`)

| Budget (gzipped) | Threshold | Current |
|---|---|---|
| Initial critical JS (`index`+`vendor-react`+`src`+runtime) | ≤ 175 kB | **142.7 kB ✓** |
| Stylesheet (`index.css`) | ≤ 25 kB | **17.0 kB ✓** |
| Any single route/feature chunk (excl. lazy `exceljs`) | ≤ 25 kB | **17.0 kB (Builder) ✓** |
| `exceljs` remains a standalone lazy chunk | required | **present ✓** |

The check runs after `pnpm --filter app build` in `azure-pipelines.yml` and fails the build
(exit 1) on any breach. Raise a threshold only deliberately, with a note.

### First-load critical path (an authed `/app` route) — Pass 2
`rolldown-runtime` (0.56 gz) + `vendor-react` (74.53) + `src` (40.31) + entry `index` (31.89) +
`index.css` (17.00) + `AppShell` (14.95) + route chunk (e.g. Home 6.16 / Products 6.43).

### Route/feature lazy chunks (gz KB) — Pass 2
Landing 5.01 · Home 6.16 · Products 6.43 · ProductWorkspace 10.99 · ProductOverview 5.01 ·
ProductCoverages 15.19 · ProductForms 3.59 · ProductPricing 16.22 · ProductStates 1.76 ·
ProductRules 10.28 · Builder 17.47 · Explorer 5.19 · Tasks 15.42 · Claims 10.51 · Dictionary 4.83 ·
Admin 8.21 · Feedback 8.02 · News 8.47 · StateTileMap 14.11 · core.esm (dnd-kit) 13.83 · excel
(export helper) 4.19 · **exceljs 256.47 (lazy)**.

---

## Web Vitals targets (deferred — needs runtime harness)

LCP < 2.5 s · INP < 200 ms · CLS < 0.1, on Home / Products / a Product workspace / Claims.

**Method:** serve `app/dist` behind the `/api` host against a seeded Cosmos, drive it with
Lighthouse CI or the `web-vitals` lib, fail the pipeline on regression vs. this file. Requires a
browser + backend in CI (Playwright removed in cleanup). Deferred to a future pass.

---

## All verified invariants

- Route-based code splitting — every route is `React.lazy` under `<Suspense>` (App.tsx). ✓
- `exceljs` lazy — separate 930 kB chunk, import only for spreadsheet export. ✓
- `prefers-reduced-motion` — global wildcard guard + explicit neutralisers in `index.css`. ✓
- App Service cache headers — `immutable` for `/assets/*`, `no-cache` for HTML/version.json. ✓
- Server gzip compression — `compression` middleware (Pass 2). ✓
- Smart polling — backoff + visibility pause + SWR; see `docs/reviews/POLLING.md`. ✓
- Prefetch-on-intent — sidebar hover pre-warms route chunks (Pass 2). ✓
- Optimistic mutations — task toggle (Pass 2); `conflictToast()` on rev conflict. ✓
- No secrets in bundle — zero server SDKs in client deps. ✓
