# Duck Creek Author XML Export — Binding Specification (P1 → P3)

**Status:** SPEC_READY (P1, 2026-07-15, docs-only wave — push held).
**Audience:** P3 (the implementer). Where this spec says MUST, P3 does not guess; where it
says HITL, the value is a human decision surfaced by the export UI, never silently invented.
**Verified grounding:** every `SP3:<line>` citation was spot-verified against the in-repo copy
[`DCT_SampleProduct_3_0_0_0.xml`](DCT_SampleProduct_3_0_0_0.xml) (11,886 lines — line parity
with the schema guide's citations confirmed at lines 1, 2, 33, 964, 1449, 1452, 1743, 5336,
5341, 11078, 11681, 11823, 11825). The schema guide
[`author-xml-schema-guide.md`](author-xml-schema-guide.md) is stored as a single collapsed
line, so it is cited by **section** (`guide §N.N`), not by line. The machine grammar is
[`author-xml-node-index.json`](author-xml-node-index.json) (240 observed elements; cited as
`node-index:<element>`). Workbook cells are cited as `<Workbook>·<Sheet>!<cell/row>` against
[`../PA_PROD_001_CoverageConfig (1).xlsx`](../PA_PROD_001_CoverageConfig%20(1).xlsx) and
[`../PA_PROD_001_TableConfig (1).xlsx`](../PA_PROD_001_TableConfig%20(1).xlsx).

**One paragraph of truth:** the exporter emits a **ManuScript overlay** (guide §1) — a
delta on a named base chain — never a flattened product. Rates never ride in the XML: factor
tables travel in the **TableConfig workbook** and coverage/input structure in the
**CoverageConfig workbook** (the Unity/Express path), while the overlay carries the model
wiring that *consumes* those tables (`lookup`/`tableRef`/`keyRef`), the premium roll-up, the
forms (`documents`), and the header (`properties`/`keys`). One export = one delivery bundle:
`overlay.xml` + the two workbooks + `export-manifest.json` (id map + HITL inventory)
(+ `.resx` sidecars only when localization is active, §4.7).

---

## 0. What exists vs. what P3 builds (reconciled at HEAD `1c47f25`)

| Artifact | State | Evidence |
|---|---|---|
| Flattened DuckCreek export (old) | **DELETED end-to-end** — do not resurrect | commit `8825cbd` removed `shared/src/duckcreek/**`, `server/lib/duckcreek.js`, goldens `*.duckcreek.xml`; `/api/duckcreek/*` must 404 |
| `docs/reference/DuckCreekXML.xml` | Runtime transcript, **NOT a golden** | it is engine *output*, not authoring input; never validate against it |
| Unity workbook producer | **DOES NOT EXIST — P3 builds it** | zero hits for `TableConfig`/`CoverageConfig` in code and in all git history |
| Generic XLSX exporter | exists, different purpose | `app/src/lib/export/excel.ts` (Overview/Framework/Rules/Rating/Forms sheets) — reuse its ExcelJS plumbing, not its shapes |
| Import brain (two-way target) | exists | `server/lib/import-brain/stage0-router.js:143-214` (container sniff), deterministic mapper `shared/src/insurance/isoImport.ts` |
| Structural goldens for the workbook pair | **the `(1).xlsx` files in `docs/export-templates/` ARE the goldens** | pin them as fixtures (ledger XE-03); the brief's "existing export tests" are stale — none exist |

---

## 1. OVERLAY MODEL

### 1.1 The overlay contract

A product file is an overlay on a base chain (guide §1, §2.1). The root is `<ManuScript>`
(SP3:1; node-index:ManuScript children `properties, model, modelCollections, topics,
documents, mapping, schemaMaps, …`). The single top-level `<properties>` names the parent:

- `properties@inherited` = the **model/item base** (SP3:2 `inherited="Carrier_SampleProductBase_3_0_0_0"`; XSD:78 per guide §2.1).
- `properties@inheritedPage` = a **separate pages base** when model and pages inherit
  differently (guide §2.2, BASE:2, XSD:457).

**MUST — base binding:** the Hub overlay sets
`inherited="Carrier_ProductBase_PersonalAuto_1_0_0_0"` for the PA product — the base the
updated workbooks bind to (CoverageConfig·Config!C3 = `Carrier_ProductBase_PersonalAuto_1_0_0_0.xml`;
TableConfig·Config!E2:E22 same value on every row). Generalized: the target base manuscript is a
**per-LOB tenant setting** (HITL:MAPPED once configured; see §5 row 1).
⚠️ **Form of the value differs by artifact:** `properties@inherited` carries the **bare
manuscript ID** (no `.xml` — SP3:2), while the workbook `ManuscriptID` columns carry the
**file-name form** (`…_1_0_0_0.xml` — CoverageConfig·Config!C3, TableConfig·Config!E2) and the
per-sheet `MS Physical Path:` preamble carries a full path (TableConfig·TerritoryBaseRate_1!row 4).
The exporter derives all three from one setting; P3 must not let the `.xml` suffix leak into
the `inherited` attribute.

