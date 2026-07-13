# 07_PRODUCTION_READINESS.md — Engineering Assessment

## Assessment Summary

| Domain | Status | Critical items |
|---|---|---|
| Security | ⚠️ Needs work | Hardcoded credentials (HIGH), Firebase API key in bundle (INFO), dev bypass reachable |
| Authentication/Authorization | ✅ Solid | Dual-enforced (rules + functions); role enforcement correct |
| AI Safety | ✅ Solid | Grounded tools, citation verification, prompt injection defense, cost guard |
| Data Integrity | ✅ Solid | Atomic mutations, optimistic concurrency, rev conflict detection |
| Test Coverage | ⚠️ Partial | Rating canary + unit tests good; E2E shallow; AI paths untested |
| Performance | ⚠️ Some gaps | Prompt caching good; in-memory digest TTL short; retrieval fallback unoptimized |
| Observability | ⚠️ Minimal | AI cost telemetry exists; no structured app-level logging or alerting |
| Dead Code | ✅ Low | AWS swap stub is labelled; dev bypass is guarded |
| Production Readiness | ⚠️ NOT READY | See critical blockers below |

---

## CRITICAL BLOCKERS (must fix before production)

### SEC-01 — Hardcoded demo-admin password in client bundle
**File:** `app/src/lib/backend/firebase.adapter.ts:204-205`
**Severity:** HIGH
**Detail:** `DEMO_ADMIN_EMAIL = 'sal@productreinvention.app'` and `DEMO_ADMIN_PASSWORD = 'scrudato'` are module-level constants compiled into the Vite bundle. Any visitor can open DevTools → Network and read the JavaScript to extract these credentials. The `signInAsAdmin()` method calls `signInWithEmailAndPassword(auth, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD)` — a one-click authenticated session as the ADMIN account. There is a `// REMOVE-BEFORE-PROD` comment on the adjacent dev bypass, but the `signInAsAdmin()` method and constants have no such guard and are reachable in production builds.
**Fix:** Remove `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, and `signInAsAdmin()` entirely before production. The real admin user should set their own password via the provisioning flow.

### SEC-02 — Dev admin bypass reachable in production code path
**File:** `app/src/lib/backend/firebase.adapter.ts:194-214`
**Severity:** MEDIUM
**Detail:** `signInAsDevAdmin()` sets `bypassActive = true` and emits a fake `ADMIN` session to all auth listeners. It is guarded by `if (!import.meta.env.DEV) return` — so it is a no-op in production builds. However, `bypassActive` starts as `true` when `sessionStorage` contains `pf.devAdminBypass=1`, with no DEV build check on that initialization path (`let bypassActive = import.meta.env.DEV && sessionStorage.getItem(DEV_BYPASS_KEY) === '1'`). Vite sets `import.meta.env.DEV` to `false` in production builds which evaluates the expression to `false`, so the bypass is dormant. ASSUMPTION: this is safe in practice, but the defense is a Vite constant, not server-side — requires code review to confirm no production builds have `DEV=true`.
**Fix:** Move the bypass block inside `if (import.meta.env.DEV) { ... }` at the top of the file to make the dev-only intent structurally enforced and visible to static analyzers.

---

## SECURITY FINDINGS

### SEC-03 — Firebase API key exposed in client bundle (INFO, expected by design)
**File:** `app/src/lib/backend/firebase.config.ts`
**Severity:** INFO (by Firebase design, not a vulnerability)
**Detail:** `apiKey: 'AIzaSy<redacted>'` is in the client bundle (literal redacted here; the value is a client identifier, not a credential). Firebase client API keys are NOT secrets — they identify the project and are always public. Security is enforced by Firestore rules and Function auth (which both verify the JWT). This is correct Firebase architecture; however, the key's Firebase App Check or authorized domains list should be configured in the Firebase console to prevent unauthorized project use.
**Fix:** Enable Firebase App Check or restrict authorized domains in the Firebase console. No code change required.

### SEC-04 — Anonymous auto sign-in grants read access to all portfolio data
**File:** `app/src/lib/backend/firebase.adapter.ts:168-181`
**Severity:** MEDIUM
**Detail:** `signInAnonymously(auth)` is called automatically for any unauthenticated visitor. Anonymous users receive a Firebase ID token with no role claim — Firestore rules grant `isAuthed()` read access to `products`, `coverages`, `forms`, `rules`, `ldTables`, `rtTables`, `dictionary` (all portfolio data) to any authenticated user. An anonymous visitor who has never entered credentials can read the full product portfolio.
**Fix:** Determine if anonymous read access is intentional. If not, change the `isAuthed()` rule to require a role (`isViewer() || isEditor() || isAdmin()`). If anonymous read is intentional, document it as a product decision.

### SEC-05 — Server secrets bound via `defineSecret` but not validated at startup
**File:** `functions/src/runtime.ts:21-28`
**Severity:** LOW
**Detail:** `ANTHROPIC_API_KEY` and `VOYAGE_API_KEY` are bound as Firebase Secrets via `defineSecret()`. The Anthropic key is fetched eagerly inside `anthropic()` — any function that calls the AI will crash at invocation if the secret isn't bound, producing a non-descriptive 500. There is no startup health-check that validates key presence.
**Fix:** Add a `hello` (health) function that calls `anthropic()` with a minimal ping (or checks `ANTHROPIC_API_KEY.value()` is non-empty) and returns 200, so deployment smoke tests catch a misconfigured secret before real traffic hits.

---

## BUGS AND CORRECTNESS

### BUG-01 — `mutateBatch` vote and `setNewsPins` bypass the atomic envelope
**File:** `app/src/lib/backend/firebase.adapter.ts:410-426`
**Severity:** LOW
**Detail:** `vote()` and `setNewsPins()` use `updateDoc`/`setDoc` directly, not the `mutate()` envelope — so they produce no `auditEvent`, no `version`, and no `searchIndex` entry. This is intentional for votes (the code comments say so) but means vote history is invisible in the History drawer. For `setNewsPins`, the skip is correct (pins are UI state, not governed content).
**Fix:** None required for `setNewsPins`. For `vote`: if vote auditability is a product requirement, thread it through a lightweight `mutate({op:'vote'})` path; otherwise document the intentional skip.

### BUG-02 — Optimistic concurrency only enforced when `expectedRev` is supplied
**File:** `app/src/lib/backend/firebase.adapter.ts:290-294`
**Severity:** LOW
**Detail:** `if (m.expectedRev !== undefined && current && prevData['rev'] !== m.expectedRev)` — the conflict check is conditional. Callers that omit `expectedRev` can silently overwrite a document modified since it was loaded. The product workspace populates `expectedRev`, but the Builder, Admin, and some dialog flows may not.
**Fix:** Audit all `mutate()` call sites for edit operations to confirm `expectedRev` is always supplied. For delete operations, omitting it is acceptable (last-write-wins is fine for deletes).

### BUG-03 — Portfolio digest TTL (5 min) shorter than prompt cache TTL (1 hour)
**File:** `functions/src/portfolioDigest.ts:84`
**Severity:** LOW (performance)
**Detail:** The in-memory digest cache has a 5-minute TTL. The Anthropic prompt cache has a 1-hour TTL. If the Function instance stays alive and the digest rebuilds at 5 minutes, the new digest string may differ from the one in the Anthropic cache, causing a cache miss on the stable prefix. This costs ~2x input tokens on the next call.
**Fix:** Increase the digest TTL to 55–60 minutes, or use a content-hash comparison (only invalidate when the portfolio data actually changes). The invalidation triggers already evict the semantic cache; extend them to reset the digest cache too.

### BUG-04 — `identifyBaseForm` two-pass escalation writes through `auditedMerge`, which requires `updatedBy`
**File:** `functions/src/claims.ts:447-523`, `functions/src/audited.ts`
**Severity:** LOW (untested path)
**Detail:** `auditedMerge()` is used to write the identified form metadata back to Firestore. ASSUMPTION: `auditedMerge` constructs an `AuditEvent` with `actor.uid`. If the `caller` object from `authenticate()` is not threaded correctly through to the merge, the audit event may have a blank `updatedBy`, violating the audit invariant.
**Fix:** Trace `caller.uid` through the `identifyBaseForm` execution path to confirm it reaches `auditedMerge`. Add a test.

### BUG-05 — `identifyBaseForm` haiku→sonnet escalation threshold is hard-coded
**File:** `functions/src/claims.ts:485-510`
**Severity:** INFO
**Detail:** The two-pass identification escalates to Sonnet 5 only when `!formNumber && !lob`. If haiku returns a confident but wrong form number (hallucination), the result is accepted without escalation. No verification against the Firestore `forms` collection is done on the form number.
**Fix:** After getting a haiku result, check if the returned `formNumber` exists in `forms/{formNumber}`. If not found, escalate to Sonnet and/or flag as `UNKNOWN`.

---

## PERFORMANCE

### PERF-01 — Chat cold start reads the entire portfolio per instance startup
**File:** `functions/src/portfolioDigest.ts:26-77`
**Severity:** LOW
**Detail:** `buildDigestInput()` does 3 top-level collection reads + N per-product sub-collection reads. At seed scale (2 products, ~80 coverages) this is acceptable. At 50+ products it becomes a slow cold start for the chat function (possibly 5–10 seconds). After the first request, the in-memory cache serves all subsequent requests until TTL expires.
**Fix:** If the portfolio grows beyond ~20 products, move the digest build to a background scheduled function that writes to Firestore, and serve it from there rather than recomputing in-memory per instance.

### PERF-02 — Semantic cache uses flat KNN (no HNSW)
**File:** `firestore.indexes.json:8`
**Severity:** INFO (acceptable at seed scale)
**Detail:** The `groundingChunks` and `semanticCache` vector indexes use `"flat": {}` — exact (brute-force) KNN. Accurate but O(n) scan. At 10k+ chunks this will become noticeably slow.
**Fix:** When the chunk count exceeds ~5k, switch to `"treeAh": {}` (Firestore's HNSW) for approximate KNN. This requires rebuilding the index.

### PERF-03 — `refIdsIn()` does a full collection scan on every create
**File:** `app/src/lib/backend/firebase.adapter.ts:108-111`
**Severity:** LOW
**Detail:** `getDocs(collection(db, collectionPath))` fetches ALL documents to find the max refId sequence. This is a full collection scan per entity create. For large sub-collections (e.g. 1000 coverages), this is expensive.
**Fix:** Store `meta/refCounters/{segment}` (a simple integer counter per LOB+segment) and use an atomic increment inside the `runTransaction`, as many Firebase patterns recommend. This is O(1) regardless of collection size.

---

## TEST COVERAGE

### TEST-01 — E2E tests are shallow (3 smoke tests, no AI path coverage)
**File:** `e2e/smoke.spec.ts`
**Severity:** MEDIUM
**Detail:** Three tests cover: portfolio rendering after sign-in, GTM board authoring, and anonymous read-only gating. No E2E tests cover: AI chat responses, claims analysis, coverage extraction, rule drafting, product scaffold, feedback submission, news feed, dictionary, admin flows, or any SSE streaming path.
**Fix:** Add E2E tests for the happy path of each AI feature (at minimum: chat → receives a response; claims → receives a determination card; draftRule → receives a draft).

### TEST-02 — Rating engine well-tested; AI function layer has no unit tests
**File:** `shared/src/rating/evaluator.test.ts` (well-covered); `functions/src/` (no test files)
**Severity:** MEDIUM
**Detail:** The HO-3 ($1,528) and PA ($1,002) canaries are solid. The `functions/src/` directory has no test files — `ai.ts`, `claims.ts`, `extract.ts`, `rules.ts`, `shapeFeedback.ts`, `costGuard.ts`, `retrieval/` are all untested by unit tests.
**Fix:** Add unit tests for at minimum: `costGuard.ts` (guardSpend logic), `retrieval/` (lexical fallback), citation verification in `claims.ts` (grounding invariant), and `shapeFeedback.ts` (candidateFiles intersection).

### TEST-03 — No Firestore security-rules tests beyond emulator integration
**File:** (no dedicated rules test file found)
**Severity:** MEDIUM
**Detail:** ASSUMPTION: The Firestore security rules are exercised only by E2E tests against the emulator, not by a dedicated `@firebase/rules-unit-testing` suite. Role-matrix edge cases (VIEWER attempting a write, anonymous user reading groundingChunks) are not unit-tested.
**Fix:** Add a `firestore.rules.test.ts` using `@firebase/rules-unit-testing` covering at minimum: VIEWER can read but not write products; VIEWER can vote on feedback; anonymous users cannot read `aiUsage`; groundingChunks are always denied.

---

## DEAD CODE AND TECHNICAL DEBT

### DEBT-01 — AWS swap annotations throughout the codebase
**Files:** `functions/src/runtime.ts:5` (`// AWS-SWAP: ...`), `firebase.adapter.ts:3,44`, `retrieval/placeholder.ts`
**Severity:** INFO
**Detail:** Every AWS migration hook is commented with `// AWS-SWAP:`. These are intentional architectural markers, not dead code — they document where to change when migrating to AWS. `retrieval/placeholder.ts` is an OpenSearch swap stub. These are acceptable as-is.

