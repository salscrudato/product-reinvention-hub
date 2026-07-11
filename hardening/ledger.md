SUMMARY: OPEN: 26 | CRITICAL: 2 | HIGH: 9 | MEDIUM: 13 | LOW: 2 | WONTFIX: 0 | FALSE-POSITIVE: 6

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
- note(SECRETS probe 2026-07-11): Client bundle `app/dist/assets/Admin-C9uYCkWl.js` contains the string `"Bootstrap admins (admin, sal.scrudato) are always available"` from `app/src/routes/Admin.tsx:177`. This chunk is publicly downloadable by any unauthenticated client; bypass account usernames are discoverable without any credentials, directly enabling exploitation of this DEF. Evidence: `git grep -n "sal.scrudato" app/src/` → `app/src/routes/Admin.tsx:177`; `grep -o ".\{50\}sal\.scrudato.\{100\}" app/dist/assets/Admin-C9uYCkWl.js` → confirms the string in the bundle.

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

---

### DEF-0021
- status: OPEN
- severity: HIGH
- probe: MULTILINE
- surface: server/lib/serff.js:191, server/lib/serff-shared.cjs:5435
- title: SERFF bundle endpoint hard-codes `?? 'PH'` LOB fallback; GL product with missing ratingProgram silently gets Personal Home rating tables
- evidence: `grep -n 'lobPrefix\|ratRows\|ratingProgram' server/lib/serff.js` — line 191: `const lobPrefix = cloneSnap.ratingProgram?.refId?.split('.')[0] ?? 'PH'`. Line 85: `loadSnapshot()` returns synthetic `{ refId: '', ... }` when Cosmos ratingPrograms subcollection is empty. `''.split('.')[0]` = `''`; `'' ?? 'PH'` does NOT fire (empty string is not null/undefined), so `lobPrefix = ''`. `grep -n 'KITS\["PH"\]' server/lib/serff-shared.cjs` → line 5435: `resolveRatingKit('')` → `KITS['']` undefined → `resolveLineArchetypeByPrefix('')` undefined → `return KITS["PH"]`. `loadSnapshot()` lines 87-95 returns only `{ refId, name, coverages, forms, rtTables, ldTables, ratingProgram }` — `product.lob` is absent; no LOB-aware fallback path exists.
- repro: `POST /api/serff/bundle` with a GL product whose ratingPrograms subcollection is absent or empty in Cosmos (any GL product not seeded via `migrate-to-cosmos.ts`, or whose ratingPrograms were deleted). `loadSnapshot()` returns `ratingProgram = { refId: '' }`. `resolveRatingKit('')` silently returns PH kit. Rate exhibit is computed with PH territory/construction factor tables instead of GL class-code/exposure-volume tables — numerically wrong with no error returned.
- fix:
- verified-by:
- commit:

---

### DEF-0022
- status: OPEN
- severity: MEDIUM
- probe: MULTILINE
- surface: app/src/routes/News.tsx:57-65
- title: News relevance scorer has no GL keyword expansion; BASE_NEWS_INSTRUCTION hardcodes HO+PA emphasis, omitting GL
- evidence: `grep -n 'LOB_KEYWORDS\|BASE_NEWS_INSTRUCTION' app/src/routes/News.tsx` — line 57-60: `LOB_KEYWORDS = { HO: ['homeowners','ho-3','dwelling',...], PA: ['personal auto','automobile',...] }` — no `GL` key. Line 65: `BASE_NEWS_INSTRUCTION` ends "with emphasis on Homeowners (HO) and Personal Auto (PA)." Line 100: `const extras = LOB_KEYWORDS[lobPrefix] ?? []` — for a GL product `lobPrefix='GL'`, `LOB_KEYWORDS['GL']` is `undefined`, `extras=[]`. PH gets 8 expansion terms (+3 relevance per match); PA gets 7; GL gets 0. Industry abbreviations 'CGL', 'occurrence form', 'commercial general liability', 'CG 00 01' are absent.
- repro: Navigate to the News tab with a portfolio containing only the GL seed product (GL.PROD.001). Any article about CGL rate filings or ISO CGL updates that uses 'CGL' without spelling out 'general liability' in full scores zero LOB-relevance for the GL product; an equivalent PH article using 'homeowners' would score +3.
- fix:
- verified-by:
- commit:

---

