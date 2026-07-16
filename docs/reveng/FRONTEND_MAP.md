# FRONTEND_MAP — routes, primitives, tokens, invariants, import review surface (`d28c8a1`)

> `docs/reveng/` dossier. React 19 / React Router 7 / Vite / Tailwind v4 / TypeScript.
> No global store: React Context + local state + the adapter's subscribe layer.

## 1. The adapter seam (the one binding client invariant)

`app/src/lib/backend/` is the ONLY interface app code may depend on
(`index.ts:1-7` exports the Azure adapter + all types; the Firebase adapter is retired).

- Contract: `BackendAdapter` (`types.ts:141`) — `auth`, `db` (get/list/listPage/subscribe/
  mutate/mutateBatch/vote/setNewsPins/tx), `storage`, `fns` (AI invoke + stream),
  `presence`, `tenancy`, `orgAdmin`, `portal`. `MutationPayload` carries `expectedRev`
  optimistic locking (`types.ts:119`); 409 -> `MutationConflictError` (`types.ts:129`) ->
  `ConflictDiffDialog`.
- Transport: `api()` (`azure.adapter.ts:39-77`) — same-origin `/api/*`, Bearer from
  localStorage `pf.azure.token` (`:22`), 401 -> full sign-out + cache clear +
  `CLEAR_ALL_CACHES` to the SW (`:60-61,139-146`).
- **Realtime = smart polling** (Cosmos has no browser change feed): `subscribe()`
  (`azure.adapter.ts:110-306`) — POLL_MIN 3.5s -> POLL_MAX 30s x1.6 backoff, snap-to-fast
  on any mutation or tab focus, Page-Visibility pause (`:152-159`), concurrent-subscriber
  coalescing via `pathFetches` (`:264-273`), stale-while-revalidate paint.
- Writes poke all pollers back to fast (`mutate()` -> `pokeAll()`, `:308-319`);
  `mutateBatch` sends 150-entity HTTP batches, server re-chunks to <=96-op transactions
  (`:321-325`).
- SUPER_ADMIN cross-tenant: `setSuperAdminTenant()` sets the `X-Tenant-Id` header and
  clears all caches (`:95-106`).
- SSE: `fns.stream()` with TextDecoder + AbortSignal (`:370-393`).
- `useLiveCollection` (`app/src/lib/useLiveCollection.ts:34-52`) wraps subscribe with a
  parallel one-shot `list()` error probe so hard failures surface as `'error'` (with
  `retry()`), not an eternal skeleton.

## 2. Route map (`app/src/App.tsx:1-90`, all routes lazy)

| Zone | Route | Component |
|---|---|---|
| public | `/` | Landing (marketing + sign-in) |
| public | `/pricing` | Pricing (ILLUSTRATIVE ROI calc, `app/src/lib/pricing.ts`) |
| public | `/must-change-password` | post-OTP gate |
| public | `/home-check` | HomeCheck guest risk surface |
| public | `/portal` | policyholder portal (POLICYHOLDER persona) |
| `/app` shell | index | Home (portfolio cockpit + copilot) |
| 〃 | `products` / `products/:id` | Products list / ProductWorkspace |
| 〃 (workspace tabs) | `overview, coverages, forms, pricing, states, rules` | ProductOverview/-Coverages/-Forms/-Pricing/-States/-Rules |
| 〃 | `builder, explorer, tasks, news, claims, dictionary, feedback, admin, tenant-admin` | one route each |
| catch-all | `*` | `Navigate('/')` |

Guard: AppShell redirects to Landing when `!user?.email` (`App.tsx:52-53`) — there is NO
anonymous session inside `/app`. (The documented `VITE_ALLOW_GUEST` guest floor of
ADR-0004 has no live code path — Platform_Review F12, still true at this tree.)

## 3. Design-token system (`app/src/index.css`)

