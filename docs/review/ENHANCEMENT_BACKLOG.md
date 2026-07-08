# ENHANCEMENT_BACKLOG.md — the triage instrument

> **One row per finding** from [OBSERVATIONS.md](OBSERVATIONS.md), triaged into an
> executable plan. This is the ledger **every later prompt updates**: when a finding is
> addressed, flip its **Status** to `DONE` (with the commit) or `WONTFIX` (with a reason).
> Do not renumber — the IDs (`A1..H6`) are stable references back to OBSERVATIONS.
>
> **Provenance.** Findings, effort (S/M/L) and the §E severities are lifted verbatim from
> OBSERVATIONS. Severities for the non-§E findings are **triage estimates** made here
> (OBSERVATIONS only assigned explicit severity in §E); refine as the plan proceeds.
> Established against the live emulator stack with both canaries green (**HO-3 $1,528**,
> **GL $2,789**). Code beats docs; one new drift found while verifying is flagged in F3.

## Phase legend

The phases are the [OBSERVATIONS §H shortlist](OBSERVATIONS.md) turned into an ordered plan.
Each atomic finding is mapped to the phase that will resolve it; the `H*` rows are the
epics those phases roll up to.

| Phase | Theme | Rolls up |
|---|---|---|
| **P1** | Baseline: verification, fatal canaries, this backlog *(this prompt)* | D1 |
| **P2** | Close the two-sided **role/security** invariant | H1 · E1 · E5 |
| **P3** | **Test** the load-bearing write path + role guards (wire Playwright) | H2 · B6 · B7 |
| **P4** | Make **AI grounding** uniform + AI robustness | H3 · C1–C5 · B1 · B2 |
| **P5** | Fix the local **Storage** prod-write footgun | H4 · B8 |
| **P6** | **Rating data-truth** hardening (literals → tables, dead fields) | H5 · D2–D6 · B12 |
| **P7** | **Demo-readiness** (seed sample base form + news) | H6 · A1 · A2 |
| **P8** | Robustness, doc-drift & polish cleanup | remaining B/A/E/F/G |

## Severity snapshot (atomic findings A–G; H are epics)

| Severity | Count | IDs |
|---|---|---|
| **HIGH** | 0 open | *(B6✅ B7✅ E1✅)* |
| **MEDIUM** | 9 open | A1, A3, B1, B2, B10, C1, C2, C3, E2 *(B4✅ B8✅ D1✅ D2✅ D5✅ E3✅ E5✅ G5✅)* |
| **LOW** | 11 open | A2, A4, A5, A7, B3, E4, F3, G1, G2, G3, G4 *(B5✅ B9✅ B11✅ B12✅ C4✅ C5✅ D3✅ D4✅ D6✅ E6✅ E7✅ F1✅ F4✅)* |
| **INFO** | 1 | F2 (console noise — verified clean, no action) |
| **EPIC** | 6 | H1–H6 |

**Status roll-up:** 27 DONE (D1, D2, D3, D4, D5, D6, B4, B5, B6, B7, B8, B9, B11, B12, C4, C5, E1, E3, E5, E6, E7, F1, F4, H1, H2, H4, H5) · 25 OPEN. Total rows: 52.

## Backlog

