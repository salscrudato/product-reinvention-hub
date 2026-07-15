# P4 — history + integrity: summary + HOSTILE SELF-REVIEW

**Branch:** `p4-history` (worktree, forked at `d4434c3` = current `main`). **9 commits**, every
diff fresh-context Haiku hostile-judged (one writer). **PUSH/DEPLOY held pending operator go.**

| # | Commit | What |
|---|---|---|
| 0 | `6a9209a` | allowlist + provenance CONTRACTS stub + fork note |
| H1 | `8b9c70a` | pure `assembleEnvelope` — proves both write paths emit a hash-chained version doc |
| H4 | `0db95c0` | provenance sealed in the audit hash **without forking** (conditional) + bundle + types |
| H2 | `4b2a3dd` | dormant restore finished server-side (HI-01..04): reconstruct + `/api/db/restore` + client |
| H3 | `9f7fd9a` | XLSX history export + `safeCellValue` formula-injection guard (all exports) |
| H6a | `f74647f` | cross-tenant read+write fail-closed proof + wired into the CI deploy gate |
| H6b | `b4a55b8` | HITL — AI/voice governed write needs a resolvable citation (envelope 422) |
| H6c | `08e3c82` | cost-guard trips/degrades + admin diagnostics read + structured logging + a11y |
| H5 | `cc99233` | fleet audit — confirm + PIN the certified fleet (no import-path swap) + CI-wired lock |

**Gate:** typecheck ✅ (all workspaces) · lint ✅ (exit 0) · `pnpm --filter @pf/shared test` ✅
(50 files: chain-provenance, fleet.lock, $1,528/$1,002/$2,635 canaries — this is the CI canary
step) · `pnpm test:gates` ✅ (isolation·HITL·cost-guard — now a deploy-blocking pipeline step) ·
`pnpm --filter app build` + bundle budget ✅ (initial 146.3/175, exceljs stays a lazy chunk).
Full local `vitest run` has ONE failure — `tests/server/metering.test.ts` (F5 lane),
`per-tenant … isolated from other tenants` — a **pre-existing** cross-file fragility surfaced by
the full-suite fork pool on Node 24 (`isolate=true`). Ruled out as a P4 regression four ways:
(a) it passes in isolation (6/6) and every 2-file combo (cost-guard+metering 11/11,
versions-read+metering 10/10); (b) it fails in the full run **with OR without** the 5 new P4 test
files (excluded → still 1-fail/1299-pass), so P4's test files aren't the cause; (c) `metering.js`
and the accumulator paths it exercises are **untouched by P4**; (d) it already failed in the
`tests/server` subset during H6a. It is **NOT in the CI deploy gate** (CI runs `@pf/shared` +
`pnpm test:gates`, never metering). **CONFIRMED pre-existing:** a clean checkout at the fork
point `d4434c3` (zero P4 changes) reproduces the identical failure (`metering.test.ts:26`) —
1 failed / 123 passed on `vitest run tests/server`.

---

## HOSTILE SELF-REVIEW

### 1. Do imported entities carry version zero, and does History show them? Prove both paths.
**Yes — both write paths emit a hash-chained version doc, and the read path surfaces it.**
`mutate` and `mutateBatch` (the import bulk path) both call the same `envelope()` →
`assembleEnvelope()` (extracted in H1). `tests/server/versions-write.test.ts` drives
`assembleEnvelope` directly: a fresh create (current=null, as an imported entity is) emits a
`kind:'version'` doc at **rev 1** — the genesis/"version zero" — with `op:'create'`, actor,
diff, and the effective date `at`; an update advances the rev + records the before/after diff;
and a source-audit asserts `router.post('/mutate' … envelope(tid, payload)` AND
`router.post('/mutateBatch' … envelope(tid, p)` both route through it. Honest caveat: rev counts
from **1** (rev 0 is the pre-creation null state), so "version zero" is the *genesis* version
entry, not a literal rev-0 doc. **Read path:** the dedicated `GET /api/db/versions` (kind=version;
`/db/list` can never return versions — its WHERE is kind=entity), locked by
`versions-write.test.ts` + the pre-existing `versions-read.test.ts`; the client subscribes it
(`ProductContext.tsx:104`) → HistoryDrawer renders imported + interactive entries identically.

### 2. After a restore, does `/api/db/audit/verify` stay green, and is provenance covered by the hash?
**Yes to both.** `tests/server/restore.test.ts` HI-04 builds a create→update→restore chain via
the real `assembleEnvelope` (the restore is `op:'restore'` with `{authoredBy:'restore',
restoredFrom}` provenance) and asserts `verifyAuditChain([...], heads)` is `ok:true` with the tail
anchor — a restore EXTENDS the chain, never rewrites it. Provenance is genuinely sealed:
tampering the restore's `restoredFrom` flips verify to not-ok. The general proof is in
`shared/src/audit/chain.test.ts` (H4): a provenance-bearing event whose provenance is **stripped
OR altered** → `hash_mismatch` on verify; a mixed legacy+provenanced chain verifies; and — the
no-fork guarantee — an event with **absent** provenance hashes byte-identically to a
pre-provenance event (provenance is conditionally sealed, deliberately NOT in `AUDIT_HASH_FIELDS`).
The server bundle `audit-chain-shared.cjs` was rebuilt in-sync with the TS.

