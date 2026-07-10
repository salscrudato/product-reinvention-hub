# Cleanup Report — Azure cutover teardown (session 2026-07-10)

Branch `sec-remediation-and-cleanse`. Recursive, static-analysis-driven removal of dead weight left
behind by the completed Firebase → Azure migration. **Rule:** every deletion is backed by tool
output *and* a zero-reference grep; ambiguity ⇒ keep-with-reason. Zero runtime behavior change;
canaries byte-for-byte exact. Companion ledger entry: `GROUND_TRUTH.md` V18. Predecessor:
`CLEANSE_MANIFEST.md` (the 2026-07-09 cleanse, done *before* the migration finished — it kept the
Firebase infra "because Firebase is live"; this pass removes it now that the runtime is Azure-only).

---

## Closing answer (the question this report must answer)

**What did I remove that a careless reviewer would have feared touching, and how did static analysis
prove it safe?**

The whole Firebase spine — `firestore.rules`, `firebase.json`, the `seed.ts` seeder, the emulator
scripts, and (scariest) the **client mutation envelope** `app/src/lib/backend/envelope.ts` with its
tests, plus the V16-documented **`FilingImportModal`** filing-importer UI. A careless reviewer sees
"security rules" / "the atomic-mutation envelope" / "a documented feature" and freezes. Proof it was
safe, in layers:

1. **Runtime call-graph.** `app/src/lib/backend/index.ts` exports the Azure adapter and states "The
   Firebase adapter is retired." `azure.adapter.ts` talks only to `/api/*` and reads `VITE_API_BASE`,
   never `VITE_USE_EMULATORS`. So nothing in the browser reaches Firestore/rules/emulator.
2. **The envelope moved, provably.** `server/lib/data.js` re-implements the exact
   entity+audit+version+searchIndex batch (one Cosmos `items.batch`, `expectedRev`→409,
   `requireRole('EDITOR')`). The client `envelope.ts`/`refIdAlloc.ts`/`coverageParent.ts` are imported
   by **only their own tests** (grep across the repo for every exported symbol confirmed it) — knip
   classifies them "test-only," and the Azure adapter posts raw payloads for the server to envelope.
3. **`FilingImportModal` was superseded.** knip flagged it (and `filingImportClient.ts`,
   `BaseFormExtract.tsx`) as *unused files*; grep shows the newer `UnifiedImportModal` (which Builder
   actually renders) imports `unifiedImportClient`, not these — the only references to the removed
   files are prose comments ("mirrors BaseFormExtract", "existing FilingImportModal path").
4. **CI + deploy.** `azure-pipelines.yml` builds the SPA + `server/` and never touches Firebase; the
   e2e/rules/integration suites ran only under `firebase emulators:exec`.
5. **The gate agrees.** After removal: typecheck ✓, lint ✓, 764 unit tests ✓, build ✓; canaries
   HO-3 $1,528 / PA $1,002 / GL $2,635 / imported $1,281 all exact.

**What looked unused but I kept, and why?**

- **`functions/` (whole workspace).** knip flags it structurally (not a deployed entrypoint) and the
  Azure host doesn't call it. **Kept** because it's still wired into the gate (typecheck·lint·test,
  125 tests) and `server/lib/ai.js` has ported **only `chat`** — every other AI handler returns
  `501 ai_handler_not_ported`, so `functions/` is the live reference for the un-ported handlers.
  Deleting it is an architecture decision, not janitorial cleanup.
- **`snowchat/` (≈674 files).** knip flags every file. Separate Python/JS project, not a
  `pnpm-workspace` package, zero references from the Hub, not built or gated. Out of scope; owner call.
- **`app/src/lib/theme.ts`** (knip "unused exports"). **Live** — dark mode was added post-migration
  (`useTheme` in `AppShell.tsx` + `ThemeToggle.tsx`, `data-theme` in `index.html`/`index.css`).
  GROUND_TRUTH V11 ("light-only") is stale on this point.