| ID | Finding (short) | Sev | Effort | Phase | Status | Evidence / notes |
|---|---|:--:|:--:|:--:|:--:|---|
| **A1** | Claims is an empty shell on first run — no base form seeded; upload hits live Storage | MED | M | P7 | OPEN | `Claims.tsx`, `BaseFormsLibrary.tsx`; seed has no `baseForm`/`baseForms`. Seed one sample base form. |
| **A2** | News feed empty until nightly agent / manual refresh | LOW | S | P7 | OPEN | `News.tsx`; `news.ts:210` scheduled, emulator ignores pubsub. Seed sample news. |
| **A3** | Overview label over-claims grounding ("Grounded in the base form") — summary reads client metadata only | MED | S | P4 | OPEN | `ProductSummaryDashboard.tsx`; `summarize.ts:59-68`. Soften to "Summarized from product metadata". |
| **A4** | Two AI dollar-cost triggers auto-fire (Overview auto-summary; Home starter pills) | LOW | S | P8 | OPEN | `ProductSummaryDashboard.tsx:72-77`; `Home.tsx:186-195`. Consider a "Generate" gate. |
| **A5** | Delete uses native `window.confirm` (Coverages, Dictionary) not on-brand Dialog | LOW | S | P8 | OPEN | `ProductCoverages.tsx:100`; `Dictionary.tsx:143-159`. (= G4.) |
| **A6** | Admin console shell flashes for non-admins during profile load | LOW | S | P8 | **DONE** | Closed by E5 — `loading` guard added to `Admin.tsx`. |
| **A7** | Pricing dead ternary `premium={result?.finalPremium ?? (tablesReady ? null : null)}` | LOW | S | P8 | OPEN | `ProductPricing.tsx:226`. Both branches null; simplify. |
| **B1** | `chat` swallows stream `error` events → possible silent empty answer at maxTurns | MED | M | P4 | OPEN | `ai.ts:46, 82-104`. Emit fallback/error when no text produced. |
| **B2** | `analyzeClaim` can end with `done` and no determination (silent) | MED | M | P4 | OPEN | `claims.ts:216-249`. Emit terminal "couldn't reach a grounded determination". |
| **B3** | `nightlyNews` empty catch swallows per-instruction failures (no logging) | LOW | S | P8 | OPEN | `news.ts:221-224`. Log the error. |
| **B4** | Non-atomic multi-step server writes (`setUserRole` 3 awaits no rollback; `refreshNews`; `createShare`) | MED | M | P8 | **DONE** | `setUserRole` create wraps claim+mirror writes in a compensating `auth.deleteUser` rollback (no orphan account) + `requireRole`; `createShare` reads product+coverages in ONE `runTransaction` (consistent snapshot) and stamps `rev:1`; `storeItems` dedup is now a transactional check-and-set. *This prompt.* |
| **B5** | No per-request Anthropic timeout on `refreshNews`/`nightlyNews`/`describeForm` | LOW | S | P4 | **DONE** | `timeout: 60_000` added to `fetchForInstruction`; `timeout: 45_000` to `describeForm`. |
| **B6** | `mutate()` invariant has **no runtime test** (entity+audit+version+searchIndex+rev+term guard) | **HIGH** | M | P3 | **DONE** | `tests/integration/mutate.test.ts` (emulator, real adapter): asserts create-envelope, rev bump + field diff, **conflict rejection on stale expectedRev**, term-guard abort (nothing persists), delete + searchIndex removal, non-indexable skip. Runs in the gate via `test:integration`. *This prompt.* |
| **B7** | **All Cloud Functions untested**; `@playwright/test` installed but zero `.spec.ts` | **HIGH** | L | P3 | **DONE** | `functions/src/guards.test.ts` invokes the real callables via `.run()` — VIEWER/EDITOR/anon rejected by setUserRole/describeForm/refreshNews; `sse.test.ts` covers the SSE happy+error framing; `e2e/smoke.spec.ts` (real chromium + full emulator stack) drives sign-in → the reseeded portfolio. All in the gate (`test:e2e`). *This prompt.* |
| **B8** | Storage never emulated → local uploads write to the **PROD** bucket | MED | M | P5 | **DONE** | `firebase.adapter.ts` now `connectStorageEmulator(…9199)` inside the emulator block (firebase.json already declared it). Proven by `mutate.test.ts` B8 case: `storage.upload`/`getUrl` resolve to `127.0.0.1:9199`, never `firebasestorage.googleapis.com`. *This prompt.* |
| **B9** | `expectedRev` applied inconsistently (omitted on Dictionary/share delete, News prefs, MustChangePassword) | LOW | S | P8 | **DONE** | `expectedRev` now threaded through all four: Dictionary delete (`draft.source.rev`), News prefs (tracked from the subscription), Admin share delete (createShare stamps `rev:1`), MustChangePassword (reads current rev) — each with a `MutationConflictError` toast. *This prompt.* |
| **B10** | Grounding tools do full-collection scans (searchIndex/forms/dictionary/usage corpus) | MED | M | P4 | OPEN | `tools.ts:167,257,317,345-351`. Fine at seed scale; index before scale. |
| **B11** | `describeForm` writes a domain doc outside `mutate()` (no audit/version/searchIndex) | LOW | S | P2 | **DONE** | New `functions/src/audited.ts` (`auditedMerge`) mirrors the client `mutate()` envelope server-side (entity + auditEvent + version diff + searchIndex, one Admin-SDK transaction); `describeForm` writes the AI description through it, attributed to the acting EDITOR/ADMIN. searchIndex step MERGES keywords so it never clobbers the seed's richer form display. *This prompt.* |
| **B12** | rtGrid key separator is a NUL (`\0`) rendered as a space — a "cleanup" would silently break grid keys | LOW | S | P6 | **DONE** | `rtGrid.ts` — `SEP` is now written as an explicit `U+0000` escape (identical runtime value, no raw NUL byte in source) with a 5-line warning comment against turning it into a space; `joinKey`/`splitKey` and the app grid editor that shares them are unchanged. *This prompt (P6).* |
| **C1** | Grounding enforcement uneven — `chat` has **no** server citation guard (prompt-only) | MED | M | P4 | OPEN | `ai.ts` vs `claims.ts:222-230`. Add lightweight post-check or mark chat advisory. (= E2.) |
| **C2** | `refreshNews`/`nightlyNews` store **unverified URLs** (no existence check) | MED | M | P4 | OPEN | `news.ts:112,178`. HEAD-check or drop unresolved. |
| **C3** | PDF extraction can't verify form numbers (`verifyText=null` for base64 PDFs) | MED | M | P4 | OPEN | `extract.ts:230-232`. Extract PDF text server-side to enable grep-verify. |
| **C4** | `err.message` echoed to clients in several catch blocks | LOW | S | P4 | **DONE** | Generic client messages + `console.error` server logs in ai/claims/extract/rules/scaffoldProduct/news. |
| **C5** | `web_search` tool cast `as unknown as Anthropic.Tool[]` — type hole | LOW | S | P4 | **DONE** | Typed with `satisfies Anthropic.WebSearchTool20250305` — SDK schema changes now caught at compile time. |
| **D1** | Seed canary verification was non-fatal (CRITICAL warning, still completed) | MED | S | P1 | **DONE** | `scripts/seed.ts` — canary miss now accumulates + `process.exit(1)` after report; proven exit 0 (pass) / 1 (miss). *This prompt.* |
| **D2** | Rating literals duplicate table data → silent desync (`HO.RT.003` magic nums, RC `CONST 1.10`, GL terrorism `CONST 50`) | MED | M | P6 | **DONE** | `personalHome.ts` — `PH.RT.003` extrapolation now reads the top tabulated row (removed the `1.94`/`600000` literals that duplicated table cells); the `+0.32/100k` slope is an algorithm param, duplicates nothing. RC `CONST 1.10` is the *sole* source (no RC table → not a duplicate; kept). GL removed in P4. Locked by `seed/seedIntegrity.test.ts` (editing a factor moves the premium). *P6.* |
| **D3** | `RatingProgram.minimumPremium` is a dead field (floor applied via `MIN_FLOOR` step) | LOW | S | P6 | **DONE** | Superseded: the field is now *live* (displayed on `PremiumCard`, fed to AI context via `summarize`/`tools`), so it is NOT retired. Instead single-sourced — a per-line `P{H,A}_MINIMUM_PREMIUM` const feeds BOTH the field and the `MIN_FLOOR` step's `CONST`, so declared floor == applied floor. One mechanism. Test asserts field == step const. *P6.* |
| **D4** | GL ILF trace shows `aggregateLimit` key that doesn't affect the result ("rides along for display") | LOW | S | P6 | **DONE** | Verified clean in the P4 seeds: audited every step in both `PH.RAT.1` / `PA.RAT.1` — each declared `keys` entry is consumed by its getter (no ride-along). The offending GL step was removed with the GL seed in P4. Nothing to fix. *P6.* |
| **D5** | refId scheme inconsistent across lines (HO `HO.LD.*`/`HO.RT.*` vs GL `LDTable.*`/`RTTable.*`) | MED | M | P6 | **DONE** | The P4 reseed made both lines uniformly line-prefixed (`PH.*` / `PA.*`) — the un-prefixed GL `LDTable.*`/`RTTable.*` are gone. Locked by `seedIntegrity.test.ts` (every seeded refId for each product carries its line prefix). Forms keep ISO numbers by design (separate scheme). *P6.* |
| **D6** | Entire `LD` source path is dead code for seeded data (both getters throw) | LOW | S | P6 | **DONE** | **Chose WIRE** (not remove): `'LD'` is a valid `RatingStep.source.type` in the shared contract (additive-types invariant forbids removing it) **and** the rating-step editor offers it, so the branch is reachable via user data — it must work, not throw. New shared `rating/ldGetter.ts` (`makeLdGetter`) resolves the selected option to its numeric value; both seeds re-export it (no more throwing stubs). Test proves it evaluates end-to-end; INPUT branch also covered. *P6.* |
| **E1** | **Role invariant drift** — `describeForm`/`refreshNews` gate only on `req.auth` then write role-protected collections | **HIGH** | S | P2 | **DONE** | `requireRole(req.auth,'EDITOR','ADMIN')` in `describeForm`; `requireRole(req.auth,'ADMIN')` in `refreshNews`. `requireRole` helper in `runtime.ts`; unit tests in `functions/src/roleGuard.test.ts`. |
| **E2** | AI grounded+cited drift — chat unguarded, summarize unverified, PDF extract unverifiable | MED | M | P4 | OPEN | See §C1/C3. |
| **E3** | `mutate()` atomic invariant correct but untested + a few Functions write domain-ish docs outside it | MED | M | P3 | **DONE** | Closed by B6 (runtime integration test) + B11 (`describeForm` now audited via `auditedMerge`). `refreshNews`/`createShare` are system/snapshot docs, now transactional (B4). *This prompt.* |
| **E4** | Design tokens — no `#RRGGBB` violations in screens, but hard-coded `rgba()` literals outside `index.css` | LOW | S | P8 | OPEN | `Landing.tsx`, `AppShell.tsx:51`, `ProductWorkspace.tsx:120,245`, `CommandPalette.tsx:183,190`. (Extended by F3.) |
| **E5** | Admin gate flashes (`if (profile && profile.role!=='ADMIN')`) — console renders while `profile` null | MED | S | P2 | **DONE** | `Admin.tsx` now returns `null` while `loading \|\| !profile`; role enforced after resolve. |
| **E6** | Docs match code — `signInAsAdmin` targets unseeded `admin@admin.com`; SignIn header stale; `canEdit()` server helper doesn't exist | LOW | S | P8 | **DONE** | `DEMO_ADMIN_EMAIL` → `sal@productreinvention.app`; SignIn.tsx header cleaned; `functions/CLAUDE.md` corrected. |
| **E7** | Dev-only bypass `signInAsDevAdmin()` still present (`import.meta.env.DEV`-guarded) | LOW | S | P8 | **DONE** | Kept (DEV-guarded, harmless in prod); comment updated to `// REMOVE-BEFORE-PROD`. Intentional. |
| **F1** | Dead code — `StubRoute.tsx` (imported by nothing), the `LD` branch + getters, `minimumPremium` | LOW | S | P8 | **DONE** | `LD` branch wired+tested (D6) and `minimumPremium` live+single-sourced (D3). `app/src/routes/stub/StubRoute.tsx` now **removed** (grep-confirmed unused — only doc references remained). *This prompt.* |
| **F2** | Console noise — verified essentially clean (only intentional `ErrorBoundary` + adapter warn) | INFO | — | — | OPEN | `ErrorBoundary.tsx:19`; `firebase.adapter.ts:205`. No action. |
| **F3** | Hard-coded color inventory — `rgba()` literals (= E4) **plus** hex in browser-rendered brand SVGs | LOW | S-M | P8 | OPEN | **New drift found this prompt:** `Logo.tsx:15` (`#A100FF`/`#8B1FE0`/`#6D28D9`), `HeroMark.tsx:48-53` (`#FFFFFF`) render in-browser (not disk-export). Tokenize or document as brand-mark exception. |
| **F4** | Tooling gaps — `functions`/`shared` lint are `echo` no-ops; `pnpm test` excludes `test:rules`; TS drift (app ~6.0 vs ~5.7) | LOW | S | P8 | **DONE** | `functions`/`shared` lint now run real `oxlint src` (+ `.oxlintrc.json`); `pnpm test` chains `test:rules` + `test:integration` + `test:e2e`; TS unified to `~6.0.2` (6.0.3) across all workspaces (`functions/tsconfig.json` typecheck-only, tsup owns emit). *This prompt.* |
| **G1** | Token-by-token SSE verbose under screen readers (Home + Claims `role="log"`) | LOW | S | P8 | OPEN | `Home.tsx:154`, `Claims.tsx`. Debounced "response ready" announcement. |
| **G2** | `--color-danger` (#DC2626) is 4.37:1 on `raised` — below AA for small text | LOW | S | P8 | OPEN | `index.css`. Not currently on `raised`; darken before such use. |
| **G3** | News `role="feed"` children are anchors, not `role="article"` | LOW | S | P8 | OPEN | `News.tsx`. Minor semantic mismatch. |
| **G4** | Dictionary delete native `window.confirm` (a11y-ok, off-brand) | LOW | S | P8 | OPEN | Duplicate of A5. |
| **G5** | Admin gate flash — also a disclosure/a11y concern | MED | S | P2 | **DONE** | Closed by E5/A6. |
| **H1** | **Epic:** close the two-sided role invariant (gate `describeForm`/`refreshNews`) | EPIC | S | P2 | **DONE** | E1 + E5 both closed. `requireRole` helper in runtime.ts; unit tests in roleGuard.test.ts. |
| **H2** | **Epic:** test the load-bearing write path + role guards + wire Playwright | EPIC | M-L | P3 | **DONE** | B6 (mutate integration), B7 (functions guard/SSE tests + real Playwright smoke) and E3 all closed; every suite runs in the gate. *This prompt.* |
| **H3** | **Epic:** make AI grounding uniform (chat post-check, verify news URLs, PDF text) | EPIC | M | P4 | OPEN | Rolls up C1, C2, C3 (+ B1, B2, E2). |
| **H4** | **Epic:** fix the local Storage prod-write footgun | EPIC | M | P5 | **DONE** | B8 closed — Storage emulator wired; integration test proves local uploads resolve to the emulator, never prod. *This prompt.* |
| **H5** | **Epic:** data-truth hardening of the rating seams | EPIC | M | P6 | **DONE** | All rolled-up findings closed: D1✅ D2✅ D3✅ D4✅ D5✅ D6✅ B12✅. The $1,528/$1,002 provenance is now self-consistent (no literal/table desync, one minimum-premium mechanism, uniform line-prefixed refIds, no throwing/dead engine branch, explicit grid separator) and each is locked by a test. *P6.* |
| **H6** | **Epic:** demo-readiness (seed sample base form + news) | EPIC | S-M | P7 | OPEN | Rolls up A1, A2. |
