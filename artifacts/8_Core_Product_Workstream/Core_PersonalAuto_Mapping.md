# Core Personal Auto — Manuscript Build & Mapping

Deliverables at repository root:

| File | What it is |
|---|---|
| `SampleProduct_Reproduced/` | Verbatim copy of the full Duck Creek sample product manuscript set: `DCT_SampleProduct.xml` (1.0.0.0), `DCT_SampleProduct_3_0_0_0.xml`, `DCT_SampleProduct_Validation_1_0_0.xml`, all `.resx` resources, **plus** the inherited base manuscripts from `ManuScripts/DCTSampleProducts/Base/CarrierAdmin/` (product base, workflow, workflow data/VM, communications). |
| `Core_PersonalAuto_1_0_0_0.xml` | New product manuscript: the sample product's full author-XML structure integrated with `Product_Specifications_Core_07_13_2026.xlsx`. |
| `Core_PersonalAuto_Mapping.md` | This document. |

## What the Excel spec actually defines

Despite the working name "core property product", the workbook specifies a **collector-vehicle Personal Auto** product ("Core", Hagerty-style): product hierarchy `CORE.PRD.001 → CORE.LOB.001 (Personal Auto) → CORE.COV.001–019`, with rules, forms, rating algorithms, and state applicability. The manuscript was built to that spec.

## How the two sources were integrated

`Core_PersonalAuto_1_0_0_0.xml` is a transform of `DCT_SampleProduct_3_0_0_0.xml`:

- **Kept**: the entire product infrastructure — inheritance (`Carrier_SampleProductBase_3_0_0_0`), written-premium config, Account/Location/Risk model, billing/estimation/forms/import integration objects, documents, schemaMaps, mapping, premium roll-up chain, all viewModels/pages.
- **Removed**: the five placeholder sample coverages (`Coverage_LineA/LineB/RiskA/RiskB/InsurableAmount`) and every reference to them (model, calculations, viewModels, mergeFields, print scopes, schemaGroups), plus the sample `LimitFactor` table.
- **Renamed**: manuscript identity to `Core_PersonalAuto_1_0_0_0`; keys `family=Core, lob=PersonalAuto, state=US, version=1.0.0.0, effective 2026-10-01, currency USD`.
- **Added**: everything below.

## Coverage mapping (Excel → manuscript objects)

Policy-level coverages (under `LineCoverages`); vehicle-level (under `RiskCoverages`, zeroed when the risk is deleted). Each is a `Coverage_X` object with `Input` (Limit/Deductible pick-lists), `Output` (Premium, PremiumChange, PremiumWritten via shared written config, Indicator, AS LOB stat code), `Private` (BaseRate, factor lookups, FrameworkID traceability), and one sub-object per Excel sub-coverage (93 total, each with Indicator + FrameworkID).