**MUST — inheritedPage:** omit it. When absent, pages inherit from the same parent as
`inherited` (guide §2.2: "When `inheritedPage` is ABSENT (as on SP3), the pages inherit from
the same parent"). The Hub overlay does not hand-author presentation (§3.7), so a split pages
base is unnecessary. If a tenant's base chain requires a split (BASE:2 pattern), it becomes a
second value of the same HITL setting — the emitter logic is unchanged.

### 1.2 Override vs. net-new (the core rule)

Guide §2.3, confirmed against SP3:964 / SP3:1743 (overrides reaching two levels up the chain)
and SP3:1452 (net-new, no `override` attribute):

- **OVERRIDE:** the node restates an `id` that exists anywhere in the base chain → it MUST
  carry `override="1"`. Observed override-bearing node types in SP3: `public 51, private 39,
  object 7, documentSet 2, modelCollection 1, table 1` (guide §2.3); node-index confirms
  `supports_override: true` for `object`, `public`, `private`, `table`, `documentSet`, `page`,
  `modelCollection`.
- **NET-NEW:** a fresh `id` not present in any base → MUST NOT carry `override`.
- **Abstract scaffolding:** to nest a concrete node at the right tree position, the overlay
  re-declares the abstract ancestor path (`abstract="1"` objects — 219 of 547 SP3 objects,
  guide §2.4, e.g. the `LineCoverages`/`ManuScriptCoverage` scaffolds at SP3:1738-1740). Such
  re-declarations are themselves overrides of the scaffold.
- **Do NOT flatten:** the overlay contains only deltas plus the re-declared abstract
  scaffolding (guide §2.3, closing rule).

**Open Question 2 of the guide (partial-vs-full replacement on override) remains unresolved
from the corpus.** P3 MUST adopt the conservative binding: **an override restates the node
COMPLETELY** (all children the composed result must have), because full restatement is correct
under both merge and replace semantics, while partial restatement is correct only under merge.
This is the single decision in this spec most likely to matter if an import fails (§7 self-review).

### 1.3 OVERLAY-DELTA LINT (normative)

Inputs: the emitted overlay; the base-id set **B** = all `id`s harvested from the configured
base-chain files (for the reference chain in this repo: [`BaseProduct.xml`](BaseProduct.xml),
[`Carrier_SampleProductBase.xml`](Carrier_SampleProductBase.xml),
[`Carrier_SampleProductBase3.xml`](Carrier_SampleProductBase3.xml); in production the tenant
uploads or names its base chain — HITL row 1); the TableConfig manifest **T** (Config sheet
column A/F pairs); the CoverageConfig field set **C** (InputFields!E column, the generated
field ids).

Every element in the overlay must satisfy exactly one clause, else **FAIL**:

1. `id ∈ B` and the node carries `override="1"` → legal override.
2. `id ∉ B` and no `override` attribute → legal net-new; additionally the id MUST appear in
   the `export-manifest.json` id map (traceable to a Hub refId or to a spec-defined synthetic
   role, e.g. a roll-up private) — an untraceable net-new id is a fabrication, **FAIL**.
3. `abstract="1"` restatement whose subtree contains at least one node passing (1) or (2) →
   legal scaffolding; an abstract node with no such descendant is dead scaffolding, **FAIL**.
4. Structural containers with no id (`definition`, `rules`, `value`, `documents`, `merge`,
   `keys`, …) are judged by their nearest id-bearing ancestor.

Additional rules:

- **R-flatten:** a node passing (1) whose serialized form is byte-identical to the base
  node → **WARN** `pointless-restatement` (flattening detector; a full flatten produces
  thousands of these — treat >5% of B restated-identical as **FAIL**).
- **R-rates (the inline-rate tripwire, §3.6):** any `<table tableType="local">` containing
  `<data>` whose `id` case-insensitively matches a TableConfig manifest TableName /
  PascalCase(TableName) in **T** → **FAIL** `rate-table-inlined`.
- **R-override-attr:** `override` with any value other than `"1"` → **FAIL** (only
  `override="1"` is observed — guide §2.3).
- **R-idref:** every `idref`/`tableRef@value`/`fieldRef@value`/`keyRef@name` must resolve in
  the composed namespace (overlay ∪ B ∪ C ∪ table ids/columns derived from T) → else **FAIL**
  `dangling-reference` (wiring relationships enumerated in guide §4).

The lint runs in the gate (offline, no engine needed) — it is the export-side analogue of the
import brain's plan-integrity checks.

---

## 2. Identity and provenance (refId is load-bearing)

- **DC id grammar:** dotted `Object.Field` ids (guide §4: `AccountInput.Name`,
  `ManuScriptCoverageOutput.Premium`). The Express-generated input fields follow
  `<PascalCaseCoverageName>Input.<PascalCaseFieldName>` — observed for all 12 rows of
  CoverageConfig·InputFields!E (e.g. `LiabilityCoverageInput.BIPDLimitPackage` row 2,
  `CollisionCoverageInput.CollisionDeductible` row 10). The exporter MUST use the same
  derivation so overlay wiring lands on the ids Unity generates.
- **Sanitization rule:** PascalCase = strip every character outside `[A-Za-z0-9]` after
  title-casing words; observed proof: "Medical Payments Limit (any one person)" →
  `MedicalPaymentsLimitanyoneperson` (InputFields!E5 — note the parenthetical collapses with
  its original casing, i.e. strip-then-concatenate, NOT re-title-case inside parentheses).
- **Hub refId preservation:** Hub refIds (`PA.COV.001` — CoverageConfig·Coverage!A2) do NOT
  fit the DC id grammar. They ride in: (a) the CoverageConfig `RequirementID` column
  (Coverage!A — already the workbook contract), (b) `comment="<refId>"` on emitted `public`/
  `private`/`table` nodes (node-index: those three carry a `comment` attribute; `object` does
  not — for objects the refId lives only in the manifest), and (c) `export-manifest.json`
  `ids: { "<dcId>": "<hubRefId>" }` covering **every** net-new id. The manifest is what makes
  the two-way proof (§6) able to score identity fidelity; it is not optional.

---

## 3. CANONICAL → NODE MAP

Hub canonical model (per [`product_first_principles.md`](../../../product_first_principles.md)
§2 PCM hierarchy, §12 machine summary): Product → LOB → Coverage(parentId tree, terms) with
Rules, Forms, RatingProgram(ordered steps), LD/RT tables.

### 3.1 Product → `properties` + `keys`

| Hub source | DC target | Cite |
|---|---|---|
| product refId + version | `properties@manuscriptID` / `@versionID` = `<Tenant>_<RefIdSafe>_<v>` e.g. `Hub_PA_PROD_001_1_0_0_0`; `@version="1"`; `@versionDate=<export date>` | SP3:2; node-index:properties attrs |
| product name | `properties@caption` | SP3:2 |
| per-LOB tenant setting | `properties@inherited` (bare id — §1.1) | SP3:2 |
| — | `properties@cultureCode="en-US"` `@cultureName="United States [english]"` | Carrier_SampleProductBase.xml:2 |
| engine flags | `boolean="1" fieldCache="1" shortCircuitCond="1"` — **copy the base's observed values verbatim** (GUESSED; guide Open Q5) | Carrier_SampleProductBase3.xml:2 |
| LOB registry entry | `keyInfo name="lob"` (e.g. `PersonalAuto`); `keyInfo name="family"` (HITL row 3); `state`; `version`; `effectiveDateNew/Renewal` (HITL row 4); `masterID="None"`; `productCode="Data"` | SP3:16-27 shape; guide §3.9 observed name set |

`productCode="Data"`: the overlay is a model-layer manuscript — presentation is generated by
Express from CoverageConfig (§3.7), matching the `Data`-vs-`Pages` split documented at guide
§2.2 (`productCode` labels: `Data, Pages, ViewModel, Forms, Tax, Admin`).
`writtenConfig`, `contexts`, `mapping` (policy-index slots): **omit — inherit from base**
(Carrier_SampleProductBase3.xml:15-26 shows the base already carries `writtenConfig`; emitting
it unchanged would trip R-flatten).

### 3.2 Coverage / Sub-Coverage → CoverageConfig rows (+ overlay scaffolding only where wiring demands)

Coverages ride the **CoverageConfig workbook**, not hand-built XML:

| CoverageConfig·Coverage column | Meaning | Grounding |
|---|---|---|
| `RequirementID` (A) | Hub coverage refId (`PA.COV.001`, sub `PA.COV.001.001`) | Coverage!A2-A13 |
| `CoverageName` (B) | display name | |
| `Path` (D) | the object's data path **with predicate** — `coverage[Type="Liability Coverage"]` — the exact `object@path` predicate shape of SP3:1739 (`coverage[Type=&quot;ManuScriptCoverage&quot;]`) | Coverage!D2; guide §3.1 object |
| `CoverageType` (E) | `LineCoverages` (parent) / `SubCoverage` (child) — mapping onto the SP3 `LineCoverages`/`ManuScriptCoverage` abstract scaffolds (SP3:1738-1740) | Coverage!E2 vs E3 |
| `SubCoverages` (G) | semicolon-joined child names — the parentId tree flattened | Coverage!G2 |
| `State` (H) | comma state list = Hub `states`/`allStates` attachment | Coverage!H2 |

Hub mapping: coverage with `parentId == null` → `LineCoverages` row; coverage with a parent →
`SubCoverage` row listed in the parent's `SubCoverages` cell. Hub CoverageTerm (limit /
deductible) → **InputFields rows** (§3.3). Election of optional coverages → a Dropdown
input defaulting `false` (InputFields!row 9 `Physicaldamagecoverageelected` is the observed
pattern).

