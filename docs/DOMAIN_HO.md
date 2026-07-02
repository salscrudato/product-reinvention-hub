# DOMAIN_HO.md — Seed product: Homeowners HO-3 (Special Form)

The app seeds exactly this dataset. A representative ISO-style sample for demo
purposes (numbers, editions and rates are illustrative). `shared/src/seed/ho3.ts`
encodes it verbatim; `pnpm seed` writes it; tests assert the worked example.

## Product
- HO.PROD.001 — "Homeowners — HO-3 Special Form" · LOB HO.LOB.001 Homeowners
- marketSegment: Personal Lines / Property · status ACTIVE · lifecycle LAUNCHED
- Footprint states (15): AZ CA CO FL GA IL IN MI NC OH PA SC TN TX VA
- Coastal wind/hail states (subset): FL GA NC SC TX
- Minimum premium: $500 · Rating program HO.RAT.1

## Coverages (Section I property, Section II liability)
| refId | Name | Parent | Req | Terms |
|---|---|---|---|---|
| HO.COV.001 | Coverage A — Dwelling | — | Mandatory | LIMIT = Coverage A amount (input, currency) |
| HO.COV.002 | Coverage B — Other Structures | — | Mandatory | LIMIT = 10% of A (default; increase via HO 04 48) |
| HO.COV.003 | Coverage C — Personal Property | — | Mandatory | LIMIT % of A per HO.LD.005 (default 50%) |
| HO.COV.004 | Coverage D — Loss of Use | — | Mandatory | LIMIT = 30% of A |
| HO.COV.005 | Coverage E — Personal Liability | — | Mandatory | LIMIT per HO.LD.001 (default 300,000) |
| HO.COV.006 | Coverage F — Medical Payments | — | Mandatory | LIMIT per HO.LD.002 (default 1,000) |
| HO.COV.001.001 | Water Back-Up & Sump Overflow | HO.COV.001 | Optional | LIMIT per HO.LD.006 → form HO 04 95 |
| HO.COV.002.001 | Other Structures — Increased Limits | HO.COV.002 | Optional | LIMIT (currency, free) → HO 04 48 |
| HO.COV.003.001 | Personal Property Replacement Cost | HO.COV.003 | Optional | flag → HO 04 90 |
| HO.COV.003.002 | Scheduled Personal Property | HO.COV.003 | Optional | schedule (class + value, repeating) → HO 04 61 |

Section I deductible terms (on product): All-peril per HO.LD.003 (default 1,000);
Wind/Hail % per HO.LD.004 (coastal only). Protective-device credit input
(none | local | central) → HO 04 16 when not none. Claims basis: Occurrence.
All coverages BUREAU except HO.COV.002.001 (PROPRIETARY, demo).

## Limits & Deductibles tables (LD)
- **HO.LD.001** Coverage E limits: 100,000 · **300,000 (default)** · 500,000
- **HO.LD.002** Coverage F limits: **1,000 (default)** · 2,000 · 5,000 —
  constraint on 5,000: "Available only when Coverage E ≥ 300,000"  ← demo constraint
- **HO.LD.003** All-peril deductible: 500 · **1,000 (default)** · 2,500 · 5,000
- **HO.LD.004** Wind/Hail % deductible: 1% · 2% · 5% — constraints: coastal states
  only (FL GA NC SC TX); dollar amount (% × Cov A) must be ≥ all-peril deductible
- **HO.LD.005** Coverage C % of A: **50 (default)** · 70 · 75
- **HO.LD.006** Water back-up limit: **5,000 (default)** · 10,000 · 25,000

## Rating tables (RT)
- **HO.RT.001** Territory base rate: T001 640 · T002 700 · T003 815 · T004 905 · T005 1,040
- **HO.RT.002** Protection class × construction factor:
  PC 1–3 F 0.95 / M 0.90 · PC 4–6 F 1.10 / **M 1.05** · PC 7–8 F 1.30 / M 1.20 · PC 9–10 F 1.55 / M 1.45
- **HO.RT.003** Coverage A key factor: 200k 0.80 · 250k 0.90 · 300k 1.00 ·
  350k 1.14 · **400k 1.30** · 500k 1.62 · 600k 1.94 · each add'l 100k +0.32
