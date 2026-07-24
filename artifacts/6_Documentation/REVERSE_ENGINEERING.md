> ⚠️ **SUPERSEDED (kept for history).** This diagnostic pass (branch `feat/import-concept-linker`)
> is superseded by `docs/reveng/INGESTION_PIPELINE.md`, verified against the current tree. Use that
> for live import-brain behavior; this file remains for its root-cause narrative only.

# Import Brain — Reverse Engineering, Root Cause, and the Path to an Intelligent Importer

> Read-only diagnostic pass on branch `feat/import-concept-linker`. No source was modified.
> Every behavioral claim cites `file:line`. Where docs and code disagree, the code wins and the
> divergence is flagged. Ground truth for the workbooks is the raw ExcelJS cell bytes, quoted
> verbatim (a cell value is written `Sheet!Addr = "..."`; `\n` means a literal newline inside the cell).

Companion file: [import-flow.html](../5_Build_Packs/import-flow.html) — interactive pipeline diagram (hover a stage for its `file:line`, assumptions, and failure modes; amber = known break point).

---

## Executive summary

The importer is a **two-path, single-endpoint** system. Both paths converge on one deterministic
mapper and one atomic write seam. The reported "IDs do not link" symptom is **not** a tokenizer
bug (the most common guess), and I can prove that from the sample bytes. The single root cause
that is still live in the code is a **`docId` minting inconsistency**: `refId` is stored verbatim
(dots, original case) but the `docId` is the dashed form of the `refId`, and the codebase contains
**three `docId` minters using two different conventions** — one preserves case, two lowercase — while
the parent-pointer validator only ever tries the case-preserving form. On the paths where the
deterministic ISO oracle does not run (CSV/text uploads, and brain-only entities with no ISO
counterpart), children are minted with a lowercase `docId` their parent pointer can never resolve,
so the write is rejected `INVALID_PARENT` and every cross-reference that reconstructs an uppercase
`docId` misses the row.

Everything else the prompt flagged as a suspected cause — offset header rows, multi-value cells,
sentinel tokens, stacked mini-tables, the million-row used-range bomb — is **already handled** in
the current code, and I refute each below with the exact defending line and a real sample cell.

---

## A. Current stack and import-path map

### A.1 Actual stack (verified against code, not docs)

| Concern | Reality (code) | Evidence |
|---|---|---|
| Backend runtime | **Azure App Service, Express** host | `server/server.js` `app.listen` at :349; SPA + `/api/*` |
| Database | **Azure Cosmos** (`@azure/cosmos`), DB `prodhub`, container `docs` | `server/lib/cosmos.js:6,12`; `server/lib/data.js` |
| AI provider | **Azure AI Foundry** over raw `fetch` (no SDK) | `server/lib/fleet.js:20-30` (`AZURE_FOUNDRY_ENDPOINT`/`KEY`), call in `server/lib/ai/_shared.js:51-82` |
| Auth | Custom **HS256 JWT** | `server/lib/auth.js` |
| Source control | **Azure DevOps** remote, default branch `main` | current branch `feat/import-concept-linker` off `main` |
| Active data adapter | `azure.adapter.ts` | `app/src/lib/backend/` |

**Flagged doc divergence.** The repo still contains the word "Firestore/Firebase" in comments and
strings across `app/src`, `server/lib`, `shared/src`, and the `functions/` workspace holds real
Firebase code. **All of it is vestigial**: `functions/` is reference-only and not deployed (no
`server/` or `app/` file imports it; `azure-pipelines.yml` contains no `functions` reference; the
server import-brain stage files carry `// Ported from functions/src/import/brain/...` headers, e.g.
`stage6-reconcile.js:7`). The live platform is Azure + Express + Cosmos + Foundry on `main`. Trust
the CLAUDE.md, not the stray Firebase strings.

### A.2 The two import paths (one front door)

Both paths are triggered from `app/src/import/UnifiedImportModal.tsx` and both **persist on the
client** through `adapter.db.mutate`. The server never writes the product to Cosmos.

**Path 1 — client deterministic mapper (`runImportXlsx`).** Browser reads the workbook and maps it
entirely in-process, no AI:

```
File → readWorkbook.ts (browser ExcelJS)     app/src/lib/import/readWorkbook.ts:30-54
     → mapIsoWorkbook(grids)                  shared/src/insurance/isoImport.ts:1990
     → importPlan(plan)                        app/src/lib/import/importProduct.ts:74
     → adapter.db.mutate / mutateBatch         importProduct.ts:117, 136
```

**Path 2 — server "import brain" (`runImport`).** Upload streamed to the server, processed by the
6-stage adaptive brain plus the same deterministic mapper as a canonical-identity oracle, bundle
streamed back, then persisted by the same client code:

```
unifiedImportClient.stream ── POST /api/ai/unifiedImport (SSE) ──► server/lib/ai/unified-import.js:200
  stage 0  routeArtifacts (magic-byte sniff)            server/lib/import-brain/stage0-router.js:120
  read     workbook.js (server ExcelJS + normalizeCellValue)   server/lib/import-brain/workbook.js
  stages 1-6  runAdaptiveImportBrain (AI)               server/lib/import-brain/index.js:55
  oracle   mapIsoWorkbook(isoGrids) via bridge          unified-import.js:154-159
  stage 7  buildImportPlan (joins brain + isoPlan)      server/lib/import-brain/stage7-plan.js
  emit     {t:'json', key:'bundle'} over SSE            unified-import.js:322
◄── client importPlan(bundle) ──► adapter.db.mutate     app/src/lib/import/importProduct.ts
```

The server bridge `server/lib/import-brain-shared.cjs` is a **generated esbuild bundle** of
`shared/src` (`package.json:16` `build:import-brain`), so the server runs the *same* `mapIsoWorkbook`
and `conceptMatch` code as the browser — not a reimplementation. Rebuild + commit the `.cjs` when
`shared/src` changes.

### A.3 Stage-by-stage map (what each assumes, where it is brittle)

