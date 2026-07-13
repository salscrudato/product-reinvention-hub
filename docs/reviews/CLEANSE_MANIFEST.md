# Cleanse Manifest — session 2026-07-09

Recursive cleanse of material that does not contribute to the working software. **Rule:** every
deletion is backed by tool output *and/or* a zero-reference grep; ambiguity ⇒ keep-with-reason.
Zero functionality removed. Tools: `knip`, `depcheck`, `ts-prune` (via `pnpm dlx`); output in the
session scratchpad. Companion: `BASELINE.md`, `GROUND_TRUTH.md`.

## Tooling summary

- **depcheck** (per workspace): `functions` clean; `shared` clean; `app` → only false positives
  (`tailwindcss` is used via `@tailwindcss/vite` + `@import "tailwindcss"` in `index.css`;
  `vitest` is a hoisted root devDep). Root → `typescript` flagged unused (see DEP-01).
- **knip** (monorepo): 56 "unused files", 2 devDeps, 29 exports, 28 types. High false-positive
  rate here — it flags test entry files, `vitest.*.config.ts`, ambient `.d.ts`, the AWS/retrieval
  placeholders (keep-list), and every `snowchat/` file (separate app). Each non-obvious hit was
  re-verified with a zero-reference grep before any action.
- **ts-prune**: no additional actionable unused exports for `app` beyond knip.

---

## DELETE — evidence-backed, zero functionality removed

| # | Path | Evidence |
|---|---|---|
| D1 | `ADGenPro/` (`ADGenPro/ADGenPro`) | 0-byte empty file; `grep` 0 references anywhere. Litter. |
| D2 | `ProductHub/` (`ProductHub/ProductHub.md`) | 4-byte stub (contents: `Test`); `grep` 0 references. Litter. |
| D3 | `app/src/components/home/PortfolioPulse.tsx` | knip unused-file + `grep` 0 importers (no import, lazy-import, or comment reference). |
| D4 | `app/src/components/product/CoverageCollection.tsx` | knip unused-file + `grep` 0 importers. |
| D5 | `app/src/components/product/InventoryTable.tsx` | knip unused-file + `grep` 0 importers. |
| D6 | `app/src/components/product/SegmentFilter.tsx` | knip unused-file + `grep` 0 importers. |
| D7 | `app/src/components/tasks/TaskEditDialog.tsx` | knip unused-file + `grep` 0 importers. |
| D8 | `app/src/lib/clipboard.ts` | knip unused-file + `grep` 0 importers + no symbol usage. Pure util, dead. |
| D9 | `verify-build.mjs` | knip unused-file; not wired into any `package.json` script; duplicates the documented gate (`pnpm typecheck && lint && test && build`). |

## RELOCATE

| # | From → To | Rationale |
|---|---|---|
| R1 | `fable-handoff/` → `docs/handoff/` | Reference material, not runtime (untracked prior-session artifacts). Prompt-directed: relocate, don't delete. |

## DEP REMOVAL

| # | Package.json | Change | Evidence |
|---|---|---|---|
| DEP-01 | root `package.json` | remove devDep `typescript` | depcheck (root) flags unused; no root `tsc` invocation (`typecheck` = `pnpm -r typecheck` delegates to each workspace, which each declare their own `typescript ~6.0.2`); `seed`/scripts run via `tsx`. Re-verified by running the full gate after removal + `pnpm install`. |

---

## KEEP — with reason (evaluated, NOT touched)

**Explicit keep-list (never touched):** seed data · `samples/` fixtures · `docs/reviews` outputs ·
ADRs + all `CLAUDE.md` · `functions/src/retrieval/placeholder.ts` + every AWS-SWAP marker ·
emulator + Playwright configs · `.env` examples.

