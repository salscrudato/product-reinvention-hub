# DOMAIN_GL.md — Seed product: General Liability (Monoline CGL)

The app seeds exactly this dataset alongside HO-3. A representative ISO-style sample
for demo purposes drawn from the four GL workbooks (Framework · Rules · Rating · Forms).
`shared/src/seed/gl.ts` encodes it verbatim; `pnpm seed` writes it; tests assert the
worked example. The GL product proves the platform is line-agnostic — every surface
(Home / Products / Explorer / Pricing / Explorer) renders without Homeowners assumptions.

## Product
- **GL.PROD.001** — "Monoline General Liability Product" · LOB GL.LOB.001 General Liability
- marketSegment: Commercial Lines / Casualty · status ACTIVE · lifecycle LAUNCHED
- Footprint states (44): AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY ME MD MA MI
  MN MS MO MT NE NV NH NJ NM NC ND OH OR PA RI SC SD TN TX UT VT VA WA WV
- Peril model: TERRITORY (no coastal peril; rates by ISO class table and territory/state LCM)
- Minimum premium: $125 (class-table-dependent; RTTable.004) · Rating program GL.RAT.1
- Claims bases: Occurrence (base CGL) and Claims-made (Employee Benefits Liability)

## Coverages — ISO CGL grouping (Coverage A / B / C + Other)

| refId | Name | Parent | Req | Claims | Terms |
|---|---|---|---|---|---|
| GL.COV.001 | Wrongful Acts Coverage | — | Mandatory | Occurrence | OPTION terrorism cap flag |
| GL.COV.001.001 | Terrorism Coverage | GL.COV.001 | Mandatory | Occurrence | OPTION terrorism-elected flag |
| GL.COV.002 | Bodily Injury (Premises Operations) Coverage | — | Mandatory | Occurrence | LIMIT each-occurrence per LDTable.001 (default 1,000,000) |
| GL.COV.002.001 | Mobile Equipment Operation Coverage | GL.COV.002 | Mandatory | Occurrence | LIMIT shares policy limit |
| GL.COV.002.007 | Liquor Liability Coverage | GL.COV.002 | Optional | Occurrence | OPTION liquor-elected flag → CG 24 08 / CG 00 33 |
| GL.COV.003 | Property Damage (Premises Operations) Coverage | — | Mandatory | Occurrence | LIMIT each-occurrence per LDTable.001 (default 1,000,000) |
| GL.COV.004 | Bodily Injury (Products / Completed Ops) Coverage | — | Mandatory | Occurrence | LIMIT products-agg per LDTable.006 (default 2,000,000) |
| GL.COV.005 | Property Damage (Products / Completed Ops) Coverage | — | Mandatory | Occurrence | LIMIT products-agg per LDTable.006 (default 2,000,000) |
| GL.COV.006 | Personal and Advertising Injury Coverage | — | Mandatory | Occurrence | LIMIT = occurrence limit (default 1,000,000) |
| GL.COV.006.001 | Advertising Infringement Coverage | GL.COV.006 | Mandatory | Occurrence | LIMIT shares PAI limit |
| GL.COV.006.002 | Media and Internet Business Coverage | GL.COV.006 | Mandatory | Occurrence | LIMIT shares PAI limit |
| GL.COV.007 | Medical Payments Coverage | — | Mandatory | Occurrence | LIMIT any-one-person (default 5,000) |
| GL.COV.010 | Employee Benefits Liability Coverage | — | Mandatory | Claims-made | LIMIT each-employee per-claim (default 1,000,000) |
| GL.COV.010.001 | Act, Error or Omission Coverage | GL.COV.010 | Mandatory | Claims-made | LIMIT shares EBL limit |

Section grouping (LOB registry): Coverage A — Bodily Injury & Property Damage
(GL.COV.002, GL.COV.003, GL.COV.004, GL.COV.005); Coverage B — Personal &
Advertising Injury (GL.COV.006, GL.COV.006.001, GL.COV.006.002); Coverage C —
Medical Payments (GL.COV.007); Other Coverages (GL.COV.001, GL.COV.001.001,
GL.COV.010, GL.COV.010.001, GL.COV.002.007).

## Limits & Deductibles tables (LD)

- **LDTable.001** Occurrence Limits: 100,000 · 300,000 · 500,000 · **1,000,000 (default)**
- **LDTable.002** General Aggregate Limits: 300,000 (constraint: occ ≤ 300k) · 600,000 ·
  1,000,000 · **2,000,000 (default)** · 4,000,000
- **LDTable.005** Policy Deductible: **None/0 (default)** · 500 · 1,000 · 2,500 · 5,000 · 10,000
- **LDTable.006** Products/Completed Operations Aggregate: 500,000 · 1,000,000 ·
  **2,000,000 (default)** · Exclude/0 [GL.RU.007: removing triggers removal of Cov 4 & 5]

## Rating tables (RT)

