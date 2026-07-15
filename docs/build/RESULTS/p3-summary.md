# P3 — Duck Creek Author XML export: results + hostile self-review

**Lane:** `p3/xml-export` (worktree @ fork `d4434c3` = main).
**Spec:** [XML_EXPORT_SPEC.md](../../export-templates/author-xml/XML_EXPORT_SPEC.md) (32/32 citations P1-verified).
**Scope trim (operator brief):** NO HITL capture UI, NO override capture, NO tenant mapping
memory → ledgered `XE-09` (BACKLOG); two-way plug as a user-facing import source → `XE-10` (BACKLOG).
**Model:** Fable 5 (`claude-fable-5`), confirmed at session start.

## What shipped (one commit per lettered item, test-first)

| Item | Commit | Ledger |
|---|---|---|
| X1 overlay emitter + OVERLAY-DELTA LINT hard gate | `08507b9` | XE-01, XE-02 |
| X2 Unity CoverageConfig+TableConfig transform (BUILT — never existed) + golden lockstep | `b9be5fe` | XE-03 |
| X3 17-row gap report + bundle + `/api/export/duckcreek` + read-only result panel | `e188cb8` | XE-04, XE-09 |
| X4 hardened round-trip harness (stage-0 sniff + `mapManuscriptOverlay`) | `7797fb7` | XE-05, XE-06, XE-10 |
| X5 `page.dictionary` flip on first success — never on blocked | `99967da` | XE-08 |

Gate at HEAD: typecheck ✅ (3 workspaces) · lint ✅ (pre-existing warnings only) ·
tests **1356 passed / 4 skipped (root) + 186 (functions)** incl. PH $1,528 / PA $1,002 /
GL $2,635 canaries · build + bundle budget ✅ (numbers below). ~90 new tests across
6 suites. `EX-03` (export pill on the Home brief) was NOT in the trimmed brief — stays OPEN.

## Hostile self-review

### 1. Deltas on the chain, or a flatten?

Open `Hub_PA_PROD_001_1_0_0_0.xml` (786 lines) beside `DCT_SampleProduct_3_0_0_0.xml`:
the emitted document is **deltas only**. The abstract scaffold chain is re-declared exactly
as SP3:956-959/1738 does — carrying **no override attribute** (the observed corpus shape;
spec §1.2's "abstract re-declarations are overrides" prose is corrected by its own §1.3
clause 3, which the corpus confirms):

```xml
<object id="data" abstract="1">
  <object id="Policy" abstract="1">
    <object id="Line" abstract="1">
      <object id="LineCoverages" abstract="1">
```

**All 12 `override="1"` nodes** are restatements of ids the bundle's own CoverageConfig
generates (spec §5 row 10 "override of the generated input") — 6 input containers + 6 term
publics carrying the full option lists, e.g.:

```xml
<object id="BodilyInjuryLiabilityInput" override="1">
  <public id="BodilyInjuryLiabilityInput.BodilyInjuryPerPersonPerAccident"
          path="BodilyInjuryPerPersonPerAccident" type="int" override="1" comment="PA.COV.001.001">
```

Net-new nodes (no override, every id manifest-traced — 82 ids in the map):

```xml
<object id="PersonalAutoPolicyInput">
<private id="PersonalAutoPolicyPrivate.Step01_Territorybaserate" caption="" type="float" comment="PA.RAT.1#s1">
<public id="PersonalAutoPolicyOutput.Premium" path="Premium" type="float" comment="PA.RAT.1">
<documentSet name="PP1301_0105" paperBinNum="0" printDefault="Selected" prevPage="" condition="FormsPrivate.Show_PP1301">
```

Zero concrete base-id restatements; the lint's R-flatten hard trigger (>5% of B) sits at 0.
The red fixture (`overlay.test.ts` "FAILS a deliberately flattened document") proves the
gate turns red on a flatten.

### 2. Did any rate-table data leak into the XML?

