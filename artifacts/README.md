# Product Reinvention Hub — Document Library Catalog

Curated library of P&C insurance product artifacts that **feed, test, tune, or export from** the Product Reinvention Hub application — a system that converts semi-structured insurance spreadsheets and filing documents into a canonical Product Component Model (PCM): `Product → LOB → Coverage → Sub-Coverage`, with three pillars (**Rules / Forms / Rating**), state scoping, and `refId` traceability (see `DATA_MODEL.md` in the app repo).

**Organized:** 2026-07-15 · **Naming standard:** `Underscore_Separated_Descriptive_Names` (no spaces, parens, or `&`); filing documents follow `{LOB}_{State}_{DocType}_{FormNumber}_{Title}.pdf`.

---

## Folder Map

| Folder | Category | Role relative to the app |
|---|---|---|
| `1_Product_Frameworks/` | Product framework workbooks | **Import input** — coverage-hierarchy source (Product/Coverage/Terms) |
| `2_Product_Specifications/` | Forms / Rules / Rating spec workbooks | **Import input** — the three specification pillars |
| `3_Filing_Packets/` | State filing document sets (PDF) | **Import input** — filing-importer & AI-extraction test corpus |
| `4_Configs_and_Requirements/` | PAS config templates & BRDs | **Reference / export target shape** (Duck Creek-style configs) |
| `5_Build_Packs/` | HTML build/feature specs | **App development instructions** (not data) |
| `6_Documentation/` | Methodology, reviews, briefs | **Context** for humans & AI agents |
| `7_Reference_Samples/` | Policy & import test samples | **Test/tuning corpus** for extraction quality |
| `8_Core_Product_Workstream/` | "Core" Personal Auto end-to-end chain | **Spec → canonical extraction → PAS manuscript** worked example |
| `9_Archive/` | Duplicates, scratch, superseded versions | **Not needed** — retained for safety only |

---

## 1_Product_Frameworks — Coverage hierarchy sources

Framework workbooks define the PCM skeleton: products, coverages, sub-coverages, terms. These map to `Product`, `Coverage`, `CoverageTerm` in the canonical model.

| File | Purpose | App usage | Needed? |
|---|---|---|---|
| `Product_Framework_All_Lines_Master.xlsm` | Master multi-line product document (PCM, ROC, Forms Library, Rules Repository sheets) | Gold-standard input shape for the import engine; source for multi-LOB scaffolding | ✅ Yes — master template |
| `Product_Component_Model_Coverages.xlsx` | Standalone PCM coverage taxonomy | Reference taxonomy for coverage classification / concept-linking during import | ✅ Yes |
| `Product_Framework_Client_Master.xlsx` | Client-facing master framework template | Blank/master template for client engagements; import template shape | ✅ Yes |
| `Product_Framework_General_Liability.xlsx` | GL framework (matches app seed `GL.PROD.001` domain) | Primary GL import test file (identical copy was `sample-GL-framework.xlsx`, now archived) | ✅ Yes |
| `Product_Framework_General_Liability_2026_Example.xlsx` | Expanded 2026 GL worked example | Richer GL import fixture; regression case for larger frameworks | ✅ Yes |
| `Product_Framework_SECURA_Property.xlsx` | SECURA commercial property framework | Real-carrier variation test — validates import against non-template formatting | ✅ Yes |

## 2_Product_Specifications — The three pillars (Forms / Rules / Rating)

Map to `Form`, `Rule`/`FormRule`, `RatingProgram`/`RatingStep`, `LDTable`, `RTTable`.

