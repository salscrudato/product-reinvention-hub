# Canonical PDM → Duck Creek mapping

This document describes how a product in this repo is projected into a neutral **Product
Data Model (PDM)** and then serialized into **Duck Creek-shaped manuscript XML**. It is
deliberately honest about what is faithful, what is an approximation, and what is
proprietary and therefore unknowable from the material we have.

## Pipeline

```
domain seed (Coverage/Form/Rule/RatingProgram/RTTable/LDTable)
      │  shared/src/pdm/build.ts        (deterministic projection)
      ▼
PDM   (shared/src/pdm/types.ts)         neutral · lossless · vendor-agnostic
      │  shared/src/duckcreek/serialize.ts   (mapping-driven, deterministic)
      ▼
Duck Creek-shaped manuscript XML
      │  shared/src/duckcreek/validate.ts     (well-formed + structural + round-trip)
      ▼
ValidationReport (pass/fail + per-section counts + dropped nodes)
```

Everything above lives in `shared/` and is **platform-free**: no Firebase, no AI, no
`crypto`, no clocks, no randomness. The serializer is a pure function — the same PDM
produces byte-identical XML on every run and on every platform (browser, Cloud Functions,
Vitest).

## ⚠️ The instance-vs-manuscript-definition caveat (read this first)

The golden reference we studied (`DuckCreekXML.xml`) is an **instance** document — a
serialized `OnlineData.loadPolicyRs` quote (one Florida homeowners risk, its selected
limits, its computed premium). It is **not** a Duck Creek *manuscript definition*.

> **Not committed.** That reference file is a real exported quote containing
> instance-level PII (names, addresses, dates of birth, license numbers). Per the
> "no giant XML snapshots" guardrail *and* basic data hygiene it is **kept out of the
> repo**; the vocabulary it taught us is captured entirely in `mapping.ts` and this doc.

The true manuscript-**definition** schema (the authoring artifact that declares a product's
coverages, valid-value lists, rating worksheets and inference rules) is **proprietary to
Duck Creek and versioned per carrier**. We do not have it and do not guess at its exact
tag set.