The **overlay** re-declares coverage objects ONLY when it must nest net-new logic under them
(§1.2 clause 3) — e.g. the premium-output public per coverage (§3.5). It then re-declares the
abstract path exactly as SP3 does for `LineCoverages` (SP3:1738-1740) and the concrete object
with `path` copied byte-identically from the CoverageConfig `Path` column.

### 3.3 Coverage terms (limits/deductibles) → InputFields rows

One row per input term (InputFields!A-P): `CoverageID` (coverage name), `PageSet=MainInterview`,
`PageID` (coverage name), `FieldName`, `FieldID` (derived — §2), `FieldCaption`,
`PublicOrPrivate=Public`, `ValueType=Constant`, `ControlType` (`Dropdown` when the Hub term
has an enumerated value list, `Textbox` otherwise — observed split rows 2 vs 3),
`FieldDefault` (the Hub term's default value, e.g. `100/300/100` row 2, `500` row 10),
`GroupType=Input`. Hub CoverageTerm value lists (the limit/deductible option sets) are
**MAPPED** — they exist in canonical `coverage.terms[].values`; P3 emits them into the
workbook (`FieldDefault` holds the default; the full option list is a CoverageConfig
limitation — see HITL row 10 for where full option sets go).

### 3.4 LD/RT tables → TableConfig sheets (NEVER the overlay — §3.6)

Per-table contract (all cites TableConfig):

- **Config sheet (last sheet, manifest):** one row per table —
  `TableName | EffectiveDate | EffectiveDateRenewal | IsVersion | ManuscriptID | SheetName | State Applicable`
  (Config!A1:G1; 21 data rows observed). `SheetName` = PascalCase(TableName) truncated to
  Excel's 31-char limit, suffixed `_<ordinal>` (`TerritoryBaseRate_1`, …,
  `TowingandLaborRate_21`; truncation observed: `ProtectionClassConstructionFact`,
  `ScheduledPersonalPropertyClassR` — Config!F3, F8).