- **RTTable.001** Increase Limit Factor (ILF) — Premises/Operations by class table
  (illustrative from workbook; per-occurrence in $000s; ILF relative to 100/300 base):

  | Coverage | Table | Per Occ ($000) | Agg ($000) | ILF |
  |---|---|---|---|---|
  | Prem/Ops | 1 | 100 | 300 | 1.00 |
  | Prem/Ops | 1 | 300 | 600 | 1.12 |
  | Prem/Ops | 1 | 500 | 1,000 | 1.22 |
  | Prem/Ops | **1** | **1,000** | **2,000** | **1.32** |
  | Prem/Ops | 2 | 100 | 300 | 1.00 |
  | Prem/Ops | 2 | 300 | 600 | 1.15 |
  | Prem/Ops | 2 | 500 | 1,000 | 1.28 |
  | Prem/Ops | **2** | **1,000** | **2,000** | **1.40** ← worked example |
  | Prem/Ops | 3 | 100 | 300 | 1.00 |
  | Prem/Ops | 3 | 300 | 600 | 1.18 |
  | Prem/Ops | 3 | 500 | 1,000 | 1.34 |
  | Prem/Ops | **3** | **1,000** | **2,000** | **1.50** |

- **RTTable.002** Loss Cost Multiplier (LCM) by rating state (illustrative OH/MO subset):
  OH 1.50 · MO 1.62

- **RTTable.004** Minimum Premium by ISO class table:
  Table 1 → $100 · **Table 2 → $125** ← worked example · Table 3 → $190 ·
  Table A → $95 · Table B → $190 · Table C → $275

- **RTTable.006** Schedule Rating — characteristics and ±25% cap (GL.RU.091 reference;
  actual modification flows as the `scheduleMod` input, not a table lookup):
  Management · Location (inside) · Location (outside) · Premises condition ·
  Equipment · Employees · Classification peculiarities — each ±25%

## Rating algorithm — GL.RAT.1 (8 steps, Premises/Operations)

A faithful, linear subset of the ISO Prem/Ops algorithm: base loss cost × exposure
× LCM × ILF × schedule modification × tier factor, optional terrorism flat charge,
floored at the class minimum premium.

| # | Step | Op | Source | Round |
|---|---|---|---|---|
| 1 | Base loss cost (per $1,000 exposure) | SET | INPUT(lossCost) | — |
| 2 | Rating exposure (units of $1,000) | MUL | INPUT(exposureUnits) | — |
| 3 | Loss cost multiplier (LCM) | MUL | RTTable.002[lcmState] | — |
| 4 | Increased limit factor (ILF) | MUL | RTTable.001[coverage, classTable, perOccurrenceLimit] | 2 |
| 5 | Schedule rating modification | MUL | INPUT(scheduleMod) | — |
| 6 | Tier factor | MUL | INPUT(tierFactor) | 2 |
| 7 | Terrorism coverage premium [CG 21 70] | ADD | CONST 50 | — |
| 8 | Minimum premium by class [RTTable.004] | MIN_FLOOR | RTTable.004[classTable] | 0 |

Step 7 is gated by `terrorismElected` boolean — skipped when false.

### Worked example (GL canary — tests must assert $2,789)

