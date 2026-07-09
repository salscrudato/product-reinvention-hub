# DOMAIN_PA.md — Seed product: Personal Auto (ISO-style PAP, PP 00 01)

The app seeds exactly this dataset alongside Personal Home (HO-3). A representative
ISO-style Personal Auto Policy for demo purposes — **illustrative / generic content,
NOT proprietary bureau rates or form text**. `shared/src/seed/personalAuto.ts` encodes
it verbatim; `pnpm seed` writes it; `shared/src/rating/personalAuto.evaluator.test.ts`
asserts the worked example. Personal Auto proves the platform is line-agnostic — every
surface (Home / Products / Explorer / Pricing / Forms / Rules) renders it through the
same canonical model as Personal Home, with no Homeowners assumptions.

## Product
- **PA.PROD.001** — "Personal Auto Policy" · LOB PA.LOB.001 Personal Auto
- marketSegment: Personal Lines / Automobile · status ACTIVE · lifecycle LAUNCHED
- Footprint states (45): AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY ME MD MA MI
  MN MS MO MT NE NV NH NJ NM NC ND OH OR PA RI SC SD TN TX UT VT VA WA WV WI
- Peril model: **TERRITORY** (no coastal peril; rates by garaging territory T001–T005)
- Minimum premium: **$250** (single source `PA_MINIMUM_PREMIUM`; the declared field and
  the `s11` MIN_FLOOR step both read the one constant — D3: one mechanism) · program PA.RAT.1
- Claims basis: Occurrence (all coverages)

## Coverages — ISO PAP grouping (Parts A / B / C / D)

Sub-coverages nest under their Part via `parentId`; a Part cannot be priced without its
sub-coverages. Section grouping is driven by the LOB registry (`PA_SECTIONS`).

| refId | Name | Parent | Req | Terms |
|---|---|---|---|---|
| PA.COV.001 | Part A — Liability Coverage | — | Mandatory | OPTION BI/PD limit package (rating key, PA.RT.003; default 100/300/100) |
| PA.COV.001.001 | Bodily Injury Liability | PA.COV.001 | Mandatory | LIMIT per person/per accident per PA.LD.001 (default 100/300) |
| PA.COV.001.002 | Property Damage Liability | PA.COV.001 | Mandatory | LIMIT per occurrence per PA.LD.002 (default $100,000) |
| PA.COV.002 | Part B — Medical Payments Coverage | — | Optional | LIMIT any-one-person per PA.LD.003 (default $5,000) |
| PA.COV.003 | Part C — Uninsured Motorists Coverage | — | Optional | LIMIT per person/per accident per PA.LD.004 (default 100/300; ≤ BI limit) |
| PA.COV.003.001 | Uninsured Motorist Bodily Injury | PA.COV.003 | Mandatory | LIMIT matches Part C |
| PA.COV.003.002 | Underinsured Motorist Bodily Injury | PA.COV.003 | Mandatory | LIMIT matches Part C; may not exceed BI (PA.RU.007) |
| PA.COV.004 | Part D — Coverage for Damage to Your Auto | — | Optional | OPTION physical-damage elected flag |
| PA.COV.004.001 | Collision Coverage | PA.COV.004 | Optional | DEDUCTIBLE per occurrence per PA.LD.005 (default $500) |
| PA.COV.004.002 | Other Than Collision (Comprehensive) | PA.COV.004 | Optional | DEDUCTIBLE per occurrence per PA.LD.006 (default $250) |
| PA.COV.004.003 | Rental Reimbursement | PA.COV.004 | Optional | OPTION rental elected → PP 13 01 (requires Collision or Comp) |
| PA.COV.004.004 | Towing and Labor Costs | PA.COV.004 | Optional | OPTION towing elected → PP 03 28 (requires Collision or Comp) |

## Limits & Deductibles tables (LD)

- **PA.LD.001** Bodily Injury Liability Limits (per person/per accident): 25/50 · 50/100 ·
  **100/300 (default)** · 250/500
- **PA.LD.002** Property Damage Liability Limits: $25,000 · $50,000 · **$100,000 (default)** · $300,000
- **PA.LD.003** Medical Payments Limits: $1,000 · **$5,000 (default)** · $10,000 · $25,000
- **PA.LD.004** UM/UIM Bodily Injury Limits: 25/50 · 50/100 · **100/300 (default)** · 250/500
  (must match or be ≤ BI limit in most states)
- **PA.LD.005** Collision Deductible: $100 · $250 · **$500 (default)** · $1,000
- **PA.LD.006** Comprehensive (OTC) Deductible: $100 · **$250 (default)** · $500 · $1,000

## Rating tables (RT) — illustrative rates, not filed