| File | Purpose | App usage | Needed? |
|---|---|---|---|
| `Product_Forms_Library_General_Liability_2025_Example.xlsx` | Full GL forms library (large, 2025) | Bulk forms-import test; source for `Form` entities + dynamic fields | ✅ Yes |
| `Product_Forms_Specifications_Hagerty.xlsx` | Hagerty (collector auto) forms spec — populated | Client import input for Hagerty products | ✅ Yes |
| `Product_Forms_Specifications_Hagerty_Blank_Template.xlsx` | Same workbook, blank | Template for authoring/export round-trip (app → spec workbook) | ✅ Yes — template |
| `Product_Forms_Specifications_Template_FY26_Example.xlsx` | Current-generation forms spec template with example | Canonical forms spec template shape (FY26) | ✅ Yes |
| `Product_Rating_Specifications_General_Liability.xlsx` | GL rating algorithm + factor tables | Rating import test; maps to `RatingProgram`/`RTTable` (identical copy was `sample-GL-pricing.xlsx`, archived) | ✅ Yes |
| `Product_Rating_Specifications_Hagerty.xlsx` | Hagerty rating spec — populated | Client rating import input | ✅ Yes |
| `Product_Rating_Specifications_Hagerty_Blank_Template.xlsx` | Same, blank | Authoring/export template | ✅ Yes — template |
| `Product_Rules_Specifications_Hagerty.xlsx` | Hagerty product rules spec | Client rules import input (`Rule` entities) | ✅ Yes |
| `Product_Rules_Specifications_Template_FY25_Example.xlsx` | Rules spec template with worked example (large) | Canonical rules spec template shape (FY25 generation) | ✅ Yes |
| `Product_Rules_Classification_Index_Template_FY26_Example.xlsx` | Rules classification index (FY26) | Rule `subCategory` taxonomy source for import classification | ✅ Yes |
| `Product_Rules_Taxonomy_Sample.xlsx` | Compact rules taxonomy sample | Lightweight taxonomy reference / classifier tuning | ✅ Yes (small; overlaps Classification Index — candidate to merge) |

## 3_Filing_Packets — State filing corpora (PDF import tests)

Realistic filing packets exercising the AI document-import pipeline: forms → `Form`, rate manuals → `RTTable`/`RatingProgram`, rule manuals → `Rule`. Each packet = one product/state filing.

### CGL_WA_Product_Filing — Commercial GL, Washington (ASCC Western Trade-Craft program)
24 files: 20 endorsement/exclusion forms (`ASC 60 xx` series), 4 coverage endorsements (`ASC 70 xx`), declarations (`ASC-DS-01`), ISO forms adoption list, expense-adjusted base rates (Rate), GL rules + program guidelines (Rule). **Usage:** end-to-end CGL filing import test — forms extraction, ISO adoption cross-referencing, rate/rule manual parsing. **Needed:** ✅ Yes — primary commercial-lines PDF corpus.

### Homeowners_WA_Product_Filing — Homeowners (HO9), Washington
23 files: WA HO9 base contract, 20 endorsements (HO/PM series with edition dates `08 20`), WA rate manual v1.0 (Rate), WA rule manual v1.0 (Rule). **Usage:** personal-property filing import test; complements the app's HO-3 seed (`PH.PROD.001`) with a real HO9 program. **Needed:** ✅ Yes.

### PersonalAuto_WA_Product_Filing — Personal Auto, Washington
3 files: WA auto contract (01 26), rate manual v2.11, rule manual v2.5. **Usage:** compact personal-auto filing import test; pairs with seed `PA.PROD.001`. **Needed:** ✅ Yes.

### Hagerty_Enthusiast_Plus_Public_Filing_Packet_2026-07-15 — E+ public-filing research packet
Self-documented research packet (has its own `README.md` + `MANIFEST.txt`): SERFF link list, state status workbook/CSV, document inventory, retrieval checklist, source manifest, candidate filing manifest, forms cross-check (`forms_crosscheck/`), public records request letters (CO, WI), Hagerty 2025 10-K (`corporate_evidence/`), marketing one-pager (`reference_nonfiling/`), research findings & limitations notes. **Usage:** provenance/grounding evidence for the Hagerty E+ two-product (Core vs E+) workstream; inputs to filing-gap analysis, not direct import data. **Needed:** ✅ Yes — keep intact as a packet (internally consistent, do not rename contents).

## 4_Configs_and_Requirements — PAS config shapes & client requirements

Downstream/parallel system shapes — useful as **export targets** and requirement sources, not canonical imports.

| File | Purpose | App usage | Needed? |
|---|---|---|---|
| `CO_EnthusiastPlus_Config_Template_Final.xlsx` | Colorado E+ PAS configuration template (limits, coverage rules, factors, fees, pay plans) | Reference for E+ vs Core delta analysis; potential export target shape | ✅ Yes |
| `CO_RV125_Rating_Config_Template.xlsm` | Colorado RV-125 rating config template (coverage/factor tabs per rating dimension) | Rating-table shape reference for collector-vehicle programs | ✅ Yes |
| `OH_EnthusiastPlus_BRD.xlsx` | Ohio E+ business requirements document (forms, UI, factors, STP rules, fees) | Requirements source for E+ state rollout; rule/factor extraction candidate | ✅ Yes |
| `PA_PROD_001_CoverageConfig.xlsx` | Coverage config keyed to app seed `PA.PROD.001` (Coverage/Config/InputFields sheets) | App-shaped config fixture — likely round-trip/export test against seed Personal Auto | ✅ Yes |
| `PA_PROD_001_TableConfig.xlsx` | Rate-table config for `PA.PROD.001` (territory base rates, factor tables 1–19) | RT-table import/export fixture matching the seed rating program | ✅ Yes |

