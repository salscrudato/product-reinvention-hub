TOTAL WAVES: 13 | T0:3 T1:4 T2:3 T3:3 | est human sessions with tier-chaining: ~8

<!--
Hardening wave batch plan (PLANNER output — no product code changed here).
Covers every OPEN ledger DEF exactly once (34 OPEN after LEDGER SURGERY 2026-07-11:
DEF-0001→0041/0042, DEF-0006→0038/0039/0040; parents set status:SPLIT/uncounted).

FILE-CONTENTION MAP (why the ordering exists)
  server/lib/data.js  (hot-spot) → WAVE-01 (envelope +groundingChunks op), WAVE-03 (envelope
      correctness), WAVE-04 (write routes), WAVE-05 (list reads). These four SHARE data.js and
      run as a strict sequential chain 01→03→04→05 (never parallel, never chained).
  server/lib/ai.js    (hot-spot) → WAVE-01 (grounding/chat/summary/log), WAVE-02 (unifiedImport
      port). WAVE-02 depends-on WAVE-01.
  server/lib/serff.js → WAVE-06 only (disjoint, parallel-safe).
  server/lib/auth.js  → WAVE-07 only.   app/src/routes/Admin.tsx → WAVE-08 only.
  CLAUDE.md/Feedback.tsx → WAVE-09 only. shared/src/rating/* → WAVE-12 only (T3 solo).
  All other waves touch a single disjoint file set → parallel-safe.

The two smoke blockers (hardening/smoke.mjs) are WAVE-01 (chat must return a bracketed citation
that resolves to a REAL entity — lines 353-368, 495-522) and WAVE-02 (501 on /api/ai/unifiedImport
is an explicit SMOKE FAIL — lines 260-268). Phase 4 golden-path smoke stays red until both land.

HARD INVARIANTS every fix-approach must hold: adapter seam; atomic mutate() (entity + AuditEvent +
Version field-diff + searchIndex + rev, reject on rev mismatch); server roles with VIEWER
inquiry-only; grounded server-side AI citing [refId] + form numbers, never fabricating; no client
secret; both canaries byte-exact (HO-3 $1,528, GL $2,635).
-->

## WAVE-01  tier:T3  chains:NO  blocks-smoke:YES  status:DONE
- members: DEF-0018, DEF-0019, DEF-0020, DEF-0028, DEF-0033, DEF-0034, DEF-0012, DEF-0035
- root-cause: The Azure AI server path (server/lib/ai.js) was ported without its grounding-write, citation-validation and write-envelope guarantees — the seed corpus is written with no top-level tenantId / non-tenant-prefixed pk (invisible to tenant-scoped grounding()), mutate() writes zero groundingChunks (imported/edited products never grounded), so grounding() returns [] for EVERY query and chat() streams unvalidated/fabricated [refId] chips; summarizeProduct grounds only coverage names; persistSummary bypasses the envelope with rev=1; grounding read is unbounded and the startup log leaks the Foundry endpoint.
- fix-approach: (1) migrate-to-cosmos.ts — write every doc with a top-level `tenantId` and a tenant-prefixed pk matching data.js pkFor, so the PH/PA/GL corpus (incl. groundingChunks) is visible to tenant-scoped reads (DEF-0033). (2) Add a mutate-time grounding hook: envelope() emits a 5th op `kind:'entity', coll:'groundingChunks'` built per entityType via a new server chunker bridge (esbuild `build:chunk` bundling shared/src/retrieval/chunk.ts → server/lib/chunk-shared.cjs) so every write stays grounded ATOMICALLY in the same batch — no client reindex call, no staleness (DEF-0034). (3) chunk.ts — wrap `[refId]` in brackets for chunkRule/chunkFormRule/chunkLdTable/chunkRtTable so all citable types carry the anchor the system prompt requires (DEF-0019); update chunk.test.ts fixtures (contentHash shifts). (4) ai.js chat() — after the stream, extract the model's cited [refId]s, diff against the bracketed refIds present in the grounding CONTEXT, and emit `{t:'notice', kind:'unverified', refs:[...]}` for any not-in-context ref (client already wired via app/src/lib/ai/notices.ts + Home.tsx); optionally style unverified chips in Markdown.tsx; never fabricate (DEF-0018). (5) ai.js grounding() — add `TOP @cap` to the SQL so the read never loads an unbounded set into heap (DEF-0028). (6) ai.js groundSummary() — validate headline/overview/highlights.value/considerations against the product metadata, not only coverageHighlights (DEF-0020). (7) ai.js persistSummary() — route through the atomic envelope (entity+audit+version+searchIndex, real incrementing rev) instead of the bare rev=1 upsert (DEF-0012). (8) ai.js:23 — drop AZURE_FOUNDRY_ENDPOINT url + AZURE_FOUNDRY_DEPLOYMENT from the startup console.log (DEF-0035).
- files: scripts/migrate-to-cosmos.ts, server/lib/ai.js, server/lib/data.js, shared/src/retrieval/chunk.ts, shared/src/retrieval/chunk.test.ts, server/lib/chunk-shared.cjs (generated — never hand-edited), package.json (build:chunk + build chain), app/src/components/chat/Markdown.tsx, app/src/lib/ai/notices.ts
- depends-on: none
- verify: harden-probe DEF-0018,0019,0020,0028,0033,0034,0012,0035; pnpm build (regenerates chunk-shared.cjs); /gate; harden-smoke (LOCAL) — the HO + GL chat "bracketed citation resolves to a real entity" assertions must pass; canary check: pnpm --filter shared test (chunk.ts change must NOT perturb HO-3 $1,528 / GL $2,635).

## WAVE-02  tier:T3  chains:NO  blocks-smoke:YES  status:DONE
- members: DEF-0040
- root-cause: POST /api/ai/unifiedImport hits the ai.js wildcard and returns 501 ai_handler_not_ported; the PDF/multi-format filing importer (ADR-0005) is non-functional on Azure and the smoke harness fails on this exact 501.
- fix-approach: Port the unifiedImport (filing-extraction) handler from the functions/ reference into server/lib/ai.js on the Anthropic-native fleet surface — gated by fleet.guard()/resolveModel, grounded, returning the ImportPlan/extraction shape the existing client (UnifiedImportModal → importProduct.ts → adapter.db.mutate) expects. No client secret; extraction is cited, never fabricated. Do NOT delete UnifiedImportModal — this port makes it live (supersedes the DEF-0038 dead-code note). Imported products auto-appear in grounding via WAVE-01's mutate-time chunk hook.
- files: server/lib/ai.js, functions/src/ (read-only reference — not a write target)
- depends-on: WAVE-01
- verify: harden-probe DEF-0040; /gate; harden-smoke (LOCAL) — the full HO Lemonade filing-import → mutate → chat-citation golden path; the 501 assertion flips to pass.

## WAVE-03  tier:T2  chains:NO  blocks-smoke:NO  status:DONE
- members: DEF-0003, DEF-0015, DEF-0016, DEF-0013
- root-cause: The data.js write path has four correctness gaps — envelope() never validates parentId (dangling/cross-product refs persist), version records store the full new snapshot instead of a field diff, expectedRev is bypassed when the target is absent (CAS voided on re-create after delete), and mutateBatch silently splits an over-BATCH_OPS within-partition op set into multiple non-atomic Cosmos batch calls (partial commit on failure).
- fix-approach: (1) DEF-0016 — drop the `&& current` short-circuit at data.js:67 so expectedRev is enforced even when the entity is absent (create with a non-zero expectedRev against an absent path → 409). (2) DEF-0015 — the version op stores a computed field diff (before/changed) from current.data vs new data, satisfying the "Version = field diff" invariant. (3) DEF-0003 — envelope validates any parentId in `data` resolves to an existing same-tenant (and, for coverages, same-product) entity; reject 4xx otherwise (server-side only; no types.ts change needed). (4) DEF-0013 — guard mutateBatch so a within-partition op set exceeding BATCH_OPS is rejected up-front, or the failure response identifies committed vs uncommitted payloads — never silently commit chunk N while chunk N+1 fails.
- files: server/lib/data.js
- depends-on: WAVE-01
- verify: harden-probe DEF-0003,0015,0016,0013; verify-invariant (mutation envelope); /gate; harden-smoke — GL expectedRev increment + stale-409 + audit-trail (rev/updatedAt) assertions must still pass (existing-entity expectedRev path unchanged; smoke reads entity data, not version diffs).

## WAVE-04  tier:T2  chains:NO  blocks-smoke:NO  status:DONE
- members: DEF-0008, DEF-0009, DEF-0010
- root-cause: Three POST routes are guarded by requireAuth instead of requireRole('EDITOR'), letting VIEWER write; two (/vote, /setNewsPins) also bypass the atomic envelope with bare Cosmos .replace()/.upsert() (no audit/version/searchIndex).
- fix-approach: Change /vote, /setNewsPins and /presence/join guards to requireRole('EDITOR'). Route /vote and /setNewsPins writes through the atomic envelope (mutate) so audit+version+searchIndex are emitted instead of a bare Cosmos write. /presence/join stays a presence-container heartbeat but at EDITOR+ (VIEWER keeps read-only /presence/watch — invariant purity over VIEWER presence-write). Update the app/src/lib/backend/types.ts:74-76 doc comment that currently claims "any authenticated role may vote."
- files: server/lib/data.js, app/src/lib/backend/types.ts
- depends-on: WAVE-03
- verify: harden-probe DEF-0008,0009,0010; verify-invariant (role matrix: VIEWER inquiry-only, writes EDITOR+); /gate; harden-smoke — VIEWER-write-rejected + unauth-mutate-401 assertions.

## WAVE-05  tier:T1  chains:NO  blocks-smoke:NO  status:DONE
- members: DEF-0027, DEF-0030, DEF-0005
- root-cause: Server collection reads are unsafe — /api/db/list and both /api/admin list endpoints call fetchAll() with no SQL TOP (whole matching set loaded into heap before slice), and /api/db/list interpolates client-supplied where[].field / orderBy[].field names straight into the Cosmos SQL string with no allow-list (structure-injection + raw-error leak).
- fix-approach: (1) Add `SELECT TOP @limit` to data.js /list and a bounded TOP + maxItemCount to admin.js /tenants and /users, so no read loads an unbounded result set into heap (DEF-0027, DEF-0005). (2) Validate where[].field / orderBy[].field against a property-name allow-list / strict `^[A-Za-z0-9_.]+$` before interpolation; reject malformed field names with 400 rather than passing them into SQL (DEF-0030). Tenant scoping (c.tenantId=@tid, parameterised) is unchanged.
- files: server/lib/data.js, server/lib/admin.js
- depends-on: WAVE-04
- verify: harden-probe DEF-0027,0030,0005; /gate; harden-smoke — list-backed reads still return; a crafted field name is rejected 400.

## WAVE-06  tier:T2  chains:YES  blocks-smoke:NO  status:DONE
- members: DEF-0014, DEF-0021
- root-cause: server/lib/serff.js has two correctness gaps — the bundle-generate audit is a bare fire-and-forget items.create outside any batch (orphan audit, no version/searchIndex), and the LOB prefix `?? 'PH'` fallback never fires on the empty-refId synthetic ratingProgram, so a GL product with no ratingProgram is silently rated with PH kit tables (resolveRatingKit('') → KITS['PH']).
- fix-approach: (1) DEF-0014 — route the SERFF audit through the atomic envelope conventions (pair with its version+searchIndex siblings in one Cosmos batch, or drop the standalone create); no orphan audit. (2) DEF-0021 — loadSnapshot() carries product.lob; derive lobPrefix from the product LOB (not just ratingProgram.refId); treat empty/unknown prefix as a hard 400 unsupported_lob rather than defaulting to PH; optionally harden resolveRatingKit in the shared serff source to throw on unknown prefix instead of returning KITS['PH']. Rate exhibit stays computed by the real evaluate() engine — no canary path touched.
- files: server/lib/serff.js, shared/src/serff/api-server.ts (only if hardening resolveRatingKit), server/lib/serff-shared.cjs (regenerated via `pnpm build:serff` — never hand-edited)
- depends-on: none
- verify: harden-probe DEF-0014,0021; a GL /api/serff/bundle resolves the GL kit (not PH); pnpm build (regenerates serff-shared.cjs if the shared source changed); /gate.

## WAVE-07  tier:T1  chains:YES  blocks-smoke:NO  status:DONE
- members: DEF-0041, DEF-0039
- root-cause: server/lib/auth.js has three security/durability gaps — AUTH_JWT_SECRET silently defaults to a public literal, the trivial-password BOOTSTRAP admins are unconditionally active, and changePassword stores overrides in an in-process Map that resets on restart and never reaches Cosmos.
- fix-approach: (1) DEF-0041 — require AUTH_JWT_SECRET (no insecure default; fail-closed when unset). Gate BOOTSTRAP behind an explicit env opt-in (default OFF in production, ON for LOCAL/smoke) with passwords sourced from env, not hardcoded — PRESERVING a documented local/smoke bootstrap path so hardening/smoke.mjs still authenticates as admin/admin. (2) DEF-0039 — persist changePassword to the Cosmos __system__ user store (upsert kind:'user') so a change survives restart.
- files: server/lib/auth.js
- depends-on: none
- verify: harden-probe DEF-0041,0039; /gate; harden-smoke run with AUTH_JWT_SECRET + bootstrap opt-in set (admin login still works); confirm changePassword survives a `node server/server.js` restart. DEPLOY NOTE (cross-ref DEF-0037 / WAVE-08): App Service must set AUTH_JWT_SECRET + the bootstrap opt-in.

## WAVE-08  tier:T0  chains:YES  blocks-smoke:NO  status:DONE
- members: DEF-0038, DEF-0037, DEF-0042
- root-cause: Documentation + inert artifacts drifted after the Firebase→Azure cutover — the canonical deploy guide lists Firebase-era secrets and omits all six required Azure env vars (mis-naming AZURE_BLOB_CONNECTION as AZURE_STORAGE_CONNECTION_STRING), Firebase/AWS-SWAP remnants linger, stale AI-cache/model UI copy remains, and Admin.tsx discloses bootstrap account names in the public bundle.
- fix-approach: Correct DEPLOY_AZURE.md + hardening/BACKEND.md + migrate-firebase-to-azure.md to the six real Azure vars (COSMOS_ENDPOINT/KEY, AZURE_FOUNDRY_ENDPOINT/KEY, AZURE_BLOB_CONNECTION, AUTH_JWT_SECRET) and the az CLI example (DEF-0037); remove/annotate Firebase-era handoff docs and the completed "relocate AI" follow-up, drop the @firebase/util allowBuild and the AWS-SWAP comment markers, scrub the stale semanticCache/verifier UI copy (DEF-0038); scrub the bootstrap-account-name disclosure string from Admin.tsx:177 (DEF-0042). Docs/comment/config only — no runtime behavior change. functions/ edits are comment-only and don't affect WAVE-02's port reference. Do NOT remove UnifiedImportModal (WAVE-02 makes it live).
- files: docs/DEPLOY_AZURE.md, hardening/BACKEND.md, docs/prompts/migrate-firebase-to-azure.md, docs/handoff/*, pnpm-workspace.yaml, functions/src/*.ts (AWS-SWAP comment markers only), app/.env.development.local, app/src/routes/Admin.tsx
- depends-on: none
- verify: harden-probe DEF-0038,0037,0042; /gate (Admin.tsx still compiles; docs/config-only otherwise).

## WAVE-09  tier:T0  chains:YES  blocks-smoke:NO  status:DONE
- members: DEF-0002
- root-cause: The CLAUDE.md binding-invariant table (and ADR-0001 and Feedback.tsx:141) bind model IDs to claude-sonnet-5 "defined once in functions/src/runtime.ts" — the reference-only, non-deployed workspace — while the deployed fleet (shared/src/ai/fleet.ts → server/lib/fleet.js) uses claude-opus-4-8 / claude-haiku-4-5; Feedback.tsx even emits the stale table (line 141) four lines above the correct "Set /model to claude-opus-4-8" directive (line 158).
- fix-approach: Re-point the CLAUDE.md invariant, docs/adr/0001-model-ids.md, and Feedback.tsx:141 to the deployed source of truth (shared/src/ai/fleet.ts: claude-opus-4-8 reasoning / claude-haiku-4-5 bulk), resolving the in-file contradiction. Docs/comment only — fleet.ts/fleet.js are already correct; no code-path change; never claude-fable-5.
- files: CLAUDE.md, docs/adr/0001-model-ids.md, app/src/routes/Feedback.tsx
- depends-on: none
- verify: harden-probe DEF-0002; /gate (Feedback.tsx compiles).

## WAVE-10  tier:T1  chains:YES  blocks-smoke:NO  status:DONE
- members: DEF-0022, DEF-0023
- root-cause: GL is a seeded portfolio line but two client surfaces still assume HO+PA only — News.tsx LOB_KEYWORDS/BASE_NEWS_INSTRUCTION has no GL entry (GL articles score zero relevance) and duckcreek.test.ts's matrix covers only PH+PA with an HO/PA-biased lob-token assertion (the GL export path is entirely untested).
- fix-approach: (1) News.tsx — add a GL LOB_KEYWORDS entry (CGL, commercial general liability, occurrence form, CG 00 01, …) and include GL in BASE_NEWS_INSTRUCTION emphasis (DEF-0022). (2) duckcreek.test.ts — add GL_DATA to the describe.each matrix and fix the lob-token derivation so 'General Liability' → 'GL' (not the 'Home'/'PA' fallback), exercising GL XML/validation/round-trip/manuScriptID (DEF-0023).
- files: app/src/routes/News.tsx, app/src/lib/export/duckcreek.test.ts
- depends-on: none
- verify: harden-probe DEF-0022,0023; /gate (the new GL duckcreek case runs green; News compiles).

## WAVE-11  tier:T1  chains:YES  blocks-smoke:NO  status:DONE
- members: DEF-0029
- root-cause: deleteProduct()'s SUBCOLLECTIONS cascade omits the global ldTables/rtTables the filing importer creates, so a product's L&D + rate tables persist as orphans in the global collections after deletion.
- fix-approach: Extend the cascade to remove the product's owned ldTable/rtTable entities (matched by product ownership / refId prefix) through adapter.db.mutate() like the other cascade steps — without touching tables shared by other products.
- files: app/src/lib/product/deleteDraft.ts
- depends-on: none
- verify: harden-probe DEF-0029; /gate; delete a product with tables → its ldTables/rtTables no longer appear in list('ldTables')/list('rtTables').

## WAVE-12  tier:T3  chains:NO  blocks-smoke:NO  status:PENDING
- members: DEF-0004, DEF-0026
- root-cause: Rating money is float dollars throughout the seed + rating tables with no integer-cent encoding and no single rounding discipline (intermediate HO-3 trace s5=1013.36 … s10b=1527.97); and evaluator.creditFloor.test.ts:50 masks non-integer drift on the credit-cap path with toBeCloseTo(800,6) even though a trailing roundTo:0 MIN_FLOOR yields an exact integer.
- fix-approach: (1) DEF-0004 — introduce one rounding-discipline helper applied at every rating step so no intermediate step truncates, and lock the HO-3 intermediate trace byte-exact with a regression assertion. Do NOT restructure stored money into integer cents in this wave — a cents migration would perturb the $1,528/$1,002/$2,635 canaries and needs its own ADR. (2) DEF-0026 — tighten the sole approximate final-premium assertion to `expect(r.finalPremium).toBe(800)`, matching the sibling exact-equality paths. Both canaries stay byte-exact.
- files: shared/src/rating/evaluator.ts, shared/src/rating/rtGrid.ts, shared/src/rating/kits.ts, shared/src/rating/evaluator.creditFloor.test.ts, shared/src/seed/personalHome.ts, shared/src/seed/personalAuto.ts, shared/src/seed/generalLiability.ts, shared/src/types.ts
- depends-on: none
- verify: harden-probe DEF-0004,0026; CANARY: pnpm --filter shared test — HO-3 $1,528 + PA $1,002 + GL $2,635 byte-exact + the $800 creditFloor assertion + the intermediate-trace lock; /gate.

## WAVE-13  tier:T0  chains:YES  blocks-smoke:NO  status:PENDING
- members: DEF-0036, DEF-0031
- root-cause: Two sensitive artifacts are reachable via git — a LIVE AZURE_FOUNDRY_KEY committed in tmp.md (deleted from HEAD but permanent in the DAG; also plaintext in gitignored model_secrets.md) and an internal RFC1918 IP + hostname + TLS fingerprints in a tracked snowchat ES setup-output file. The in-repo portion (gitignore/removal) is fixable now; key rotation + history rewrite are out-of-code human steps.
- fix-approach: In-repo (this wave): `git rm --cached snowchat/scripts/es-setup-passwords-output.txt`; add it + `model_secrets.md` to .gitignore (tmp*.md already covered); confirm `git grep` finds no live secret at HEAD.
- files: .gitignore, snowchat/scripts/es-setup-passwords-output.txt (git rm --cached)
- depends-on: none
- verify: harden-probe DEF-0036,0031; `git grep -i "C0S1LR7\|10\.192\.37\.11"` returns nothing at HEAD; /gate (no code surface).
- BLOCKED-ON-HUMAN (Sal — out-of-code, do NOT skip):
    1. Rotate the Foundry key NOW in Azure AI Foundry — the committed key `C0S1LR7AUnd9…` is compromised — then update AZURE_FOUNDRY_KEY in App Service config.
    2. Purge it from history: `git filter-repo --path tmp.md --path snowchat/scripts/es-setup-passwords-output.txt --invert-paths` (or BFG), force-push, and re-seed all existing clones.
