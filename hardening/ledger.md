SUMMARY: OPEN: 6 | CRITICAL: 1 | HIGH: 3 | MEDIUM: 2 | LOW: 0 | WONTFIX: 0 | FALSE-POSITIVE: 1

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