- **HO.RT.004** Deductible factors — all-peril: 500 1.10 · **1,000 1.00** ·
  2,500 0.88 · 5,000 0.76; wind/hail % (multiplied when elected): 1% 0.97 · 2% 0.94 · 5% 0.89
- **HO.RT.005** Coverage C % factor: 50 1.00 · **70 1.06** · 75 1.09
- **HO.RT.006** Liability increased-limit charges (additive $): Cov E — 100k +0 ·
  **300k +24** · 500k +38; Cov F — 1k +0 · **2k +6** · 5k +18
- **HO.RT.007** Scheduled Personal Property class rates per $100 of value:
  **Jewelry 1.27** · Furs 0.55 · Cameras 1.10 · Fine Arts 0.85 · Silverware 0.45 · Musical Instruments 0.60
- **HO.RT.008** Endorsement/credit factors: HO 04 90 Replacement Cost **1.10**;
  protective devices — **none 1.00** · local alarm 0.98 · central station 0.95
- **HO.RT.009** Tier factor: A 0.90 · **B 1.10** · C 1.25
- **HO.RT.010** Water back-up flat premium: 5,000 → **75** · 10,000 → 110 · 25,000 → 175

## Rating algorithm — HO.RAT.1 (11 steps)
| # | Step | Op | Source | Round |
|---|---|---|---|---|
| 1 | Territory base rate | SET | HO.RT.001[territory] | — |
| 2 | Protection/construction factor | MUL | HO.RT.002[pc, construction] | — |
| 3 | Coverage A key factor → Key Premium | MUL | HO.RT.003[covA] | 0 |
| 4 | Deductible factor(s) (wind/hail factor multiplies only if elected) | MUL | HO.RT.004 | — |
| 5 | Coverage C percentage factor | MUL | HO.RT.005[covC%] | — |
| 6 | Coverage E increased-limit charge | ADD | HO.RT.006[E] | — |
| 7 | Coverage F increased-limit charge | ADD | HO.RT.006[F] | — |
| 8 | Endorsement/credit factors (HO 04 90 if elected × device credit) | MUL | HO.RT.008 | 2 |
| 9 | Tier factor | MUL | HO.RT.009[tier] | — |
| 10 | Flat/scheduled endorsement premiums (water back-up + SPP Σ value/100 × class rate) | ADD | HO.RT.010 + HO.RT.007 | — |
| 11 | Final premium = MAX(running, minimum 500) | MIN_FLOOR | CONST 500 | 0 |

### Worked example (seed default preset — tests must assert $1,528)
Inputs: territory T002 · PC 5 Masonry · Cov A 400,000 · all-peril ded 1,000 ·
no wind/hail ded · Cov C 70% · Cov E 300,000 · Cov F 2,000 · Replacement Cost
elected · protective device none · Tier B · Water back-up 5,000 · SPP Jewelry 15,000.

700.00 → ×1.05 = 735.00 → ×1.30 = 955.50 → **956** → ×1.00 = 956.00 →
×1.06 = 1,013.36 → +24 = 1,037.36 → +6 = 1,043.36 → ×(1.10×1.00) = **1,147.70** →
×1.10 = 1,262.47 → +75 +190.50 = 1,527.97 → MAX(·,500), round 0 = **$1,528**.

