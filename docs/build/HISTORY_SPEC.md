# HISTORY_SPEC — finish the version/history model (P1 → P4)

**Status:** SPEC_READY (P1, 2026-07-15). State at HEAD `1c47f25`: write side atomic and
correct (F19 disproven — envelope writes `kind:'version'` docs in the transactional batch,
`server/lib/data.js`); read side shipped by PCM-B (GET `/api/db/versions` at
`server/lib/data.js:427`, client bridge `app/src/lib/backend/versionRead.ts`, ProductContext
subscription at `ProductContext.tsx:104`). **Dormant:** HistoryDrawer's restore UI
(`app/src/components/product/HistoryDrawer.tsx:140-166`) is gated on `v.snapshot != null`
(HistoryDrawer.tsx:237) while `versionRead.ts:43` always maps `snapshot: null` — restore can
never activate today, by design ("restore hidden, never invented"). **Missing:** history
XLSX export (verified absent — the only exporter is `app/src/lib/export/excel.ts`, portfolio
shapes only).

## 1. Version entry (what a row IS — no schema change)

Server doc (existing): `kind:'version'`, id `ver:<path>:<rev>`, partition `${tenantId}|<base>`,
fields `{ path, rev, op, actor, at, before, changed }` where `before/changed` is the field
diff pair the envelope records. Client `VersionEntry` (versionRead.ts): `{ id, productId,
entityType, entityPath, rev, action, actor, at, diffs: VersionDiff[], snapshot: null }`.
This spec adds NO new stored fields — restore reconstructs (§2). `versionAction` continues to
trust the recorded `op` (create/update/delete/restore).

## 2. Restore path (the finish)

**Server:** `POST /api/db/restore` body `{ path, targetRev, expectedRev }`, EDITOR+ (write
role guard as every mutate), tenant from JWT.

1. Load current doc; if `current.rev !== expectedRev` → **409** `{ error: 'stale_rev',
   currentRev }` — the client refetches history and re-asks (same optimistic-concurrency
   contract as the existing envelope's etag guard).
2. Reconstruct the entity state at `targetRev` by reverse-applying `before/changed` diffs
   from current back to target (versions are partition-local and TOP-capped 2000 — same read
   the versions endpoint uses; reconstruction failure (gap in the chain) → **422**
   `{ error: 'unreconstructable', firstMissingRev }` — never a best-guess restore).
3. Persist via the STANDARD envelope (`op: 'restore'`, payload = reconstructed state).
   Restore is a forward mutation: new rev, new version doc, hash-chained audit event in the
   same transactional batch — history is never rewritten. `meta.restoredFrom = targetRev`
   rides in the audit event detail.

**Client:** `versionRead.ts` maps `canRestore: rev > 0` (replacing the dead snapshot gate at
HistoryDrawer.tsx:237); `doRestore` calls the endpoint, on 409 surfaces the existing
conflict toast + refreshes, on 422 explains honestly. The dormant UI at
HistoryDrawer.tsx:140-166 comes alive with its existing confirm flow.

## 3. Audit-chain tie-in

Nothing new to build — the envelope already writes the chained audit op. The spec binds:
restore MUST go through the envelope (no bare write; the no-bare-writes census
`app/src/__invariants__/no-bare-writes.test.ts` will catch violations), and
`/api/db/audit/verify` (`server/lib/data.js:472`) must stay green across a restore
(fixture: restore then verify).

## 4. History XLSX export

Client-side, reusing `app/src/lib/export/excel.ts` plumbing (ExcelJS). One sheet `History`:

| Col | Content |
|---|---|
| A `Rev` / B `When` / C `Actor` / D `Action` | version envelope fields |
| E `Entity type` / F `Entity path` | from entityPath |
| G `Field` / H `Before` / I `After` | **one row per diff** (a rev spanning 4 fields = 4 rows, A-F repeated) |

Filename `<productId>-history-<yyyy-mm-dd>.xlsx`. Scope = the drawer's current filter
(product, entity-type, search) so what you see is what you export. Empty history exports a
header-only sheet with a note row — never a zero-byte file.

## 5. Tests P4 owes

Server: restore 200 happy path (new rev + version doc + audit op in one batch), 409 stale,
422 gap, VIEWER 403; audit verify green post-restore. Client: canRestore gating, 409 flow,
XLSX row-per-diff shape (fixture workbook), filter-scoped export.