| Stage | File:line | Assumes | Brittle at |
|---|---|---|---|
| Upload / assembly | `unifiedImportClient.ts:60-138` | base64 docs, sheet names sniffed from ZIP central dir | none material |
| 0 Router | `stage0-router.js:120` | container by magic bytes, LOB by cell refIds then AI-prefix vote | `.xls` (OLE2) misroutes to PDF vision; **CSV pushed with no `isoGrids`** (:207) |
| Read | `workbook.js` (`sniffContainer` :26-46, cell normalize :125, true-extent :107-114) | ExcelJS; `normalizeCellValue` on every cell | hidden framework sheet invisible to AI (only the ISO mapper recovers it) |
| 1 Classify | `stage1-classify.js` | sheets have a discernible domain | AI: haiku+gpt-5-mini prefilter → opus+gpt-5.1 → opus adjudicate |
| 2 Header-lock | `stage2-header-lock.js` | header row scoreable deterministically | fast path > 0.80 else opus fallback |
| 3 Column-map | `stage3-column-map.js` | columns map to canonical fields | AI ensemble opus ‖ gpt-5.1; 24-col batches |
| 4 Extract | `stage4-extract.js` | rows are cited entities | ~90% of wall-clock; token-truncation → recursive batch halving |
| 5 Validate | `stage5-validate.js` | citations resolve to cells | deterministic resolver owns BLOCKING; gpt-5.1 WARN-only |
| 6 Reconcile | `stage6-reconcile.js` | pure aggregation | writes nothing |
| 7 Plan | `stage7-plan.js:120` (`buildImportPlan`) | join brain values onto ISO identity | **`toDocId` lowercases** (:41); ISO-join `adoptIdentity` (:165) overwrites `docId` |
| Header scan (mapper) | `isoImport.ts:325-335` (`findHeaderRow`) | header in first 20 rows, >= 3 alias hits | novel header phrasing below 3 hits skips the sheet |
| Column map (mapper) | `isoImport.ts:349-388` (`mapColumns`) | alias list + 0.5 fuzzy word-overlap | a genuinely novel column stays unmapped |
| Hierarchy | `coverageHierarchy.ts:85` (`resolveCoverageHierarchy`) | 3 structural signals + orphan promote | glued ids (SECURA `IM.COV044`) rely on group-name signal |
| Persist | `importProduct.ts:74` (`importPlan`) | parents written before children (wave batching :173-188) | one bad batch is skipped, not fatal (except the product) |
| Atomic write | `data.js:222` (`envelope`) | `parentId` resolves to `[dotted, UPPER-dash]` | **lowercase `docId` never tried** (:243) |

---

## B. Reverse-engineered pipeline (narrative)

An upload enters at `POST /api/ai/unifiedImport` (`unified-import.js:200`), gated on
`product:write`, opened as an SSE stream with a 15s `:hb` heartbeat (Azure kills idle connections
at ~230s), under an `IMPORT_CONTEXT` no-cap budget. **Stage 0** (`routeArtifacts`) sniffs each doc
by magic bytes only — `PK\x03\x04` is a ZIP (xlsm if it carries `vbaProject.bin`), `%PDF-` is a
PDF, mostly-printable is text — never by filename (`workbook.js:26-46`). It also derives the line of
business deterministically from the `refId` tokens it sees in the cells, and only if that is
inconclusive does it ask a cheap model (haiku, escalating to opus below 0.6 confidence) to vote a
**prefix**, which `prefixToLobRefId` resolves against `LOB_REGISTRY` — the model can never mint a
`refId` (`stage0-router.js`).

Workbooks are read by `workbook.js` with ExcelJS, bounding the used range with
`eachRow({includeEmpty:false})` so a sheet that reports 1,048,576 rows because of whole-column
formatting does not freeze the process, and normalizing every cell through `normalizeCellValue`
(this normalization is the fix for the CORE `allStates` regression documented in
`docs/audit/import_eval_iso_join_investigation.md`). The brain then runs **stages 1-6**
(`index.js:55`): classify sheets, lock the header row, map columns to canonical fields, extract
rows into cited entities, validate citations, reconcile. Each ambiguous decision is voted by two
different model families (Claude and GPT) so correlated errors cannot pass consensus, and
disagreements climb `haiku → sonnet → opus` before a `gpt-5.1` judge.

In parallel, `mapIsoWorkbook(isoGrids)` runs deterministically over the same grids and produces an
`isoPlan` that **stage 7** (`buildImportPlan`) treats as the canonical-identity oracle: the brain
supplies cited *values*, the mapper supplies canonical *identity* (`refId`, hierarchy, sibling
order, state scopes). Stage 7 emits a normalized bundle over SSE. The client
(`UnifiedImportModal.tsx`) receives it and writes every entity through
`importProduct.ts:importPlan` → `adapter.db.mutate`/`mutateBatch`, coverages first with
wave-batching so a child never shares a Cosmos transactional batch with a not-yet-committed parent.

The deterministic mapper itself (`isoImport.ts:1990`) is the interesting part, because it encodes a
lot of hard-won domain knowledge: it selects the framework sheet by counting real `refId` rows
(`selectFrameworkSheet:466`), skips revision/definition/data-validation sheets and architect/scratch
decoys and `(2)`/`(3)` version copies (`IGNORE_SHEET:444`, `DECOY_SHEET:447`, `VERSION_SUFFIX:449`),
finds the header row by alias scoring (`findHeaderRow:325`), reconstructs the coverage tree from
column fill (`resolveCoverageHierarchy`), segments stacked LD/RT tables on their marker rows, and —
new on this branch — reconstructs concept links (rule → table → coverage, rating group → coverage)
by fuzzy name matching (`conceptMatch.ts`) whenever a workbook carries the signature of un-keyed
reference tables.

---

## C. Root cause of the ID-linking failure

### C.1 The single root cause: the `docId` minting inconsistency

