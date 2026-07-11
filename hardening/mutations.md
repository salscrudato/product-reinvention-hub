# Hardening: Fault-Injection Checklist (Phase 3)

**DO NOT apply these mutations in this session.**
Phase 3 applies each mutation in isolation, confirms the gate turns red, then reverts.
Each entry names the exact one-line change, the file + location, and the specific test that
must fail.  Reverts are mandatory — no mutation survives beyond its probe window.

---

## FAULT-001: Break the HO-3 $1,528 canary

**Mutation:** In `shared/src/seed/personalHome.ts`, find the step `s1` object inside
`PH_RATING_STEPS` (the territory base rate step).  Change `value: 700` to `value: 701`.

**File:** `shared/src/seed/personalHome.ts`  
**Location:** The `PH_RATING_STEPS` array, step `{ id: 's1', ... op: 'SET', source: { type: 'CONST', value: 700 } }` — change `700` to `701`.

**Test that must fail:** `shared/src/rating/evaluator.test.ts`  
Expected failure: `expect(result.finalPremium).toBe(1528)` — actual will be ≥1529 (base rate propagates through every subsequent multiplier step).

**Also verify:** `shared/src/rating/workedExample.canary.test.ts` PH canary block also fails.

---

## FAULT-002: Break the GL $2,635 canary

**Mutation:** In `shared/src/seed/generalLiability.ts`, find the step `s3` inside
`GL_RATING_STEPS` (the payroll multiplier step, MUL 1.82).  Change `value: 1.82` to `value: 1.83`.

**File:** `shared/src/seed/generalLiability.ts`  
**Location:** The `GL_RATING_STEPS` array, step `{ id: 's3', ... op: 'MUL', source: { type: 'CONST', value: 1.82 } }` — change `1.82` to `1.83`.

**Test that must fail:** `shared/src/rating/generalLiability.evaluator.test.ts`  
Expected failure: `expect(result.finalPremium).toBe(2635)` — actual will be ~2647 (1250 × 1.83 = 2287.5 → s5 ADD 360 → 2647.5 → rounds up).

**Also verify:** `shared/src/rating/workedExample.canary.test.ts` GL canary block also fails.

---

## FAULT-003: Drop the AuditEvent write from mutate()

**Mutation:** In `server/lib/data.js`, find the `ops.push({ operationType: 'Create', resourceBody: { id: auditId(), ... kind: 'audit', ... } })` line inside the `envelope()` function.  Comment it out or delete it.

**File:** `server/lib/data.js`  
**Location:** The `envelope()` function body, the `ops.push(...)` call that produces `kind: 'audit'` documents.  This is the second push after the entity upsert.

**Test that must fail:** `hardening/smoke.mjs` GL audit trail assertion.  
Expected failure: After calling mutate() in the GL path, a direct Cosmos query for `kind:'audit'` documents at the tested partition key will return zero results, which the smoke harness detects by … (audit probe to be wired in Phase 3).

**Implementation note:** Since the public `/api/db/*` surface does not expose audit-kind
documents, verifying this fault requires either a test-only Cosmos read route or a direct SDK
query in the smoke harness.  Phase 3 adds a `GET /api/db/audit?path=…` probe endpoint (gated
behind ADMIN + a `PROBE_MODE=1` env flag) that returns the raw kind=audit documents for a path.
Wire this fault before implementing the probe endpoint.

---

## FAULT-004: Flip a server-side role check so VIEWER can write

**Mutation:** In `server/lib/data.js`, find the line `router.post('/mutate', requireRole('EDITOR'), requireTenant, async ...`.  Change `requireRole('EDITOR')` to `requireRole('VIEWER')`.

**File:** `server/lib/data.js`  
**Location:** The `router.post('/mutate', ...)` handler registration line.

**Test that must fail:** `hardening/smoke.mjs` role enforcement probe.  
Expected failure: A smoke test login with role=VIEWER (create a Cosmos user with role VIEWER via the admin API, then login as that user) that attempts `POST /api/db/mutate` should currently receive HTTP 403.  With this mutation applied, it succeeds — the smoke assertion `expect(res.status).toBe(403)` fails.

**Also verify:** `app/src/` `verify-invariant` slash command confirms VIEWER write is blocked — the mutation makes it green when it should be red.

---

## FAULT-005: Make a grounded-AI path return an uncited number

**Mutation:** In `server/lib/ai.js`, find the `chat()` handler's system prompt construction.  Remove or comment out the instruction that requires the model to cite sources in `[refId]` brackets (the citation instruction line in the system prompt string).

**File:** `server/lib/ai.js`  
**Location:** The `SYSTEM_PROMPT` constant or inline string inside the `chat()` function — the sentence that instructs the model to "cite sources using `[refId]`" or equivalent.

**Test that must fail:** `hardening/smoke.mjs` chat citation assertion.  
Expected failure: The smoke harness asks the AI a question whose answer is grounded in a known entity (e.g., "What is the occurrence limit on coverage GL-SMOKE-001?") and asserts that the response contains `[GL-SMOKE-001]` or a similar bracketed refId.  With the citation instruction removed, the model answers without brackets — the smoke assertion `citationFound === true` fails.

**Also verify:** The binding invariant "AI grounded + cited — AI responses must cite their source documents. Free invention is a bug." is directly violated.
