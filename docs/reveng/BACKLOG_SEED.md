# BACKLOG_SEED — build-ready, prioritized (`d28c8a1`)

> `docs/reveng/` dossier. Companion to [RISK_REGISTER.md](RISK_REGISTER.md) (R-numbers
> reference it). Three sections: (1) the ranked build list, (2) the v6-pack
> landed-vs-parked determination FROM THE TREE, (3) the diagnostic's LOCK CANDIDATES —
> defenses that exist in code but deserve pinning tests.

## 1. Ranked build list

**Item 1 — canonicalize docId minting (R1). THE ranked-first fix (the diagnostic's W2.5,
never run).**
Build: one `refIdToDocId()` in `shared/src` = the case-preserving `dashId` semantics;
delete the lowercasing in `stage7-plan.js:40-43` and `unified-import.js:374`;
belt-and-braces extend `data.js:243` candidates with `raw.toLowerCase().replace(/\./g,'-')`
so historical lowercase docs still resolve.
Verify: 2-row CSV fixture (`CORE.COV.001` / `CORE.COV.001.001`) end-to-end through the
brain with `isoPlan` forced null — assert the child persists and parentId resolves; unit
asserting `dashId(x) === refIdToDocId(x)` byte-equal over the seed corpus; all four
premium canaries exact. Effort S-M. Owner BRAIN.

**Item 2 — helmet + CSP + HSTS + frame-ancestors (R3).** One middleware in `server.js`;
CSP `default-src 'self'`; verify portal HTML still renders. Effort S. Owner SEC.

**Item 3 — remove (or argon2id-hash) the stored password field (R2).** Delete preferred —
OTP is the real login; touch `auth.js:444-462` + admin/tenant-admin upserts. Effort S.
Owner SEC.

**Item 4 — promote GL ldTableRef resolution to a gated metric and close the 0.8 gap
(R13, E1).** Extend `matchRuleReferenceToTables` to cover the three failing forms
(GL.RU.024/025/089 -> LDTable.122/123/058, `import_eval_results.json:89`); flip the
metric from report-only. Effort S-M. Owner BRAIN.

**Item 5 — zip-bomb ceiling on the import parse (R5).** Pre-inspect the OOXML central
directory for total uncompressed size + cell count; reject > N with an honest 413-class
notice. One function in `workbook.js`. Effort S. Owner BRAIN.

**Item 6 — bridge-parity CI check (R19, E6).** Pipeline step: rebuild every
`*-shared.cjs` from `shared/src` and fail on diff vs committed. Kills the stale-bridge
incident class. Effort S. Owner PLAT.

**Item 7 — Cosmos-TTL backing for revocation + OTP + buckets + spend window (R4, R10).**
Start with revocation (the one that must not fail open). Effort M. Owner PLAT.

**Item 8 — extraction cache keyed by (contentHash + prompt version + model) (R17, E3).**
The invalidation key already exists on chunks; add the store, hit it in stage 4 and the
eval harness. Directly attacks the $110/run economics. Effort M. Owner BRAIN.

**Item 9 — page-range windowing for dense manuals (R16, E2).** Overlapping page windows,
concurrent reads, reconcile; unlocks >180k-char manuals. Effort M. Owner BRAIN.

**Item 10 — checkpoint/resume per stage keyed by runId (R15, E4).** Blob-persist stage
outputs; resume at last completed stage after a recycle; makes item 9's windows
independently retryable. Effort M-L. Owner BRAIN.

**Item 11 — referential-integrity pass at the mutate seam (R11).** Run the import-side
reconciler's dangling-ref logic on hand edits; surface (don't block) breaks. Effort M.
Owner DATA.

**Item 12 — converge chunk/searchIndex schemes (R9, F5).** One migration script onto
`buildChunkOp`; retire the seed variant. Effort M. Owner DATA.

**Item 13 — version retention/compaction + snapshot policy (R8, F6).** Coordinate with
origin/main's P4 history wave FIRST (R25) — it may have landed parts of this. Effort M.
Owner DATA.

**Item 14 — content-signature sheet routing in the DETERMINISTIC mapper (diagnostic D2).**
Port the brain's stage-1 content signal so SECURA-style "ISO TABLES" sheets stop dying in
path-1; fixture = renamed-tabs Property master, assert rtTables>0 and ldTables>0.
Effort M. Owner BRAIN.

**Item 15 — schema-learning pre-pass: Definitions + Data Validation sheets (diagnostic
D3).** Parse per-workbook id grammar + enum domains into an AliasOverlay before mapping;
fixture = SECURA IM `Data Validation!E5:E9` -> coverageEffect domain. Effort M. Owner BRAIN.

**Item 16 — qualify bare rating-step ids with their group prefix (diagnostic D4).**
`1.01` under `GL.RAT.1.00` -> `GL.RAT.1.01`, keep `sourceStepId`; extend
`isoImport.test.ts:287-294`. Effort S. Owner BRAIN.

**Item 17 — smaller items:** import-exempt `proposeMapping` (R21) · OLE2 `.xls` "convert
to .xlsx" notice (diagnostic D5 — routing already safe) · wide-matrix horizontal
continuation (R20) · stream admin exports to Blob (R22) · presence TTL (R27) · fix
`Explorer.tsx:114` copy + retire ADR-0004 flag docs (R23) · pipeline step running
`app/src/__invariants__` (TEST_MAP gap 4) · NODE_ENV=production bootstrap refusal +
rotate/clean `REACT_APP_*` (R6/R7).