**Claim.** `refId` is stored verbatim (dots preserved, original case); the Cosmos `docId` is the
dashed form of the `refId`. But the code mints `docId`s in three places with **two conventions**,
and the parent-pointer validator only understands one of them.

The three minters:

| Minter | File:line | Transform | `GL.COV.001` becomes |
|---|---|---|---|
| Client mapper `dashId` | `isoImport.ts:311` | `refId.replace(/\./g,'-')` — **case preserved** | `GL-COV-001` |
| Server stage-7 `toDocId` | `stage7-plan.js:40-43` | `.toLowerCase().replace(/[^a-z0-9]+/g,'-')` — **lowercases** | `gl-cov-001` |
| Server filing fallback | `unified-import.js:374` | `.replace(/\./g,'-').toLowerCase()` — **lowercases** | `gl-cov-001` |

The validator, in the atomic write envelope:

```js
// server/lib/data.js:240-249
if (data.parentId && op !== 'delete') {
  const base = segs(path).slice(0, -1)
  const raw = String(data.parentId)
  const candidates = raw.includes('.') ? [raw, raw.replace(/\./g, '-')] : [raw]  // NO .toLowerCase()
  let parent = null
  for (const cand of candidates) { parent = await readEntity(tid, [...base, cand].join('/')); if (parent) break }
  if (!parent) { const e = new Error('invalid_parent'); e.code = 'INVALID_PARENT'; throw e }  // → HTTP 422
}
```

A sub-coverage carries `parentId` = the parent's **verbatim `refId`** (dotted, uppercase — set by
`resolveCoverageHierarchy`, stored at `finalizeCoverages`, `isoImport.ts:597`). The validator tries
`["GL.COV.001", "GL-COV-001"]`. If the parent was minted by the server `toDocId` as
`"gl-cov-001"`, **neither candidate matches**, so the child write throws `INVALID_PARENT` and is
lost. And any UI/grounding lookup that reconstructs a `docId` as the uppercase dashed form
(`chunk.ts:73`, `seed-shared.cjs:3215`, etc. — 29 case-preserving sites vs the 1 lowercasing site,
per the full census below) silently misses a lowercase document.

### C.2 Minimal failing example (real sample values)

Take the real CORE framework rows (verbatim bytes):

```
Core Framework!B8 = "CORE.COV.001"        (Bodily Injury Liability Coverage — top-level)
Core Framework!B9 = "CORE.COV.001.001"    (Pre-Judgment Interest Coverage — sub of B8)
```

Import this workbook as a **CSV/text** upload (or any path where the ISO oracle does not run).
`stage0-router.js:207` pushes CSV/text with **no `isoGrids`**, so `unified-import.js:154` never
calls `mapIsoWorkbook`, `isoPlan` is null, and every `docId` is minted by `toDocId`
(`stage7-plan.js:41`):

```
parent CORE.COV.001      → docId "core-cov-001"    (lowercase, no ISO adoption)
child  CORE.COV.001.001  → docId "core-cov-001-001", parentId "CORE.COV.001"
```

Client writes parent first (OK), then the child. The envelope validates the child's
`parentId = "CORE.COV.001"`: `raw.includes('.')` is true, candidates =
`["CORE.COV.001", "CORE-COV-001"]`. The parent's actual doc id is `"core-cov-001"`. Neither
candidate equals it → `INVALID_PARENT` → **the sub-coverage is dropped and never links to its
parent**. Exactly the reported "IDs do not link."

**Why the ISO golden path hides it.** On a normal `.xlsx` upload the ISO oracle runs and stage 7
`adoptIdentity` overwrites the brain `docId` with the mapper's value:

```js
// server/lib/import-brain/stage7-plan.js:165
brainP.docId = isoP.docId ?? toDocId(isoP.refId)
```

`isoP.docId` came from the client-convention `dashId` (uppercase `CORE-COV-001`), so on the ISO
path the parent doc id *is* `CORE-COV-001`, the second candidate matches, and the link holds. The
bug is therefore **masked wherever the ISO oracle runs and unmasked wherever it does not**: CSV/text
imports (always), and any brain-only entity that has no ISO counterpart to adopt identity from.

### C.3 What is NOT the root cause (refuted from the sample bytes)

The intuitive hypothesis — a naive whitespace split shreds multi-value cells like
`"GL.COV.002 GL.COV.003"` and `"CG 21 70 CG 21 87"` — is **refuted by the raw cell bytes**. Those
cells are not space-separated; they are **newline-separated** (ISO) or **semicolon-separated**
(CORE). The display *looks* space-separated only because whitespace collapses when you eyeball it
(my own first-pass dump did the same until I probed the raw bytes):

```
20ISORulesGL.xlsx  'GL Rules Specifications'!B6 = "GL.COV.002\nGL.COV.003\nGL.COV.004\nGL.COV.005"
20ISOPricingGL.xlsx 'GL Rating Specifications'!B6 = "GL.COV.002\nGL.COV.003"
20ISOFrameworkGL.xlsx 'GL Product Framework'!H8  = "CG 21 70\nCG 21 87"
Product_Specifications_Core_07_13_2026.xlsx 'Core Framework'!H9 = "AC 900; AC 00 01; AC 00 03; PP 00 01; AC 00 02"
```

The tokenizer is built for exactly this:

```js
// shared/src/insurance/isoImport.ts:166-168
function splitList(v: IsoCell): string[] {
  return text(v).split(/[\n;,]+/).map(s => s.trim()).filter(s => s && !isPlaceholder(s))
}
```

It splits on newline / semicolon / comma and **preserves internal spaces**, so
`"GL.COV.002\nGL.COV.003"` → `['GL.COV.002','GL.COV.003']` (correct), and
`"CG 21 70\nCG 21 87"` → `['CG 21 70','CG 21 87']` (correct — the internal spaces of an ISO form
number survive). The one input it does **not** split is a bare-space-separated list, and **no
sample workbook uses one**. So the tokenizer is well-designed for the real files; it is a latent
risk for a hypothetical vendor, not the live failure.

