# Product Reinvention Hub — Document Library

This folder is a **document library, not a code repository**. It holds curated P&C insurance product artifacts (Excel workbooks, filing PDFs, specs, build packs) that feed, test, tune, or export from the Product Reinvention Hub application — a system that converts semi-structured insurance documents into a canonical Product Component Model (PCM): `Product → LOB → Coverage → Sub-Coverage`, with three pillars (**Rules / Forms / Rating**), state scoping, and `refId` traceability.

**Start with [README.md](README.md)** — it is the authoritative file-by-file catalog (purpose, app usage, and "needed?" verdict for every file), plus a duplicate/integrity audit. This CLAUDE.md is the quick orientation layer on top of it.

## Quick navigation — "where do I find X?"

| I need... | Go to |
|---|---|
| Coverage hierarchy / framework workbooks (import inputs) | `1_Product_Frameworks/` |
| Forms, Rules, or Rating specification workbooks (the three pillars) | `2_Product_Specifications/` |
| State filing PDFs for AI-extraction testing (CGL, Homeowners, Personal Auto — all WA) | `3_Filing_Packets/` |
| Hagerty Enthusiast+ public-filing research packet | `3_Filing_Packets/Hagerty_Enthusiast_Plus_Public_Filing_Packet_2026-07-15/` (self-documented — has its own README + MANIFEST) |
| PAS config templates & BRDs (export target shapes, Duck Creek style) | `4_Configs_and_Requirements/` |
| App build/feature specs for coding agents (HTML) | `5_Build_Packs/` — `final-build-pack-v6.html` is current |
| Methodology, platform review, reverse-engineering notes, services inventory | `6_Documentation/` |
| Import test/tuning samples (incl. non-seeded LOBs: Inland Marine, Property) | `7_Reference_Samples/Import_Test_Samples/` |
| The end-to-end "Core" Personal Auto worked example (spec → canonical → Duck Creek XML) | `8_Core_Product_Workstream/` |
| Duplicates / superseded versions (safe to ignore) | `9_Archive/` |

## Key artifacts

- **`8_Core_Product_Workstream/Product_Specifications_Core_07_13_2026.xlsx`** — master Core spec workbook, source of truth for the whole Core chain. Its `_LINKED` sibling is the canonical extraction; `Core_PersonalAuto_1_0_0_0.xml` is the Duck Creek manuscript exported from it; `Core_PersonalAuto_Mapping.md` records the mapping and known gaps.
- **`1_Product_Frameworks/Product_Framework_All_Lines_Master.xlsm`** — gold-standard input shape for the import engine.
- For the **app codebase itself**, the canonical context is **`docs/reveng/`** (start at `EXEC_OVERVIEW.md`) plus root **`DATA_MODEL.md`** — verified against the current tree. The older `6_Documentation/REVERSE_ENGINEERING.md` / `Platform_Review.md` are kept for history but marked superseded.
- Hagerty pairs in `2_Product_Specifications/`: populated + `_Blank_Template` versions of Forms/Rating specs are intentional (instance + authoring template), not duplicates.

## Conventions and rules for working here

- **Naming standard:** `Underscore_Separated_Descriptive_Names` (no spaces, parentheses, or `&`). Filing documents follow `{LOB}_{State}_{DocType}_{FormNumber}_{Title}.pdf`. Follow this for any file you add.
- **Do not rename or restructure** the Hagerty E+ filing packet's contents — its own `MANIFEST.txt`/`README.md` reference its internal file names.
- **`9_Archive/` is quarantine**, not working material: exact duplicates (MD5-verified), a personal scratch copy, and superseded build packs (v1, v5). Never treat archived files as current.
- Most content is **binary (xlsx/xlsm/pdf/docx)** — use appropriate tooling (e.g., a script with openpyxl, or PDF page reads) rather than plain-text reads.
- When adding or removing files, **update README.md's catalog tables** so it stays the source of truth. (Note: README may drift — e.g., it lists a few files such as `import-flow.html`, `Platform_Review.pdf`, and `Rebuild_Master_Prompt_Draft.txt` that are not currently present; trust the filesystem over the catalog and reconcile when noticed.)

## Relationship to the app

Folders 1–3 and 7 are **import-side** (inputs and test corpora); folder 4 is **export-side** reference shapes; folder 8 proves the **full round trip** (import → canonical model → PAS manuscript export); folders 5–6 are instructions and context for building the app, not insurance data. The canonical entity mapping (which folder produces which `Product`/`Form`/`Rule`/`RatingProgram`/`RTTable` entities) is tabled at the bottom of README.md.
