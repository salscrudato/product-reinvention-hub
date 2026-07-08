# OBSERVATIONS.md — opinionated findings (enhancement raw material)

> Hostile-reviewer pass over the Product Reinvention Hub monorepo, run against the live local
> emulator stack (canaries green: HO-3 **$1,528**, GL **$2,789**). Findings are grouped, each with
> **what / where / why / effort (S·M·L)**. This is input for the enhancement plan, not a defect
> ledger — the codebase is unusually clean in several places (subscription hygiene, token
> discipline, grounded-AI guards), and those are called out honestly so effort lands where it pays.
> The elevation scoreboard already drove a11y/states/domain-truth ≥4.5 on every surface, so most of
> what remains is **backend robustness, AI grounding evenness, and data-truth of derived values** —
> not visual polish.

---

## A. UX / customer-experience friction (per screen)

| # | What | Where | Why it matters | Effort |
|---|---|---|---|---|
| A1 | **Claims first-run is an empty shell.** No base forms are seeded, so Claims opens on its zero-state until an EDITOR uploads a PDF; and uploading hits **live** Storage even locally (§B8). A demo/first-run user sees nothing to try. | `Claims.tsx`, `BaseFormsLibrary.tsx`; seed has no `baseForm`/`baseForms` (`shared/src/seed/*`) | The flagship AI surface looks broken/empty on a fresh environment. Seeding one sample base form (or a local-only sample) would make Claims demoable out of the box. | M |
| A2 | **News is empty until the nightly agent or a manual refresh runs.** `nightlyNews` is pubsub-scheduled (ignored by the emulator), so locally the feed is blank until someone clicks Refresh. | `News.tsx`; `functions/src/news.ts:210` | Another AI surface that looks empty on first load; a seeded sample news set would help demos. | S |
| A3 | **Overview AI summary label may over-claim grounding.** The header renders "Grounded in the base form `<formNumber>`", but `summarizeProduct` only reads **client-supplied metadata** (never the PDF). | `ProductSummaryDashboard.tsx`; `functions/src/summarize.ts:59-68` | Reads as if the model read the form; it read a metadata snapshot. Soften the label to "Summarized from product metadata" unless a form was actually parsed. | S |
| A4 | **Two AI dollar-cost triggers fire without explicit user intent.** Overview auto-runs `summarizeProduct` once per product per session; Home has starter pills that fire full chat turns. | `ProductSummaryDashboard.tsx:72-77`; `Home.tsx:186-195` | Fine for a demo, but each is a billed model call; on a large portfolio the auto-summary cost compounds. Session-cache exists for Overview (good); consider a "Generate" gate. | S |
| A5 | **Delete uses native `window.confirm`** (Coverages, Dictionary) instead of the on-brand `Dialog`. | `ProductCoverages.tsx:100`; `Dictionary.tsx:143-159` | Functional + accessible, but jarring against an otherwise bespoke UI. | S |
| A6 | **Admin console shell flashes for non-admins during profile load** (see §E5). | `Admin.tsx:43` | A non-admin briefly sees the console chrome + subscribed data before the guard resolves. | S |
| A7 | **Pricing dead ternary** `premium={result?.finalPremium ?? (tablesReady ? null : null)}` — both branches `null`. | `ProductPricing.tsx:226` | Harmless, but signals an unfinished loading-vs-null intent; either branch to a real skeleton or simplify. | S |

**Strengths worth preserving:** Explorer is a reference-grade keyboard/a11y surface (roving focus, full arrow-key nav); Pricing's reduced-motion-aware spring premium + step trace is excellent; the Home/Claims citation chips are load-bearing and clickable; every list ships loading/empty states.

---

## B. Technical robustness risks