### C.4 Ranking of the 11 flagged observations (cause vs aggravator vs handled)

| # | Observation | Verdict | Evidence |
|---|---|---|---|
| 5 | Hierarchy implied by column fill; `parentId` reconstructed | **Manifestation of the root cause** | `coverageHierarchy.ts:85` builds it correctly; the dotted-`parentId`-vs-lowercase-`docId` split (C.1) breaks the write |
| 8 | Sheet names not stable across vendors | **Real aggravator** | client mapper routes by name regex (`findSheet:488`); SECURA `"ISO TABLES"`/`"PROPERTY ROC"` land in `sheetsSkipped` → PR `rtTables=0, ldTables=0` (`docs/audit/fidelity/fidelity-pr.json`) |
| 6 | References by name, not id (`Prem/Ops`) | **Aggravator, newly addressed** | `conceptMatch.matchCoverageByName:161` (this branch); before it, name-only refs were 100% unlinked |
| 10 | Definitions / Data Validation sheets carry the schema | **Missed opportunity** | `IGNORE_SHEET:444` skips them; the documented id grammar `CR.COV001.01` is never read |
| 3 | refId grammar differs by vendor | Mostly handled, minor aggravator | `refIdPrefix:303` separator-agnostic; `coverageHierarchy` dot-split means glued `IM.COV044` nests via group-name not refId |
| 4 | Rating step ids internally inconsistent | Minor (cosmetic) | program id collapses `GL.RAT.1.00`→`GL.RAT.1` (`isoImport.ts:1516`); bare `1.01`/`1.02` kept verbatim, not qualified (:1524); steps are nested + order-referenced |
| 2 | Multi-value reference cells | **Handled (hypothesis refuted)** | `splitList:166` handles `\n`/`;`/`,`, preserves form-number spaces (C.3) |
| 1 | Header rows offset to ~row 5 | **Handled** | `findHeaderRow:325` scans first 20 rows; server `scoreHeaderCandidates` |
| 7 | Sentinel values | **Handled** | `PLACEHOLDER:146` matches `<...>`, `n/a`, `intentionally left blank`; `clean():148` applies it |
| 9 | Stacked mini-tables | **Handled** | `parseLdTables:1308`, `parseRtTables:1379`, `detectReferenceTables:1587` segment on marker rows |
| 11 | Million-row used-range bomb | **Handled** | client `readWorkbook.ts:36-43` and server `workbook.js:107-114` bound by `eachRow({includeEmpty:false})`; verified: Property_RF "Rules Repository" reports 1,048,417 rows, real data ends at 1,609 |

---

## D. Five problems, highest severity first

### D1. `docId` case/representation split breaks parent + cross-reference resolution (CRITICAL)

- **Symptom.** Sub-coverages silently fail to import (`INVALID_PARENT`, HTTP 422) and cross-refs
  resolve to nothing, on CSV/text uploads and for brain-only entities. IDs "do not link."
- **Root cause.** Three `docId` minters, two conventions; validator tries only the case-preserving
  form (see C.1). `stage7-plan.js:41` lowercases; `data.js:243` does not.
- **Fix.** Make `docId` minting a **single canonical function** shared by client and server, and
  make it deterministic and reversible. Recommended: keep the case-preserving `dashId`
  (`refId.replace(/\./g,'-')`) everywhere; delete the lowercasing in `stage7-plan.js:40-43` and
  `unified-import.js:374`. Belt-and-braces: extend `data.js:243` candidates to also include
  `raw.toLowerCase().replace(/\./g,'-')` so historical lowercase docs still resolve. One source of
  truth in `shared/src` (e.g. `refIdToDocId`), imported by both the mapper and the bridge.
- **Verify.** New fixture: a 2-row CSV (`CORE.COV.001`, `CORE.COV.001.001`) imported end-to-end
  through the server brain with `isoPlan` forced null; assert the child persists and
  `coverage.parentId` resolves. Add a unit test asserting `dashId` and `toDocId` produce byte-equal
  output for the seed corpus. The $1,528 / $1,002 / $2,635 / $1,281 canaries must stay exact.

### D2. Client mapper routes sheets by name, so novel-vendor sheets are silently skipped (HIGH)

- **Symptom.** SECURA PR imports with `rtTables=0, ldTables=0` — every rate table and every
  limit/deductible table is lost — because the sheets are named `"ISO TABLES"` / `"PROPERTY ROC"`,
  which no regex in `mapIsoWorkbook` matches (`fidelity-pr.json` `sheetsSkipped`).
- **Root cause.** `findSheet` (`isoImport.ts:488`) and the routing regexes at
  `isoImport.ts:1995-2003` are a hardcoded name list. A sheet not on the list is invisible to the
  mapper, so its entities never exist to be linked.
- **Fix.** Route by **content signature**, not name (the server brain already classifies by content
  in `stage1-classify`). For the deterministic mapper, add a content sniffer: a sheet with >= 2
  `RTTable.*` / `RATE TABLE ID:` markers is a rate-table sheet regardless of its tab name; a sheet
  whose header row scores high on LD-table aliases is an L&D sheet. Fall back to the name regex only
  to break ties.
- **Verify.** Fixture from `Property_Rating_Repository__Master.xlsx` with its tabs renamed;
  assert `rtTables > 0` and `ldTables > 0` and that the rating steps resolve their `RT` refs.

### D3. Definitions and Data Validation sheets are ignored, so per-workbook grammar is never learned (HIGH)

- **Symptom.** Every workbook ships a Definitions sheet documenting its id grammar (`CR.COV001.01`)
  and a Data Validation sheet giving enum domains (Status, Claims Basis, Requirement, Form Category,
  Coverage Scope, Coverage Effect...). The importer reads neither; enum mapping is a hardcoded
  crosswalk that silently mislabels or flags unknown vendor values.