### DEF-0023
- status: OPEN
- severity: MEDIUM
- probe: MULTILINE
- surface: app/src/lib/export/duckcreek.test.ts:37-40,68
- title: Duck Creek export test matrix covers only PH and PA; GL export path entirely untested; lob-token assertion is HO/PA-biased
- evidence: `grep -n 'describe.each\|_name.includes\|GL_DATA' app/src/lib/export/duckcreek.test.ts` — lines 37-40: `describe.each([['Personal Home (HO-3)', PH_DATA], ['Personal Auto (PAP)', PA_DATA]])` — no GL_DATA entry. Line 68: `const lob = _name.includes('Home') ? 'HO' : 'PA'` — if GL were added to the matrix, 'General Liability' → `lob='PA'`, silently asserting the wrong lobToken. The GL Duck Creek path (`lobTokens: { ..., GL: "GL" }` per serff-shared.cjs) is never exercised: GL XML generation, GL validation report, GL cross-ref integrity, GL round-trip, and GL manuScriptID prefix are all invisible to CI.
- repro: Any regression introduced in the GL XML serialisation path (wrong namespace, missing refId, broken CovA/CovB/CovC coverage-part mapping) passes the full test suite without detection.
- fix:
- verified-by:
- commit:

---

### DEF-0024
- status: FALSE-POSITIVE
- severity: N/A
- probe: MULTILINE
- surface: shared/src/insurance/lobRegistry.ts:221, app/src/routes/product/ProductPricing.tsx:175
- title: FP — DEFAULT_LOB=PH_LOB and isHO branch are documented-intentional, not silent HO hard-coding
- evidence: `grep -n 'DEFAULT_LOB\|resolveLob' shared/src/insurance/lobRegistry.ts` — lines 219-221 comment: "Personal Home is the seed reference line and the safe default when a product's LOB is missing or unrecognised" — explicitly documented. `resolveLob()` JSDoc: "then falls back to Personal Home (the reference line)". `ProductPricing.tsx:175` `const isHO = lob.prefix === 'PH' && !useGrid` is correct registry-driven routing; GL routes to GenericRatingPanel. `grep` confirmed: `StateTileMap.tsx`, `GenericRatingPanel.tsx`, `groupBySection()`, `isPerilState()`, `evaluateRulesGL()` — all line-agnostic. Registry provably drives refId prefix, section taxonomy, and peril/coastal rules: `grep -n 'groupBySection\|isPerilState\|lob\.sections\|peril\.eligibleStates' shared/src/insurance/lobRegistry.ts`.
- repro: N/A — not a defect. DEFAULT_LOB fallback is a known design choice; isHO routing is correct registry-driven dispatch.

---

<!-- MULTILINE probe summary 2026-07-11:
Registry provably drives refId prefix (resolveLob/lobByPrefix), section taxonomy
(groupBySection reads lob.sections), and peril/coastal rules (isPerilState reads
lob.peril.eligibleStates; evaluateRulesPH PH_COASTAL consts are PH-evaluator-only).
GenericRatingPanel, StateTileMap, ProductRules GL-branch, and termConstraints PH-guard
all confirmed line-agnostic or correctly branched. Three real HO-only hard-codings found:
(1) SERFF lobPrefix ?? 'PH' / resolveRatingKit('') → PH kit when ratingProgram missing [DEF-0021, HIGH];
(2) News.tsx LOB_KEYWORDS has no GL entry, BASE_NEWS_INSTRUCTION names only HO+PA [DEF-0022, MEDIUM];
(3) duckcreek.test.ts matrix covers only PH+PA, GL export path untested, lob assertion biased [DEF-0023, MEDIUM].
DEF-0024 clears DEFAULT_LOB=PH_LOB and isHO routing as intentional/documented.
-->

---