- **TOC sheet (first):** human index `Manuscript ID | Table Name | Complexity | State Applicable | Comment`
  starting row 2 col D (TOC!row 2).
- **Each table sheet:** rows 1-3 blank; row 4 `MS Physical Path: <full path to base .xml>`;
  row 5 `Manuscript ID: <file-name form>`; row 6 `Comments:`; row 7
  `<Table Name> — Table Type: Rating Table`; **row 8 = header row**; rows 9+ = data
  (TerritoryBaseRate_1!rows 4-13).
- **Header/axis rule:** columns 1..n-1 are lookup keys **in order**, column n is the single
  result value (`territory | rate` = 1 key; `subTable | key | factor` = 2 keys —
  TerritoryBaseRate_1!row 8, DeductibleFactors_4!row 8). The workbook format has **no colKeys
  channel**: 2-D tables MUST be unpivoted to `(key1, key2, value)` rows (DeductibleFactors_4
  rows 9-15 is the observed unpivoted form). The header strings are **authoritative and
  case-sensitive** — Unity generates `rowKeys@name` / `field@name` from them, and the
  overlay's `keyRef@name` / `fieldRef@value` must byte-match (§3.5).

This resolves the ManuScript side deterministically: each TableConfig row materializes (on the
DC side, via the Unity transform) as `<table id="<PascalCase(TableName)>" tableType="local">`
with `fields/field@name=<value header>`, `rowKeys@name=<key header>` (+`find="eq"`), `key`
rows and `data/row` values — the exact grammar of SP3:5336-5354 (node-index:table children
`rowKeys, fields, data, colKeys`; node-index:rowKeys attrs `name, type, find`).

### 3.5 RatingProgram (ordered steps) → overlay compute chain

The ONLY rating content in the overlay is **wiring**:

- One net-new `private` per rating step, named `<CoverageObject>Private.Step<NN>_<StepName>`
  (grammar per §2), `type="float"`, with `<value>` holding the step's producer:
  - factor-table step → `<lookup><tableRef value="<PascalCase(TableName)>"/><fieldRef value="<value header>"/><keyRef idref="<driver FieldID>" type="<t>" name="<key header>"/></lookup>`
    — the SP3:1449-1453 shape; node-index:lookup children `keyRef, tableRef, fieldRef, manuscriptName`.
    `keyRef@idref` points at the CoverageConfig-generated input id (set **C**) or a prior step's
    private; `keyRef@name` byte-matches TableConfig header (§3.4).
  - arithmetic step → `<calculation>` with ordered `argument@op` (`eq` seeds, then
    `add/sub/mul/div` — SP3:1750-1753; node-index caveat: `argument` requires `op`).
  - conditional step → `if/condition/comparison/operand` (SP3:1008-1015).