- **`app/public/sw.js`** (knip unused file). Registered at runtime by string in `main.tsx`
  (`navigator.serviceWorker.register('/sw.js')`, PROD only). Live asset.
- **`scripts/migrate-to-cosmos.ts`, `scripts/genGtmProcess.ts`** (knip unused files). Operational /
  build-time CLIs run by hand (Cosmos seeder; GTM-process generator), not importable modules.
- **`functions/src/import/map.ts`, `functions/src/retrieval/placeholder.ts`** (knip unused within
  functions). Left to keep the retained `functions/` subsystem coherent — pruning its internals
  belongs with the eventual functions port/removal, not this pass.
- **knip "unused exports" (50) / "types" (33).** Dominated by the public adapter contract
  (`BackendAdapter`/`Session`/`MutationPayload` re-exports), UI-library barrel primitives, and
  symbols used internally. Tree-shaken out of the bundle already; deleting `export` keywords is
  cosmetic churn with breakage risk. Per "ambiguity ⇒ keep," not modified.

---

## Tooling summary

Run via `pnpm dlx`; raw output in the session scratchpad. (`pnpm hygiene` reproduces them.)

- **knip** (monorepo, no config): 60 "unused files", 1 dep, 2 devDeps, 50 exports, 33 types.
  High false-positive rate without config — it flags the entire non-TS `server/` host, every
  `snowchat/` file, ambient `.d.ts`, string-registered `sw.js`, CLI-only scripts, and test-only
  files. Each actionable hit was re-verified with a zero-reference grep before removal.
- **depcheck** (per workspace): `app` → unused dep `firebase` (real); `tailwindcss`/`vitest` are
  false positives (used via `@tailwindcss/vite` + `@import`, and hoisted root devDep). `functions`
  and `shared` clean.
- **ts-prune**: no actionable app-only unused exports beyond knip.

---

## DELETE — evidence-backed (31 tracked files)

### Firebase hosting / emulator / rules config
| Path | Evidence |
|---|---|
| `firebase.json` | knip unlisted-binary `firebase`; only consumed by the removed emulator/deploy scripts. Runtime is Azure (`azure-pipelines.yml`). |
| `.firebaserc` | Firebase project pointer (`productreinvention`); no Firebase deploy remains. |
| `firestore.rules` | Role enforcement moved to `server/lib/{auth,data}.js` (grep: no runtime reader; only the deleted rules tests + docs). |
| `firestore.indexes.json` | Firestore index config; no Firestore at runtime. |
| `storage.rules`, `storage.cors.json` | Firebase Storage config; storage is Azure Blob (`server/lib/storage.js`) + adapter `/api/storage`. |

### Emulator / seed / e2e / capture scripts
| Path | Evidence |
|---|---|
| `scripts/seed.ts` | Seeds the **Firestore emulator**; superseded by `scripts/migrate-to-cosmos.ts`. Imports `firebase-admin` (grep). |
| `scripts/wait-and-seed.mjs` | Waits on the Firestore emulator (port 8080) then runs `seed.ts`. |
| `scripts/guard-backend.mjs` | Guards `VITE_USE_EMULATORS` — a flag the Azure adapter no longer reads. |
| `scripts/e2e-serve.mjs` | Runs under `firebase emulators:exec`; seeds emulator + `--mode emulator` Vite. |
| `scripts/capture-screens.mjs`, `docs/handoff/take-screenshots.mjs` | Screenshot tools driving the Firestore-emulator REST API + `pnpm dev:seed`; `@playwright/test` consumers, broken post-teardown. |