### DEF-0025
- status: FALSE-POSITIVE
- severity: N/A
- probe: RATING-CANARY
- surface: shared/src/rating/generalLiability.evaluator.test.ts:27, hardening/BACKEND.md:107-110
- title: FP — probe spec claims GL canary = $2,789; actual code asserts exactly $2,635
- evidence: Every authoritative source locks GL at $2,635, not $2,789. `generalLiability.evaluator.test.ts:27` — `expect(result.finalPremium).toBe(2635)` (strict equality). `workedExample.canary.test.ts:31` — `GL: { canary: 2635, ... }` iterated with `expect(result.finalPremium).toBe(canary)`. `evaluator.ts:14` comment — "the $1,528 (HO-3), $1,002 (Personal Auto) and $2,635 (GL) canaries are untouched". `generalLiability.ts:8` header — "The $2,635 canary is locked by generalLiability.evaluator.test.ts." `hardening/BACKEND.md:107-110` — already documents the discrepancy: "The harness specification for this session cites GL canary 'expected 2789'. The actual authoritative value, per `shared/src/rating/generalLiability.evaluator.test.ts:27`, is $2,635. GROUND_TRUTH.md line 592 explicitly states: 'the GL canary is $2,635 (see V15), not $2,789.'" Confirm: `grep -n 'toBe(263' shared/src/rating/generalLiability.evaluator.test.ts` → `27:    expect(result.finalPremium).toBe(2635)`. `grep -n '2789\|2,789' shared/ -r` → zero results in any test or seed file.
- repro: N/A — not a code defect. The probe specification contained a stale canary value ($2,789); the codebase is correct.

---

### DEF-0026
- status: OPEN
- severity: MEDIUM
- probe: RATING-CANARY
- surface: shared/src/rating/evaluator.creditFloor.test.ts:50
- title: Credit-cap test uses toBeCloseTo for finalPremium instead of toBe, masking non-integer premium on creditFloor path
- evidence: `evaluator.creditFloor.test.ts:50` — `expect(r.finalPremium).toBeCloseTo(800, 6)`. The program under test (`makeCreditProgram(0.70)`) ends with `{ id: 's6', op: 'MIN_FLOOR', source: { type: 'CONST', value: 500 }, roundTo: 0 }` (line 28). After a `roundTo: 0` MIN_FLOOR step the running total is always a whole-dollar integer: the `__credit_cap__` adjustment fires after the last credit step (s4, order 4) and BEFORE s5 (flat add) and s6 (MIN_FLOOR + roundTo:0), so the final `running` is `Math.round(≈800) = 800` exactly. Using `.toBeCloseTo(800, 6)` means the test PASSES for any `finalPremium` within ±0.0000005 of 800 — a non-integer like 800.0001 passes silently. Contrast: the no-creditFloor path (line 39) uses `.toBe(748)`; the gated-credits path (line 75) uses `.toBe(910)`; the filing-importer canary (`functions/src/filingImport.test.ts:71`) uses `.toBe(1281)` for a creditFloor=0.5 program with a trailing MIN_FLOOR. All three demonstrate that `.toBe()` is correct and achievable for final premiums from programs with `roundTo: 0` MIN_FLOOR termination. Secondary risk: if a PM-authored or filing-imported program places credit steps AFTER the MIN_FLOOR step in the step ordering (e.g., credit at order 10, MIN_FLOOR at order 5), the credit cap fires after MIN_FLOOR and `finalPremium` is a non-integer float. The weak assertion would not detect this regression. `grep -n 'toBeCloseTo' shared/src/rating/evaluator.creditFloor.test.ts` — line 50 is the sole premium assertion using approximate equality; the cap-mechanism assertion at line 48 (`cap.factorOrAmount`) is correctly approximate (0.70/0.648 is irrational in IEEE 754). `grep -n 'toBeCloseTo.*800\|toBe.*800' shared/src/rating/evaluator.creditFloor.test.ts` confirms the mismatch.
- repro: In `evaluator.creditFloor.test.ts`, change line 50 from `expect(r.finalPremium).toBeCloseTo(800, 6)` to `expect(r.finalPremium).toBe(800)`. Run `pnpm --filter @pf/shared test evaluator.creditFloor`. If the test PASSES, the assertion is simply too loose (a weakness, not a runtime error). If it FAILS, the credit cap path is leaving a non-integer finalPremium even after `roundTo: 0`, confirming active float drift.
- fix:
- verified-by:
- commit:
- note(RATING-CANARY probe 2026-07-11 on DEF-0004): The "silent corruption of stored premium" concern is PROVED FALSE for the current architecture. `grep -r 'finalPremium' app/src/ shared/src/ server/ --include="*.ts" --include="*.tsx" --include="*.js"` — every consumer of `finalPremium` either displays it in the UI (ProductPricing.tsx, HomeCheck.tsx, TaskLensPanel.tsx) or uses it for a transient SERFF rate-exhibit computation returned to the browser as HTTP JSON. No `adapter.db.mutate()` or `adapter.db.mutateBatch()` call is ever passed a `finalPremium` value; no rating output is stored to Cosmos. The float-money risk (DEF-0004) is therefore a future-state concern (e.g., if a quote-binding path were added) rather than a live data-corruption path.