- **Root cause.** `IGNORE_SHEET = /revision history|definition|data validation|categories/i`
  (`isoImport.ts:444`) drops these sheets before any parser sees them.
- **Fix.** Add a **schema-learning pre-pass** that parses the Definitions sheet into a
  per-workbook id-grammar hint and column glossary, and the Data Validation sheet into the enum
  domains, then feeds both into `mapColumns` (alias extension) and the enum mappers. This is a
  read-only enrichment; it changes no identity.
- **Verify.** Fixture: SECURA IM workbook; assert the learned enum domain for `COVERAGE EFFECT`
  includes `Grants/Restricts/Broadens/Amends/Administrative` (real values from
  `Data Validation!E5:E9`) and that a coverage carries `coverageEffect` instead of dropping it as an
  unmapped column.

### D4. Rating step ids are not qualified with their group prefix (MEDIUM)

- **Symptom.** A rating group starts `GL.RAT.1.00` and continues with bare `1.01`, `1.02`
  (`20ISOPricingGL.xlsx 'GL Rating Specifications'!C6,C7,C8`). The bare ids are stored verbatim, so
  a step referenced elsewhere as `GL.RAT.1.01` will not match the stored `1.01`.
- **Root cause.** `parseRating` (`isoImport.ts:1524`) sets `id: stepId || step-N` with no
  qualification; only the program refId is normalized (`:1516`).
- **Fix.** When a bare step id (no line prefix) follows a qualified group header, qualify it with
  the group's `.RAT.N` prefix: `1.01` under `GL.RAT.1.00` becomes `GL.RAT.1.01`. Keep the raw id in
  a `sourceStepId` field for provenance.
- **Verify.** Extend the existing rating test (`isoImport.test.ts:287-294`) to assert
  `steps[1].id === 'GL.RAT.1.01'` while the program refId stays `GL.RAT.1`.

### D5. `.xls` (OLE2) and other non-ZIP spreadsheets misroute to the PDF vision path (MEDIUM)

- **Symptom.** A legacy `.xls` (OLE2 `D0 CF 11 E0` magic) is not `PK\x03\x04`, so `sniffContainer`
  does not classify it as a workbook; with `mediaType` defaulting to `application/pdf` it falls into
  the filing PDF vision route and produces a garbage or empty product.
- **Root cause.** `sniffContainer` (`workbook.js:26-46`) recognizes only ZIP-based OOXML and PDF;
  no OLE2 branch, and the PDF fallback is greedy.
- **Fix.** Add an OLE2 magic-byte branch that routes to a converter (or rejects with a clear
  "convert to .xlsx" notice) rather than to vision. Never default an unrecognized container to PDF;
  route to `unknown` with a specific reason.
- **Verify.** Fixture: a `.xls` file; assert it routes to `unknown` with reason `ole2_legacy_xls`,
  not to the filing path.

### Appendix D — the long tail (every additional issue found)

- **A1.** `refIdPrefix` fallback (`isoImport.ts:308`) can derive a junk prefix from a malformed id;
  guarded for minted ids (G-C) but a malformed *source* id still flows through.
- **A2.** `coverageHierarchy` segment-nesting splits on dot only (`coverageHierarchy.ts:70`), so
  SECURA glued ids (`IM.COV044.00` vs `IM.COV044.03`, same segment count) never nest by refId and
  depend on the group-name signal; a SECURA workbook without a clean COVERAGE column would orphan
  those sub-coverages.
- **A3.** Duplicate coverage ids across different coverages are kept-first with a warning
  (`parseFramework:736`; real occurrence: `fidelity-pr.json` warns `PR.COV001.20` reused for two
  different "Building" coverages) — a genuine source ambiguity the importer cannot resolve alone.
- **A4.** `mapColumns` fuzzy pass at 0.5 overlap (`isoImport.ts:381`) can mis-bind a novel column to
  the wrong field; there is no confidence surfaced on the binding.
- **A5.** The AI overlay endpoint `proposeMapping` is **not** import-exempt (`ai/index.js:36` only
  exempts `unifiedImport`), so the concept-linker AI tail can be `503`'d by the cost ceiling mid
  review while the deterministic import cannot — an inconsistent guard boundary.
- **A6.** `data.js` parentId validation issues **one `readEntity` per candidate per child** during
  the envelope build; a deep coverage tree does N sequential reads, a latency cost on large imports.
- **A7.** Stage-4 extraction is ~90% of import wall-clock and spend (`import_eval_iso_join_investigation.md`);
  a correctness-neutral perf debt, but it makes iteration on real workbooks slow (~95 min / ~$70 for CORE).
- **A8.** The offline golden eval reports F1 = 1.0 for GL/IM/PR/CORE because the goldens were built
  from the same templates (`docs/audit/import_eval_results.json`) — green here does not prove
  real-world linking (see E10, I).

---

## E. Ten ideas for a genuinely intelligent import brain

1. **Read the Definitions + Data Validation sheets first (schema self-description).** Every workbook
   documents its own id grammar and enum domains. Parse them into a per-workbook schema before
   mapping. *Beats status quo* because the importer stops guessing the grammar and stops flagging
   valid vendor enums as unknown. *Cost/risk:* low; read-only; the sheets are small.

2. **Content-based sheet + section routing.** Classify a sheet by what is in it (refId density,
   marker rows, header alias score), not by its tab name. *Beats status quo* because it survives
   SECURA's `"ISO TABLES"` and any unseen vendor naming (fixes D2). *Cost/risk:* low-medium;
   the server brain already does this — port the signal to the deterministic mapper.

3. **One canonical reference RESOLVER with a confidence score.** A single module that: normalizes
   any id grammar (dotted, glued, dashed), tokenizes multi-value cells with form-number awareness,
   falls back to name and fuzzy matching, and returns `{refId, basis, confidence}`. Replace the
   scattered per-parser linking with calls to it. *Beats status quo* because linking logic stops
   being duplicated and every link carries a provenance + confidence. *Cost/risk:* medium; this is
   the natural home for the `docId` canonicalization fix (D1) and `conceptMatch` (already built).