- **PA.RT.001** Territory Base Rate: T001 350 · **T002 400** ← worked example · T003 465 · T004 510 · T005 590
- **PA.RT.002** Driver Class Factor: DC1 0.90 (preferred) · **DC2 1.00 (standard)** · DC3 1.20 (non-standard)
- **PA.RT.003** BI/PD Limit Factor: 25/50/25 0.85 · 50/100/50 0.93 · **100/300/100 1.00** · 250/500/250 1.14
- **PA.RT.004** Vehicle Age Factor: Economy 0.90 · **Standard 1.00** · Luxury 1.15
- **PA.RT.005** Medical Payments Rate by Territory (additive): T001 35 · **T002 42** · T003 49 · T004 55 · T005 63
- **PA.RT.006** UM/UIM Rate by Territory (additive): T001 50 · **T002 62** · T003 74 · T004 83 · T005 95
- **PA.RT.007** Collision Premium by symbol × deductible (additive): e.g. **sym12/$500 = 306** ← worked example
- **PA.RT.008** Comprehensive Premium by symbol × deductible (additive): e.g. **sym12/$250 = 154** ← worked example
- **PA.RT.009** Tier Factor: Preferred 0.90 · **Standard 1.00** · Non-Standard 1.20
- **PA.RT.010** Rental Reimbursement Rate (additive): $20/600 24 · **$30/900 38** · $40/1200 52
- **PA.RT.011** Towing and Labor Rate (additive): $50 10 · $100 15 · $200 22

## Rating algorithm — PA.RAT.1 (11 logical / 12 executable steps)

Territory base → driver class → limit factor → vehicle age → (optional med pay, UM,
collision, comprehensive additives) → tier factor → (optional rental, towing additives)
→ minimum-premium floor. Multiplicative factors apply to the running total; coverage
premiums are additive; conditional steps are skipped when their flag is false.

| # | Step | Op | Source | Round | Condition |
|---|---|---|---|---|---|
| s1  | Territory base rate      | SET       | RT PA.RT.001[territory]                | — | — |
| s2  | Driver class factor      | MUL       | RT PA.RT.002[driverClass]              | — | — |
| s3  | BI/PD limit factor       | MUL       | RT PA.RT.003[biPdLimitCode]            | — | — |
| s4  | Vehicle age factor       | MUL       | RT PA.RT.004[vehicleAgeClass]          | 2 | — |
| s5  | Medical Payments premium | ADD       | RT PA.RT.005[territory]                | — | medPayElected |
| s6  | UM/UIM premium           | ADD       | RT PA.RT.006[territory]                | — | umElected |
| s7  | Collision premium        | ADD       | RT PA.RT.007[vehicleSymbol, collisionDed] | — | collisionElected |
| s8  | Comprehensive premium    | ADD       | RT PA.RT.008[vehicleSymbol, compDed]   | — | compElected |
| s9  | Tier factor              | MUL       | RT PA.RT.009[tier]                     | — | — |
| s10a| Rental reimbursement     | ADD       | RT PA.RT.010[rentalCode]               | — | rentalElected |
| s10b| Towing and labor         | ADD       | RT PA.RT.011[towingLimit]              | — | towingElected |
| s11 | Apply minimum premium    | MIN_FLOOR | CONST 250                              | 0 | — |

### Worked example (Personal Auto canary — the test asserts **$1,002** exactly)

**Inputs:** territory T002 · driver class DC2 (standard) · BI/PD 100/300/100 · vehicle age
Standard · vehicle symbol sym12 · tier Standard · Med Pay elected · UM/UIM elected ·
Collision elected @ $500 deductible · Comprehensive elected @ $250 deductible ·
Rental reimbursement elected ($30/day, $900 max) · Towing NOT elected.

**Step-by-step derivation:**

```
s1   SET  PA.RT.001[T002]                = 400   →   400.00
s2   MUL  PA.RT.002[DC2]                 = 1.00  →   400.00
s3   MUL  PA.RT.003[100/300/100]         = 1.00  →   400.00
s4   MUL  PA.RT.004[Standard], round 2   = 1.00  →   400.00
s5   ADD  PA.RT.005[T002]  (Med Pay)     = 42    →   442.00
s6   ADD  PA.RT.006[T002]  (UM/UIM)      = 62    →   504.00
s7   ADD  PA.RT.007[sym12,$500] (Coll)   = 306   →   810.00
s8   ADD  PA.RT.008[sym12,$250] (Comp)   = 154   →   964.00
s9   MUL  PA.RT.009[Standard]            = 1.00  →   964.00
s10a ADD  PA.RT.010[$30_900] (Rental)    = 38    → 1,002.00
s10b (SKIPPED — towingElected = false)
s11  MIN_FLOOR CONST 250, round 0        → MAX(1,002.00, 250) = 1,002.00 → $1,002
```

**Result: $1,002** — the Personal Auto canary. Locked fatally in
`shared/src/rating/personalAuto.evaluator.test.ts` (asserts the final premium and every
per-step running total) and re-verified by `scripts/seed.ts` before the seedReport is
written (a mismatch exits the seed non-zero). The minimum-premium floor ($250) does not
bind here; it binds for a liability-only economy/preferred risk.

