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
| **HIGH** | 3 | B6, B7, E1 |
| **MEDIUM** | 17 | A1, A3, B1, B2, B4, B8, B10, C1, C2, C3, D1✅, D2, D5, E2, E3, E5, G5 |
| **LOW** | 25 | A2, A4, A5, A6, A7, B3, B5, B9, B11, B12, C4, C5, D3, D4, D6, E4, E6, E7, F1, F3, F4, G1, G2, G3, G4 |
| **INFO** | 1 | F2 (console noise — verified clean, no action) |
| **EPIC** | 6 | H1–H6 |

**Status roll-up:** 1 DONE (D1, this prompt) · 51 OPEN. Total rows: 52.

## Backlog

| ID | Finding (short) | Sev | Effort | Phase | Status | Evidence / notes |
|---|---|:--:|:--:|:--:|:--:|---|
| **A1** | Claims is an empty shell on first run — no base form seeded; upload hits live Storage | MED | M | P7 | OPEN | `Claims.tsx`, `BaseFormsLibrary.tsx`; seed has no `baseForm`/`baseForms`. Seed one sample base form. |
| **A2** | News feed empty until nightly agent / manual refresh | LOW | S | P7 | OPEN | `News.tsx`; `news.ts:210` scheduled, emulator ignores pubsub. Seed sample news. |
| **A3** | Overview label over-claims grounding ("Grounded in the base form") — summary reads client metadata only | MED | S | P4 | OPEN | `ProductSummaryDashboard.tsx`; `summarize.ts:59-68`. Soften to "Summarized from product metadata". |
| **A4** | Two AI dollar-cost triggers auto-fire (Overview auto-summary; Home starter pills) | LOW | S | P8 | OPEN | `ProductSummaryDashboard.tsx:72-77`; `Home.tsx:186-195`. Consider a "Generate" gate. |
| **A5** | Delete uses native `window.confirm` (Coverages, Dictionary) not on-brand Dialog | LOW | S | P8 | OPEN | `ProductCoverages.tsx:100`; `Dictionary.tsx:143-159`. (= G4.) |
| **A6** | Admin console shell flashes for non-admins during profile load | LOW | S | P8 | OPEN | `Admin.tsx:43`. UX face of E5/G5. |
| **A7** | Pricing dead ternary `premium={result?.finalPremium ?? (tablesReady ? null : null)}` | LOW | S | P8 | OPEN | `ProductPricing.tsx:226`. Both branches null; simplify. |
| **B1** | `chat` swallows stream `error` events → possible silent empty answer at maxTurns | MED | M | P4 | OPEN | `ai.ts:46, 82-104`. Emit fallback/error when no text produced. |
| **B2** | `analyzeClaim` can end with `done` and no determination (silent) | MED | M | P4 | OPEN | `claims.ts:216-249`. Emit terminal "couldn't reach a grounded determination". |
| **B3** | `nightlyNews` empty catch swallows per-instruction failures (no logging) | LOW | S | P8 | OPEN | `news.ts:221-224`. Log the error. |
| **B4** | Non-atomic multi-step server writes (`setUserRole` 3 awaits no rollback; `refreshNews`; `createShare`) | MED | M | P8 | OPEN | `admin.ts:31-40`; `news.ts:173-183`; `share.ts:39-42`. Compensating cleanup on `setUserRole`. |
| **B5** | No per-request Anthropic timeout on `refreshNews`/`nightlyNews`/`describeForm` | LOW | S | P4 | OPEN | `news.ts:95`; `describeForm.ts:56`. Add SDK `timeout` like other endpoints. |
| **B6** | `mutate()` invariant has **no runtime test** (entity+audit+version+searchIndex+rev+term guard) | **HIGH** | M | P3 | OPEN | `firebase.adapter.ts:220-320`. Emulator integration test. Core write path. |
| **B7** | **All Cloud Functions untested**; `@playwright/test` installed but zero `.spec.ts` | **HIGH** | L | P3 | OPEN | `functions/*`; root `package.json:24`. Auth/role/SSE regressions ship undetected. |
| **B8** | Storage never emulated → local uploads write to the **PROD** bucket | MED | M | P5 | OPEN | `firebase.adapter.ts:33,40`. Wire Storage emulator or hard-block in dev. |
| **B9** | `expectedRev` applied inconsistently (omitted on Dictionary/share delete, News prefs, MustChangePassword) | LOW | S | P8 | OPEN | `Dictionary.tsx:143`; `Admin.tsx:201`; `News.tsx:184`; `MustChangePassword.tsx:34`. |
| **B10** | Grounding tools do full-collection scans (searchIndex/forms/dictionary/usage corpus) | MED | M | P4 | OPEN | `tools.ts:167,257,317,345-351`. Fine at seed scale; index before scale. |
| **B11** | `describeForm` writes a domain doc outside `mutate()` (no audit/version/searchIndex) | LOW | S | P2 | OPEN | `describeForm.ts:71`. Deliberate derived cache; tension with atomic invariant (= E3). |
| **B12** | rtGrid key separator is a NUL (`\0`) rendered as a space — a "cleanup" would silently break grid keys | LOW | S | P6 | OPEN | `rtGrid.ts:39`. Add explicit comment / guard. |
| **C1** | Grounding enforcement uneven — `chat` has **no** server citation guard (prompt-only) | MED | M | P4 | OPEN | `ai.ts` vs `claims.ts:222-230`. Add lightweight post-check or mark chat advisory. (= E2.) |
| **C2** | `refreshNews`/`nightlyNews` store **unverified URLs** (no existence check) | MED | M | P4 | OPEN | `news.ts:112,178`. HEAD-check or drop unresolved. |
| **C3** | PDF extraction can't verify form numbers (`verifyText=null` for base64 PDFs) | MED | M | P4 | OPEN | `extract.ts:230-232`. Extract PDF text server-side to enable grep-verify. |
| **C4** | `err.message` echoed to clients in several catch blocks | LOW | S | P4 | OPEN | `ai.ts:141`, `claims.ts:253`, `extract.ts:274`, `rules.ts:225`, `scaffoldProduct.ts:224`. Never the key; still internal text. Generic message + server log. |
| **C5** | `web_search` tool cast `as unknown as Anthropic.Tool[]` — type hole | LOW | S | P4 | OPEN | `news.ts:102`. A schema/SDK bump could break silently. |
| **D1** | Seed canary verification was non-fatal (CRITICAL warning, still completed) | MED | S | P1 | **DONE** | `scripts/seed.ts` — canary miss now accumulates + `process.exit(1)` after report; proven exit 0 (pass) / 1 (miss). *This prompt.* |
| **D2** | Rating literals duplicate table data → silent desync (`HO.RT.003` magic nums, RC `CONST 1.10`, GL terrorism `CONST 50`) | MED | M | P6 | OPEN | `ho3.ts:287,385`; `gl.ts:245`. Pull literals into tables. |
| **D3** | `RatingProgram.minimumPremium` is a dead field (floor applied via `MIN_FLOOR` step) | LOW | S | P6 | OPEN | `evaluator.ts` never reads it; `ho3.ts:364,395`; `gl.ts:235,246`. Retire the field. |
| **D4** | GL ILF trace shows `aggregateLimit` key that doesn't affect the result ("rides along for display") | LOW | S | P6 | OPEN | `gl.ts:196-198,242`. Misleading provenance in the auditable artifact. |
| **D5** | refId scheme inconsistent across lines (HO `HO.LD.*`/`HO.RT.*` vs GL `LDTable.*`/`RTTable.*`) | MED | M | P6 | OPEN | `ho3.ts:66,125` vs `gl.ts:62,114`. Normalize the scheme. |
| **D6** | Entire `LD` source path is dead code for seeded data (both getters throw) | LOW | S | P6 | OPEN | `evaluator.ts:82-87`; `ho3.ts:349-355`; `gl.ts:219-223`. Wire or remove. |
| **E1** | **Role invariant drift** — `describeForm`/`refreshNews` gate only on `req.auth` then write role-protected collections | **HIGH** | S | P2 | OPEN | `describeForm.ts:20,71`; `news.ts:192,178` vs `firestore.rules:50,84`. VIEWER can trigger a write the rules forbid. **Verified this prompt.** |
| **E2** | AI grounded+cited drift — chat unguarded, summarize unverified, PDF extract unverifiable | MED | M | P4 | OPEN | See §C1/C3. |
| **E3** | `mutate()` atomic invariant correct but untested + a few Functions write domain-ish docs outside it | MED | M | P3 | OPEN | See §B6/B11. |
| **E4** | Design tokens — no `#RRGGBB` violations in screens, but hard-coded `rgba()` literals outside `index.css` | LOW | S | P8 | OPEN | `Landing.tsx`, `AppShell.tsx:51`, `ProductWorkspace.tsx:120,245`, `CommandPalette.tsx:183,190`. (Extended by F3.) |
| **E5** | Admin gate flashes (`if (profile && profile.role!=='ADMIN')`) — console renders while `profile` null | MED | S | P2 | OPEN | `Admin.tsx:43`. Disclosure, not escalation (writes server-gated). (= A6/G5.) |
| **E6** | Docs match code — `signInAsAdmin` targets unseeded `admin@admin.com`; SignIn header stale; `canEdit()` server helper doesn't exist | LOW | S | P8 | OPEN | `firebase.adapter.ts:91-92`, `SignIn.tsx:1-3`, `runtime.ts` (inline role checks, no helper). |
| **E7** | Dev-only bypass `signInAsDevAdmin()` still present (`import.meta.env.DEV`-guarded) | LOW | S | P8 | OPEN | `firebase.adapter.ts:79-96,163-168`. Remove before prod. |
| **F1** | Dead code — `StubRoute.tsx` (imported by nothing), the `LD` branch + getters, `minimumPremium` | LOW | S | P8 | OPEN | `routes/stub/StubRoute.tsx`; see D3/D6. Remove. |
| **F2** | Console noise — verified essentially clean (only intentional `ErrorBoundary` + adapter warn) | INFO | — | — | OPEN | `ErrorBoundary.tsx:19`; `firebase.adapter.ts:205`. No action. |
| **F3** | Hard-coded color inventory — `rgba()` literals (= E4) **plus** hex in browser-rendered brand SVGs | LOW | S-M | P8 | OPEN | **New drift found this prompt:** `Logo.tsx:15` (`#A100FF`/`#8B1FE0`/`#6D28D9`), `HeroMark.tsx:48-53` (`#FFFFFF`) render in-browser (not disk-export). Tokenize or document as brand-mark exception. |
| **F4** | Tooling gaps — `functions`/`shared` lint are `echo` no-ops; `pnpm test` excludes `test:rules`; TS drift (app ~6.0 vs ~5.7) | LOW | S | P8 | OPEN | Workspace `package.json`s; root `package.json`. |
| **G1** | Token-by-token SSE verbose under screen readers (Home + Claims `role="log"`) | LOW | S | P8 | OPEN | `Home.tsx:154`, `Claims.tsx`. Debounced "response ready" announcement. |
| **G2** | `--color-danger` (#DC2626) is 4.37:1 on `raised` — below AA for small text | LOW | S | P8 | OPEN | `index.css`. Not currently on `raised`; darken before such use. |
| **G3** | News `role="feed"` children are anchors, not `role="article"` | LOW | S | P8 | OPEN | `News.tsx`. Minor semantic mismatch. |
| **G4** | Dictionary delete native `window.confirm` (a11y-ok, off-brand) | LOW | S | P8 | OPEN | Duplicate of A5. |
| **G5** | Admin gate flash — also a disclosure/a11y concern | MED | S | P2 | OPEN | Duplicate of E5/A6. |
| **H1** | **Epic:** close the two-sided role invariant (gate `describeForm`/`refreshNews`) | EPIC | S | P2 | OPEN | Rolls up E1 (+ E5). Highest-severity guardrail drift, small fix. |
| **H2** | **Epic:** test the load-bearing write path + role guards + wire Playwright | EPIC | M-L | P3 | OPEN | Rolls up B6, B7 (+ E3). |
| **H3** | **Epic:** make AI grounding uniform (chat post-check, verify news URLs, PDF text) | EPIC | M | P4 | OPEN | Rolls up C1, C2, C3 (+ B1, B2, E2). |
| **H4** | **Epic:** fix the local Storage prod-write footgun | EPIC | M | P5 | OPEN | Rolls up B8. |
| **H5** | **Epic:** data-truth hardening of the rating seams | EPIC | M | P6 | OPEN | Rolls up D1✅, D2, D3, D4 (+ D5, D6, B12). |
| **H6** | **Epic:** demo-readiness (seed sample base form + news) | EPIC | S-M | P7 | OPEN | Rolls up A1, A2. |