4. **Deterministic-first, AI-only-on-ambiguity (already the design — enforce it).** The mapper and
   the brain fast-paths handle confident cases; AI is invoked only when a column, header, or link is
   genuinely ambiguous, and the highest-reasoning model (opus) only when the ladder disagrees.
   *Beats status quo* on cost and determinism. *Cost/risk:* low; tighten the escalation thresholds.

5. **Extract-then-validate ENSEMBLE with a cross-family validator.** Keep the two-family vote
   (Claude value, GPT check) and add a final cross-family adversarial pass over the assembled link
   graph, not just per-field. *Beats status quo* because correlated single-family hallucinations
   cannot survive. *Cost/risk:* medium (extra calls, but import is no-cap).

6. **Confidence scoring + a human-review queue.** Every mapping and link carries a confidence; below
   a threshold it goes to a review lane in the UI rather than being written or dropped. *Beats status
   quo* because unsure mappings are surfaced, not silently guessed or lost. *Cost/risk:* low-medium;
   the bundle already carries a `review` block and notices.

7. **A normalization pass (money, dates, enums, state matrix).** Money to plain dollars, dates to
   ISO, enums to the learned domain, per-state matrix columns to `{allStates, states[]}`. Some
   exists (`stateScope`, `parseNum`); make it a uniform, testable stage. *Beats status quo* by making
   values comparable across vendors. *Cost/risk:* low.

8. **Provenance capture (source workbook / sheet / cell → entity field).** Every field records where
   it came from. The brain already captures `Sheet!Cell` citations; extend to the mapper and to
   every link. *Beats status quo* for audit and debugging (this whole investigation would have been
   minutes, not hours). *Cost/risk:* low.

9. **Dry-run PREVIEW with a full diff before any `mutate()`.** Show adds/updates/link-edges and
   unresolved items with confidence, and let the user approve before the write. *Beats status quo*
   because `INVALID_PARENT`-class failures become visible pre-write. *Cost/risk:* low-medium; the
   review UI is most of the way there.

10. **Regression fixtures from the known templates — used as tests, not as the definition of
    correct.** The current goldens were built from the templates, so a template-shaped bug scores
    1.0 (E8/I). Keep them as regression guards but add **held-out adversarial** fixtures (see G) and
    a real-world spot-check. *Beats status quo* by closing the "green but wrong" gap. *Cost/risk:*
    low; `samples/hardening/holdout/` already exists as a starting point.

---

## F. Conceptual ingestion framework (observant human, any format)

The goal is to ingest *any* insurance artifact — xlsx/xlsm, PDF (manuals, base forms, rate order of
calculations), docx — as **domain concepts**, not template cells. The reasoning an SME applies:

**(a) Recognize the archetype.** Before reading a single value, decide what the document *is*:
product framework, forms specification, rating specification, rules specification, bureau rate
manual, base policy form, rate order of calculations (ROC), or class-code tables. Signals: sheet
titles and merged banners; the presence of a hierarchy column block; marker rows; for a PDF, the
running headers and the shape of the tables. The archetype selects the extractor.

**(b) Locate the schema.** Find where the document describes itself: the Definitions sheet, the Data
Validation sheet, the merged category band on row 4, the real header row on row 5, the
`RATE TABLE ID:` / `TABLE NAME:` section markers. An observant analyst reads the schema before
trusting the cells — so should the importer (E1).

**(c) Extract the domain concepts (what each IS, where it lives).**
- *Coverage* — a scope of protection against a named loss. Lives as a row in the framework/PCM sheet
  where the COVERAGE column is populated; its `refId` is the row id; its forms cluster in the FORM
  NUMBER column beside it.
- *Sub-coverage* — a coverage beneath a parent (narrows/extends/components it). A row where the
  SUB-COVERAGE column is populated, or whose `refId` segment-nests under a coverage, or that shares
  the parent's COVERAGE group name.
- *Limit / deductible / option (a term)* — a constraint on a coverage. Lives in an L&D table near
  its coverage, or in a stacked table keyed by `LDTable.*`, or in a matrix whose column codes
  (BI/PD/CSL) name the coverages.
- *Rating step / factor* — one instruction in the pricing algorithm. A factor is the value at the
  row-by-column intersection of a rate table; a step lives in a row of the rating spec, grouped
  under a `.RAT.N` header; a *rate order of calculations* is an ordered list of those steps (an
  algorithm), distinct from a step-table lookup.
- *Rule* — an eligibility/attachment/rating condition. A row in the rules spec, referencing its
  coverages (by id or name) and forms, sometimes citing a table by free-text name.
- *Form* — a policy document. Form numbers cluster in a forms-library list; each ISO number is a
  multi-token string (`CG 21 70`) with an edition date beside it.

**(d) Build the linkage graph.** Wire coverage → form → rule → rating step → table using, in order of
certainty: `refId` equality, then form number, then normalized/fuzzy name, then positional
proximity. Every edge carries a basis and a confidence.

**(e) Infer the hierarchy** from column fill + refId nesting + group name (the `resolveCoverageHierarchy`
signals), promoting orphans rather than dropping them.

**(f) Normalize values** (money, dates, enums to the learned domain, per-state matrix to
`{allStates, states[]}`).

**(g) Score confidence and route the unsure** to a human-review queue rather than guessing or
dropping.

**(h) Persist via `mutate()`** — parents before children, atomic entity + audit + version +
searchIndex + chainHead + chunk, with a canonical, reversible `docId` (D1).

**The SME principle (stated in the Accenture template guidance itself).** When terminology does not
align or a mapping is ambiguous, **do not assume — flag it**, and in a real engagement confirm with
the business. The importer's job is to reconstruct the analyst's reasoning transparently and to
surface every uncertainty, never to invent a link to make the graph look complete. This is already a
binding invariant here ("AI grounded + cited; free invention is a bug"); the framework operationalizes
it end to end.

---