| Item | Why kept |
|---|---|
| `snowchat/` (674 files) | Separate Python/JS project; **not** a `pnpm-workspace` package, zero references from the Hub, not built or gated. Removing it removes zero Hub functionality — but it is a coherent, self-contained codebase, not incidental litter. **Largest single removal candidate; flagged for owner decision rather than deleted unilaterally** (deleting a 674-file project is not reviewable in a diff). |
| `reference_tasks/*.xlsx` | Cited by `shared/src/seed/personalHome.ts` as provenance for the Level-4 task activities. Seed-linked reference. |
| `app/src/components/product/BaseFormExtract.tsx` | Zero importers, BUT referenced by code comments in `BaseFormsLibrary.tsx` + `lib/product/baseForm.ts` as the canonical base64-chunk pattern. Looks like an unwired feature (§8B/§10.1). Ambiguous ⇒ keep-with-note; owner to wire or remove. |
| `app/src/lib/svg/ratingFlow.tsx` | Zero importers, BUT cited in `app/CLAUDE.md` as the canonical example of the SVG-hex-export design-token exception. Keeping preserves the doc. |
| `docs/review/_capture.mjs`, `docs/review/_pdf.mjs` | Unwired, BUT part of `docs/review/` provenance (which `GROUND_TRUTH.md` cites via `docs/review/shots/…`). Review tooling; low value to remove. |
| `functions/src/news.ts → backfillNewsImages` | One-time migration admin callable, still exported. Can't confirm from the repo whether every news doc now carries an `image` field, so removal could strand un-backfilled docs. Keep-with-note. |
| `samples/iso/sample-PH-baseform-HO3.pdf`, `samples/mock/*.md` | Not consumed by an automated test, but `samples/` is a keep area and these are plausible manual Claims-flow demo fixtures. |
| knip "unused exports" (29) + "types" (28) | Reviewed: dominated by false positives — public adapter API surface (`index.ts`: `BackendAdapter`/`Session`/`MutationPayload`, `MutationConflictError`), symbols used **internally** within their own module (e.g. `searchIndexEntry` in `envelope.ts`), or test/eval-consumed. **Unused exports are tree-shaken out of the production bundle**, so they add zero weight; removing the `export` keyword is pure cosmetics with breakage risk. Per "ambiguity ⇒ keep", not modified. |
| `app/src/fontsource.d.ts` | Ambient module declaration for `@fontsource-variable/*` CSS imports — used by the compiler, not "imported". knip false positive. |
| `app/public/sw.js` | Registered at runtime in `main.tsx` (`navigator.serviceWorker.register('/sw.js')`, PROD only). Live asset. |
| `scripts/e2e-serve.mjs`, `vitest.integration.config.ts`, `vitest.rules.config.ts`, `tests/*.test.ts` | knip false positives — Playwright `webServer` command / vitest configs referenced by `package.json` `--config` / test entry points run by vitest. |
| root devDeps `@firebase/rules-unit-testing`, `firebase` | knip false positives — imported by `tests/rules.test.ts` + `tests/integration/mutate.test.ts`. |
| `aws.adapter.placeholder.ts`, `functions/src/retrieval/placeholder.ts` | Explicit keep-list (AWS-SWAP / retrieval seam — intentional architecture). |

## Litter / build outputs

- No tracked build outputs (`dist/`, `build/`, `functions/lib/`) — all gitignored.
- No tracked OS/editor litter (`.DS_Store`, `Thumbs.db`, `*.swp`, …).

---

## Measurements — before → after

| Metric | Before | After | Δ |
|---|---|---|---|
| Git-tracked files | 1065 | 1056 | −9 |
| Root devDependencies | 10 | 9 | −1 (`typescript`) |
| App deps / devDeps | 12 / 12 | 12 / 12 | — |
| Functions deps / devDeps | 3 / 5 | 3 / 5 | — |
| Shared deps / devDeps | 0 / 3 | 0 / 3 | — |
| Production bundle — `dist/assets/*.js` total | 2434.4 kB | 2434.4 kB | 0 |
| Largest chunks | `index` 824.3 kB · `exceljs` 929.9 kB (split) | identical | 0 |
| Route-level lazy chunks | 12 | 12 | 0 (no route regressed to eager) |

The bundle is **byte-identical** — every deleted file had zero importers, so none was in any
chunk. The cleanse reduced file/dependency count and removed dead code while keeping the shipped
software exactly the same size. Route-level `lazy()` code-splitting (App.tsx) is intact.

## Prevention

Added `pnpm hygiene` (root `package.json`) → `knip` + per-workspace `depcheck` via `pnpm dlx`.
Standalone drift detector; deliberately **not** wired into the gate (`typecheck · lint · test ·
build`) so its false positives can never flake CI.