| Framework ID | Coverage | Object | Level | Rating shape | Options implemented |
|---|---|---|---|---|---|
| CORE.COV.001 (+11 subs) | Bodily Injury Liability | `Coverage_BI` | Policy | BaseRate × LimitFactor × Discounts × Term | Splits 25/50 … 500/1000, default 100/300 |
| CORE.COV.002 (+1) | Motorcycle Passenger Liability | `Coverage_MPL` | Policy | same | = BI splits (rule: MPL limit = BI limit) |
| CORE.COV.003 (+9) | Property Damage Liability | `Coverage_PD` | Policy | same | 15k–500k, default 100k |
| CORE.COV.004 (+3) | Medical Payments | `Coverage_MedPay` | Policy | same | 1k–500k, default 100k |
| CORE.COV.005 / 007 | UM-BI / UIM-BI | `Coverage_UMBI` / `Coverage_UIMBI` | Policy | same | BI splits (limit ≤ Liability per rules) |
| CORE.COV.006 / 008 | UM-PD / UIM-PD | `Coverage_UMPD` / `Coverage_UIMPD` | Policy | + DeductibleFactor | $7,500 limit; deductible {200, 250} |
| CORE.COV.009 (+23) | Collision | `Coverage_Collision` | Vehicle | BaseRate × (GuaranteedValue/100) × DedFactor × Discounts × Term | Ded ladder 0–100,000 |
| CORE.COV.010 (+24) | Other Than Collision | `Coverage_OTC` | Vehicle | same | Ded ladder 0–100,000; Indicator default ON (mandatory per rules) |
| CORE.COV.011 | Evacuation Expense | `Coverage_EvacuationExpense` | Vehicle | flat | — |
| CORE.COV.012 (+3) | Spare Parts or Tools (AC 501) | `Coverage_SparePartsTools` | Policy | BaseRate × (Limit/100) × DedFactor | Ladder 1,500–250,000; ded {0–1,000} |
| CORE.COV.013 (+9) | Collectible Personal Property (AC 500) | `Coverage_CollectiblePersonalProperty` | Policy | same | same ladders |
| CORE.COV.014 | Towing & Storage | `Coverage_TowingStorage` | Policy | **unrated** (no algorithm in spec) | — |
| CORE.COV.015 (+10) | Personal Injury Protection | `Coverage_PIP` | Policy | flat | — |
| CORE.COV.016 / 017 / 018 | Auto Death / Total Disability / Income Loss | `Coverage_AutoDeathBenefit` / `Coverage_TotalDisability` / `Coverage_IncomeLoss` | Policy | flat | — |
| CORE.COV.019 | Property Protection (MI) | `Coverage_PropertyProtection` | Vehicle | flat | — |

Additional model objects:
- **`VehicleInput`** (under `Risk`): GuaranteedValue, ModelYear, Make, Model, VehicleType (eligibility classes from rules [6]–[19]: Antique, Classic, Exotic/Special Interest, EV Conversion, Highly Modified, Hot Rod/Street Rod, Restomod/Tuner, Camper Trailer, Collector Motorcycle, Motorsports, Pro-Street), BodyStyle, LienholderExists.
- **`CoreDiscounts`** (under `Line`): Paid-In-Full, Mass Marketing (Hagerty Drivers Club), Portfolio Transfer, Prior Specialty Carrier booleans → combined `DiscountFactor` multiplied into every rated premium.
- **Tables**: one `<X>LimitFactor` / `<X>DeductibleFactor` table per rateable dimension, plus `CoverageStateApplicability` holding the full 51-jurisdiction availability grid for all 112 framework IDs (states pipe-delimited).
- **Roll-ups rewired**: `RiskPurePremiums.*` sums the 4 vehicle coverages; `LinePurePremiums.*` sums risk totals + 15 policy-level coverages; totals flow unchanged into `PolicyPremiums` → `data.TotalPremiumWritten`.
- **UI**: `RiskRoster` viewModel edits all coverage indicators/limits/deductibles, vehicle fields, and discounts; `Coverage` viewModel shows all premiums.

## Known gaps (flagged in the manuscript's `<annotations>`)

1. **No numeric rates**: the workbook's Rate Reference column is empty and its Rate Tables tab is a blank template — every `BaseRate` (100) and factor-table value (1.00) is a placeholder to be loaded from the rate filings.
2. The full per-vehicle **class-factor chain** (model year × modification × program tier × insurance score × territory × symbol × ~40 more factors per the rating spec) is documented in the spec but not wired; the manuscript implements the structural skeleton (base rate × limit/deductible factors × discounts × term).
3. **Towing & Storage** and **UIM-PD** have no rating algorithm in the spec (UIM-PD rows are literal placeholders); modeled unrated / mirroring UM-PD.
4. State limit/deductible reference tables exist in the workbook only for AZ, CO, GA, MO, OH, WI, TN, IN, NE; the canonical (superset) option lists were used.
5. Policy fees/assessments (theft authority fees, MCCA, etc.), payment plans, and the 234 underwriting/form rules are catalogued in the spec but only the coverage-structural rules (mandatory flags, limit ladders, mutual-exclusivity defaults) are reflected; the rest are implementation backlog.
