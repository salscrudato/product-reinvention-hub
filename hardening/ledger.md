SUMMARY: OPEN: 17 | CRITICAL: 2 | HIGH: 7 | MEDIUM: 7 | LOW: 1 | WONTFIX: 0 | FALSE-POSITIVE: 3

<!-- convergence.mjs rewrites the SUMMARY line above on every run. Do not hand-edit it. -->

---

### DEF-0001
- status: OPEN
- severity: CRITICAL
- probe: SEED
- surface: server/lib/auth.js:18,25-28
- title: Hardcoded BOOTSTRAP users with trivial passwords are always active; JWT secret defaults to insecure value
- evidence: `server/lib/auth.js:18` — `const SECRET = process.env.AUTH_JWT_SECRET || 'dev-insecure-secret-change-me'`. Line 25-28 — `BOOTSTRAP` object always present with `admin`/`admin` and `sal.scrudato`/`sal.scrudato`, both ADMIN-role, both `tenants:'*'`. These bypass Cosmos auth and cannot be disabled at runtime. Note: the originally-documented `signInAsDevAdmin()` adapter method was removed in V18 (Azure cleanup); the equivalent production risk lives in the server auth module. `grep -n 'BOOTSTRAP\|dev-insecure' server/lib/auth.js`
- repro: `curl -X POST http://<HOST>/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin"}' | jq .token` — returns a valid ADMIN JWT on any deployment where AUTH_JWT_SECRET is not overridden in App Service config.
- fix:
- verified-by:
- commit:
- note(ROLE probe 2026-07-11): `signInAsDevAdmin()` confirmed absent from all source — `grep -r 'signInAsDevAdmin' . --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs'` returns zero results. Also confirmed `pf.devAdminBypass` localStorage key referenced only in `docs/review/_capture.mjs` (Playwright screenshot cleanup, not app source) — `grep -r 'devAdminBypass' app/src/` returns zero results. BOOTSTRAP users remain the live risk.

---

### DEF-0002
- status: OPEN
- severity: HIGH
- probe: SEED
- surface: shared/src/ai/fleet.ts, server/lib/fleet.js, CLAUDE.md (invariant table)
- title: Deployed AI fleet uses claude-opus-4-8 for reasoning; CLAUDE.md governance binds to claude-sonnet-5 in a non-deployed workspace
- evidence: `shared/src/ai/fleet.ts` GROUNDED_CITED deployment = `claude-opus-4-8`; BULK_VERIFY = `claude-haiku-4-5`. `functions/src/runtime.ts:45-46` MODEL = `claude-sonnet-5`, MODEL_FAST = `claude-haiku-4-5` — but `functions/` is retained as reference only, NOT deployed (returns 501 for all handlers except chat/summarizeProduct). CLAUDE.md invariant table reads: "Model IDs — `claude-sonnet-5` (reasoning) and `claude-haiku-4-5` (bulk/simple), defined once in `functions/src/runtime.ts`. Never `claude-fable-5`." This binding points at the non-deployed workspace. `grep -r 'claude-' shared/src/ai/fleet.ts functions/src/runtime.ts`
- repro: `grep -r 'deploymentName\|MODEL\b' shared/src/ai/fleet.ts server/lib/fleet.js functions/src/runtime.ts` — confirms opus-4-8 in deployed path vs sonnet-5 in reference-only path.
- fix:
- verified-by:
- commit:

---

### DEF-0003
- status: OPEN
- severity: HIGH
- probe: SEED
- surface: server/lib/data.js (envelope function), app/src/lib/backend/types.ts
- title: parentId not validated server-side in mutate(); a dangling or cross-product parentId is persisted silently
- evidence: `server/lib/data.js` `envelope()` destructures only `{ op, path, data, entityType }` from the payload. `parentId` (when present) flows in via the `data` bag and is stored with `...data` spread — no existence check, no cross-tenant check, no cross-product check. Client-side guards in `CoverageEditDialog.tsx` and `ProductHierarchy.tsx` render a warning badge for orphaned coverages but never block persistence. `grep -n 'parentId' server/lib/data.js` returns zero results.
- repro: `curl -X POST http://<HOST>/api/db/mutate -H 'Authorization: Bearer <EDITOR_JWT>' -H 'Content-Type: application/json' -d '{"payload":{"op":"create","path":"products/P1/coverages/bad","entityType":"coverage","data":{"parentId":"nonexistent-ref"},"actor":{"uid":"test","name":"test"}}}' ` — returns 200 OK; the dangling parentId is persisted.
- fix:
- verified-by:
- commit:

---

### DEF-0004
- status: OPEN
- severity: HIGH
- probe: SEED
- surface: shared/src/seed/personalHome.ts, shared/src/seed/generalLiability.ts, shared/src/seed/personalAuto.ts, shared/src/types.ts
- title: Money stored as float dollars throughout; intermediate rating steps accumulate sub-cent rounding drift
- evidence: No `toCents`, `toFixed`, or integer-cent conversion anywhere in shared/src/seed/*.ts or server/lib/data.js. Rating tables use plain JS number literals (e.g., `premium: 380`). Intermediate steps use `roundTo:2` (sub-dollar precision): HO-3 canary trace shows s5: 1013.36, s8b: 1147.70, s10b: 1527.97 before the final MIN_FLOOR rounds to whole dollars. `Coverage.terms` premium values stored as whatever float the client sends via `data` spread. `grep -n 'toCents\|toFixed\|cents' shared/src/seed/personalHome.ts shared/src/types.ts` returns zero results.
- repro: Inspect `shared/src/rating/evaluator.test.ts:33` — `expect(s5?.runningTotal).toBeCloseTo(1013.36, 2)` — sub-cent accumulation is the tested path. A future rating step using truncation instead of rounding on a float intermediate can diverge from the canary.
- fix:
- verified-by:
- commit:

---

### DEF-0005
- status: OPEN
- severity: MEDIUM
- probe: SEED
- surface: server/lib/admin.js:22-25,42-45
- title: Unbounded admin list reads — GET /api/admin/tenants and /api/admin/users call .fetchAll() with no page bound
- evidence: `server/lib/admin.js:22-25` — `docs.items.query({ query: "SELECT c.data FROM c WHERE c.pk='__system__' AND c.kind='tenant'" }).fetchAll()` with no `maxItemCount`. Line 42-45 same pattern for users. Compare with `server/lib/data.js` `/list` endpoint which caps at `MAX_LIST = 1000` and passes `{ maxItemCount: limit }`. `grep -n 'fetchAll\|maxItemCount' server/lib/admin.js server/lib/data.js`
- repro: At scale (hundreds of tenants or users), `GET /api/admin/tenants` or `GET /api/admin/users` will attempt to load the entire `__system__` partition into memory in a single Cosmos call, risking OOM/timeout/RU exhaustion on the server.
- fix:
- verified-by:
- commit:

---

### DEF-0006
- status: OPEN
- severity: MEDIUM
- probe: SEED
- surface: pnpm-workspace.yaml, functions/src/*.ts (AWS-SWAP markers), server/lib/auth.js, server/lib/ai.js
- title: Stale migration artifacts: Firebase allowBuild, AWS-SWAP markers, unported unifiedImport handler, in-process changePassword
- evidence: (a) `pnpm-workspace.yaml:allowBuilds` still lists `@firebase/util` — Firebase was fully removed from the app adapter. (b) `functions/src/audited.ts:14`, `runtime.ts:5`, `admin.ts:4`, `retrieval/placeholder.ts:12,16,21,27` — AWS-SWAP comment markers from an abandoned AWS migration. (c) `server/lib/ai.js` wildcard handler returns 501 for `unifiedImport`, `filingImport`, and all other non-ported Cloud Function names — the PDF/multi-format import path (ADR-0005) is broken on Azure. (d) `server/lib/auth.js:29` — `changePassword` stores overrides in an in-process `Map`; resets on server restart; never written to Cosmos. `grep -n 'AWS-SWAP\|firebase' pnpm-workspace.yaml functions/src/audited.ts`
- repro: (a) `pnpm build` still passes because @firebase/util is in devDependencies only. (b) `POST /api/ai/unifiedImport` returns `{"error":"ai_handler_not_ported","name":"unifiedImport"}`. (c) Change password via the UI, restart `node server/server.js`, attempt login with the new password — fails, reverts to original.
- fix:
- verified-by:
- commit:
- note(SEAM probe 2026-07-11): `app/.env.development.local` also contains stale Firebase comments and `VITE_USE_EMULATORS=false` — confirmed dead (variable not read by any source file; `grep -r VITE_USE_EMULATORS app/ shared/` returns zero hits). Covered by this DEF's stale-artifacts scope; not a new seam violation.
- note(CITE probe 2026-07-11): `app/src/routes/Admin.tsx:746` UI copy reads "Repeat grounded questions served from cache behind a conservative similarity threshold + a cheap verifier; a stale-cited answer is never served." This describes the Firebase `semanticCache.ts` + verifier workflow, not the Azure port. The Azure `chat()` handler (server/lib/ai.js) has no semantic cache and no verifier; the statement is factually incorrect for the deployed system. Covered by this DEF's stale-artifacts scope.

---

### DEF-0007
- status: FALSE-POSITIVE
- severity: N/A
- probe: SEAM
- surface: app/.env.development.local, app/src/ (comment-only Firebase references)
- title: FP — stale Firebase comments in gitignored .env.development.local and source comments do not constitute a seam leak
- evidence: `grep -r "VITE_USE_EMULATORS" app/ shared/` returns zero results. `grep -r "^import.*from.*firebase\|^import.*from.*@firebase" app/src/ shared/src/` returns zero results. The `.env.development.local` sets `VITE_USE_EMULATORS=false` and contains comments about Firebase emulators, but this var is never read. Firebase references in other source files (`UserContext.tsx:2`, `BaseFormsLibrary.tsx:6`, `savedViewsStore.ts:8`, `News.tsx:12`, `Tasks.tsx:9`, etc.) are all comments, not import statements. `app/package.json` has zero Firebase, Azure, Cosmos, Anthropic, or OpenAI SDK dependencies.
- repro: N/A — not a real defect. `grep -r "^import.*from.*['\"]firebase\|@firebase\|@azure\|CosmosClient\|@anthropic\|openai" app/src/ shared/src/` → empty.

---

<!-- SEAM probe clean-summary 2026-07-11:
Adapter-seam integrity confirmed clean. All app/ reads/writes go through
app/src/lib/backend/ (azure.adapter.ts — pure fetch wrapper, no SDK imports).
shared/ has zero platform SDK deps (package.json: only oxlint/typescript/vitest).
Investigated: Firebase comments, VITE_USE_EMULATORS, HomeCheck vision path,
savedViewsStore localStorage, direct SDK constructor calls, hardcoded platform
endpoint URLs, AI SDK imports. Every vector returned clean.
-->

---

### DEF-0008
- status: OPEN
- severity: HIGH
- probe: ROLE
- surface: server/lib/data.js:113-121
- title: POST /api/db/vote guarded by requireAuth only — VIEWER can mutate entity vote data, bypassing EDITOR+ gate and atomic envelope
- evidence: `data.js:113` — `router.post('/vote', requireAuth, requireTenant, ...)`. The handler reads an entity, increments `votes.count`, pushes to `votes.voters`, then calls `docs.item(...).replace(ent)` — a raw Cosmos document replace. CLAUDE.md binding invariant: "VIEWER is read-only. every write is EDITOR+; always." data.js module comment (line 11): "Role matrix: reads = any authed (VIEWER+); writes = EDITOR+". `app/src/lib/backend/types.ts:74-76` documents: "any authenticated role may vote" — confirming a deliberate design choice that directly contradicts the binding invariant. Secondary violation: `docs.item(...).replace(ent)` bypasses the atomic mutate envelope (no audit event, no version document emitted). Confirmed via `grep -n 'requireAuth\|requireRole' server/lib/data.js` — only the vote route uses requireAuth for a write path.
- repro: Obtain a VIEWER JWT via `curl -X POST /api/auth/login -d '{"username":"<viewer>","password":"<pw>","tenant":"<tid>"}' | jq .token`. Then `curl -X POST /api/db/vote -H 'Authorization: Bearer <VIEWER_JWT>' -H 'Content-Type: application/json' -d '{"path":"feedback/some-id"}'` — returns HTTP 200 with updated vote count. No 403 returned.
- fix:
- verified-by:
- commit:

---

### DEF-0009
- status: OPEN
- severity: MEDIUM
- probe: ROLE
- surface: server/lib/data.js:124-131
- title: POST /api/db/setNewsPins guarded by requireAuth only — VIEWER can upsert personal news-preference records in Cosmos
- evidence: `data.js:124` — `router.post('/setNewsPins', requireAuth, requireTenant, ...)`. Handler calls `docs.items.upsert(...)` to write a `newsPrefs` entity — a Cosmos write not gated at EDITOR+. CLAUDE.md binding invariant: "every write is EDITOR+; always." A UID ownership check (`if (uid !== req.user.uid) return 403`) limits blast radius to the caller's own preferences, but does not exempt the route from the binding invariant. Also bypasses the atomic mutate envelope (direct upsert, no audit event). `grep -n 'setNewsPins' server/lib/data.js app/src/lib/backend/azure.adapter.ts`
- repro: Obtain a VIEWER JWT. `curl -X POST /api/db/setNewsPins -H 'Authorization: Bearer <VIEWER_JWT>' -H 'Content-Type: application/json' -d '{"uid":"<viewer-uid>","pinnedHashes":["abc123"]}'` — returns HTTP 200, preference upserted.
- fix:
- verified-by:
- commit:

---

### DEF-0010
- status: OPEN
- severity: LOW
- probe: ROLE
- surface: server/lib/data.js:133-137
- title: POST /api/db/presence/join guarded by requireAuth only — VIEWER can write presence heartbeats (separate presence container)
- evidence: `data.js:133` — `router.post('/presence/join', requireAuth, requireTenant, ...)`. Handler calls `presence.items.upsert(...)` on the `presence` container — a Cosmos write with no EDITOR+ gate. CLAUDE.md binding invariant: "every write is EDITOR+; always." Presence heartbeats are operationally benign (ephemeral awareness signals, separate from the docs container) but the invariant admits no exception. `grep -n 'presence' server/lib/data.js`
- repro: Obtain a VIEWER JWT. `curl -X POST /api/db/presence/join -H 'Authorization: Bearer <VIEWER_JWT>' -H 'Content-Type: application/json' -d '{"pid":"products/P1"}'` — returns HTTP 200, presence upserted.
- fix:
- verified-by:
- commit:

---

### DEF-0011
- status: FALSE-POSITIVE
- severity: N/A
- probe: ROLE
- surface: docs/review/_capture.mjs:299
- title: FP — `pf.devAdminBypass` localStorage removal in screenshot capture script is stale cleanup; key not consumed by any deployed app source
- evidence: `grep -r 'devAdminBypass' app/src/` returns zero results. `grep -r 'devAdminBypass' . --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs'` returns exactly one match: `docs/review/_capture.mjs:299`, a Playwright screenshot automation script that removes the key as a cleanup step (not as a set/read). The key has no producer or consumer in the deployed application. This is dead cleanup code for a previously-removed dev bypass.
- repro: N/A.

---

<!-- ROLE probe summary 2026-07-11:
signInAsDevAdmin() confirmed absent from all source (grep returns zero hits).
pf.devAdminBypass localStorage key confirmed dead in app/src (DEF-0011 FP).
DEF-0001 BOOTSTRAP users remain the only live dev-bypass risk.
Role enforcement is server-side and correct for: /mutate (EDITOR+), /mutateBatch (EDITOR+),
/admin/* (ADMIN via router.use), /ai/* (ANALYST+), /duckcreek/* (EDITOR+), /serff/bundle (EDITOR+),
/storage/upload (EDITOR+). Three routes violate "every write is EDITOR+": /vote (DEF-0008, HIGH),
/setNewsPins (DEF-0009, MEDIUM), /presence/join (DEF-0010, LOW). No UI-only gates found for
write paths — all relevant write gates are also enforced server-side; canEdit UI checks are
defense-in-depth only.
-->
- note(MUTATION probe 2026-07-11 on DEF-0008): bare-write vector confirmed — `data.js:120` `docs.item(idFor('ent', path), pkFor(tid, path)).replace(ent)` is a raw Cosmos replace: no audit event, no version document, no searchIndex update, no rev increment. Two violations in one endpoint (role + envelope bypass).
- note(MUTATION probe 2026-07-11 on DEF-0009): bare-write vector confirmed — `data.js:129` `docs.items.upsert({ kind: 'entity', ... })` is a raw Cosmos upsert with no atomic envelope; same dual violation as DEF-0008.

---

### DEF-0012
- status: OPEN
- severity: HIGH
- probe: MUTATION
- surface: server/lib/ai.js:104-122
- title: `persistSummary()` writes a `kind:'entity'` document via bare upsert with `rev` hardcoded to `1`, bypassing the mutate() atomic envelope entirely
- evidence: `grep -n 'upsert\|rev.*1\|kind.*entity' server/lib/ai.js` — lines 107-118: `docs.items.upsert({ id: 'ent:productSummaries~...', kind: 'entity', rev: 1, ... })` called directly from `summarizeProduct`. No audit event, no version record, no searchIndex write. `rev` is always `1` regardless of call count; successive calls silently overwrite the document and reset rev, meaning a future `mutate()` on this path would start at `curRev=1` with no version history for the baseline. The function is swallowed in a try/catch with a non-fatal warning, so persistence failures are invisible to the caller.
- repro: Call `POST /api/ai/summarizeProduct` with a valid ANALYST JWT twice for the same product. Query Cosmos `docs` container for `id='ent:productSummaries~<productId>'`: entity exists with `rev:1`. Query for any document with `kind='audit'` or `kind='version'` in partition `${tenantId}|productSummaries` — zero results. Call a third time; rev is still 1 with no version trail.

---

### DEF-0013
- status: OPEN
- severity: HIGH
- probe: MUTATION
- surface: server/lib/data.js:95-111
- title: `mutateBatch` within-partition chunk overflow produces multiple non-atomic Cosmos batch calls; first chunk commits silently if subsequent chunks fail
- evidence: `grep -n 'BATCH_OPS\|chunk.length\|docs.items.batch' server/lib/data.js` — line 19: `BATCH_OPS = 96`; each entity envelope produces 4 ops (entity + audit + version + searchIndex); threshold is 24 entities per partition before the first chunk flush. Lines 102-104: `if (chunk.length + ops.length > BATCH_OPS) { await docs.items.batch(chunk, pk); chunk = [] }` — each chunk is an independent Cosmos transactional batch call; if the Nth chunk succeeds but the (N+1)th fails, the first N×24 entities are permanently committed with no rollback. Outer `catch` returns `{ error: 'batch_failed' }` without identifying which payloads succeeded. `SeedProcessDialog.tsx:48` calls `adapter.db.mutateBatch(buildSeedPayloads(...))` which can produce 65 task payloads all mapping to partition `${tenantId}|tasks` (260 ops → 3 separate batch calls).
- repro: `POST /api/db/mutateBatch` with 25 payloads whose paths all map to the same partition (e.g., `tasks/t1` through `tasks/t25`). Induce a Cosmos failure on the second batch call (rate-limit or network partition). First 24 entities commit; entity 25 does not. Server returns 500; Cosmos state is partial with no way for the client to distinguish which payloads persisted.

---

### DEF-0014
- status: OPEN
- severity: MEDIUM
- probe: MUTATION
- surface: server/lib/serff.js:233-256
- title: SERFF bundle-generate handler injects an orphan `kind:'audit'` record into the product partition outside any atomic batch, fire-and-forget
- evidence: `grep -n 'items.create\|kind.*audit' server/lib/serff.js` — lines 238-253: `_docs.items.create({ id: 'aud:serff:...', pk: pkFor(tenantId, cloneProductId), kind: 'audit', op: 'serff-bundle-generate', ... })`. The code comment says "fire-and-forget; atomic via data.js conventions" but this is NOT using data.js conventions — it is a direct Cosmos create outside any transactional batch. If the create fails (wrapped in non-fatal try/catch), the SERFF operation succeeds with no audit record. The audit document that IS written has no corresponding `kind:'version'` record and no `kind:'searchIndex'` update, creating an orphaned entry in the product partition that violates the implied 1:1 audit-to-entity-write pairing.
- repro: `POST /api/serff/v1/bundle` with valid EDITOR JWT and two valid product refs. On success, query Cosmos for `kind='audit'` in partition `${tenantId}|${productBase}` with `op='serff-bundle-generate'`: the audit record exists. Query for a sibling `kind='version'` document with the same `entityPath` — none exists.

---

### DEF-0015
- status: OPEN
- severity: MEDIUM
- probe: MUTATION
- surface: server/lib/data.js:75
- title: Version records store the full new entity snapshot, not a field diff — the `Version(field diff)` requirement of the mutation invariant is unimplemented
- evidence: `grep -n 'kind.*version\|entityData\|current' server/lib/data.js` — line 65: `const current = await readEntity(tid, path)` (previous state is fetched and available); line 69: `const entityData = { ...data, rev, updatedAt, updatedBy }` (full new state); line 75: `{ kind: 'version', data: op === 'delete' ? null : entityData, ... }` — `current.data` is never compared against `data` to produce a diff, `changed`, or `before` field. History viewers must fetch two consecutive version records and compute a diff externally. `HistoryDrawer.tsx:5` (comment) states the history is "atomically written" but does not claim field-level diff.
- repro: Call `mutate({ op:'update', path:'products/P1', data:{ name:'New Name' }, ... })` with a product that had `{ name:'Old Name' }`. Query Cosmos for `kind='version'` at `entityPath='products/P1'`: the version document body is `{ name:'New Name', rev:2, ... }` — full new state with no `before`, `diff`, or `changed` field.

---

### DEF-0016
- status: OPEN
- severity: MEDIUM
- probe: MUTATION
- surface: server/lib/data.js:67
- title: `expectedRev` optimistic-concurrency guard is silently bypassed when the target entity does not exist — any `expectedRev` value is accepted on a create against a non-existent path
- evidence: `grep -n 'expectedRev\|current &&' server/lib/data.js` — line 67: `if (payload.expectedRev !== undefined && current && curRev !== payload.expectedRev) { throw conflict }`. The conjunction `&& current` means: when `readEntity()` returns null (path absent or previously deleted), the check is entirely skipped regardless of the provided `expectedRev`. A caller providing `expectedRev: 99` for a create against an absent path receives HTTP 200 with `rev: 1` — the compare-and-swap guarantee is voided. Scenario: two concurrent writers both read entity at rev=5; writer A deletes it; writer B sends an update with `expectedRev: 5` — instead of a 409, writer B's operation silently re-creates the entity as rev=1.
- repro: Delete entity at `products/P1` (confirms `current=null`). Then `POST /api/db/mutate` with `{ op:'create', path:'products/P1', expectedRev:99, data:{...}, entityType:'product', ... }` — returns `{ ok:true, rev:1 }`. The `expectedRev:99` is silently ignored.

---

### DEF-0017
- status: FALSE-POSITIVE
- severity: N/A
- probe: MUTATION
- surface: server/lib/admin.js, server/lib/duckcreek.js, server/lib/data.js (presence routes)
- title: FP — admin.js `__system__` writes, duckcreek `kind:'duckcreek_audit'` writes, and presence container writes are intentional non-entity writes outside the mutation invariant's scope
- evidence: `grep -n 'kind.*tenant\|kind.*user\|kind.*duckcreek_audit' server/lib/admin.js server/lib/duckcreek.js` — (a) `admin.js:30,59`: `kind:'tenant'` and `kind:'user'` in the `__system__` partition — ADMIN-role only, system management data, no product entity envelope required. (b) `duckcreek.js:123`: `kind:'duckcreek_audit'` in a dedicated `${tenantId}|__duckcreek_api__` partition, documented in-code as "audit is append-only"; not a `kind:'entity'` write. (c) `data.js:136`: `presence.items.upsert(...)` targets a separate `presence` Cosmos container (not `docs`), writes ephemeral session heartbeats with no entity kind — outside the `docs` entity lifecycle entirely.
- repro: N/A — all three write classes produce no `kind:'entity'` documents and are not in scope of the "every entity write uses mutate()" invariant.

<!-- MUTATION probe summary 2026-07-11:
Write-path audit complete across server/ and app/src/. All app-layer components correctly route
through adapter.db.mutate() or adapter.db.mutateBatch() — confirmed by grep over app/src (no direct
Cosmos SDK imports in browser code; adapter is the sole write path). The envelope() function
(data.js:60-79) is structurally sound for the nominal mutate() path: all 4 ops (entity + audit +
version + searchIndex) share the same pk and commit in one Cosmos transactional batch.
Defects found: two server-side routes (/vote DEF-0008, /setNewsPins DEF-0009) bypass the envelope
with bare Cosmos writes and allow VIEWER access (already logged by ROLE probe; bare-write note
added above); persistSummary() in ai.js writes a kind:'entity' doc with rev hardcoded to 1
(DEF-0012 HIGH); mutateBatch() within-partition chunk overflow is non-atomic above 24-entity
threshold (DEF-0013 HIGH); serff.js injects orphan audit records outside the batch (DEF-0014
MEDIUM); version records store full snapshots not field diffs (DEF-0015 MEDIUM); expectedRev is
silently bypassed when entity is absent (DEF-0016 MEDIUM). DEF-0017 clears admin/__system__,
duckcreek, and presence writes as intentional non-entity writes.
parentId validation (DEF-0003) confirmed still unimplemented — no note added (existing DEF).
-->

---

### DEF-0018
- status: OPEN
- severity: CRITICAL
- probe: CITE
- surface: server/lib/ai.js:193-234, app/src/components/chat/Markdown.tsx:74-78, app/src/lib/ai/notices.ts
- title: Portfolio chat stream has no server-side citation validation — fabricated [refId] chips render as authoritative
- evidence: (1) `grep -n 'notice\|unverified\|emit.*notice' server/lib/ai.js` → zero results; `chat()` emits only `{t:'token'}`, `{t:'error'}`, `{t:'done'}` — never `{t:'notice', kind:'unverified'}`. (2) Client is fully wired: `notices.ts:13` defines `NoticeKind='unverified'`; `Home.tsx:149-153` and `TaskBriefing.tsx:19` both handle `{t:'notice'}` — dead client infrastructure the server never triggers for portfolio chat. (3) `Markdown.tsx:27` — regex `cite: /^\[([^\]]+)\]/` renders ANY `[X]` in model output as a styled clickable `CitationChip` with zero existence validation; `openCitation()` (Home.tsx:91-100) silently falls back to `/app/explorer` for unknown refIds, so a fabricated chip looks identical to a real one. (4) Adversarial-input proof: `grep -ri 'cyber\|earthquake\|nuclear' shared/src/seed/` → zero results. Question "What is the cyber liability sub-limit under the GL product?" yields `grounding()` returning `[]`; system becomes `CONTEXT:\n(no matching context found)`. Server fires the LLM with NO early-return or rate-limiting-of-fabrication guard; response streams token-by-token with no post-processing. A model output containing `[GL.COV.999]` reaches the client unchanged and renders as an authoritative chip. (5) The claims copilot equivalent (functions/src/claims.ts) does have server-side citation resolution, `unverifiedCitations` field, and client-side `shouldRenderDetermination()` guard. Portfolio chat has none. CLAUDE.md binding invariant: "AI grounded + cited: AI responses must cite their source documents. Free invention is a bug."
- repro: `POST /api/ai/chat` with `{ messages:[{role:'user',content:'What is the cyber liability endorsement sub-limit under the GL product?'}] }` — grounding returns empty (no "cyber" in corpus). Model streams — if it invents a `[GL.COV.999]` citation, the response arrives unchanged, the chip renders, clicking it goes to explorer. No server-side validation fires.
- fix:
- verified-by:
- commit:

---

### DEF-0019
- status: OPEN
- severity: HIGH
- probe: CITE
- surface: shared/src/retrieval/chunk.ts:77-106, 155-174
- title: Rule, formRule, LD-table, and RT-table grounding chunks lack the [refId] bracket format the system prompt requires for citation
- evidence: `chunkRule()` (chunk.ts:79): `` `Rule ${refId} (${r.category}...)` `` — bare refId, no brackets. `chunkFormRule()` (chunk.ts:95): `` `Form-attachment rule ${refId}` `` — bare. `chunkLdTable()` (chunk.ts:157): `` `Limit/Deductible table ${refId} — ${t.name}` `` — bare. `chunkRtTable()` (chunk.ts:165): `` `Rate table ${refId} — ${t.name}` `` — bare. Contrast: `chunkProduct()` (chunk.ts:47) and `chunkCoverage()` (chunk.ts:63) embed `[${refId}]` in brackets; `chunkRatingProgram()` (chunk.ts:145) also brackets. System prompt (ai.js:36): "cite its source using the bracketed reference tags that appear in the context." For rules, formRules, LD tables and RT tables no bracketed reference tag appears in chunk text. The model either (a) omits the citation — missing citation (HIGH) — or (b) invents the bracket wrapper around a bare ID it saw — technically fabricates a tag, which "Do not fabricate reference tags" (ai.js:37) forbids. Either outcome violates the citation invariant. Run: `grep -n '^\`Rule\|^\`Form-attachment\|^\`Limit\|^\`Rate' shared/src/retrieval/chunk.ts` (after substituting template literal patterns) to confirm all four lack brackets.
- repro: Ask the portfolio chat "What is the minimum premium threshold for the HO-3 rating program?" Grounding returns `chunkRule` entries for minimum-premium rules (e.g., text contains `Rule PH.RU.009 ...` without brackets). The model cannot satisfy "cite with a bracketed reference tag that appears in the context" for these chunks because the bracketed form is absent.
- fix:
- verified-by:
- commit:

---

### DEF-0020
- status: OPEN
- severity: MEDIUM
- probe: CITE
- surface: server/lib/ai.js:94-102, 154-155 (groundSummary, summarizeProduct)
- title: summarizeProduct groundSummary filter only validates coverageHighlights names; headline, overview, highlights values, and considerations pass through unvalidated
- evidence: `groundSummary()` (ai.js:94-102): computes `known` from `coverages[].name`, filters `coverageHighlights` array to name-matched entries, returns `{ ...raw, coverageHighlights: grounded }`. The `...raw` spread passes `raw.headline`, `raw.overview`, `raw.highlights` (array of `{label,value}` tiles), and `raw.considerations` through unchanged. No code checks these fields against the product metadata. Examples of undetectable invention: `highlights[].value` = "States: 50" when product footprint is 15 states; `headline` = "Built on HO 00 03 with earthquake endorsement" when no earthquake coverage exists; `considerations[]` = invented regulatory requirement. SUMMARY_TOOL schema (ai.js:59-82) and SUMMARY_SYSTEM prompt (ai.js:84-88) instruct the model to use only the metadata, but no server-side code validates the prose output against the input JSON. `grep -n 'highlights\|headline\|overview\|considerations' server/lib/ai.js` confirms these fields are never checked.
- repro: `POST /api/ai/summarizeProduct` with a product body whose `footprint` is 15 states. Inspect response — if `highlights` contains `{label:'States',value:'50'}`, it passes through `groundSummary` unchanged because `groundSummary` only touches `coverageHighlights`.
- fix:
- verified-by:
- commit:

---

<!-- CITE probe summary 2026-07-11:
All AI calls confirmed server-side only: /api/ai/* (ANALYST+); zero client SDK imports in
app/ or shared/ (grep -r "@anthropic\|@azure/openai" app/src/ shared/src/ → empty).
Grounding mechanism confirmed: Cosmos groundingChunks, keyword-scored keyword query, top-8 slice.
Three real defects found:
  DEF-0018 CRITICAL: no server-side citation validation in portfolio chat — fabrication path open;
    fabricated [refId] chips render identically to real ones via Markdown.tsx CitationChip.
  DEF-0019 HIGH: rule/formRule/LD-table/RT-table chunks lack [refId] bracket format — citation
    instruction unsatisfiable from context for these four entity types.
  DEF-0020 MEDIUM: summarizeProduct groundSummary validates coverageHighlights only; other
    prose fields (headline/overview/highlights.value/considerations) are unvalidated.
Adversarial test executed: grep confirmed "cyber"/"earthquake"/"nuclear" absent from all seed
files → grounding returns [] for cyber coverage query → model fires with (no matching context
found) → no code intercepts between model output and client SSE stream.
Claims copilot (functions/src/claims.ts) has the full citation-resolution + shouldRenderDetermination()
stack but is NOT ported to Azure (returns 501 on /api/ai/:name for any name except chat/summarizeProduct).
DEF-0006 note added: Admin.tsx:746 UI copy references "cheap verifier" and "stale-cited answer
never served" — describes the original Firebase semanticCache+verifier stack; absent in Azure port.
-->