### 3. Show the test proving a cross-tenant WRITE fails closed, and where it runs in CI.
`tests/server/tenant-isolation.test.ts` → *"a smuggled foreign tenantId/pk cannot escape the
caller's partition"*: it calls `assembleEnvelope({ tid:'tenantA', data:{ tenantId:'tenantB',
pk:'tenantB|products' }, … })` and asserts **every** op's `resourceBody.tenantId === 'tenantA'`
and `pk` starts `tenantA|` — the authoritative fields Cosmos partitions on and every query
filters. Plus: the `RESERVED_ENVELOPE_KEYS` strip is audited, no query filters the
client-writable `c.data.tenantId`, and NO route in the whole `server/lib` reads the tenant from
the request body/query. **Where it runs in CI:** `azure-pipelines.yml` gained a
`pnpm test:gates` step (after the server host-deps install, before the artifact assemble/deploy)
— a red gate blocks the deploy. This was necessary because the pipeline's only prior test step
was `pnpm --filter @pf/shared test` (shared/src only), so a `tests/server/*` test was invisible
to CI. Read isolation is also *functional*: `scopeDoc` (the real `readEntity`/`readChainHead`
defense-in-depth) drops a cross-tenant doc → null. Hostile-judged over two rounds.

### 4. If H5 swapped an import-path model, paste the G2 slice result on the new model; if not, say so.
**H5 swapped NO model.** Every routed role serves the import path (opus/sonnet/haiku ladder + the
decorrelated gpt-5.1 judge/validator + gpt-mini prefilter) or is the only provisioned embedding
tier, and the fleet is IMPORT-CERTIFIED `f67fbf0`; no provisioned alternative beats a role on its
labeled eval (`docs/build/FLEET_AUDIT.md`). Because no import-path model changed, the G2
generalization slice was correctly **not re-run** — the certification stands. The exact re-cert
process (`pnpm test` G-locks → `npx tsx scripts/phaseg-holdout.mts --check --seed GL/IM` → offline
`import:eval`) is documented for any future swap, and `shared/src/ai/fleet.lock.test.ts` (in the
`@pf/shared` CI step → deploy-blocking) turns red on any deployment-name drift, forcing it.

### 5. Could any exported history cell execute as a formula?
**No.** Every data cell written by the shared `table()` goes through `safeCellValue`
(`app/src/lib/export/excel.ts`), which prefixes any string leading with `= + - @` or a tab/CR/LF
with an apostrophe so it stays literal — hardening BOTH the new history export AND the existing
portfolio export; numbers pass through unchanged. `historyExcel.test.ts` proves a `=SUM(1+1)` /
`@HYPERLINK(...)` / `=cmd()` cell is apostrophe-prefixed, `cell.formula` is `undefined`, and
`cell.type` is not Formula(6).

### 6. Is there any AI-authored governed change that can commit without a resolvable citation?
**No — for any surface that declares AI/voice authorship.** H6b enforces at the envelope
(`server/lib/data.js`): a governed create/update/delete whose `provenance.authoredBy` is
`ai`/`voice` and whose citations are empty OR placeholder (`unknown`/`n/a`/`tbd`/…) is refused
`422 citation_required` — on `/mutate`, `/mutateBatch`, and any `mutateInternal` caller, before
Cosmos. `tests/server/hitl.test.ts` proves it (incl. an AI *delete* without a citation). **Honest
scope:** the gate binds surfaces that *declare* ai/voice authorship; a caller that omits
provenance is treated as a human write (subject to role/tenant/audit) — the import path does
exactly this (it's human-reviewed in `UnifiedImportModal`, sets no provenance → IMPORT-CERTIFIED
unaffected), and human edits/vote/restore carry none. Deep entity-resolution of citations remains
the import stage-5 deterministic resolver's job, which runs before the write.

### 7. Did you touch any P2-owned path? Paste `git log --stat` proof.
**No.** `git diff --name-only d4434c3..HEAD` — 29 files, all within the published P4 allowlist;
grep for every P2/import-brain/functions FOREIGN path (`routes/{Tasks,Home,News,Claims,Products,
TenantAdmin}`, `components/{tasks,home,admin}`, `daily-brief`, `tenant-profile`, `task-summary`,
`refresh-news`, `form-risk-report`, `platform-shared`, `ai/index.js`, `Sidebar`, `import-brain`,
`unified-import`, `functions/`) returns **NONE**. Two in-domain edits to shared invariant files
are noted: `app/src/__invariants__/server-invariants.test.ts` (DEF-0003 source-audit updated in
lockstep with the `scopeDoc` extraction — the tenant-scope semantics are byte-identical) and
`server/lib/admin.js` (additive: one `require` + the global cost-guard diagnostics GET — fleet
observability, which P2 explicitly reserved to P4). No `git add -A`; every commit used a scoped
pathspec; stowaway-check clean (isolated worktree).

---

## Residual / deferred (honest)
- **Live shared-Cosmos verification** deferred to post-go (the unit harness has no live Cosmos):
  a real restore round-trip against `testco`, `/api/db/audit/verify` green after it, and a
  cost-guard fuzz proving `trips` increments via `GET /api/admin/ai/cost-guard`.
- **`claude-sonnet-5` unprovisioned in Foundry dev** — a provisioning (ops) gap, not routing; the
  import ladder + filing verifier degrade past the missing rung to opus, provenance-recorded.
- **`metering.test.ts`** many-worker Node-24 flake (F5 lane) — see the gate note above.