---

<!-- RATING-CANARY probe summary 2026-07-11:
HO-3 $1,528 canary: confirmed byte-exact via `.toBe(1528)` in evaluator.test.ts:16,
evaluator.creditFloor.test.ts:89, seedIntegrity.test.ts:31, workedExample.canary.test.ts:49,
rtGrid.test.ts:57, bundle.test.ts:401. Six independent exact assertions. No drift.
GL canary: code asserts $2,635 exactly (`.toBe(2635)` in generalLiability.evaluator.test.ts:27,
workedExample.canary.test.ts:49, evaluator.creditFloor.test.ts:99). Probe spec "$2,789" is stale
— logged as FALSE-POSITIVE DEF-0025.
Money representation: no integer-cent encoding anywhere; all float dollars (DEF-0004 confirmed).
Intermediate HO-3 steps use `.toBeCloseTo()` (s5, s8a, s9, s10a, s10b); final s11 uses `.toBe(1528)`.
Stored premium corruption: FALSE — finalPremium is never written to Cosmos; float-money risk
is display-only and SERFF exhibit-only in the current architecture.
Credit cap path: evaluator.creditFloor.test.ts:50 uses toBeCloseTo for final premium even though
a roundTo:0 MIN_FLOOR terminates the program — logged as DEF-0026 MEDIUM (weak test assertion).
All existing canary tests pass on Node 24 per full gate run 2026-07-11 (59+17 test files, 685+187 tests).
-->

---

### DEF-0027
- status: OPEN
- severity: HIGH
- probe: DATA-INTEGRITY
- surface: server/lib/data.js:52-56
- title: POST /api/db/list — SQL has no TOP clause; fetchAll() loads ALL N matching entities into server heap; slice(0,1000) applied only to the HTTP response
- evidence: `grep -n 'fetchAll\|maxItemCount\|TOP\|slice\|sql' server/lib/data.js` — line 52: `let sql = 'SELECT c.data FROM c WHERE ${where}'` — no `TOP @limit`. Line 55: `docs.items.query({ query: sql, parameters: params }, { maxItemCount: limit }).fetchAll()` — `maxItemCount` controls the Cosmos page size (x-ms-max-item-count) but `fetchAll()` iterates ALL continuation tokens until the query result set is exhausted. Line 56: `resources.slice(0, limit)` — applied AFTER fetchAll() has already loaded the full result set into the Node.js heap. Compare with DEF-0005 (admin endpoints, ADMIN-only, MEDIUM): the `/list` endpoint is requireAuth + requireTenant (VIEWER+), making this higher severity. Any authenticated user can trigger a full table scan of any collection they can name. No SQL-level row cap exists anywhere in server/lib/ (`grep -n 'TOP @\|SELECT TOP' server/lib/*.js` → zero results).
- repro: Seed or accumulate >1000 entities in one collection (e.g., `tasks`). `POST /api/db/list` with `{ "path": "tasks" }` via a VIEWER JWT → server calls `docs.items.query({...}, { maxItemCount: 1000 }).fetchAll()` with no SQL TOP → Cosmos fetches all N tasks across multiple pages, each page consuming RUs → all N documents land in Node.js heap → `slice(0, 1000)` discards extras before HTTP response. At N=10,000 tasks the server loads ~10× more data than it returns; at high N this risks OOM or request timeout. Being cross-partition (no partitionKey option passed to query), RU cost is also elevated.
- fix:
- verified-by:
- commit:

---