- Light theme `:root` (`index.css:8-120`): surfaces (`--color-page #F7F7FA`, `--color-surface`,
  `--color-raised`, `--color-hover`), 3 AA-verified ink tiers (`--color-text #131318`,
  `--color-dim`, `--color-faint`), Accenture-violet accent family (`--color-accent #8B1FE0`,
  `-bright #A100FF`, `-strong #7A00E6`), AA-darkened status colors, domain palettes
  (state tiles, import-stage tints `--color-stage-warm/-cool`, 5-step GTM phase ramp),
  gradients, motion durations, shadows, fonts.
- Dark theme = complete token re-cast, not inversion (`html[data-theme="dark"]`,
  `index.css:250-341`); accent shifts lighter (`#C29BFF`), `--color-on-accent` flips
  near-black.
- No-FOUC: inline script in `index.html` stamps `data-theme` before first paint;
  `applyTheme()` also updates `<meta name=theme-color>` and cross-fades unless
  `prefers-reduced-motion` (`app/src/lib/theme.ts:48-64`).
- **Invariant: no hard-coded hex outside `index.css`** (CLAUDE.md binding rule; SVGs
  exported to disk are the only exception).

## 4. Primitives + icons

- `app/src/components/ui/` barrel (`index.ts:1-20`): Button, Card, Badge (+Status/
  Lifecycle/Review/ProductStatus pills), RefChip, Input, Combobox, Table, Tabs, Dialog,
  Drawer, Tooltip, Skeleton(+Card), EmptyState, NoticeBanner, Logo, ViewToggle, Highlight.
- Icon registry `app/src/components/icons/index.tsx` — ~93 hand-drawn 24px-grid glyphs,
  `currentColor` strokes, zero third-party icon deps; `ui/icons.tsx` is a re-export shim
  for the 77 legacy importers. Includes the 7 multi-agent-import glyphs (IconAgent,
  IconStage, IconEscalate, IconVerify, IconReconcile, IconDisagreement, IconStream,
  `index.tsx:331-369`).
- **RefChip encodes a binding invariant** (`ui/RefChip.tsx:9,20`): ISO form numbers
  (spaces, no dots — "HO 04 90") render as monospace chips; internal refIds (dots, no
  spaces) render NOTHING in the UI and survive only in exports.

## 5. Invariant tests (`app/src/__invariants__/`)

| Test | Locks |
|---|---|
| `no-bare-writes.test.ts` | every Cosmos write call in `server/lib/` allowlisted with rationale; 8 files / 31 calls, exact count asserted (`:27-60,99`) |
| `server-invariants.test.ts` | audit hash-chain wiring (prevHash + sealed hash + chainHead + etag + `/audit/verify`), parentId validation, bootstrap fail-closed, capability (not role) gates on mutate, AI system-prompt citation contract, filing create-only + verifier-before-freeze + reserved base |
| `server-security.test.ts` | platform/filing verifier + reserved-base immutability |
| `vite-define.test.ts` | the Vite `define` block contains ONLY build metadata (`__BUILD_ID__`), never a secret env name (regex over COSMOS_KEY/FOUNDRY_KEY/JWT_SECRET/... , `:1-37`) |

Note the quirk: these SERVER invariants live in the APP test tree — they run with the
app's vitest project on every `pnpm test`, which is exactly the point (the deploy
pipeline runs only shared tests; the invariants gate locally/PR — ARCHITECTURE.md sec 7).

## 6. The import review surface, end to end

1. **Entry** — `app/src/import/UnifiedImportModal.tsx` (EDITOR+: `canI(user,'product:write')`,
   `:135`). Phase machine `select -> streaming -> review -> xlsx-plan -> importing ->
   done|error` (`:53`).
2. **Streaming** — `unifiedImportClient.ts`: base64-encodes files, sniffs XLSX sheet names
   from the ZIP central directory of the first 64KB (`:42-56`), streams
   `POST /api/ai/unifiedImport` via `adapter.fns.stream`, parses every SSE event, and
   accumulates the bundle from `{t:'json', key:'bundle'}` (`:97-138`).