**Inputs:** ISO class table 2 (Prem/Ops) · base loss cost $4.20 per $1,000 ·
exposure $300,000 gross sales (= 300 units of $1,000) · occurrence limit $1,000,000 ·
general aggregate $2,000,000 · rating state OH · schedule mod 0.90 (10% net credit,
within RTTable.006's ±25%) · tier factor 1.15 · terrorism elected.

**Step-by-step derivation:**

```
s1  SET  lossCost             →   4.20
s2  MUL  exposureUnits 300    →   4.20 × 300 = 1,260.00
s3  MUL  LCM(OH) 1.50         → 1,260.00 × 1.50 = 1,890.00
s4  MUL  ILF(Prem/Ops, tbl 2, occ 1,000) 1.40, round 2
                               → 1,890.00 × 1.40 = 2,646.00
s5  MUL  scheduleMod 0.90     → 2,646.00 × 0.90 = 2,381.40
s6  MUL  tierFactor 1.15, round 2
                               → 2,381.40 × 1.15 = 2,738.61
s7  ADD  terrorism CONST 50   → 2,738.61 + 50.00 = 2,788.61
s8  MIN_FLOOR RTTable.004[tbl 2]=125, round 0
                               → MAX(2,788.61, 125) = 2,788.61 → $2,789
```

**Result: $2,789** (the GL canary; `gl.evaluator.test.ts` asserts this exactly).

The ILF lookup: `perOccurrenceLimit / 1,000 = 1,000` → RTTable.001 row
(Prem/Ops, table 2, perOccurrence 1,000) → ilf = 1.40.
The minimum premium (RTTable.004, classTable 2) = $125, well below $2,788.61, so
the floor does not bind; it binds on a tiny exposure (exposureUnits=1 → $125 min).

## Forms catalog (14 forms — verbatim from GL workbooks)

| Number | Edition | Name | Category | Attach | Dyn | States |
|---|---|---|---|---|---|---|
| CG 00 01 | 04 13 | Commercial General Liability Coverage Form | Base Coverage | Mandatory | — | footprint |
| CG 00 33 | 04 13 | Liquor Liability Coverage Form | Base Coverage | Mandatory | — | footprint |
| CG 00 39 | 04 13 | Pollution Liability Coverage Form Designated Sites | Base Coverage | Rule | — | footprint |
| CG 03 00 | 01 96 | Deductible Liability Insurance | Endorsement | Rule | ✓ | footprint |
| CG 04 35 | 12 07 | Employee Benefits Liability Coverage | Endorsement | Rule | ✓ | footprint |
| CG 20 10 | 04 13 | Additional Insured — Owners, Lessees Or Contractors | Endorsement | Rule | ✓ | footprint |
| CG 21 35 | 10 01 | Exclusion — Coverage C — Medical Payments | Exclusion | Rule | ✓ | footprint |
| CG 21 38 | 11 85 | Exclusion — Personal And Advertising Injury | Exclusion | Rule | — | footprint |
| CG 21 45 | 07 98 | Exclusion — Damage To Premises Rented To You | Exclusion | Rule | — | footprint |
| CG 21 70 | 01 15 | Cap On Losses From Certified Acts Of Terrorism | Endorsement | Rule | — | footprint |
| CG 21 87 | 01 15 | Conditional Exclusion Of Terrorism | Exclusion | Rule | — | footprint |
| CG 24 04 | 05 09 | Waiver Of Transfer Of Rights Of Recovery Against Others | Endorsement | Rule | ✓ | footprint |
| CG 24 08 | 10 93 | Liquor Liability | Endorsement | Rule | — | footprint |
| CG 01 03 | 06 06 | Texas Changes | Amendatory | Mandatory | — | TX only |

Dynamic fields:
- **CG 03 00**: BI Deductible CURRENCY · PD Deductible CURRENCY
- **CG 04 35**: Each Employee Limit CURRENCY · Aggregate Limit CURRENCY ·
  Retroactive Date DATE
- **CG 20 10** (repeating): Name Of Person(s) Or Organization(s) TEXT ·
  Location(s) of Covered Operations TEXT
- **CG 21 35**: Description of Premises or Classification TEXT
- **CG 24 04**: Name of Person or Organization TEXT

## Product rules (GL.RU.*)

- **001** Base Coverage — if Monoline CGL selected → BI/PD (Premises & Products) mandatory [CG 00 01]
- **004** Limit Ranges — Occurrence Limit mandatory (LDTable.001; default 1,000,000)
- **005** Limit Ranges — General Aggregate mandatory (LDTable.002; default 2,000,000)
- **006** Limit Ranges — Products/Completed Ops Aggregate optional (LDTable.006; default 2,000,000)
- **007** Mandatory Exclusion — if Products/Completed Agg excluded → remove GL.COV.004 & GL.COV.005
- **011** Base Coverage — Medical Payments optional (GL.COV.007)
- **013** Mandatory Exclusion — if Med Pay excluded → attach CG 21 35
- **020** Mandatory Exclusion — if Personal & Advertising Injury excluded → attach CG 21 38; removes GL.COV.006
- **023** Deductible — Policy Deductible optional [CG 03 00]
- **026** Deductible — if deductible selected → mandatory (LDTable.005) [CG 03 00]
- **090** RATING — LCM applies to Prem/Ops premium (RTTable.002) [GL.RAT.1 s3]
- **091** RATING — ILF applies when limits exceed 100/300 base (RTTable.001) [GL.RAT.1 s4]
- **092** RATING — minimum premium by ISO class table (RTTable.004) [GL.RAT.1 s8]

## Form attachment rules (GL.FORM.RU.*)

- **GL.FORM.RU.001** — Pollution Liability Form selected → attach CG 00 39 (mandatory)
- **GL.FORM.RU.018** — Employee Benefits Liability selected → attach CG 04 35 (mandatory)

## Dictionary starter fields (7)

Occurrence Limit CURRENCY · General Aggregate Limit CURRENCY · ISO Class Table
LIST[1, 2, 3] · Base Loss Cost CURRENCY (per $1,000 exposure) ·
Loss Cost Multiplier PERCENT (filed per state) ·
Schedule Rating Modification PERCENT (±25% cap) · Claims Basis LIST[Occurrence, Claims-made]

## Seed notes

The GL product is seeded by the same `ProductBundle` loop in `scripts/seed.ts` as
HO-3, so audit/version/searchIndex parity holds. No GL-specific seeding code.
`pnpm seed --only gl` seeds GL only; `pnpm seed --only ho` seeds HO only; default
seeds both. The seed verifies both canaries ($1,528 HO-3 and $2,789 GL) before
writing the seedReport; a mismatch is emitted as a CRITICAL warning.

The rating worksheet for GL is data-driven (`GL_RATING_INPUT_SPEC` in gl.ts),
rendered by `GenericRatingPanel` in the Pricing tab. The bespoke `HomeownersRatingPanel`
is only shown when `lob.prefix === 'HO'`; all other lines use the generic panel.