### DEF-0028
- status: OPEN
- severity: MEDIUM
- probe: DATA-INTEGRITY
- surface: server/lib/ai.js:43-49
- title: grounding() loads ALL groundingChunks for the tenant into server heap via fetchAll(); only top-8 scored chunks are used; no SQL TOP or result cap
- evidence: `grep -n 'fetchAll\|maxItemCount\|TOP\|slice' server/lib/ai.js` — line 43: `let sql = "SELECT c.data FROM c WHERE c.kind='entity' AND c.coll='groundingChunks' AND c.tenantId=@tid"` — no `TOP`. Line 45: `docs.items.query({ query: sql, parameters: params }, { maxItemCount: 500 }).fetchAll()` — `maxItemCount: 500` sets page size, not result count; `fetchAll()` fetches all pages. Line 49: `.slice(0, 8)` — applied to the in-process scored array AFTER all chunks are already in memory. With filing imports (ADR-0005), each imported carrier rate-filing generates many grounding chunks per product entity type. A tenant with 10 imported products could have thousands of groundingChunks. Every `POST /api/ai/chat` invocation triggers `grounding()`, loading all of them. Triggered by ANALYST+ role.
- repro: Import multiple filing PDFs via the filing importer path (ADR-0005) for one tenant, accumulating >500 `kind='entity'` documents in `coll='groundingChunks'`. Issue `POST /api/ai/chat` with a valid ANALYST JWT. Server loads all N groundingChunks into memory (N pages of 500), scores them in-process for keyword overlap, returns top-8 to the LLM context. Memory consumption scales linearly with chunk count; at several thousand chunks each holding up to 4000 chars of text (searchText truncation), heap impact can be significant per concurrent chat request.
- fix:
- verified-by:
- commit:

---

### DEF-0029
- status: OPEN
- severity: MEDIUM
- probe: DATA-INTEGRITY
- surface: app/src/lib/product/deleteDraft.ts:18-23, app/src/lib/import/importProduct.ts:40-41
- title: deleteProduct() cascade omits ldTables and rtTables subcollections; these entities become orphans in global collections after product deletion
- evidence: `grep -n 'SUBCOLLECTIONS\|coll\|entityType' app/src/lib/product/deleteDraft.ts` — lines 18-23: `SUBCOLLECTIONS = [{ coll:'coverages', entityType:'coverage' }, { coll:'rules', entityType:'rule' }, { coll:'formRules', entityType:'formRule' }, { coll:'ratingPrograms', entityType:'ratingProgram' }]` — no `ldTable` or `rtTable` entry. `grep -n 'ldTable\|rtTable' app/src/lib/import/importProduct.ts` — lines 40-41: `ldTable: { entityType:'ldTable', underProduct:false, path:(id) => \`ldTables/${id}\` }` and `rtTable: { entityType:'rtTable', underProduct:false, path:(id) => \`rtTables/${id}\` }` — filing importer creates ldTable/rtTable entities in the global `ldTables` / `rtTables` collections. `grep -n 'ldTables\|rtTables' app/src/routes/Products.tsx` — lines 83-84: `adapter.db.list('ldTables')` and `adapter.db.list('rtTables')` load ALL limit/deductible tables and rate tables for the portfolio view. Product-specific tables (e.g., PH.LD.001-006, PA.LD.001-006, GL.LD.001-004) remain in Cosmos after the owning product is deleted and continue to appear in these global lists. `shared/src/types.ts:512` confirms `ldTable` and `rtTable` are recognised `SearchEntityType` values.
- repro: (1) Import a product with filing tables via importProduct (or use any seed product that has ldTables). (2) Invoke the DeleteProductDialog / deleteDraftProduct flow for that product. (3) After deletion, `POST /api/db/list` with `{ path: 'ldTables' }` — the product's ldTable entities (e.g., PH.LD.001 through PH.LD.006) remain in Cosmos and are returned in the response. The portfolio's rate-table and L&D-table views show orphaned entries with no owning product. The orphaned tables also continue to match any `list('ldTables')` call used by ProductContext or SERFF snapshot assembly.
- fix:
- verified-by:
- commit:

---