- Ordering: ManuScript compute is **dependency-driven, not sequence-driven** — the ROC order
  is preserved by making step N+1's expression reference step N's private id. P3 MUST emit the
  chain so each step consumes its predecessor; a step that references nothing earlier breaks
  the ROC guarantee (lint R-idref catches dangling refs, and the two-way proof scores step
  count/order via the manifest).
- Per-coverage premium: net-new `public` `<CoverageObject>Output.Premium` (`path` required —
  node-index:public attrs; 656/656 publics carry path, guide §3.2) with `rules/value`
  referencing the final step private; `<worksheet><caption value="<step name>"/></worksheet>`
  on each step private for rating-worksheet output (SP3:1454-1456).
- Roll-up: a `sum` iterator over the coverage object into the line/product total —
  `<iterator type="float" scope="all" action="sum" includeDeleted="1" idref="<CoverageObject>">`
  (SP3:2288-2290; node-index:iterator attrs `type, scope, action, idref, includeDeleted`).
  The grand total lands on the field named by the base's `model@defaultValue`
  (`data.TotalPurePremiumWritten` — Carrier_SampleProductBase3.xml:28): the overlay overrides
  that field's rules ONLY if the base's roll-up does not already sum line premiums (HITL row 12
  confirms per-base).

### 3.6 The Unity-vs-inline rate boundary (unambiguous, testable)

**Rates ride Unity. The overlay never contains a rating table body.**

- MUST NOT: emit `<table>` with `<data>` for any factor/rate table (they live in TableConfig).
- MUST: emit the consuming `lookup` wiring (§3.5) whose `tableRef@value` names the table id
  that Unity will generate — `PascalCase(TableName)` from TableConfig·Config!A.
- Narrow exception: non-rating utility tables (the SP3 `CultureCaptions` class, SP3:6472-6491)
  MAY inline as `tableType="local"` — but none is required by the Hub model today, so P3
  should treat any inline table as a spec change, and lint rule **R-rates (§1.3) FAILS the
  build** if an inlined local table's id collides with the TableConfig manifest. "Could P3
  accidentally inline a rate table?" — only by simultaneously (a) writing a `<table>` emitter
  that this spec never asks for and (b) naming it identically to a manifest row; (b) is
  mechanically caught.
- Delivery: the two artifacts are inseparable — the export bundle (§0 paragraph of truth) is
  one atomic unit; the overlay's lookups are dangling until Unity lands the workbook into the
  SAME base manuscript both artifacts name (§1.1). The bundle manifest records
  `tables: [{tableName, sheetName, keyColumns[], valueColumn, dcTableId}]` so the lint and the
  two-way proof share one source of truth.