Consequently this exporter emits a manuscript-**shaped** document: it **reuses the
vocabulary observed in the instance sample** (element and attribute names, the `dctSys`
namespace, GUID `id` conventions, the manuScriptID pattern) to describe product
*definition* content. Where the definition needs a construct the instance sample has no tag
for (e.g. a limit's full valid-value list), we add a clearly-named **extension** and call
it out below.

Because every Duck Creek name is **configuration, not code** (see
`shared/src/duckcreek/mapping.ts`), pointing this at a real carrier's manuscript schema is
a mapping edit, not a rewrite.

## Vocabulary mirrored from the sample

Observed in `DuckCreekXML.xml` and reproduced by the serializer:

- **Namespace** `dctSys` = `http://www.duckcreektech.com/dctSys` (declared on the root; the
  sample uses it explicitly on `dctSys:condTrack`).
- **GUID `id` attributes with a type-prefix letter** — the sample's convention is
  *first letter of the element/type name*: `c`overage, `l`imit, `S`tatCode, `i`ndicator,
  `o`ptions, `e`xposure, `p`eril, `d`eductible, … We derive the GUID **deterministically**
  from the node's refId (see *Determinism* below) rather than minting a random one.
- **Coverage node** — `id`, `t` (a term/type key like `CoverageD`), `ind`, `e` (effective
  date), a `Caption` child, `limit`/`deductible` children, a `StatCode` child, and the
  `Premium` / `written` / `onset` / `offset` / `change` quintet.
- **Options** — `<options t=… cid=… isvalid=… Ismandatory=… Isselected=… caption=…>`, with
  `cid` linking the option to its coverage.
- **Forms** — `Form`, `FormNumber`, `FormsManuScriptID`, `UseDCTForms`,
  `UseDCTFormsAndMessages`.
- **manuScriptID pattern** — `Carrier_LOB_Market_Layer_Country_major_minor_build_rev`, e.g.
  `PCG_HO_Admitted_ViewModel_US_1_0_0_0`. Composed in `mapping.ts` from configurable parts.

## Field-by-field mapping (canonical → Duck Creek)

| Canonical (PDM) | Duck Creek element | Notes |
|---|---|---|
| product | `product` (+ `policyAdmin` footer) | `t` = compact line name (`PersonalHome`); carries `refId`. |
| line | `line` / `Type` | `description`/`Type` = compact line name; wraps a single `risk`. |
| coverage | `coverage` (`id`, `t`, `ind`, `refId`) | `t` = PascalCase key (`CoverageA`); `ind` = mandatory flag. |
| sub-coverage | nested `coverage` | nested by `parentRefId` under its parent coverage. |
| limit | `limit` typed field (`t`, `id`, `default`, `structure`, `basis`) | value list as `validValues`; see extensions. |
| deductible | `deductible` typed field | same shape as `limit`. |
| eligible value | `validValues > value` (`label`, `default`, `enabled`, `allStates`) | **extension** — the sample instance shows only the selected value. |
| option / flag | `options` (`cid` → coverage, `t`, `caption`, `Isselected`…) | electable endorsement / coded selection. |
| form + edition | `form` > `Form`/`FormNumber`/`editions`/`FormsManuScriptID` | each edition carries its state/effective attachment. |
| dynamic field | `dynamicFields > field` (+ `FieldOption`) | data type + repeating flag preserved. |
| rating program | `rating > program` | `minimumPremium` attribute; ordered `step` children. |
| rating step | `step` (`op`, `sourceType`, `tableRef`, `keys`, `const`, `condition`, `roundTo`) | one element per executable step, in `order`. |
| rating table | `factorTables > table` (`columns`, `dimensions`, `rows > row > cell`) | grid `dimensions` emitted when the table is grid-modellable; raw rows always preserved. |
| eligibility / coverage / rating rule | `rules > rule` (`ruleType`, `if`, `then > action`) | IF = condition, THEN = outcome(s). |
| form-attach rule | `rule` with `ruleType="FORM_ATTACH"` | keyed on state (+ effective date when supplied) via the `states` block; `mandatory` preserved. |
| per-state variation | `states > State` (+ `e`/effective on the block) | `allStates="1"` collapses to an empty `states` element. |
| **refId** | `refId` attribute on **every** node | **extension** — the load-bearing id kept verbatim, distinct from the GUID `id`. |

## Extensions (honestly flagged, not present in the instance sample)

- **`refId` attribute on every node.** The sample instance has GUID `id`s but no product
  refIds (it is quote data). refIds and form-number chips are load-bearing here, so they
  are preserved as an explicit attribute and are the anchor the round-trip validator uses.
- **`validValues` / `value` lists.** A definition must express *which* limits/deductibles a
  coverage offers; the instance only records the *selected* one. We emit the resolved
  option matrix (`shared/src/insurance/terms.ts::resolveTermOptions`), each value with its
  default/enabled/state applicability.
- **`Premium`/`written`/`onset`/`offset`/`change` = `0`.** A definition has no computed
  premium; the quintet is emitted as structural zeros to mirror the sample's coverage shape
  without fabricating amounts.
- **`StatCode` emitted empty (`<StatCode id=… />`).** Several sample coverages already show
  an empty StatCode; we never invent ISO stat codes we do not have.
- **Effective date (`e`) is opt-in.** The seed carries no policy dates, so `e` is emitted
  **only** when a caller passes `effectiveDate` to `buildPdm(...)` — we do not fabricate a
  date to make the output look more "instance-like".

## What we do NOT claim

- We do **not** claim this is a byte-compatible Duck Creek manuscript-definition file. The
  real definition schema is proprietary; this is a faithful *shape* built from the instance
  vocabulary plus the flagged extensions.
- We do **not** reproduce ISO statistical codes, territory/credit rating internals, or the
  exact worksheet element schema — none of which are recoverable from an instance sample.
- The Personal Auto LOB token (`PA`) is a **placeholder**: the sample only covers
  Homeowners (`HO`). Swap it in `mapping.ts::manuscript.lobTokens` for the carrier's real
  auto token.

## id conventions (deterministic, diffable)

- Each id = `<prefix letter><32 uppercase hex>` (a Duck Creek-width GUID body).
- The body is a 128-bit FNV-1a hash of `"<nodeType>|<refId>"`
  (`shared/src/duckcreek/guid.ts`). Deterministic ⇒ two runs are byte-identical; scoped by
  refId ⇒ changing one node's refId changes only that node's id (diff-friendly).
- The validator asserts global id uniqueness and that every id carries the correct
  type-prefix letter.

## Using it

```ts
import {
  buildPersonalHomePdm, serializePdmToDuckCreek, validateDuckCreek, summarizeReport,
} from '@pf/shared'

const pdm    = buildPersonalHomePdm()                 // or buildPersonalAutoPdm()
const xml    = serializePdmToDuckCreek(pdm)            // deterministic
const report = validateDuckCreek(pdm, xml)            // well-formed + structural + round-trip
console.log(summarizeReport(report))                  // [PASS] … coverages=10/10 …
```

To retarget the vocabulary, pass a `mapping`:

```ts
import { DEFAULT_DUCKCREEK_MAPPING } from '@pf/shared'
const mapping = structuredClone(DEFAULT_DUCKCREEK_MAPPING)
mapping.manuscript.lobTokens.PA = 'AUTO'              // e.g. a carrier's real auto token
serializePdmToDuckCreek(pdm, { mapping })
```

## Validation contract

`validateDuckCreek(pdm, xml)` returns a `ValidationReport`:

- `wellFormed` — the emitted XML re-parses under the strict parser.
- `namespaceDeclared` — the `dctSys` namespace is declared on the root.
- `idPrefixesValid` — every id carries its node type's prefix letter; no duplicate ids.
- `crossRefsValid` — every `options.cid` points at a real coverage id.
- `roundTripOk` + `counts` — parsing the XML back recovers the **same** coverage / limit /
  deductible / option / form / rating-program / step / table / rule set and refIds as the
  source PDM. `missingRefIds` lists anything dropped; `extraRefIds` anything invented.

Tests: `shared/src/pdm/build.test.ts`, `shared/src/duckcreek/{guid,xml,serialize,validate}.test.ts`.
They assert structure + counts (not giant XML snapshots) and cover projection completeness,
serializer determinism, refId/form-number preservation, and a clean validation report for
both Personal Home and Personal Auto.