### DEF-0030
- status: OPEN
- severity: MEDIUM
- probe: DATA-INTEGRITY
- surface: server/lib/data.js:48-53
- title: POST /api/db/list — client-supplied field names in query.where[].field and query.orderBy[].field are interpolated directly into the Cosmos SQL string without sanitization
- evidence: `grep -n 'w\.field\|o\.field\|data\.\$' server/lib/data.js` — line 50: `` where += `... c.data.${w.field} ${opMap[w.op] || '='} ${p}` `` and `` where += ` AND ARRAY_CONTAINS(c.data.${w.field}, ${p})` `` — field name from `query.where[i].field` (client-supplied) is interpolated into the SQL string with no allow-list, regex, or property-path validation. Line 53: `` sql += `... c.data.${o.field} ${(o.dir || 'asc').toUpperCase()}` `` — same pattern for `query.orderBy[i].field`. The VALUE `w.value` is correctly parameterised (`@w${i}`), but the FIELD NAME is not. A crafted field name such as `"x) OFFSET 0 LIMIT 99999"` or `"x, c.tenantId"` can modify the query structure or expose schema details. Cosmos SQL is read-only and tenant-scoped by `c.tenantId = @tid` (parameterised from the JWT), so full cross-tenant data exfiltration via injection requires bypassing the WHERE predicate — difficult but the field-name surface is unguarded. Any malformed field name that causes a Cosmos parse error propagates the raw Cosmos error through `res.status(500)` in Express's default error handler, leaking internal query structure to the caller.
- repro: `POST /api/db/list` with a VIEWER JWT and body `{ "path": "tasks", "query": { "orderBy": [{ "field": "id, c.tenantId", "dir": "asc" }] } }` → server generates `ORDER BY c.data.id, c.tenantId asc` — a syntactically valid Cosmos SQL that retrieves the `tenantId` column alongside sorted results, leaking the partition key layout. Alternatively, send `{ "where": [{ "field": "x) OR (1=1", "op": "==", "value": "y" }] }` → SQL parse error returned verbatim in the response body.
- fix:
- verified-by:
- commit:

---

<!-- DATA-INTEGRITY probe summary 2026-07-11:
Investigated: POST /api/db/list (VIEWER+), POST /api/db/presence/watch (requireAuth), grounding()
in ai.js (ANALYST+), cascade delete in deleteDraft.ts, searchIndex consistency, parentId orphan
detection, ldTable/rtTable orphan path, duckcreek/serff readColl() patterns, auth.js fetchAll().

DEF-0005 (admin unbounded list) confirmed in scope and noted as baseline; no new note added.
presence/watch fetchAll() assessed: SELECT c.uid only; record count bounded by unique user count
per (tenant, product) pair (upsert by ${tid}:${pid}:${uid}); not a realistic OOM risk — no new DEF.
duckcreek readColl() and serff readColl(): scoped to a single Cosmos partition (partitionKey
passed); product subcollections typically contain dozens of entities — not a realistic OOM risk.
auth.js:65 fetchAll(): single-record point lookup (username/email equality), not a collection scan.

searchIndex consistency: envelope() correctly emits kind='searchIndex' on every normal mutate().
SearchIndex is written but NEVER queried server-side or client-side (crossEntity.ts runs entirely
in-process on data fetched via list; list endpoint queries kind='entity', not kind='searchIndex').
Orphaned searchIndex tombstones (deleted:true after cascade delete) accumulate but have no observable
functional impact. Dark entities from persistSummary() (no searchIndex, see DEF-0012) also
non-impactful since searchIndex is unread. searchIndex consistency: no NEW stand-alone defect.

parentId orphan (coverage child with non-existent parentId): server-side no validation (DEF-0003,
already logged). Client-side ProductCoverages.tsx:90-103 handles orphans gracefully (surfaces as
roots). Direct API delete of a product shell (bypassing deleteProduct cascade) leaves all children
orphaned but still list-accessible — no new DEF added (covered by DEF-0003 scope).

Four new defects logged:
  DEF-0027 HIGH: /api/db/list fetchAll() no SQL TOP — unbounded heap load, VIEWER+ accessible.
  DEF-0028 MEDIUM: grounding() fetchAll() no SQL TOP — all groundingChunks into heap, ANALYST+.
  DEF-0029 MEDIUM: deleteProduct cascade omits ldTables/rtTables — orphaned global entities.
  DEF-0030 MEDIUM: user field names interpolated into Cosmos SQL — injection vector, VIEWER+.
-->

---