| # | What | Where | Why it matters | Effort |
|---|---|---|---|---|
| B1 | **`chat` swallows stream error events.** `stream.on('error', () => {})` is a no-op; recovery relies on `finalMessage()` rejecting. If the model exhausts `maxTurns` on a `tool_use` turn, the loop exits with **no final text** — a silent empty answer. | `functions/src/ai.ts:46, 82-104` | Users get an empty bubble with no error. Emit a `done`-with-fallback or an `error` event when no text was produced. | M |
| B2 | **`analyzeClaim` can end with no determination.** If no validly-cited determination is produced within `maxTurns=7`, the stream just ends with `done` and no `json` determination. | `functions/src/claims.ts:216-249` | The copilot silently produces no card; add a terminal "couldn't reach a grounded determination" event. | M |
| B3 | **`nightlyNews` empty catch swallows per-instruction failures.** `try { … } catch {}` with no logging. | `functions/src/news.ts:221-224` | A failing instruction is invisible; the nightly run looks healthy while producing nothing. Log the error. | S |
| B4 | **Non-atomic multi-step server writes.** `setUserRole` create = `createUser` → `setCustomUserClaims` → `db.set` across 3 awaits with **no rollback** (orphan account on partial failure); `refreshNews` get-then-set dedup loop; `createShare` two un-transacted reads. | `admin.ts:31-40`; `news.ts:173-183`; `share.ts:39-42` | A crash mid-sequence leaves inconsistent state (esp. `setUserRole`: an account with no role/mirror doc). Wrap `setUserRole` create in a compensating cleanup. | M |
| B5 | **No per-request Anthropic timeout on 3 endpoints.** `refreshNews`/`nightlyNews` (`messages.create` has no `timeout`) and `describeForm` — they rely on the function ceiling; a stalled upstream burns the whole budget. All other AI calls set explicit SDK timeouts. | `news.ts:95`; `describeForm.ts:56` | A hung upstream call ties up the function to its max; add a `timeout` like the other endpoints (45-90 s). | S |
| B6 | **The `mutate()` invariant has no runtime test.** The core transaction (entity + audit + version diff + searchIndex + rev re-check + term guard) is untested; only the *rules* side is covered by `tests/rules.test.ts`. | `firebase.adapter.ts:220-320`; test gap | The single most load-bearing write path can regress silently (e.g., a diff/searchIndex bug) with a green gate. An emulator integration test would lock it. | M |
| B7 | **All Cloud Functions are untested.** No test touches `functions/src/*` — not `authenticate`/role guards, not the SSE path, not `setUserRole`. `@playwright/test` is installed but there are **zero** `.spec.ts` (Playwright unused). | `functions/*`; `package.json:24` | Auth/role regressions and AI-wiring breaks ship undetected. | L |
| B8 | **Storage is never emulated → local uploads write to the PROD bucket.** Even with `VITE_USE_EMULATORS=true`, `storage.upload`/`getUrl` hit live Firebase Storage. | `firebase.adapter.ts:33,40` | A developer testing base-form upload locally silently writes objects into production Storage. Real footgun; wire the Storage emulator (fixing the documented CORS reason) or hard-block in dev. | M |
| B9 | **Optimistic concurrency is applied inconsistently.** `expectedRev` is passed on workspace rename, States save, Rules edit, Tasks update/move, Dictionary update, Feedback patch — but **omitted** on Dictionary delete, Admin share delete, News prefs, and MustChangePassword self-update. | `Dictionary.tsx:143`; `Admin.tsx:201`; `News.tsx:184`; `MustChangePassword.tsx:34` | Delete/self-update lost-update races aren't guarded. Low individual risk, but the pattern should be uniform. | S |
| B10 | **Grounding tools do full-collection scans.** `search_entities` reads all `searchIndex`; `get_forms` all `forms`; `get_dictionary` all `dictionary`; `loadUsageCorpus` collection-group reads all coverages+rules+forms per call. | `functions/src/tools.ts:167,257,317,345-351` | Fine at seed scale (93 index docs); at portfolio scale each AI turn pulls the whole corpus. Move to indexed queries / a retrieval service before scale. | M |
| B11 | **`describeForm` writes a domain doc outside `mutate()`.** Direct Admin-SDK `ref.set({description},{merge:true})` on `forms/{key}` — no audit/version/searchIndex. | `functions/src/describeForm.ts:71` | Deliberate "derived cache" but tension with the atomic-mutation invariant; a `forms` doc changes with no audit trail. | S |
| B12 | **rtGrid key separator is a NUL char rendered as a space.** `const SEP = ' '` is actually `\0`. | `shared/src/rating/rtGrid.ts:39` | Invisible-character dependency; a well-meaning "cleanup" that turns it into a real space would silently break grid cell-map keys. Add a comment / use `' '` explicitly. | S |