## G. Break the formats (adversarial)

### G.1 Traps confirmed in the attached samples (with the defending or failing line)

| Sample | Trap | Handled? |
|---|---|---|
| `Product_Framework__SECURA__Property_RF.xlsm` | `"Rules Repository"` reports **1,048,417 rows** (real 1,609); junk `"Sheet1"`/`"Sheet2"`; `"ROC"` sheet | Bomb bounded (`workbook.js:107-114`); ROC routed (`isoImport.ts:2001`) |
| `20ISOFrameworkGL.xlsx` | title row 1, `<Placeholder>` rows 2-3, merged banner row 4 (`O4:BN4` STATE APPLICABILITY), headers row 5 | Handled (`findHeaderRow:325`) |
| `20ISOFrameworkGL.xlsx` | `H8 = "CG 21 70\nCG 21 87"` multi-token form numbers, newline-separated | Handled (`splitList:166`) |
| `20ISORulesGL.xlsx` | `B6 = "GL.COV.002\nGL.COV.003\nGL.COV.004\nGL.COV.005"` multi-value refIds | Handled (`splitList:166`) |
| `20ISOPricingGL.xlsx` | `C6="GL.RAT.1.00"` then bare `C7="1.01"`, `C8="1.02"`; stacked RT tables (`RATE TABLE ID: RTTable.001`); `Prem/Ops` name-only ref | Partly (steps not qualified, D4); tables segmented; name ref via concept-linker |
| `20ISOFormsGL.xlsx` | forms sheet **821 rows x 95 cols**; 214-row dynamic-data sheet | Handled (true-extent + width-aware batches) |
| all ISO/SECURA | sentinels `<Placeholder>`, `<Intentionally Left Blank>`, `N/A` | Handled (`PLACEHOLDER:146`) |
| `Product_Framework__SECURA__Inland_Marine.xlsx` | sheet `"Product Component Model"` not `"...Framework"`; id grammar `IM.COV044.00` | Framework selected (`selectFrameworkSheet:467`); grammar via `refIdPrefix` |
| `Product_Specifications_Core_07_13_2026.xlsx` | 25 sheets: `(2)`/`(3)` version copies, `_arch`/`_Before50States`/`scratch`/`Rating question`/`IN Factor Review` decoys, `<Name> Product Framework` placeholder; `H9 = "AC 900; AC 00 01; ..."` semicolon-separated forms | Handled (`DECOY_SHEET:447`, `VERSION_SUFFIX:449`, `selectFrameworkSheet` refId scoring; `splitList` semicolons) |
| SECURA PR | rate/L&D in `"ISO TABLES"`/`"PROPERTY ROC"` → **skipped** → `rtTables=0, ldTables=0` | **NOT handled** (D2) |
| ISO/SECURA | Definitions grammar `CR.COV001.01`, Data Validation enum domains | **Ignored** (D3) |
| PDFs present | `sample-PH-baseform-HO3.pdf`, NJ HO Manual + ROC, `PP_00_01`, Lemonade HO, WA Auto rate/rule/form | Filing path (vision ladder) — not workbook-linked |

### G.2 Synthetic adversarial inputs (predicted failure today) — the hardening fixture set

1. **Transposed table** (fields down column A, records across the top row). `findHeaderRow` finds no
   header row with >= 3 alias hits → whole sheet skipped. *Predicted: silent drop.*
2. **Headers on an unexpected row** (row 8, extra preamble). Covered if within the 20-row scan
   window; **fails past row 20** → sheet skipped.
3. **Coverage title spanning merged cells** (name only on the anchor row). `fillForward` /
   coverage-name fill-forward recovers it; **fails if the merge is on the id column** (id blank on
   continuation rows → those rows dropped at `parseFramework:701`).
4. **Rule references a coverage refId that does not exist.** `linkReferenceTables` /
   `validateEntityRefs` drop the dangling ref (correct — never invented), but there is **no notice
   naming the missing id** unless the reference-table path runs → silent non-link.
5. **Form number with an edition date glued on** (`CG 21 70 04 13`). `splitList` keeps it as one
   token; `covsByForm` keys on the squished whole string → **rule-by-form links miss**.
6. **Two id grammars mixed in one workbook** (`GL.COV.001` and `IM.COV044.00`). `refIdPrefix` yields
   two prefixes → multi-product split; coverages assigned by prefix; **cross-grammar links (a GL rule
   citing an IM coverage) fail** because there is no grammar-normalizing resolver (E3).
7. **Rate table references a coverage by a slightly misspelled name** (`Premisis Operations`).
   `matchCoverageByName` tiers require >= 0.6 overlap; a one-edit typo may fall below → **unlinked**
   with no fuzzy-edit-distance fallback.
8. **Empty sheet with one stray cell far down the used range** (`ZZ99999`). Bounded by
   `eachRow({includeEmpty:false})` so no hang; the stray cell yields no header → sheet skipped
   (correct).

These 8 belong in `samples/hardening/holdout/` alongside the existing `v1..v7` variants, scored
against expected link-edge counts, **not** against a golden regenerated from the same template.

---

## H. Model fleet, ensemble, and agentic architecture

### H.1 Deployed fleet (verified in `shared/src/ai/fleet.ts:39-76` → `server/lib/fleet-shared.cjs` → `fleet.js:17`)

| Role constant | Deployment | $ / MTok in-out | Strength | Import use |
|---|---|---|---|---|
| `GROUNDED_CITED` | `claude-opus-4-8` | 15 / 75 | heavy reasoning, citation fidelity | stage 1/2/3 reasoner-A, ladder top, overlay escalation + adversarial |
| `MID_REASONER` | `claude-sonnet-5` | 3 / 15 | grounded mid-tier | ladder mid rung, stage-4 conflict votes, concept-linker proposer |
| `BULK_VERIFY` | `claude-haiku-4-5` | 0.80 / 4 | cheap bulk / verify | stage-0 assist, stage-1 prefilter, stage-4 bulk-A, filing classify |
| `VISION` | `gpt-5.1` | 3 / 12 | **cross-family validator** | stage-3 reasoner-B, stage-4 judge, stage-5 adversarial validator, overlay GPT validator |
| `CHEAP_GENERAL` | `gpt-5-mini` | 0.30 / 1.60 | cheap alt-family | stage-4 bulk-ALT, degrade target |
| `EMBED` | `text-embedding-3-small` | 0.02 / 0 | name/semantic matching | 512-dim int8, grounding chunks (best-effort → lexical fallback) |