### DEF-0031
- status: OPEN
- severity: LOW
- probe: SECRETS
- surface: snowchat/scripts/es-setup-passwords-output.txt
- title: Internal server IP (10.192.37.11) and hostname (LLMCOEAZHIJMP01) committed to git in Elasticsearch setup output file
- evidence: `git ls-files snowchat/scripts/es-setup-passwords-output.txt` — file is tracked. `cat snowchat/scripts/es-setup-passwords-output.txt` — line 10 contains: `[10.192.37.11]; the server provided a certificate with subject name [CN=LLMCOEAZHIJMP01]` — a real internal RFC 1918 IP address and internal server hostname. TLS certificate fingerprints also present (`bc7fec352f6f26220981ac1e043375eb3ca34aab`, `2d73f1c7e022f468c03772d18e9ee48d6c5c355e`). No passwords were captured (the ES password setup script failed with an SSL error before writing any credentials). The file is a developer artifact from running `elasticsearch-setup-passwords auto` against a real internal server; it should have been gitignored.
- repro: `git log -- snowchat/scripts/es-setup-passwords-output.txt` — file has been in git since initial commit; any git clone exposes the internal IP, hostname, and TLS fingerprints. `grep '10\.192\.' snowchat/scripts/es-setup-passwords-output.txt` confirms the private IP.
- fix:
- verified-by:
- commit:

---

### DEF-0032
- status: FALSE-POSITIVE
- severity: N/A
- probe: SECRETS
- surface: app/dist/assets/ProductRules-CHPnsz19.js
- title: FP — `pa-[a-zA-Z0-9]` pattern in ProductRules bundle matches Personal Auto HTML element IDs, not Voyage AI API keys
- evidence: `grep -rl "pa-[a-zA-Z0-9]" app/dist/assets/ProductRules-CHPnsz19.js` returns a match, but `grep -o ".\{20\}pa-[a-zA-Z0-9].\{20\}" app/dist/assets/ProductRules-CHPnsz19.js` shows all occurrences are checkbox element IDs: `id:\`pa-medPay\``, `id:\`pa-um\``, `id:\`pa-collision\``, `id:\`pa-comp\`` — Personal Auto (PA) coverage option identifiers, not Voyage AI key material. No actual `pa-xxxxxxxx` API key format (20+ alphanumeric chars after the prefix) is present.
- repro: N/A — not a real defect.

---

<!-- SECRETS probe summary 2026-07-11:
Secrets hygiene confirmed largely clean.

Files checked for gitignore/tracking:
  tmp_acn_secrets.md — NOT on disk; gitignored by root .gitignore:19 (tmp_acn_secrets.md literal + tmp*.md). CLEAN.
  functions/.env.local — EXISTS on disk; correctly gitignored by root .gitignore:16 (*.local pattern);
    NEVER tracked in git (`git ls-files --error-unmatch` fails; `git log -- functions/.env.local` empty). CLEAN.
  app/.env.development.local — EXISTS on disk; correctly gitignored by app/.gitignore:13 (*.local).
    NEVER tracked. CLEAN.

Git history for committed secrets:
  app/.env.emulator (deleted in 02df7348) — contained only `VITE_USE_EMULATORS=true`, no secrets. CLEAN.
  functions/.env.local — never committed. CLEAN.
  No API keys (sk-ant-*, AKIA*, AIza*, -----BEGIN PRIVATE) in any tracked file via `git grep`.

Client bundle audit (app/dist/assets/):
  Grep for COSMOS_KEY|COSMOS_ENDPOINT|AZURE_FOUNDRY*|AZURE_STORAGE_CONNECTION|AUTH_JWT_SECRET|ANTHROPIC_API_KEY|sk-ant-*
    → zero matches across all *.js chunks. CLEAN.
  Vite env object (only instance in HomeCheck-D5wh9_8l.js):
    `{BASE_URL:'/',DEV:false,MODE:'production',PROD:true,SSR:false}` — no VITE_-prefixed keys present.
    VITE_API_BASE resolves to `undefined → ''` (same-origin default). CLEAN.
  VITE_MAINTAINER_EMAIL, VITE_SEARCH_LLM, VITE_ALLOW_GUEST — absent from all bundle chunks (replaced
    with empty string by Vite; tree-shaken). CLEAN.
  No real email addresses or Azure endpoint URLs in any bundle chunk. CLEAN.
  pa- pattern in ProductRules chunk = Personal Auto element IDs (DEF-0032 FALSE-POSITIVE).

Real defects:
  Note added to DEF-0001: Admin bundle chunk discloses bootstrap account names (admin, sal.scrudato)
    to unauthenticated bundle downloaders via hardcoded UI string in app/src/routes/Admin.tsx:177.
  DEF-0031 LOW: internal IP 10.192.37.11 + hostname LLMCOEAZHIJMP01 committed in snowchat ES output file.
-->