No. The emitted overlay contains **zero `<table>` elements** — test:
`overlay.test.ts › never inlines a rate table: zero <table> elements; rates ride Unity (§3.6)`.
The mechanical tripwire is `R-rates` in `lint.ts` (a `tableType="local"` table with `<data>`
colliding with the TableConfig manifest FAILS the export), red-proven by
`overlay.test.ts › FAILS an inlined rate table whose id collides with the TableConfig manifest`.
Rates ride the TableConfig workbook the X2 transform BUILDS — proven cell-for-cell against
the golden pair (all 23 sheets; the golden is a PH(1-10)+PA(11-21) concatenation, verified
against the seed tables). The overlay only consumes:
`<lookup><tableRef value="TerritoryBaseRate"/><fieldRef value="rate"/><keyRef …/></lookup>`,
with keyRef names byte-matched to the sheet header row 8 (L3 in the lint).

### 3. Can a DEFAULTED value appear without its named rule, or a MISSING field slip through?

No, and both are pinned by tests:
- `gap.test.ts › every DEFAULTED row NAMES its spec default rule` — every DEFAULTED row's
  `rule` must be a member of the documented `RULES` table (verbatim SPEC §5 rule strings);
  a rule-less DEFAULTED row fails the test, and the classifier has no code path that emits
  DEFAULTED without a rule.
- `gap.test.ts › a LOB with no spec-pinned base manuscript yields MISSING on row 1 and BLOCKS` +
  `gap.test.ts › a blocked export produces the gap list and NO artifacts` +
  `export-duckcreek.test.ts › a BLOCKED export never writes a record and NEVER flips the flag` —
  MISSING → `blocked: true`, zero artifacts, zero writes, zero flag flips (flagged-not-dropped).

The PA base binding is **MAPPED from the spec's own §1.1 MUST** (pinned per-LOB constant
grounded in the golden `Config!C3`), not guessed; every other LOB blocks on row 1 today —
that is the honest consequence of cutting tenant mapping memory (XE-09).

### 4. Does the round-trip hit the quoted numeric bar, and where did it lose the most?

The bar (spec §6.1): **"identity-join F1 = 1.0 on coverages/forms/tables"** — quoted in the
test name `roundtrip.test.ts › export seeded PA.PROD.001 → re-import → identity-join F1 = 1.0
on coverages/forms/tables, extras 0`. Result: coverages 12/12, forms 12/12, tables 11/11 —
F1 = 1.0, extras 0, missing []. Rating program refId + all 12 step ids in reference-chain
order also recover.

Where it loses the most — stated, not hidden:
- **Rules, formRules, LD tables are not recoverable from the XML half at all** (rules ride
  annotations per spec §3.9; LD value lists ride `definition/options`). The mapper emits a
  `not-recovered` notice; the workbook/manifest half owns them. This is L5's honest
  "XML half only" split.
- Coverage **names** for the 6 non-restated coverages recover as their DC object ids (the
  manifest maps identity, not display strings) — refId fidelity is 1.0, label fidelity is not.
- 6 of 12 coverage identities travel via the manifest rather than overlay nodes — by design
  (spec §2: "the manifest is not optional"), but it means the naked XML without its manifest
  recovers only the re-declared 6.

### 5. XXE and billion-laughs results — can a crafted overlay reach an entity resolver or blow memory?

No resolver exists to reach and no expansion can happen: the parser has **no DTD machinery
at all** — `<!DOCTYPE` is rejected outright, so custom entities cannot be declared and
external entities cannot be referenced. Pasted from `manuscript-security.test.ts` (all green):

```
✓ REJECTS the XXE payload: DOCTYPE is not allowed, no entity resolver is reachable
    → XmlParseError: "DOCTYPE is not allowed (DTDs, external entities and entity expansion are disabled)"
✓ REJECTS the billion-laughs payload before any expansion can happen
    → same clean DOCTYPE rejection; heap growth asserted < 50 MB (rejection is O(1))
✓ REJECTS undefined entities even WITHOUT a DOCTYPE   → "undefined entity &lol9;"
✓ caps document size (5 MB default)                   → "exceeds the 5242880-character cap"
✓ caps element depth (64 default)                     → "element depth exceeds the 64 cap"
✓ caps node count                                     → "node count exceeds the 100 cap" (test limits)
✓ rejects malformed markup with clean errors (never partial trees)
```