`ESCALATION_LADDER = ['BULK_VERIFY','MID_REASONER','GROUNDED_CITED']` (`fleet.ts:148`). Context
windows are **not** declared anywhere in fleet config (flagged: add them). Sampling constraint
(Sonnet 5 no custom sampling, ADR 0001) lives in the reference `functions/src/runtime.ts:37-43` and
is honored in `ai-call.js` (temperature omitted; o-series use `max_completion_tokens`).

**Cost guard** (`fleet.js:74-99`): 1h window, `AI_SPEND_CEILING_USD` default $25 (live override 250
on `app-prodhub-dev`), soft-degrade at 80%. `guard(IMPORT_CONTEXT)` returns
`{allow:true, degrade:false, reason:'import_no_cap'}` *before* the ceiling check (`fleet.js:95`);
`resolveModel(role,{bypassDegrade:true})` suppresses degrade. **Telemetry is never bypassed** —
`recordSpend()` → `fleet.record()` runs after every call. **`claude-fable-5` appears nowhere in the
runtime fleet** (only negative references in tests) — the invariant holds; it must stay build/fix
only. **Flagged inconsistency:** `proposeMapping` (the concept-linker AI tail) is *not*
import-exempt and can be `503`'d by the ceiling (`ai/index.js:36`; A5).

### H.2 Proposed agentic ensemble for the import brain

A pipeline of specialized agents, each with structured output (forced tool-use) and the cheapest
model that can do its job, reserving opus for genuine ambiguity:

1. **Parser agent** (deterministic, no model) — read the workbook, bound the used range, normalize
   cells, learn the schema from Definitions/Data Validation (E1).
2. **Archetype router** (`BULK_VERIFY` haiku, opus only on <0.6) — classify each sheet by content
   (E2). Structured output: `{sheet, archetype, confidence}`.
3. **Archetype-specific extractor agents** (`BULK_VERIFY` bulk, `MID_REASONER` on conflict) — one
   extractor per archetype (framework / forms / rating / rules / L&D / ROC), each emitting cited
   entities. Deterministic fast path when the column map is confident.
4. **Cross-family validator** (`VISION` gpt-5.1) — adversarially re-check the assembled entities and
   the **link graph** against the source cells (E5). Decorrelated from the Claude extractors.
5. **Normalizer** (deterministic) — money/date/enum/state-matrix normalization (E7).
6. **Reconciler + confidence scorer** (deterministic + the canonical resolver of E3) — resolve every
   link with a basis and confidence; this is where the `docId` canonicalization (D1) lives.
7. **Human-review queue** — anything below threshold surfaces for confirmation (E6), never a
   silent guess.
8. **`mutate()` writer** (client) — parents before children, atomic, canonical `docId`.

Embeddings (`EMBED`) do the name matching in step 6 (coverage names, table names, form clusters).
The highest-reasoning model (opus) is reached only when the ladder disagrees or the validator
dissents. Invariants respected throughout: all AI server-side, grounded and citation-required, zero
fabrication, `refId`s resolved against the live catalog, cost guard intact everywhere except the
named `IMPORT_CONTEXT` bypass (and that bypass should be extended to `proposeMapping`, A5).

---

## I. Hostile self-review of this diagnosis

- **Did I confirm behavior against live code, not docs?** Yes. Every behavioral claim cites a
  current-branch `file:line` I (or a verification agent) opened. I explicitly flagged the two
  handoff docs as predating this branch and their line numbers as drifted, and the Firebase strings
  as vestigial.
- **Did I prove the root cause with a real failing example?** Yes, from real sample bytes
  (`CORE.COV.001` / `CORE.COV.001.001`) traced through `stage7-plan.js:41` (lowercase mint) and
  `data.js:243` (case-preserving validate) to `INVALID_PARENT`. The masking mechanism
  (`adoptIdentity`, `stage7-plan.js:165`) is also code-cited.
- **Did I avoid inventing anything?** I believe so. I refuted my own initial hypothesis (space-split)
  when the raw bytes contradicted it, rather than force-fitting it.
- **What I could NOT verify (be honest):**
  1. **The live `INVALID_PARENT` reproduction is by construction, not observed.** I did not run a
     CSV import against a live Cosmos to watch the 422. The chain is code-proven, but a live repro
     (force `isoPlan` null, import a 2-row CSV, observe the rejected child) is the confirming test
     and is owed. It is possible a caller never sends a CSV with a dotted `parentId`, which would
     make the bug latent rather than active — the fix is cheap either way.
  2. **Which specific "ID-linking failure" the user is seeing.** The offline eval is green (F1 1.0)
     because the goldens are template-shaped (E8). The reported symptom could be D1 (parent writes),
     D2 (SECURA tables lost), the historical `allStates`/raw-cell bug already fixed, or something
     surfaced only in the live UI. I ranked the candidates by code evidence; confirming *which* one
     the user hit needs the failing workbook and a live import trace (the instrumented harness in
     `scripts/import-eval.mts` captures notices for exactly this).
  3. **`proposeMapping` live behavior on Foundry** is unverified (per memory, the live overlay path
     was never exercised); I described it from code only.
  4. **Exact model context windows** are not in the config, so H.1 lists them as unspecified rather
     than guessing.

To close these: run one instrumented live CSV import to observe the 422; run one SECURA PR live
import to confirm the `rtTables=0` loss; and get the user's actual failing workbook to pin the
specific symptom to a specific defect above.