## Forms catalog (12)
| Number | Edition | Name | Category | Attach | Dyn | States |
|---|---|---|---|---|---|---|
| HO 00 03 | 05 11 | Homeowners 3 — Special Form | Base Coverage | Mandatory | — | footprint |
| HO DS 01 | 05 11 | Homeowners Policy Declarations | Declarations | Mandatory | ✓ | footprint |
| HO 04 90 | 05 11 | Personal Property Replacement Cost Loss Settlement | Endorsement | Rule | — | footprint |
| HO 04 95 | 05 11 | Water Back-Up and Sump Discharge or Overflow | Endorsement | Rule | ✓ | footprint |
| HO 04 61 | 05 11 | Scheduled Personal Property Endorsement | Endorsement | Rule | ✓ | footprint |
| HO 04 16 | 05 11 | Premises Alarm or Fire Protection System | Endorsement | Rule | ✓ | footprint |
| HO 04 48 | 05 11 | Other Structures — Increased Limits | Endorsement | Rule | ✓ | footprint |
| HO 03 12 | 05 11 | Windstorm or Hail Percentage Deductible | Endorsement | Rule | ✓ | coastal |
| HO 04 96 | 05 11 | No Section II Coverage — Home Day Care Business | Exclusion | Rule | — | footprint |
| HO 01 04 | 05 11 | Special Provisions — California | Amendatory | Rule | — | CA |
| HO 01 33 | 05 11 | Special Provisions — Texas | Amendatory | Rule | — | TX |
| PN HO 01 | 05 11 | Policyholder Notice — Important Information | Policy Notice | Mandatory | — | footprint |

Dynamic fields:
- HO DS 01: NamedInsured TEXT · PropertyAddress TEXT · PolicyEffective DATE ·
  PolicyExpiration DATE · CoverageLimits (repeating: Coverage TEXT, Limit CURRENCY) ·
  TotalPremium CURRENCY
- HO 04 61 (repeating): ItemClass LIST[Jewelry, Furs, Cameras, Fine Arts,
  Silverware, Musical Instruments] · ItemDescription TEXT · AppraisedValue CURRENCY
- HO 04 95: BackUpLimit CURRENCY · HO 04 16: DeviceType LIST[Local Alarm, Central
  Station] + CertificateNo TEXT · HO 04 48 (repeating): StructureDescription TEXT +
  IncreasedLimit CURRENCY · HO 03 12: DeductiblePercent LIST[1%, 2%, 5%]

## Product rules (HO.RU.*)
- 001 Eligibility — owner-occupied 1–4 family dwelling, residential use → eligible
- 002 Coverage B default limit = 10% of Coverage A; increase only via HO 04 48
- 003 Coverage C options per HO.LD.005; default 50% of A
- 004 Coverage D limit = 30% of Coverage A
- 005 Coverage E options per HO.LD.001; default 300,000
- 006 Coverage F options per HO.LD.002; 5,000 requires Coverage E ≥ 300,000
- 007 All-peril deductible per HO.LD.003; default 1,000
- 008 Wind/Hail % deductible per HO.LD.004 — coastal states only and ≥ all-peril ded
- 009 Minimum policy premium $500 (HO.RAT.1 step 11)
- 010 Seasonal/secondary dwellings ineligible unless a companion primary policy is in force

## Form attachment rules (HO.FORM.RU.*)
- 001 Replacement Cost elected → attach HO 04 90 (mandatory)
- 002 Water Back-Up elected → attach HO 04 95 (limit merges from term)
- 003 Scheduled Personal Property elected → attach HO 04 61 (schedule merges)
- 004 Protective-device credit ≠ none → attach HO 04 16
- 005 Wind/Hail % deductible elected → attach HO 03 12
- 006 Risk state = CA → attach HO 01 04; risk state = TX → attach HO 01 33
- 007 Home day-care exclusion elected → attach HO 04 96

## Dictionary starter fields (10)
Named Insured TEXT · Property Address TEXT · Coverage A Amount CURRENCY ·
All-Peril Deductible CURRENCY · Protection Class LIST[1–10] · Construction Type
LIST[Frame, Masonry] · Territory Code LIST[T001–T005] · Appraised Value CURRENCY ·
Device Type LIST · Effective Date DATE

## Default task set (auto-created per new product; D = creation date)
Ideation & Design: "Define coverage strategy" D+7 · "Draft rating plan" D+14
Build & File: "Configure product in Factory" D+30 · "File with states" D+45
Test & Approve: "UAT rating scenarios" D+60 · "Business review sign-off" D+70
Launch & Monitor: "Launch readiness check" D+80 · "30-day results review" D+110

## Seed extras
Admin user admin@productfactory.app / admin123 (custom claim ADMIN,
mustChangePassword=true) · sample EDITOR + VIEWER users · 3 sample feedback items
(one per lane) · seedReport with counts + the computed worked-example premium.