The seam is additionally **not exposed**: stage-0 only classifies `manuscript-xml` behind an
opts-only flag no HTTP caller sets (flag-off control test proves byte-identical legacy
behavior), and under the flag the router is deterministic end-to-end (no AI assist).
The real 11,886-line SP3 digests as a foreign document with **zero invented refIds** (the
manuscriptID inverse validates the Hub refId grammar — `DCT_SampleProduct_3_0_0_0` yields null,
a fabrication the test caught and the code now rejects).

### 6. Did you touch any PS or P5 path, or push without the token?

No foreign paths touched. `git log --stat` for the lane (worktree, fork `d4434c3`):

```
1ed2a5b P3 open: orchestration.md (+12)
08507b9 X1: shared/src/export/duckcreek/{ids,lint,nodeIndex,overlay(+test),paFixture,spec,tables,types,xml}.ts (10 files, +1850)
b9be5fe X2: shared/src/export/duckcreek/{cells,coverageConfig,tableConfig}.ts, tests/export/{golden-workbooks,node-index-drift}.test.ts (5 files, +399)
e188cb8 X3: shared duckcreek {bundle,gap(+test),server-entry}, server/lib/export-duckcreek.js + export-duckcreek-shared.cjs, server/server.js (mount), package.json (build:export), app backend {types,azure.adapter}, DuckCreekExportPanel(+2 tests), ExportMenu, docs/build/ledger.json (15 files, +7034 −6)
7797fb7 X4: shared/src/insurance/manuscriptImport.ts, duckcreek/server-entry.ts, server/lib/import-brain/stage0-router.js (additive clause), export-duckcreek-shared.cjs rebuild, tests/export/{roundtrip,manuscript-security}.test.ts (6 files, +743 −3)
99967da X5: server/lib/export-duckcreek.js (pc injection), tests/server/export-duckcreek.test.ts (2 files, +181 −2)
```

Every file is on the published allowlist. The two disclosed co-edit risks: additive
`adapter.export` seam in `app/src/lib/backend/{types,azure.adapter}.ts` (P4 co-edits the
same files for the restore seam — disjoint regions) and the additive stage-0 clause
(import-brain lane is DONE/certified). No `git add -A` anywhere; stowaway-check before every
commit; push executed under the PUSH TOKEN row (claim/green/release history in
orchestration.md — see the deploy log row for this lane's run).

## Deviations & least-sure decisions (for the next wave)

1. **"PascalCase" is strip-and-concatenate, no title-casing** — the golden proves it
   (`Physicaldamagecoverageelected`, `MedicalPaymentsRatebyTerritory`). Step ids like
   `Step01_Territorybaserate` inherit that rule for consistency with the one proven grammar.
2. **Golden anomaly**: `Medical Payments Coverage T` (Coverage!B5 and derivations) has no
   canonical source; the lockstep test normalizes exactly that token and nothing else.
3. **Lint clause-1 extension**: the override-legal set is B ∪ C (CoverageConfig-generated
   ids) — required by spec §5 row 10, documented in `lint.ts`, red-proven both directions.
4. **`roundTo` mapping**: `argument round="N" roundType="round"` (multiply-by-1) — observed
   for integers (`round="1"`, `round="100"`); fractional N (`0.01` for roundTo 2) is inferred
   and flagged as a `rounding-semantics` HITL note.
5. **Rating driver inputs** (`territory`, `driverClass`, …) have no CoverageConfig rows —
   emitted as net-new `PersonalAutoPolicyInput.*` publics traced to `PA_RATING_INPUT_SPEC`,
   each with a `rating-input-binding` HITL note ("wire to the base risk field at DC
   integration"). Where the Hub links a driver to a coverage term (normalized-id match:
   `biPdLimitCode`, `collisionDed`, `compDed`, `rentalElected`, `towingElected`), the
   generated C id is reused instead of duplicating the field.
6. **Brief premise stale (again)**: no "Rating Tool exporter" exists anywhere in code or
   history — the re-pinned goldens are the IMPORT goldens (`tests/golden/import/*`,
   re-pinned `66ea224`), which stay green in this lane's full-suite run.