### Firebase-emulator test suites + configs
| Path | Evidence |
|---|---|
| `tests/rules.test.ts` | `@firebase/rules-unit-testing` against the Firestore rules (deleted). knip unused file. |
| `tests/integration/mutate.test.ts` | Firebase-admin transaction test against the emulator (the old client envelope). |
| `tests/integration/costEnsemble.test.ts` | Drives cost modules against a live Firestore emulator; pure cost logic is covered by `shared/src/cost/*.test.ts`. |
| `vitest.rules.config.ts`, `vitest.integration.config.ts` | Configs for the two emulator suites (hard-wire `VITE_USE_EMULATORS=true`). |
| `playwright.config.ts`, `e2e/axe.spec.ts`, `e2e/smoke.spec.ts` | e2e via `firebase emulators:exec`; `@playwright/test` + `@axe-core/playwright`. |

### Firestore-only client helpers (extracted from the retired `firebase.adapter.ts`)
| Path | Evidence |
|---|---|
| `app/src/lib/backend/envelope.ts` (+ `envelope.test.ts`) | The client mutation envelope. Imported by **only** its test (grep for every export); `server/lib/data.js` owns the live envelope. |
| `app/src/lib/backend/refIdAlloc.ts` (+ `refId.test.ts`) | refId helpers for the retired adapter; test-only. |
| `app/src/lib/backend/coverageParent.ts` (+ `coverageParent.test.ts`) | `validateCoverageParent`; test-only. |

### App files superseded by the unified importer / unused
| Path | Evidence |
|---|---|
| `app/src/components/product/FilingImportModal.tsx` | knip unused file; superseded by `UnifiedImportModal` (grep: no importer, only comments). |
| `app/src/lib/import/filingImportClient.ts` | Imported only by `FilingImportModal` (also removed); `unifiedImportClient.ts` is the live path. |
| `app/src/components/product/BaseFormExtract.tsx` | knip unused file; no importer (only "mirrors BaseFormExtract" comments in the live `BaseFormsLibrary`/`baseForm.ts`). |
| `app/src/lib/svg/ratingFlow.tsx` | knip unused file; zero importers (only an `app/CLAUDE.md` mention, now updated). |

### App env
| Path | Evidence |
|---|---|
| `app/.env.emulator` | `--mode emulator` Vite env (`VITE_USE_EMULATORS=true`); the only consumers (`dev:emulator`, `e2e-serve`) are removed. |

*(Not tracked, left as-is: `docs/review/_capture.mjs` / `_pdf.mjs` are gitignored local recon tools —
self-documented "Not committed" — so they are not repo dead weight.)*

## DEP REMOVAL (lockfile synced: −66 packages)

| package.json | Removed | Evidence |
|---|---|---|
| `app` (dep) | `firebase` | depcheck + knip unused; zero `firebase*` imports in `app/`/`shared/` (grep). |
| root (devDep) | `firebase`, `firebase-admin` | Only used by the removed `seed.ts` + `tests/*` (grep). functions keeps its own copies. |
| root (devDep) | `@firebase/rules-unit-testing` | Only `tests/rules.test.ts` + `tests/integration/mutate.test.ts`. |
| root (devDep) | `@playwright/test`, `@axe-core/playwright` | Only the removed `e2e/*`, `playwright.config.ts`, and emulator-bound capture scripts. |
| root (devDep) | `concurrently` | Only the removed `dev:all`/`dev:seed`/`spinup` scripts. |
| root (devDep) | `pdf-lib` | Only `seed.ts` (dynamic import, PDF base-form seeding). |

Kept root devDeps: `jsdom` (root vitest DOM tests), `tsx` (`eval` + `migrate-to-cosmos`), `vitest`.

## EDITS (non-deletion)

- `package.json` — dropped Firebase scripts (`emulators`, `dev:all`, `dev:seed`, `spinup`, `seed`,
  `cors:set`, `cors:get`, `test:rules`, `test:integration`, `test:e2e`, `deploy`); `test` → `test:unit`.
- `app/package.json` — removed `firebase` dep; `dev` → `vite` (guard deleted); removed `dev:emulator`.
- `app/src/lib/backend/types.ts` — removed the dead `signInAsDevAdmin?()` member; corrected comments
  that named deleted artifacts (`firebase.adapter.ts`, `firestore.rules`, "Firebase callable",
  the "AWS-SWAP" framing) to the Azure reality.