## 2. v6 build-pack: landed vs parked — determined from trees, not the pack

Master ledger: `docs/build/ledger.json` (this tree carries the P1-baseline statuses;
`origin/main` and the unpushed `p2/experience` worktree carry later state — R25).

| Pack lane | Ledger items | State, with evidence |
|---|---|---|
| **DC export (Author XML)** | XE-01..06, XE-08 | **LANDED on origin/main, NOT in this tree** — commits `08507b9`(X1) `b9be5fe`(X2) `e188cb8`(X3) `7797f7b`(X4) `99967da`(X5) under P3 close-out `6ed7af9`, pushed at `eab0c6d`; XE-07 (resx) P5 OPEN; XE-09/XE-10 recorded BACKLOG at P3 close. In THIS tree all XE rows are SPEC_READY only. |
| **AI experience lane / polish pass** | EX-01, EX-02 (+E-series) | **BUILT, UNPUSHED** — `p2/experience` worktree branch (close-out `6d7c5a8`), gate-green, push held by operator (orchestration.md P2 row). Not on origin/main, not in this tree. EX-03 (export-readiness pill) rode P3. |
| **Exec brief (daily brief)** | BR-01, BR-02 | **BUILT, UNPUSHED** — same P2 worktree (`daily-brief.js`, DailyBriefCard, frozen `POST /api/ai/dailyBrief` contract). |
| **Reg Radar (tenant-carrier news scout)** | BR-03, BR-04 | **BUILT, UNPUSHED** — same P2 worktree (tenantProfile entity + `buildScope(tid)` profile-first news scout). |
| **History / restore** | HI-01..04 (+HI-05..08 added later) | **LANDED on origin/main, NOT in this tree** — P4 wave (`4b2a3dd` restore, `9f7f9da`-era XLSX export + injection guard, `0db95c0` provenance-in-hash, close-out `aa3eb5d` "HI-01..08 DONE"). In this tree restore is still dormant (DATA_MODEL_DELTA D1). |
| **Capstone / release** | RE-01..04, XE-06 two-way proof | RE-01/02/04 **DONE** (in-tree ledger), RE-03 RESOLVED_PRIOR; the two-way import<->export proof (XE-05/06) landed with P3 on origin/main. |
| **Voice** | VOICE-01 | **PARKED** by operator decision (ledger, `gpt-realtime-2.1` deployment idle — FLEET.md sec 3). |
| **Concept linker** (this branch's own lane) | — | **BUILT IN THIS TREE, UNPUSHED** — 12 commits + cleanse on `feat/import-concept-linker`; not on origin/main. |

Merge implication (R25): whoever pushes next must reconcile THREE lineages (this tree,
origin/main's P3+P4, the P2 worktree) — orchestration.md and `docs/build/ledger.json`
will conflict textually; nothing else is expected to overlap materially (P3/P4 touched
export + history paths this branch didn't).

## 3. LOCK CANDIDATES — diagnostic refutations that deserve pinning tests

The diagnostic proved these five suspected bugs are ALREADY DEFENDED in code (all
re-confirmed at HEAD — INGESTION_PIPELINE.md sec 11). Each defense should get a
regression lock so a refactor can't silently un-fix it:

| Lock | Defense to pin | Suggested test |
|---|---|---|
| L1 | `splitList` multi-value semantics (`isoImport.ts:166-168`): splits on `\n ; ,`, preserves form-number internal spaces, drops placeholders | table-driven unit: `"GL.COV.002\nGL.COV.003"`, `"CG 21 70\nCG 21 87"`, `"AC 900; AC 00 01"`, bare-space list documented as NOT split |
| L2 | header discovery window (`findHeaderRow:325`: first 20 rows, >=3 alias hits) | fixture with headers on row 5 (passes) and row 21 (documented skip -> notice) |
| L3 | sentinel filter (`PLACEHOLDER:146` + `stage7-plan.js:267` `PLACEHOLDER_RE`) | unit over `<Placeholder>`, `<Intentionally Left Blank>`, `N/A`, `TBD`, `xxx`, `...` at both layers |
| L4 | used-range bounding (`readWorkbook.ts:36-43`, `workbook.js:107-114`) | synthetic sheet reporting 1,048,576 rows with 1,609 real -> parse under a time/cell budget |
| L5 | stacked-table segmentation (`parseLdTables:1308`, `parseRtTables:1379`, `detectReferenceTables:1587`) | fixture with two stacked RT tables + an LD table on one sheet -> exact table count + row attribution |
| L6 | multi-refId cells kept whole until deterministic expansion (`stage4` prompt contract + `constants.js:42-44 splitMultiRefId`) | unit: one cell, three refIds -> three entities, byte-identical ids |
| L7 | CSV path carries no isoGrids (the R1 trigger condition) | assertion test documenting the gate `unified-import.js:154` — flips red the day someone wires CSV into the oracle (then R1's masking is total and the lowercase minters become dead code to delete) |

## 4. Sequencing note

Do item 1 (docId) BEFORE any real-vendor CSV/text corpus work; do items 2-3 in the same
security wave as the R6 rotation; coordinate items 12-13 with the origin/main merge
(R25) so the P4 history wave isn't duplicated; items 14-16 are the natural "concept
linker wave 2" and reuse this branch's fixtures.