**Strength — subscription hygiene is a clean bill of health.** Every `onSnapshot`/`presence.watch`/nested profile subscription across all routes and contexts returns its unsubscribe (Home, Products, Builder, Explorer, Tasks, News, Claims, Feedback, all 4 Admin tabs, ProductContext's 10 subs, UserContext, CommandPalette). No leaks found. All `fns` promises are `try/catch`-wrapped; SSE streams `AbortController`-cancel on unmount/switch.

---

## C. AI weaknesses

| # | What | Where | Why it matters | Effort |
|---|---|---|---|---|
| C1 | **Grounding enforcement is uneven.** Only `analyzeClaim` server-*rejects* uncited verdicts; `draftRule`/`scaffoldProduct`/`extractCoverages` drop uncited refs; but **`chat` has no server guard** (prompt-only free prose) and `summarizeProduct` trusts client metadata with no verification. | `ai.ts` (no guard) vs `claims.ts:222-230` | `chat` is the most-used AI surface and the least-grounded — the "AI grounded + cited" invariant is only partially enforced. Add a lightweight post-check or keep chat explicitly advisory. | M |
| C2 | **`refreshNews`/`nightlyNews` store unverified URLs.** A returned item needs only `url`+`title`; no check that the URL resolves. | `functions/src/news.ts:112,178` | A hallucinated/dead source URL is persisted as real news — a data-truth hole in an AI feature. HEAD-check or drop unresolved URLs. | M |
| C3 | **PDF extraction can't verify form numbers.** For base64-PDF uploads `verifyText=null`, so proposed form numbers are not grep-verified against the source (only citation + never-invent). | `functions/src/extract.ts:230-232` | The primary upload path (PDFs) is the one where fabricated form numbers can slip past the text check. Extract text from the PDF server-side to enable verification. | M |
| C4 | **`err.message` echoed to clients** in several catch blocks (chat/claims/extract/rules/scaffold). | `ai.ts:141`, `claims.ts:253`, `extract.ts:274`, `rules.ts:225`, `scaffoldProduct.ts:224` | Never leaks the API key, but can leak internal error text to the browser. Return a generic message; log detail server-side. | S |
| C5 | **`web_search` tool cast `as unknown as Anthropic.Tool[]`.** | `functions/src/news.ts:102` | A type hole around the server-tool version string; a schema/SDK bump could break silently. | S |

**Strengths (do not "fix"):** Model IDs are single-sourced (`runtime.ts:29-30`), no hard-coded model string, no `claude-fable-5`. **No sampling params on any Sonnet-5 call** (the only sampling is `temperature:0` on Haiku, which is allowed). Prompt caching is done well on the chat-family endpoints (stable `SYSTEM_PROMPT`+tools prefix with an `ephemeral` breakpoint, volatile context pushed after) so the prefix is reused across turns/requests. `maxRetries:4` on the client + bounded per-turn retry-with-backoff on `chat`.

---

## D. Data-truth risks

| # | What | Where | Why it matters | Effort |
|---|---|---|---|---|
| D1 | **Seed canary verification is non-fatal.** A premium mismatch pushes a `CRITICAL` warning but the seed **still completes and writes its report**. | `scripts/seed.ts:322-334` | A broken rating change could seed a wrong premium and only surface as a warning someone ignores. Make a canary miss exit non-zero. | S |
| D2 | **Rating factors that duplicate table data as literals will silently desync.** `HO.RT.003` extrapolates `1.94 + ceil((covA-600000)/100000)*0.32` (both magic numbers, `1.94` duplicates a table row); Replacement-Cost is a program `CONST 1.10` not a table lookup; GL terrorism is a program `CONST 50`. | `ho3.ts:287,385`; `gl.ts:245` | Editing the table won't update the literal → the trace and the table disagree. These are the fragile seams behind the $1,528/$2,789 canaries. | M |
| D3 | **`RatingProgram.minimumPremium` is a dead field**; the floor is applied as a `MIN_FLOOR` step instead (HO via `CONST 500` duplicating the field; GL via an RT lookup). Two mechanisms, one dead field. | `evaluator.ts` (never reads it); `ho3.ts:364,395`; `gl.ts:235,246` | Confusing dual source of truth for "minimum premium"; an editor changing `minimumPremium` sees no effect. | S |
| D4 | **GL ILF trace shows a lookup key that doesn't affect the result.** The step declares `aggregateLimit` in `keys`, but the getter matches only occurrence and ignores it ("rides along for display"). | `gl.ts:196-198,242` | An auditor reading the trace's `sourceRef` sees `aggregateLimit=…` yet it never changes the factor — a misleading-provenance risk in the very artifact meant to be trustworthy. | S |
| D5 | **refId scheme is inconsistent across lines.** HO uses line-prefixed `HO.LD.*`/`HO.RT.*`; GL uses un-prefixed `LDTable.*`/`RTTable.*`. | `ho3.ts:66,125` vs `gl.ts:62,114` | Table refIds don't follow one rule; cross-line tooling/citations must special-case. Normalize the scheme. | M |
| D6 | **Entire `LD` source path is dead code for seeded data.** Both line getters throw; no seeded step uses `type:'LD'`. | `evaluator.ts:82-87`; `ho3.ts:349-355`; `gl.ts:219-223` | Untested, unreachable branch in the rating engine — either wire it or remove it so the model matches reality. | S |

**Strength:** orphan-hierarchy handling is correct — an unresolvable `parentId` is surfaced in a separate `orphans` subtree, never dropped, and the importer promotes dangling parents with a warning (`inventory.ts:65-71`; `isoImport.ts:367-374`); `termConstraints.test.ts` proves the real seed validates with **no false positives**.

---

## E. Guardrail drift (with severity)

| # | Guardrail | Drift | Severity | Where |
|---|---|---|---|---|
| E1 | Roles enforced in rules **and** every Function | **`describeForm` + `refreshNews` gate only on `req.auth`** (any role, incl. VIEWER) then write role-protected collections (`forms` is `canEdit()`, `news` is `isAdmin()`). VIEWER can trigger a persisted write the rules forbid. | **HIGH** (invariant explicitly says "both sides, always") | `describeForm.ts:20,71`; `news.ts:192,178` vs `firestore.rules:50,84` |
| E2 | AI grounded + cited | `chat` has no server citation guard (prompt-only); `summarizeProduct` unverified; PDF extract can't verify form numbers. | **MEDIUM** | §C1, C3 |
| E3 | `mutate()` atomic invariant | Correct in code but **untested at runtime**; a few Functions write domain-ish docs outside it (`describeForm`, `refreshNews`, `createShare`). | **MEDIUM** | §B6, B11 |
| E4 | Design tokens (no hard-coded hex) | No `#RRGGBB` violations, but **hard-coded `rgba()` literals** live outside `index.css` (Landing/SignIn/MustChangePassword aurora + AppShell banner + ProductWorkspace hero/tabs + CommandPalette backdrop/shadow). | **LOW** (letter respected: "hex"; spirit bent) | `Landing.tsx`, `AppShell.tsx:51`, `ProductWorkspace.tsx:120,245`, `CommandPalette.tsx:183,190` |
| E5 | Role enforcement (client) | **Admin gate flashes**: guard is `if (profile && profile.role!=='ADMIN')`, so while `profile` is `null` the console renders for anyone. | **MEDIUM** (disclosure, not escalation — writes are server-gated) | `Admin.tsx:43` |
| E6 | Docs match code | `signInAsAdmin` targets `admin@admin.com`/`admin123` (not seeded); SignIn header still documents a removed "Continue as admin" button; functions/CLAUDE.md cites a `canEdit()` server helper that doesn't exist. | **LOW** | `firebase.adapter.ts:91-92`, `SignIn.tsx:1-3`, `runtime.ts` |
| E7 | Dev-only bypass removed before prod | `signInAsDevAdmin()` (client fake-ADMIN bypass) still present, `import.meta.env.DEV`-guarded. | **LOW** (guarded; flagged for removal) | `firebase.adapter.ts:79-96,163-168` |

---

## F. Dead code / console noise / hard-coded color inventory

- **Dead code:** `app/src/routes/stub/StubRoute.tsx` is imported by nothing — every route resolves to a real component. The `LD` rating source branch + both LD getters are unreachable for seeded data. `RatingProgram.minimumPremium` is never read. (Effort to remove: **S**.)
- **Console noise:** essentially none — the only `console.*` in app routes/components is the intentional, documented `console.error` in `ErrorBoundary.tsx:19`. Adapter subscribe-error path logs `console.warn` on listener errors (`firebase.adapter.ts:205`) — appropriate. Clean.
- **Hard-coded color (not `#`-hex):** `rgba()` literals in `Landing.tsx` (aurora gradients + shadows), `SignIn.tsx:66,109`, `MustChangePassword.tsx:122`, `AppShell.tsx:51` (amber banner), `ProductWorkspace.tsx:120,245`, `CommandPalette.tsx:183,190`. No `#RRGGBB` anywhere in `routes/`/components read. (Effort to tokenize: **S-M**.)
- **Tooling gaps:** `functions` and `shared` `lint` scripts are `echo` no-ops (only `app` runs oxlint); `pnpm test` excludes `test:rules`; TS version drift (`app` on typescript ~6.0.2 vs ~5.7 elsewhere). (Effort: **S**.)

---

## G. Accessibility gaps (relative strength — honest remaining nits)

The elevation scoreboard already lifted every surface's a11y ≥4.5 (AA color-token fixes, keyboard-reachable controls, `role="log"`/`aria-live` transcripts, real `role="tab"` groups, roving tabindex in Explorer). Remaining honest nits:

- **Token-by-token SSE is verbose under screen readers.** Home + Claims use `role="log"` `aria-live="polite"`, correct semantics, but streaming each token is noisy; a debounced "response ready" announcement would earn the last half-point. (`Home.tsx:154`, `Claims.tsx`) — **S**.
- **`--color-danger` (#DC2626) is 4.37:1 on `raised`** — below AA for small text; not currently placed on `raised`, but flagged before any raised-surface use. (`index.css`) — **S**.
- **News `role="feed"` children are anchors, not `role="article"`.** Minor semantic mismatch. — **S**.
- **Dictionary delete is a native `window.confirm`** (accessible + functional, off-brand). — **S**.
- **Admin gate flash** (§E5) is also a disclosure/a11y concern. — **S**.

---

## H. Biggest opportunities (shortlist)

1. **Close the two-sided role invariant (E1).** Gate `describeForm` and `refreshNews` on EDITOR/ADMIN (or ADMIN for `news`) server-side. Highest-severity guardrail drift, small fix. **[HIGH · S]**
2. **Test the load-bearing write path (B6) + role guards (B7).** An emulator integration test for `mutate()` (rev/conflict, diff, searchIndex, term guard) and a thin functions auth/role test suite — plus actually wiring the installed-but-unused Playwright. Protects the invariants a green gate currently can't. **[HIGH · M-L]**
3. **Make AI grounding uniform (C1-C3).** Add a `chat` citation post-check (or mark it advisory), verify news URLs, and extract PDF text server-side so `extractCoverages` can verify form numbers on the primary upload path. **[HIGH · M]**
4. **Fix the local Storage footgun (B8).** Wire the Storage emulator (or hard-block uploads in dev) so local base-form uploads stop writing to the production bucket. **[MED · M]**
5. **Data-truth hardening of the rating seams (D1-D4).** Make the seed canary a hard failure, pull the `HO.RT.003`/RC/terrorism literals into tables, retire the dead `minimumPremium` field, and drop the misleading `aggregateLimit` trace key — so the $1,528/$2,789 provenance is bulletproof and self-consistent. **[MED · M]**
6. **Demo-readiness (A1-A2).** Seed one sample base form + a handful of news items so Claims and News aren't empty shells on first run. **[MED · S-M]**