- `app/.env.development` — dropped dead `VITE_USE_EMULATORS` + `VITE_ALLOW_GUEST` (no `app/src`
  reader); documented `VITE_API_BASE`; kept the live `VITE_MAINTAINER_EMAIL` note.
- `CLAUDE.md`, `app/CLAUDE.md`, `functions/CLAUDE.md` — updated the stale Firebase operational
  sections (backend line, quick-start, environment safety, invariant enforcement locations,
  dev-bypass gotcha) to the Azure host reality. `GROUND_TRUTH.md` — appended V18.

## Hygiene

- **console/debug noise:** `shared/src` has zero `console.log/debug`; `app/src` has only
  `ErrorBoundary` (`console.error` in `componentDidCatch` — standard, kept). `server/*` uses
  console for host-lifecycle logs (operational, kept); `functions/` uses its structured `logger.ts`.
  Nothing removed — the shipped browser/shared paths were already clean.
- **tokens-only hex:** grep of `app/src` for hex outside `index.css` → only `app/src/brand/*`
  (SVG/HTML assets, allowed export exception) and `FeedbackProvider.tsx` (`<canvas>` fill colors
  baked into a raster screenshot annotation — the documented export exception). No violations. The
  deleted `ratingFlow.tsx` removed one more SVG-export hex site.
- **secrets:** grep of the tree + git index for `sk-ant-`, `AccountKey=`, `AccountEndpoint=`,
  `-----BEGIN`, `AZURE_FOUNDRY_KEY=…`, `COSMOS_KEY=…` → only a `sk-ant-xxxxxxxx` **placeholder** in
  `functions/.env.local.example`, doc-format mentions, and a snowchat runtime cert-builder. **No
  committed secret.** Server reads all keys from `process.env` (`server/lib/*`).
- **purpose comments:** every touched module retains/updates its 1–3 line header comment.

## Measurements — before → after

| Metric | Before | After | Δ |
|---|---|---|---|
| Git-tracked files | 1203 | 1172 | **−31** |
| — excluding `snowchat/` | 529 | 498 | −31 |
| Dependency entries (all package.json) | 49 | 41 | **−8** |
| — root devDeps | 10 | 3 | −7 |
| — app deps | 12 | 11 | −1 (`firebase`) |
| Installed npm packages (pnpm) | — | — | **−66** |
| Unit test files / tests | 73 / 806 | 70 / 764 | −3 / −42 (deleted dead-code tests only) |
| Production JS bundle (`dist/assets/*.js`, 45 chunks) | ~2200.3 kB | ~2200.3 kB | **0** (byte-identical per chunk) |
| Production CSS (`index.css`) | 79.90 kB | 79.87 kB | −0.03 kB (Tailwind purge of removed components' classes) |
| Largest chunks | `exceljs` 929.9 · `index` 334.8 · `src` 149.4 kB | identical | 0 |
| Gate | typecheck·lint·test·build ✓ | typecheck·lint·test·build ✓ | green |
| Canaries | 1528 / 1002 / 2635 / 1281 | 1528 / 1002 / 2635 / 1281 | **exact** |

The JS bundle is **byte-identical** — every removed file/dep had zero importers, so none was in any
chunk; the value here is file/dependency-count reduction and repo coherence, not shipped bytes. The
CSS shrank 0.03 kB because Tailwind's content scan no longer sees classes used only by the three
removed components. Route-level `lazy()` code-splitting (App.tsx) is intact (45 chunks, unchanged).

## Idempotency

A second run finds nothing new to remove: the remaining knip hits are the documented keep-list
(`functions/`, `snowchat/`, CLI scripts, ambient `.d.ts`, string-registered `sw.js`, public API
exports). The Firebase spine is gone; `pnpm hygiene` re-runs cleanly against the keep-list.