3. **Live telemetry** — `AgentVisualizer.tsx` (lazy, opt-in "Watch the agents"):
   renders ONLY real SSE events — stage boxes for the 7 brain stages / 6 filing stages,
   per-deployment spend at run end from `brain:spend`, escalation flashes from
   `brain:escalation`; explicitly no simulated activity (`:5-12,90-143`).
4. **Review** — two sections (`UnifiedImportModal.tsx:89-121`): "Detected" (per-kind
   sections with refId chips, confidence, citations, include-toggles) and "Review &
   confirm" (unresolved items + disagreement heatmap — shown, NOT written).
   `WarningsPanel.tsx` groups `ImportWarning`s by kind with severity framing
   (duplicate-refId = danger; dangling-form-reference / orphan-promoted /
   exclusion-as-coverage / incomplete-product = warn; not-in-deterministic-map /
   product-synthesized / dynamic-fields-surfaced / empty-source / unmapped-column = info)
   (`WarningsPanel.tsx:23-34`).
5. **Persist** — `lib/import/importProduct.ts:74 importPlan()`: product first (abort if it
   fails), then tables -> coverages (parents before children, wave batching) -> forms ->
   rules -> formRules -> rating; 150-entity HTTP batches; draft isolation (product lands
   under a minted draft id; forms namespaced `forms/{draftId}__{formNumber}` so the shared
   library is untouched, `:17-23`); ETA + live refId ticker; returns
   `{productId, written, failed, errors, durationMs}`.
6. **Lineage** — workbooks get `importLineage(...)`, PDFs get `filingLineage(...)`
   (`UnifiedImportModal.tsx:123-129`) stamped on the product.

## 7. Service worker + versioning (`app/public/sw.js`)

- Cache name `prh-{__BUILD_ID__}` stamped at build (`sw.js:19-20`); activation evicts all
  prior caches (`:44-49`).
- Strategies: hashed `/assets/*` cache-first; HTML navigations network-first with cached
  shell fallback; public static SWR; **`/api/*` passes through fail-closed** — the ONLY
  cached API is the unauthenticated `/api/auth/tenants` (`:29`); `version.json` never
  cached (`:94-95`).
- Messages: `SKIP_WAITING` (VersionWatcher) and `CLEAR_ALL_CACHES` (logout) (`:54-60`).
- `VersionWatcher.tsx:1-74` polls `version.json` every 5 min + on focus; buildId mismatch
  -> toast -> SKIP_WAITING + reload. `main.tsx:9-22` additionally auto-reloads ONCE on
  Vite `vite:preloadError` (stale chunk hash after a deploy), sessionStorage-guarded.

## 8. Presence + misc load-bearing quirks

- Presence: `adapter.presence.join(pid)` heartbeat 30s / `watch` poll 15s, skipped while
  backgrounded (`azure.adapter.ts:397-416`); avatars capped at 3 + "+N", deterministic
  color from uid hash (`components/product/PresenceAvatars.tsx:24-30,92-111`).
- `ErrorBoundary.tsx` — the only class component (React requirement); calm recovery
  screen, never a raw stack.
- `UserContext.tsx:24-60` subscribes to the user's own `users/{uid}` doc (for
  `mustChangePassword`) and tears down on auth change — StrictMode-safe.
- Feedback drawer: global quick-capture with screenshot annotation + AI shaping
  (`shapeFeedback`) + near-duplicate detection; auto-attaches the viewed entity/refId.
- Bundle discipline: budgets enforced by `scripts/check-bundle-budget.mjs` (critical JS
  175 KB gz, CSS 25 KB, route chunks 25 KB gz max, exceljs must stay lazy); the pipeline
  runs it, local `pnpm build` does NOT.