**This resolves guide Open Question 1** ("the interim Excel rating-table format — files absent,
'MS Physical Path' appears nowhere"): the updated `PA_PROD_001_TableConfig (1).xlsx` in this
repo IS that missing format, and its observed binding is the row-4/row-5 preamble
(`MS Physical Path:` / `Manuscript ID:`) + the Config-sheet manifest mapping
TableName→SheetName→ManuscriptID (§3.4). Recommended binding for P3: **trust the Config-sheet
manifest as primary** (it is complete and machine-shaped) and emit the per-sheet preamble for
the Unity tool's benefit, byte-shaped as observed.

### 3.7 Presentation — Express-generated, not exported

The interview/pages layer is generated by Duck Creek Express from CoverageConfig
(`Config!C8 Widget=Coverages`, `Config!C9 ExpressVersion=2`; InputFields `PageSet/PageID/
ControlType/GroupType` columns are page placement instructions). The overlay therefore emits
**no `topics`, no `modelCollections`** — which also sidesteps guide Open Question 6 / conflict
C1 (the authoring XSD does not admit `modelCollections`; emitting none keeps the overlay valid
under BOTH the stale authoring XSD and the runtime grammar). If a tenant's Express version
cannot generate a needed control, that page is hand-authored on the DC side — out of scope,
recorded as HITL row 9.

### 3.8 Forms → `documents/documentSet`

Per Hub Form (number, edition, category, requirement, attachment):

```
<documents>
  <documentSet name="<FormNumber_Edition>" printDefault="<see below>" condition="<showRef private — GUESSED stub>">
    <scope name="Line" increment="1" startIter="1" endIter="*" />
    <document><subdoc name="<HITL: physical template>" path="<HITL>" /></document>
    <merge>
      <mergeField name="<placeholder>" idref="<model field>" iter="1" formatValue="" />
    </merge>
  </documentSet>
</documents>
```

Grammar: SP3:11078-11089; node-index:documentSet attrs (`name, printDefault, prevPage,
condition, inherited, override, …`), node-index:mergeField attrs (`name, idref, iter,
formatValue, …`). Mapping decisions:

- `printDefault`: Hub requirement `MANDATORY` → `Mandatory`; `OPTIONAL` → `Selected`;
  `UNKNOWN` → HITL (never fabricate — the F14 lesson binds the exporter too: an egress
  surface must not re-fabricate what the model abstained from).
- `condition`: the attachment condition compiles to a net-new boolean private
  `FormsPrivate.Show_<FormId>` whose `<value>` tests the referenced coverage's election field
  when the Hub attachment says "when coverage X is selected"; free-text conditions →
  **GUESSED stub returning `1`** + manifest HITL row (first-principles §5.2: attachment
  conditions reference the presence of attributes, so the coverage-selected case is the only
  mechanical one).
- `subdoc@name/@path`: the Hub has form numbers/editions, **not physical .doc templates** —
  always HITL (row 6). Stub: `name="<FormNumber>.doc" path=""` marked GUESSED.
- `mergeField`: no canonical source for template placeholders (row 7). Stub the two
  universally-observed fields (`AccountName`, `PolicyNumber` — SP3:11084-11085) marked
  GUESSED; real merge maps are supplied at HITL time.

### 3.9 Rules (governed pillar) → honest, non-fabricating mapping

Product rules are first-class in the Hub (first-principles §4) but ManuScript has **no
free-standing rule node** — governance lives inside field `definition`/`rules`/`options`
(guide §3.2-3.3). Binding:

| Hub rule shape | DC target | Status |
|---|---|---|
| Limit/Deductible ranges & defaults (Rule 4.3 rows "Limit Ranges", "Deductible Ranges") | the term input's `definition/options/option` list + `option@default` (node-index:option attrs `value, caption, validRef, default`), or `rules/minimum|maximum` clamps (guide §3.3 default/minimum/maximum) | MAPPED |
| Default/mandatory coverage (Base Coverage, Mandatory Inclusion) | election input `FieldDefault` in InputFields (§3.3) + `definition/required` | MAPPED |
| Min/additional/return premium | `rules/minimum` with `message` on the premium output (guide §3.3) | MAPPED |
| Eligibility / availability / packaging / bundling (free text conditions) | **NOT compiled to logic.** Emitted as `notes`/`annotations` text on the overlay + manifest HITL rows. Fabricating executable `comparison` trees from free text violates the grounded-AI invariant | HITL |

### 3.10 Node-map summary table

| Hub canonical | Artifact | DC node (required attrs — node-index) | Example |
|---|---|---|---|
| Product | overlay | `properties` (`manuscriptID, inherited, caption, …`) + `keys/keyInfo` (`name, value`) | SP3:2, SP3:16-27 |
| LOB | overlay+workbook | `keyInfo name="lob"`; CoverageConfig Config!B2 | |
| Coverage (parent) | CoverageConfig | Coverage row, `CoverageType=LineCoverages`; overlay re-declared scaffold `object` (`id`; `path` w/ predicate) only when nesting logic | Coverage!row 2; SP3:1738-1740 |
| Sub-coverage | CoverageConfig | Coverage row `CoverageType=SubCoverage` + parent's `SubCoverages` cell | Coverage!rows 3-4 |
| CoverageTerm (limit/ded) | CoverageConfig | InputFields row → Express generates `public` (`id, path, type` req) + `definition/caption/options` | InputFields!rows 2-13 |
| LD/RT table | TableConfig | sheet + Config manifest row → Unity generates `table` (`id, tableType`) `fields/rowKeys/key/data/row` | §3.4 |
| RatingStep | overlay | net-new `private` (`id, type`) with `value/lookup|calculation|if`; `worksheet/caption` | SP3:1449-1456 |
| Premium output | overlay | net-new `public` (`id, path, type`) + `rules/value`; iterator roll-up | SP3:2288-2290 |
| Form | overlay | `documentSet` (`name, printDefault`) / `scope` / `document/subdoc` (`name, path`) / `merge/mergeField` (`name, idref`) | SP3:11078-11089 |
| Rule | overlay/workbook | §3.9 table | |
| refId (everything) | manifest | `export-manifest.json` ids map + `comment` attr | §2 |

---

## 4. Emission mechanics

1. **ASCII only** (guide preamble: "ASCII only"). Escape XML entities; `&quot;` inside path
   predicates as observed at SP3:1739.
2. **Ordering inside `rules`:** children are order-significant per XSD —
   `dependencies, forceRerate, default, minimum, maximum, nonRating, value, misc, affects`
   (guide §3.3 rules).
3. **`value` XOR `idref`** on value-or-reference leaves (`operand, argument, case, otherwise,
   tableRef, fieldRef, keyRef, default, then, else, caption` — guide §3 preamble); never both.
4. **`type` is required** on `operand`, `keyRef`, `argument`-with-idref (node-index attrs;
   guide §3.3).
5. **Indentation/shape:** two-space indent, attributes in the observed order of the exemplar
   node (stable serialization → diffable exports; the golden tests pin byte shape).
6. **File naming:** `<manuscriptID>.xml`.
7. **Localization:** default `multiLanguages` ABSENT → no resx sidecars, en-US strings inline
   only. When a tenant declares cultures (HITL row 11): emit `properties@multiLanguages="1"`,
   keyInfo `cultures`, and one `.resx` per culture seeded with en-US text under the
   deterministic key grammar (`Page.<name>.Caption`, `<fieldId>.Caption`, `<fieldId>.Value`
   with `resourceString="1"`, `<fieldId>.Options.<optionValue>` — guide §6, proven at
   SP3:33→`Page.Account.Caption` and SP3:4508-4510→`AccountPage.Caption.Value`).

---

## 5. COMPLETENESS & HITL INVENTORY (the missing-info list)

Everything a valid overlay needs that the Hub canonical model cannot derive. Convention:
**MAPPED** = canonical source exists (exporter fills it); **GUESSED** = stubbed by the stated
default rule, marked in-XML (`<!-- HITL:GUESSED … -->`) AND in `export-manifest.json
hitl[]`; the export UI presents this list as the human checklist before delivery.

| # | Field | DC target (cite) | Canonical source | Default rule when absent |
|---|---|---|---|---|
| 1 | Base manuscript id (+ physical path, pages base if split) | `properties@inherited` (SP3:2); workbook ManuscriptID cols; `MS Physical Path` row 4 | tenant per-LOB setting once configured → MAPPED | **no default — export blocks.** The one field that cannot be guessed |
| 2 | Manuscript version block | `properties@versionID/@version/@versionDate` | product version → MAPPED | `1_0_0_0` / export date |
| 3 | `family` routing key | `keyInfo name="family"` (SP3:17 shape) | none | GUESSED: tenant name PascalCase |
| 4 | Effective dates | `keyInfo effectiveDateNew/effectiveDateRenewal` (SP3:21-22 shape); TableConfig Config!B/C (observed **blank** — legal) | product effectiveDate if set → MAPPED | GUESSED: export date; workbook cells left blank as observed |
| 5 | State routing policy (one overlay vs per-state) | `keyInfo name="state"`; workbook `State Applicable` columns | Hub states list → MAPPED into workbook columns (Coverage!H, Config!G) | single overlay, `state` keyInfo = HITL choice; default `US` |
| 6 | Forms physical templates | `subdoc@name/@path` (SP3:11081) | **none** — Hub stores numbers/editions | GUESSED: `<FormNumber>.doc`, empty path |
| 7 | mergeField placeholder maps | `mergeField@name/@idref` (SP3:11084) | none | GUESSED: AccountName/PolicyNumber pair only |
| 8 | Tax binding | separate Tax-productCode manuscript; product→tax wiring **not shown in the corpus** (guide §10.4) | none | omit entirely; HITL note "tax manuscript wiring is a DC-side task" |
| 9 | Hand-authored pages (when Express can't render a control) | `topics/page` or `modelCollections/viewModel` + physical `Views/*.xhtml` (guide §3.6) | none — deliberately not emitted (§3.7) | none; flagged per-control |
| 10 | Full option sets exceeding CoverageConfig cells | `definition/options/option` in the overlay override of the generated input | Hub term value lists → MAPPED (overlay emits options when list > default-only) | n/a — this row exists because CoverageConfig carries only `FieldDefault` |
| 11 | Cultures / multiCurrency | `properties@multiLanguages/@multiCurrency`, keyInfo `cultures/currencyCodes` (SP3:25 area); per-field currency binding **uncharacterized** (guide §10.4) | none | GUESSED: absent (en-US, single currency) |
| 12 | Base roll-up behavior (does base sum line premiums into `model@defaultValue`?) | `model@defaultValue` (Carrier_SampleProductBase3.xml:28) | none — needs base inspection | GUESSED: emit own roll-up; lint R-flatten warns if redundant |
| 13 | `class` vocabularies (`class/fldClass/capClass`) | free-string attrs (guide Open Q4) | none | never emitted |
| 14 | Properties engine flags | `boolean/fieldCache/shortCircuitCond/compiled` (guide Open Q5) | none | GUESSED: copy base values byte-for-byte |
| 15 | `dataSchema` | `properties@dataSchema` (blank on Carrier bases; `CommercialLinesSchema.xml` on FORMS:2) | none | GUESSED: `""` (blank, as the PA base has) |
| 16 | Express widget/version | CoverageConfig Config!C8/C9 (`Coverages` / `2`) | none | GUESSED: `Coverages` / `2` as observed |
| 17 | Rule free-text compilation | §3.9 last row | none | never compiled — text rides annotations + HITL |

---

## 6. VALIDATION

Ladder, cheapest first — L0-L4 run in the repo gate; L5 is the wave's live check.

- **L0 — well-formed:** XML parses; ASCII-only byte scan.
- **L1 — grammar conformance:** every element name exists in the node index; its parent is in
  the element's observed `parents`; required attributes present (`public` → id/path/type;
  `table` → id/tableType; `keyRef` → name/type; …). Unknown element = FAIL (the exporter
  controls its own vocabulary — emitting outside the observed 240 is always a bug even though
  the index is an observed union, not a closed grammar).
- **L2 — overlay-delta lint** (§1.3) incl. R-rates, R-idref.
- **L3 — cross-artifact coherence:** every `tableRef` resolves to a TableConfig manifest row;
  every `keyRef@name` byte-matches that sheet's header row 8; every `keyRef@idref` resolves in
  C ∪ overlay privates; workbook `ManuscriptID` cells all equal the file-name form of
  `properties@inherited`.
- **L4 — XSD, confirm-only:** validate against `ManuScriptSchema.xsd` **only as a warning
  channel**. The authoring XSD is stale (guide §9 conflicts): C1 `ManuScript` content model
  omits `modelCollections`/`schemaMaps`; C2 `field` is overloaded; C3 ViewModel elements are
  runtime-schema-only. Real XML wins; an XSD complaint on those three shapes is expected noise
  (and §3.7 means we usually emit none of them). Any OTHER XSD complaint is investigated, not
  suppressed.
- **L5 — TWO-WAY PROOF:** re-import the emitted bundle through the Hub import brain and score
  fidelity against the source product: coverage tree F1, term coverage, table
  count/keys/values exact-match, form inventory, rating-step count and reference-chain order
  (via manifest ids). Gate thresholds mirror the import eval's discipline
  (`scripts/import-eval.mts` metrics — extras 0, linkage 1.0 offline). Two sub-paths:
  - **Workbooks (works day one):** CoverageConfig/TableConfig are ordinary XLSX — the existing
    workbook import path ingests them today (stage0-router ZIP/workbook branch,
    `server/lib/import-brain/stage0-router.js:145-152`).
  - **Overlay XML (needs the §6.1 plug):** until it lands, L5 scores the workbook half only —
    stated honestly in the gate output, never silently.
  - **Negative control:** `docs/reference/DuckCreekXML.xml` is a runtime transcript, NOT a
    golden, NOT an import fixture; it plays no role in L5.

### 6.1 TWO-WAY PLUG (XML in, as well as out)

Assessment of the import brain's middle layer: the seam is **already format-shaped for this**.
`unifiedImport` takes raw base64 docs; stage-0 sniffs containers by magic bytes and routes
ZIP-workbooks to a deterministic structural reader + the AI path, TEXT to the text path
(`stage0-router.js:143-214`); the deterministic mapper (`mapIsoWorkbook`,
`shared/src/insurance/isoImport.ts`) produces canonical entities that stage-7 joins by
identity. An Author XML overlay is a TEXT/XML container with an unambiguous fingerprint: root
element `<ManuScript>` (SP3:1).

**Smallest change that makes ingestion a two-way plug (P3 builds):**

1. In stage-0's TEXT branch, detect `<ManuScript` root → classify
   `detectedFormat: 'manuscript-xml'` (one sniff clause; no new container type).
2. A deterministic `mapManuscriptOverlay()` (sibling of `mapIsoWorkbook`) covering **exactly
   the subset this spec emits**: `properties/keys` → product identity; re-declared coverage
   `object`s + CoverageConfig conventions → coverages; `lookup` wiring → rating-step skeletons
   + table references; `documentSet` → forms; `comment` attrs + bundled
   `export-manifest.json` (when present) → refId restoration. Emits the same canonical shape
   the ISO join consumes — zero changes downstream of stage-0.
3. Round-trip closure test: export seeded `PA.PROD.001` → re-import → identity-join F1 = 1.0
   on coverages/forms/tables (this is L5's XML half).

**P3 defers (recorded, not built):** general ManuScript semantics — arbitrary `calculation`/
`iterator` logic recovery into human-readable step descriptions, `viewModel` presentation
import, resx culture merge, cross-manuscript `external` references (guide §4 last bullet).
Foreign (non-Hub-emitted) overlays will land as products with cited-but-opaque logic blobs —
honest PARTIAL, same philosophy as the filing path's `unprocessed-document` items.

---

## 7. Self-review (hostile, targeted at P3's failure modes)

1. **Least-sure decision:** §1.2's conservative full-restatement rule for overrides (guide
   Open Q2 is genuinely unresolved). Recommended binding: full restatement + R-flatten warning.
   If a DC engine import ever shows merge semantics, relax toward partial restatement — the
   lint is already shaped to allow that change without touching the node map.
2. **If the emitted overlay fails to import, look first at:** §1.1 base binding (a wrong or
   version-skewed `inherited` id makes every override claim false) — then §1.2 (override
   restatement depth), then L3 coherence (keyRef@name vs workbook header case).
3. **Unity-vs-inline ambiguity:** none remaining — §3.6 gives MUST/MUST-NOT plus the
   mechanical R-rates tripwire; the only inline-table path is one this spec never instructs
   P3 to write.
4. **Honest gaps:** tax wiring (HITL 8), physical templates (HITL 6/7), per-state manuscript
   splitting (HITL 5), and engine-side import (L6 — not runnable from this repo) are OPEN by
   design, surfaced as HITL, never silently defaulted into correctness claims.