## Forms catalog (12 forms — generic PP-series, edition 01 05)

Clearly-labelled illustrative content — not proprietary ISO form text. Attached to
coverages by rule; `attach` NONE = always on, RULE = attached by a PA.FORM.RU.* rule.

| Number | Edition | Name | Category | Attach | Dyn | States |
|---|---|---|---|---|---|---|
| PP 00 01 | 01 05 | Personal Auto Policy | Base Coverage | Mandatory | — | footprint |
| PP DS 01 | 01 05 | Personal Auto Policy Declarations | Declarations | Mandatory | ✓ | footprint |
| PP 13 01 | 01 05 | Extended Transportation Expenses (Rental Reimbursement) | Endorsement | Rule | ✓ | footprint |
| PP 03 28 | 01 05 | Towing and Labor Costs Coverage | Endorsement | Rule | ✓ | footprint |
| PP 04 46 | 01 05 | Loan or Lease Gap Coverage | Endorsement | Rule | — | footprint |
| PP 04 04 | 01 05 | Driver Exclusion Endorsement | Endorsement | Rule | ✓ | footprint |
| PP 03 05 | 01 05 | Extended Non-Owned Coverage — Regular Use | Endorsement | Rule | — | footprint |
| PP 03 01 | 01 05 | Named Non-Owner Coverage Endorsement | Endorsement | Rule | ✓ | footprint |
| PP 04 02 | 01 05 | Excess Electronic Equipment Coverage | Endorsement | Rule | ✓ | footprint |
| PP 01 75 | 01 05 | Special Provisions — California | Amendatory | Rule | — | CA only |
| PP 01 79 | 01 05 | Special Provisions — Texas | Amendatory | Rule | — | TX only |
| PN PP 01 | 01 05 | Personal Auto Policy Notice — Important Information | Policy Notice | Mandatory | — | footprint |

## Product rules (PA.RU.*)

- **001** Eligibility — personal passenger auto / motorcycle / light truck, personal use → eligible [PP 00 01]
- **002** Mandatory Coverage — PAP selected → Part A Liability (BI + PD) mandatory; both subs present
- **003** Limit Ranges — Bodily Injury per PA.LD.001 (default 100/300)
- **004** Limit Ranges — Property Damage per PA.LD.002 (default $100,000)
- **005** Optional Coverage — Med Pay (Part B) elected → PA.LD.003 [PP 00 01]
- **006** Optional Coverage — UM/UIM (Part C) available; required unless waived in writing in most states (PA.LD.004)
- **007** Coverage Constraint — UIM limit may not exceed BI limit per occurrence
- **008** Coverage Constraint — Rental Reimbursement requires Collision or Comprehensive in force [PP 13 01]
- **009** Coverage Constraint — Towing and Labor requires Collision or Comprehensive in force [PP 03 28]
- **010** RATING — minimum policy premium $250 (PA.RAT.1 step 11)

## Form attachment rules (PA.FORM.RU.*)

- **001** Rental Reimbursement elected → attach PP 13 01 (mandatory)
- **002** Towing and Labor elected → attach PP 03 28 (mandatory)
- **003** Loan/Lease Gap elected → attach PP 04 46 (mandatory)
- **004** Named Non-Owner coverage → attach PP 03 01 (mandatory)
- **005** Driver exclusion required → attach PP 04 04 (mandatory)
- **006** Risk state CA → attach PP 01 75; TX → attach PP 01 79 (mandatory, state-scoped)

## Dictionary starter fields (8)

Territory (Auto) LIST[T001–T005] · Driver Class LIST[DC1–DC3] · Vehicle Symbol
LIST[sym10, sym12] · Bodily Injury Limit CURRENCY · Property Damage Limit CURRENCY ·
Collision Deductible CURRENCY · Comprehensive Deductible CURRENCY · Effective Date (Auto) DATE

## Seed notes

Personal Auto is seeded by the same `ProductBundle` loop in `scripts/seed.ts` as Personal
Home, so audit/searchIndex/rev parity holds — no PA-specific seeding code. `pnpm seed --only pa`
seeds Personal Auto only; `--only ph` seeds Personal Home only; the default seeds both. The
seed verifies both canaries (**$1,528** Personal Home HO-3 and **$1,002** Personal Auto)
before writing the seedReport; a mismatch is FATAL (exit non-zero).

The Personal Auto pricing worksheet is data-driven (`PA_RATING_INPUT_SPEC` in
`personalAuto.ts`), rendered by `GenericRatingPanel` in the Pricing tab. The bespoke
`HomeownersRatingPanel` is only shown when `lob.prefix === 'HO'`; all other lines
(including Personal Auto) use the generic panel. `PA_LOB.supportsRulesSimulation` is
`true`, so the Rules tab's Simulate panel is available for Personal Auto.
