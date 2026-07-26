# Why eval2 numericFidelity is 0.000 — the cell-level verdict

- Date: 2026-07-26 · Branch `main` at `7b1fd1d` · Harness `scripts/import-eval2.mts --offline`
- Question: is the 0.000 a canonicalization mismatch in the harness, or genuine data loss?
- **Answer: both, and the split is measurable. The exact 0.000 is a harness artifact; the ~0.03
  hiding underneath it is real. Fixing the harness join alone moves fidelity from 0.000 to 0.034 —
  it does not go green, and it must not be allowed to look like progress.**

Every number below is reproduced from the goldens plus `mapIsoWorkbook` over the same source
workbooks the board scores, using the harness's own `buildNumericClaims` and
`goldenNumericFidelity` logic. Total claims 1218 — byte-identical to the board's
`numeric.checked` sum (146+1+132+110+11+681+7+130), so this is the same population the board
scores, not a re-derivation.

## 1. What a "numeric claim" actually is

[scripts/import-eval2.mts:278-287](scripts/import-eval2.mts#L278-L287) builds one claim per golden
cell that is `disposition: ATTR` **and** carries an `ofEntity`, whose source value canonicalizes to
a bare number. The claim is then scored by
[scripts/lib/import-eval2-metrics.mts:123-137](scripts/lib/import-eval2-metrics.mts#L123-L137):

```ts
const byRef = new Map<string, EvalEntity2>()
for (const e of extracted) if (e.refId) byRef.set(e.refId.trim().toLowerCase(), e)   // refId ONLY
...
const e = byRef.get(cl.entityRef.trim().toLowerCase())
```

The join is keyed on `refId` **only**. But the contract for `ofEntity` at
[scripts/lib/golden2-schema.mts:62](scripts/lib/golden2-schema.mts#L62) is:

```ts
ofEntity: string | null           // refId (or name) of the entity this cell belongs to
```

The harness implements the `refId` half of its own contract and silently drops the `(or name)`
half. That is defect **H** below. It is not the whole story.

## 2. The classification, all 1218 claims

| class | claims | % | what it means | whose defect |
|---|---:|---:|---|---|
| **F1** value nowhere in the plan | 296 | 24.3% | the entity resolved, the value is absent from the whole plan | **pipeline** |
| **F3** entity and value both absent | 61 | 5.0% | neither survived | **pipeline** |
| **H2** named entity exists, value absent | 20 | 1.6% | binding fine, value lost | **pipeline** |
| **F2** value landed on a *different* entity | 99 | 8.1% | duplicate representation, data on the wrong record | **pipeline** |
| **R1** value + binding survive in an opaque region blob | 330 | 27.1% | bytes conserved inside `sourceValues[]`, no governed term | **pipeline (structural)** |
| **R2** value survives, binding lost | 12 | 1.0% | as R1 without the name | **pipeline (structural)** |
| **H1** would match if the harness keyed by name | 42 | 3.4% | value **is** on the correctly-named entity | **harness** |
| **J** golden binding is not a source entity | 358 | 29.4% | `ofEntity` names nothing the golden itself declares | **golden annotation** |

Roll-up: **genuine value loss 377 (31.0%)** · **structural loss, bytes conserved 441 (36.2%)** ·
**harness join defect 42 (3.4%)** · **unscoreable golden bindings 358 (29.4%)**.

`MATCH-by-refId` is **0**. Not one claim in the whole corpus resolves by refId *and* finds its
value. That is why the board prints exactly 0.000 rather than a small non-zero number: the only
claims that could have matched are name-keyed, and the harness cannot resolve a name.

Raw data: `docs/audit/numeric-forensics.json`, `docs/audit/claim-refine.json`.

## 3. Per-claim cell evidence

Source value read from the workbook cell; golden value is the same cell (golden2 stores the
*binding*, not a copy of the value — see §5); extracted value read from `mapIsoWorkbook`'s record.

### 3.1 The edition-date column — genuine loss, 296 claims

The single largest real defect. `EDITION DATE` is a first-class column in every framework
workbook and it is never extracted.

**(1) `Product_Framework_General_Liability_2026_Example` · `GL Product Framework!I6`**
- header `I5` = `"EDITION DATE"` · source `I6` = `"04 13"` · row: `H6="CG 00 01"  I6="04 13"`
- golden: `ATTR`, `ofEntity="CG 00 01"`
- extracted `forms/CG 00 01`:
  `{"refId":"CG 00 01","name":"CG 00 01","conservation":"form-token","citation":"GL Product Framework!H6","formNumber":"CG 00 01"}`
- **no edition field of any kind.** Value present nowhere in the plan (`elsewhereInPlan=0`).
- verdict: **genuine loss.** The form number survived byte-for-byte; its edition did not. `CG 00 01`
  and `CG 00 01 04 13` are different filings.

**(2) same file · `GL Product Framework!I7`** — source `"04 13"`, golden binds it to
`ofEntity="GLCOV001.02"`. Extracted `coverages/GLCOV001.02` = `{... "formNumbers":["CG 00 01"],
"terms":[] ...}`. No edition. `elsewhereInPlan=0`. **Genuine loss.**
(Note the golden binds the *same column* to a form on row 6 and to a coverage on row 7 — an
annotation inconsistency that does not change the verdict, because the value is absent either way.)

**(3) `Product_Framework_General_Liability` · `GL Product Framework!I8`** — source `"01 15"`,
`ofEntity="GL.COV.001"`. Extracted `coverages/GL.COV.001` = `{... "formNumbers":["CG 21 70","CG 21
87"], "terms":[] ...}`. No edition. **Genuine loss.** The row states two forms and one edition.

**(4) `Product_Framework_SECURA_Property` · `Product Component Model!H441`** — source `"1012"`,
`ofEntity="CP 10 36"`. Extracted `forms/CP 10 36` = `{"refId":"CP 10 36","name":"CP 10 36",
"conservation":"form-token","citation":"Product Component Model!G441","formNumber":"CP 10 36"}`.
No edition. **Genuine loss.**

**(5) `Product_Framework_All_Lines_Master` · `Product Component Model!I9`** — source `"10 12"`,
`ofEntity="PR.COV001.0"`. Extracted `coverages/PR.COV001.0` = `{"name":"Building",
"formNumbers":["CP 00 10"], "terms":[] ...}`. No edition. **Genuine loss.**

Column fill rate confirms the scale: `GL Product Framework!I` is populated on **110 of 110** data
rows. This is a whole populated column dropped, on every framework workbook, and no other gate on
the board sees it.

### 3.2 The harness join defect — 42 claims, with a positive control

**(6) `CO_EnthusiastPlus_Config_Template_Final` · `Default Limits!B9`**
- source `B9` = `1000` · row: `A9="Other Than Collision Deductible"  B9=1000`
- golden: `ATTR`, `ofEntity="Other Than Collision Deductible"` — a **name**, not a refId
- extracted `ldTables/PH.SYNTH.TBL.002`:
  `{"refId":"PH.SYNTH.TBL.002","name":"Other Than Collision Deductible","citation":"Default Limits!A9",
  "sourceValues":["Other Than Collision Deductible","1000","Collision Deductible","1000","Minimum Premium","125"]}`
- the value **is on the entity** (`sourceValues[1]="1000"`), on the entity with **exactly** the
  golden's name.
- verdict: **harness defect, scored 0 in error.** `byRef.get("other than collision deductible")`
  misses because the record's refId is the minted `PH.SYNTH.TBL.002`.

This is the positive control for §1: the join, not the pipeline, produced this zero.

### 3.3 Structural loss — bytes conserved, governed term never created — 441 claims

**(7) `CO_EnthusiastPlus_Config_Template_Final` · `Default Limits!B3`** — source `100`, row
`A3="Liability PD"  B3=100`, header above `B2="100/300"`. `ofEntity="Liability PD"` resolves to
**nothing** in the plan by refId or name. The value survives inside a region blob. The named term
"Liability PD = 100" was never created. **Structural loss.**

**(8) `CO_RV125_Rating_Config_Template` · `Program Version!E3`** — source `125`, row
`D3="Version Number"  E3=125  G3="Program"  H3="Standard Auto Program"`. `ofEntity="Standard Auto
Program"` resolves to nothing; the value appears on 25 other records. **Structural loss** — this
file contributes 314 of the 330 R1 claims.

**(9) `Product_Component_Model_Coverages` · `PIP States!C2`** — header `C1="Minimum coverage
requirement"`, row `A2="Arkansas"  B2="No"  C2=5000`. `ofEntity="Arkansas"`. The plan models states
as an attribute array (`allStates:true, states:[]`), never as entities, so the
state→minimum-limit binding is lost while `5000` survives elsewhere. **Structural loss**, and a
modelling disagreement worth settling: the golden treats a state row as an entity, the pipeline
does not.

**(10) `Product_Framework_SECURA_Property` · `Property Forms Usage!F3`** — golden binds to
`ofEntity="CP 0090 0788"`, and a record with that exact refId **does** exist — but the value lives
on a *second*, differently-keyed record: `forms/PR.SYNTH.FORM.002` whose `name` is
`"CP 0090 0788"`. The plan emits the same form twice: a token-only stub keyed by the real form
number, and a region-blob record keyed by a synthetic id that actually holds the data. All 99 F2
claims are this one duplication pattern. **Pipeline defect** — and one that will also inflate any
count-based floor.

### 3.4 Unscoreable golden binding — 358 claims

**(11) `Product_Framework_Client_Master` · `Product Inventory!E7`** — header `E6="POLICY COUNT
(Approximate)"`, row `A7=1  D7="0MM"  E7=0`. Golden binds it to `ofEntity="1"` — the row-number
cell in column A. `"1"` is not an entity in the golden's own entity list. This claim can never be
scored by anything. 329 of the 358 are in `CO_RV125_Rating_Config_Template`.

## 4. What this means for the board

1. **Do not "fix" numericFidelity by fixing the join.** It would move 0.000 → 0.034 and change
   nothing real. Any future claim that a fix improved fidelity must state which of the classes
   above it moved.
2. **The gate is currently measuring three different things at once** — pipeline loss, harness
   keying, and golden annotation quality — and reporting them as one number. Until the J class
   (29.4%) is re-annotated and the H class (3.4%) is joined correctly, `numericFidelity` cannot
   discriminate a regression from an annotation artifact. It is a **detector**, not yet a
   **meter**.
3. **The edition-date loss (§3.1) is the one unambiguous, immediately actionable pipeline defect**
   in this population: a fully populated source column, present on every framework workbook,
   extracted nowhere. It is also the highest-value one — `refIds and form-number chips are
   load-bearing and byte-for-byte` (CLAUDE.md), and an edition date is half of a form's identity.
4. **The duplicate form representation (§3.3 item 10)** is the second: the same form emitted as
   both a token stub and a synthetic region record, with the data on the synthetic one.

None of these were visible on any passing gate before this run.

## 5. A harness observation that is NOT the cause

`canonicalizeNumeric` ([scripts/lib/golden2-schema.mts:185-193](scripts/lib/golden2-schema.mts#L185-L193))
strips whitespace before testing for a number, so the edition date `"04 13"` becomes the integer
`413` and is admitted as a *numeric* claim. That is a modelling artifact — an edition date is not a
quantity — and it should be excluded from the numeric population. **It is not the cause of the
zero**: the transform is applied to both sides, so a pipeline that carried `"04 13"` would still
match. Verified: `elsewhereInPlan=0` for every one of these claims — the value is genuinely absent,
not mismatched. Recording it here so the next reader does not chase it.

Likewise, golden2 stores a cell's *disposition and binding*, never a copy of its value
([scripts/lib/golden2-schema.mts:58-64](scripts/lib/golden2-schema.mts#L58-L64)); the harness reads
the value from the workbook at scoring time. So "source value" and "golden value" are the same
bytes by construction, and the only thing the golden asserts is **which entity owns the cell**.
That is precisely what classes H and J are about.