### DEBT-02 — `usedIn` on DictionaryEntry is partially persisted (not always computed live)
**File:** `shared/src/types.ts:323` (comment: "never persisted — so they can never go stale. Kept optional for wire/back-compat")
**Severity:** INFO
**Detail:** The `usedIn` field exists on the wire type for back-compatibility but is supposed to be computed live. Any code that persists `usedIn` would create stale data. ASSUMPTION: this is correctly handled by all write paths, but there is no type-level enforcement preventing accidental persistence.

### DEBT-03 — `signInAsAdmin()` is a real production-accessible method
**See SEC-01 above** — this is both a security and a dead-code concern. It should be removed, not just flagged.

### DEBT-04 — `backfillNewsImages` Cloud Function exported but undocumented
**File:** `functions/src/index.ts`
**Severity:** INFO
**Detail:** `backfillNewsImages` is a one-time migration function. UNKNOWN: whether this is still needed or can be deleted. Evidence needed: git log on the function and whether all news items already have the structured `image` field.

---

## OBSERVABILITY GAPS

- No structured application-level logging format (all logging is `console.log/warn`)
- No alerting configured for circuit breaker open events (cost guard)
- No latency monitoring on SSE endpoints
- No error rate dashboard
- AI cost telemetry writes to `aiUsage` but there is no alert threshold on daily spend

**Recommended:** Add Cloud Monitoring alert on `costCounters/breaker-anthropic` state change to open; add a 95th-percentile latency alert on the `chat` and `analyzeClaim` SSE endpoints.

---

## OUTSTANDING UNKNOWNS

| ID | Unknown | Evidence needed to resolve |
|---|---|---|
| UNK-01 | Whether `backfillNewsImages` is still needed | `git log functions/src/news.ts` + query `news` for docs without `image` field |
| UNK-02 | Whether Firestore rules are tested by a dedicated suite | Search for `@firebase/rules-unit-testing` in all test files |
| UNK-03 | Whether all `mutate()` edit calls supply `expectedRev` | Search all `adapter.db.mutate({op:'update'...})` call sites for `expectedRev` |
| UNK-04 | Whether anonymous read access to portfolio is intentional | Product/UX decision; no code evidence for or against |
| UNK-05 | Whether `auditedMerge` receives `caller.uid` in `identifyBaseForm` | Trace `functions/src/claims.ts:identifyBaseForm` → `audited.ts:auditedMerge` |
| UNK-06 | Whether `meta/refCounters` exists as a Firestore counter document | Check `scripts/seed.ts` for initialization of `meta/refCounters` |