## 5_Build_Packs — App feature/build specifications (HTML)

Development instructions consumed by coding agents, not insurance data.

| File | Purpose | Needed? |
|---|---|---|
| `final-build-pack-v6.html` | Latest master build pack (v6) | ✅ Yes — current |
| `design-hardening-build-pack-v2.html` | Design-hardening scope (v2) | ✅ Yes (distinct scope) |
| `import-hardening-build-pack.html` | Import-pipeline hardening scope | ✅ Yes (distinct scope) |
| `import-flow.html` | Import flow design/spec | ✅ Yes (distinct scope) |
| *(v1, v5 of final-build-pack)* | Superseded by v6 | ❌ Moved to `9_Archive/Superseded_Build_Packs/` |

## 6_Documentation — Methodology, reviews, briefs

| File | Purpose | App usage | Needed? |
|---|---|---|---|
| `AI_Native_Import_Engine_for_PC_Product_Documents.docx` | Design doc for the AI-native import engine | Architecture reference for the ingestion pipeline | ✅ Yes |
| `Platform_Review.md` | Platform review (canonical markdown) | AI-readable platform assessment | ✅ Yes |
| `Platform_Review.pdf` | Same review, rendered PDF | Human distribution copy of the `.md` (format duplicate, not content-unique) | ⚠️ Optional — keep only if shared externally |
| `REVERSE_ENGINEERING.md` | Reverse-engineering notes on the application | Context for agents working on the codebase | ✅ Yes |
| `SERVICES.md` | Services/API inventory | Context for integration work | ✅ Yes |
| `Hagerty_Presentation_Brief.md` | Presentation content spec (Kurt's framing: five pillars, Core vs E+ narrative) | Source for the Hagerty pitch/demo artifact | ✅ Yes |
| `Rebuild_Master_Prompt_Draft.txt` | Draft master prompt for the app rebuild (roles, objectives, TODOs) | Historical prompt-engineering input; largely executed | ⚠️ Marginal — archive candidate once rebuild completes |
| `Process_Value_Explorer_Report.xlsx` | Process/value analysis report (README + Report sheets) | Business-case backup for the Hub's value narrative | ✅ Yes |

## 7_Reference_Samples — Test & tuning corpus

| File | Purpose | App usage | Needed? |
|---|---|---|---|
| `Real_Policy_Sample.pdf` | Real issued policy document | Claims-analysis / policy-reading grounding sample; output-side reality check | ✅ Yes |
| `Import_Test_Samples/sample-GL-forms.xlsx` | GL forms spec sample (forms + dynamic data) | Forms-pillar import regression fixture | ✅ Yes |
| `Import_Test_Samples/sample-GL-rules.xlsx` | GL rules + limits/deductibles sample | Rules-pillar import regression fixture (incl. LD named ranges) | ✅ Yes |
| `Import_Test_Samples/sample-IM-framework.xlsx` | Inland Marine framework sample | Non-seeded-LOB framework import test (LOB registry archetype coverage) | ✅ Yes |
| `Import_Test_Samples/sample-IM-rules.xlsx` | Inland Marine rules + class codes sample | Non-seeded-LOB rules import test | ✅ Yes |
| `Import_Test_Samples/sample-PR-framework.xlsx` | Property framework sample (full PCM/ROC/forms/rules sheets) | Property-line import fixture | ✅ Yes |
| `Import_Test_Samples/sample-PR-rating.xlsx` | Property ROC + ISO tables sample | Rating-pillar import fixture with bureau tables | ✅ Yes |
| `Import_Test_Samples/sample-PH-baseform-HO3.pdf` | HO-3 base coverage form (`HO 00 03`) | Base-form upload for AI extraction grounding — matches seed `PH.PROD.001.baseForm` | ✅ Yes |

## 8_Core_Product_Workstream — "Core" Personal Auto end-to-end chain

The complete worked pipeline for the Hagerty-style **Core** collector-vehicle Personal Auto product (`CORE.PRD.001 → CORE.LOB.001 → CORE.COV.001–019`), demonstrating the app's full journey: **spec workbook → canonical extraction → PAS manuscript**.

| File | Purpose | App usage | Needed? |
|---|---|---|---|
| `Product_Specifications_Core_07_13_2026.xlsx` | Master Core spec workbook (framework, forms, rules, rating, 50-state tabs) — the **source of truth** input | Primary large-scale import input; the origin of the whole chain | ✅ Yes — critical |
| `Product_Specifications_Core_07_13_2026_LINKED.xlsx` | Canonical extraction of the master: ID Registry, Product Hierarchy, Coverage Terms, Forms, Rules, Reference Tables, Rating Algorithm, Rate Tables Needed, Gap Log | The workbook-shaped mirror of the app's canonical data model; validates spreadsheet → PCM mapping | ✅ Yes — critical |
| `CORE_PRD_001_Spec_Pack.xlsx` | Condensed app-shaped spec pack (Framework / Rules+L&D / Rating+RT / Forms+Dynamic) keyed to `CORE.PRD.001` | Compact import/export fixture for the Core product | ✅ Yes |
| `Core_PersonalAuto_1_0_0_0.xml` | Duck Creek product manuscript built from the Core spec (v1.0.0.0, effective 2026-10-01) | **Export-side proof**: canonical model → PAS manuscript; template for future exports | ✅ Yes |
| `Core_PersonalAuto_Mapping.md` | Mapping document: Excel spec → manuscript objects, coverage-by-coverage, plus known gaps (placeholder rates, unwired factor chains) | Traceability record for the export; the gap list is the backlog | ✅ Yes |

## 9_Archive — Not needed (retained for safety)

Nothing in this folder is required. Safe to delete after review.

| File | Why archived |
|---|---|
| `Exact_Duplicates/sample-GL-framework__DUP_of_Product_Framework_General_Liability.xlsx` | **Byte-identical** (MD5 `0e7bbe7c…`) to `1_Product_Frameworks/Product_Framework_General_Liability.xlsx` |
| `Exact_Duplicates/sample-GL-pricing__DUP_of_Product_Rating_Specifications_General_Liability.xlsx` | **Byte-identical** (MD5 `ad883da1…`) to `2_Product_Specifications/Product_Rating_Specifications_General_Liability.xlsx` |
| `Sal_Test_Scratch_Copy_of_Core_Specs.xlsx` | Personal scratch copy of `Product_Specifications_Core_07_13_2026.xlsx` (identical sheet structure, minor edits); not a governed artifact |
| `Superseded_Build_Packs/final-build-pack-v1.html` | Superseded by v6 |
| `Superseded_Build_Packs/final-build-pack-v5.html` | Superseded by v6 |

## Root

| File | Purpose | Needed? |
|---|---|---|
| `README.md` | This catalog | ✅ Yes |
| `Product Hub - Context.lnk` | Windows shortcut (user navigation convenience) | ⚠️ User convenience only; not part of the library |

---

## How this library maps to the canonical data model

| Library artifact type | Canonical entities produced/consumed |
|---|---|
| Framework workbooks (folder 1) | `Product`, `Coverage` (+ sub via `parentId`), `CoverageTerm` |
| Forms specs (folder 2) | `Form` (+ `DynamicField`), `FormRule` |
| Rules specs (folder 2) | `Rule` (PRODUCT/RATING/FORMS), `LDTable` refs |
| Rating specs (folder 2) | `RatingProgram`, `RatingStep`, `RTTable`, `LDTable` |
| Filing PDFs (folder 3) | AI extraction → all of the above + `refId` assignment; base forms → grounding |
| PAS configs/BRDs (folder 4) | Export target shapes; rule/factor requirement sources |
| Core workstream (folder 8) | Full round-trip: import (master xlsx) → canonical (LINKED xlsx) → export (Duck Creek XML) |

## Duplicate & integrity audit (2026-07-15)

- Every file MD5-hashed; **2 exact duplicates** found and quarantined to `9_Archive/Exact_Duplicates/`.
- **1 near-duplicate** (`Sal_Test.xlsx`) archived as scratch.
- `Platform_Review.pdf` is a **format duplicate** of `Platform_Review.md` (kept — distribution copy).
- Hagerty E+ filing packet left internally untouched: it is a self-manifested packet whose `MANIFEST.txt`/`README.md` reference its own file names.
- No other content overlaps detected; blank-vs-populated Hagerty spec pairs are intentional (template + instance).
