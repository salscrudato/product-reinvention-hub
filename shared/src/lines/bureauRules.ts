// lines/bureauRules.ts — multi-bureau, multi-line rule-number classification.
//
// Extends the homeowners-scoped classifyRuleNumber() in insurance/filing/registry.ts
// to cover ALL major P&C bureaus (ISO, NCCI, AAIS, proprietary) across multiple
// lines. Maps (bureau, ruleNumber) → { kind, ruleCategory, outcomeShape }.
//
// DONE-WHEN requirement: classifyBureauRule('ISO', '92')   → RATING / CREDIT_CAP
//                        classifyBureauRule('ISO', '94')   → RATING / PREMIUM_CAP
//                        classifyBureauRule('ISO', '205')  → RATING / MIN_PREMIUM
//                        classifyBureauRule('ISO', '406')  → RATING / DEDUCTIBLE
//                        classifyBureauRule('ISO', '1')    → RATING / BASE_LOSS_COST
//                        classifyBureauRule('ISO', '350')  → RATING / SCHEDULED_PROPERTY
//                        classifyBureauRule('ISO', '450')  → RATING / PROTECTIVE_DEVICE
//                        classifyBureauRule('ISO', '550')  → FORMS  / ENDORSEMENT_SCHEDULE
// All confirmed by the NJ Lemonade HO filing reference (docs/reviews/GROUND_TRUTH.md V16).
//
// Pure TypeScript; zero platform imports.
import type { RuleCategory } from '../types'

// ─── Bureau identifier ────────────────────────────────────────────────────────

export type Bureau = 'ISO' | 'NCCI' | 'AAIS' | 'PROPRIETARY'

// ─── Resolution result ────────────────────────────────────────────────────────

export interface BureauRuleResolution {
  /** Stable archetype label matching ManualRuleKind where applicable. */
  kind:         string
  /** Platform Rule.category: which collection the rule belongs to. */
  ruleCategory: RuleCategory
  /** One-line description of what this rule number range typically produces. */
  outcomeShape: string
}

// ─── ISO numbering plan ───────────────────────────────────────────────────────
//
// Source: ISO manual numbering conventions as reflected in the NJ Lemonade filing
// (samples/filings/nj-lemonade-ho/) and the ISO CGL / CP / PA rate manuals.
// The HO numbering plan is the reference; CGL and CP follow similar conventions
// with line-specific offsets for the extended rule numbers.
//
// Exact semantically load-bearing rules — checked before bands.
const ISO_EXACT: Record<number, BureauRuleResolution> = {
  // Rule 1  — base loss cost table; the territory-keyed starting-point factor.
  1:  { kind: 'BASE_LOSS_COST', ruleCategory: 'RATING', outcomeShape: 'Base loss cost per $100; territory-keyed RT table.' },
  // Rule 2  — loss cost multiplier; a single scalar applied after the base loss cost.
  2:  { kind: 'BASE_LOSS_COST', ruleCategory: 'RATING', outcomeShape: 'Loss cost multiplier (LCM); single scalar CONST or one-row RT table.' },
  // Rule 92 — maximum credits rule (Lemonade HO fixture, GROUND_TRUTH V16).
  92: { kind: 'CREDIT_CAP', ruleCategory: 'RATING', outcomeShape: 'Maximum total credit floor; sets RatingProgram.creditFloor (e.g. 0.50 = "max 50% credit").' },
  // Rule 94 — renewal premium capping; year-over-year rate-change cap.
  94: { kind: 'PREMIUM_CAP', ruleCategory: 'RATING', outcomeShape: 'Renewal premium cap factor table; gated MUL step keyed by prior-year premium band.' },
  // Rule 205 — minimum premium; per-form dollar floor.
  205: { kind: 'MIN_PREMIUM', ruleCategory: 'RATING', outcomeShape: 'Minimum premium by form and coverage option; MIN_FLOOR step with per-form scalar.' },
  // Rule 406 — deductible credit matrix (Lemonade HO fixture).
  406: { kind: 'DEDUCTIBLE', ruleCategory: 'RATING', outcomeShape: 'Deductible credit matrix (coverage band × deductible option); MUL RT step.' },
}

// Band ranges — evaluated after exact matches.
// Source: ISO homeowners manual rule-number numbering plan (same plan the CGL and
// CP manuals follow, with product-specific extensions at higher numbers).
interface IsoBand { lo: number; hi: number; resolution: BureauRuleResolution }
const ISO_BANDS: IsoBand[] = [
  // Rules 3–91, 93, 95–204 — characteristic/surcharge/credit factor tables (the adjusted-base
  // chain between the base premium and the final modifiers).
  { lo: 3,   hi: 91,  resolution: { kind: 'FACTOR_TABLE',         ruleCategory: 'RATING', outcomeShape: 'Surcharge/credit factor table; MUL RT step in the adjusted-base chain.' } },
  { lo: 93,  hi: 93,  resolution: { kind: 'FACTOR_TABLE',         ruleCategory: 'RATING', outcomeShape: 'Surcharge/credit factor table (between premium-cap and min-premium).' } },
  { lo: 95,  hi: 204, resolution: { kind: 'FACTOR_TABLE',         ruleCategory: 'RATING', outcomeShape: 'Surcharge/credit factor table; MUL RT step in the adjusted-base chain.' } },
  // Rules 206–299 — product/eligibility rules: underwriting guidelines, coverage restrictions.
  { lo: 206, hi: 299, resolution: { kind: 'ELIGIBILITY',          ruleCategory: 'PRODUCT', outcomeShape: 'Underwriting eligibility criterion; produces a RuleViolation or restricted option set.' } },
  // Rules 300–399 — scheduled property classes and per-$100 rates.
  { lo: 300, hi: 399, resolution: { kind: 'SCHEDULED_PROPERTY',   ruleCategory: 'RATING', outcomeShape: 'Scheduled personal property class rate ($ per $100 appraised value); SPP or ADD RT step.' } },
  // Rules 400–499 — protective device credits (ex-Rule 406 which is exact-matched above).
  { lo: 400, hi: 499, resolution: { kind: 'PROTECTIVE_DEVICE',    ruleCategory: 'RATING', outcomeShape: 'Protective device credit table; MUL RT step (smoke detectors, burglar alarms, …).' } },
  // Rules 500–699 — endorsement premium schedules; attach additional coverage forms.
  { lo: 500, hi: 699, resolution: { kind: 'ENDORSEMENT_SCHEDULE', ruleCategory: 'FORMS',  outcomeShape: 'Endorsement premium schedule; ADD RT step + Form attachment (HO 04 xx, CP 04 xx, …).' } },
  // Rules 700–999 — forms and coverage extensions (policy-form cross-references).
  { lo: 700, hi: 999, resolution: { kind: 'FORM_REFERENCE',       ruleCategory: 'FORMS',  outcomeShape: 'Policy form cross-reference or conditions rule; yields a Form attachment or product rule.' } },
]

function classifyIso(n: number): BureauRuleResolution {
  if (ISO_EXACT[n]) return ISO_EXACT[n]!
  for (const b of ISO_BANDS) if (n >= b.lo && n <= b.hi) return b.resolution
  return { kind: 'OTHER', ruleCategory: 'PRODUCT', outcomeShape: 'Unknown ISO rule; inspect manually.' }
}

// ─── NCCI numbering plan ──────────────────────────────────────────────────────
//
// Source: NCCI Workers Compensation and Employers Liability Insurance Manual
// (Basic Manual Part 1–4, Scopes Manual, Experience Rating Plan Manual).
// NCCI does not use simple integer rule numbers; it uses named-part / exhibit
// references. We classify by the numeric identifier of the PART or rule section
// that appears in state filings and experience-rating documents.
const NCCI_EXACT: Record<number, BureauRuleResolution> = {
  // Part 1 — General rules (eligibility, policy conditions)
  1: { kind: 'GENERAL_RULES',      ruleCategory: 'PRODUCT', outcomeShape: 'WC general eligibility and policy conditions.' },
  // Part 2 — Classifications (class codes, phraseology, exposure basis)
  2: { kind: 'CLASSIFICATION',     ruleCategory: 'RATING',  outcomeShape: 'WC class code with exposure basis (payroll) and phraseology; drives RT lookup.' },
  // Part 3 — Rates and rating values (loss costs, LCM, minimum premium)
  3: { kind: 'LOSS_COST',          ruleCategory: 'RATING',  outcomeShape: 'WC loss cost per $100 payroll + LCM; LOSS_COST_TIMES_LCM archetype.' },
  // Part 4 — Premium determination (e-mod, schedule rating, minimum premium)
  4: { kind: 'PREMIUM_DETERMINATION', ruleCategory: 'RATING', outcomeShape: 'E-mod MUL + schedule rating (±15% capped) + minimum-premium floor.' },
}
const NCCI_EXACT_EXACT: Record<number, BureauRuleResolution> = {
  ...NCCI_EXACT,
  // Experience Rating Plan — e-mod calculation
  40: { kind: 'EXPERIENCE_MOD',    ruleCategory: 'RATING',  outcomeShape: 'NCCI experience modification factor; MUL RT step keyed by e-mod scalar.' },
  // Schedule Rating — discretionary credit/debit ±15%, filed caps
  41: { kind: 'SCHEDULE_RATING',   ruleCategory: 'RATING',  outcomeShape: 'NCCI schedule rating credit/debit (±15% capped); SCHEDULE_RATING_CAPPED archetype.' },
}

function classifyNcci(n: number): BureauRuleResolution {
  if (NCCI_EXACT_EXACT[n]) return NCCI_EXACT_EXACT[n]!
  if (n >= 1 && n <= 4)   return NCCI_EXACT[n] ?? NCCI_EXACT[1]!
  if (n >= 5 && n <= 39)  return { kind: 'WC_GENERAL',     ruleCategory: 'PRODUCT', outcomeShape: 'WC general rule; inspect manually.' }
  if (n >= 50 && n <= 99) return { kind: 'WC_SUPPLEMENT',  ruleCategory: 'FORMS',   outcomeShape: 'WC endorsement or supplemental coverage rule.' }
  return { kind: 'OTHER', ruleCategory: 'PRODUCT', outcomeShape: 'Unknown NCCI rule; inspect manually.' }
}

// ─── AAIS numbering plan ──────────────────────────────────────────────────────
//
// Source: AAIS (American Association of Insurance Services) — used for Dwelling,
// Inland Marine, and some commercial lines in member states. AAIS does not use
// a simple numeric plan; it references forms by type prefix. We classify by the
// numeric portion of the AAIS rule reference.
const AAIS_BANDS: IsoBand[] = [
  { lo: 1,   hi: 9,   resolution: { kind: 'GENERAL_RULES',     ruleCategory: 'PRODUCT', outcomeShape: 'AAIS general eligibility rule.' } },
  { lo: 10,  hi: 49,  resolution: { kind: 'RATING_RULE',       ruleCategory: 'RATING',  outcomeShape: 'AAIS rating rule; factor or rate table.' } },
  { lo: 50,  hi: 99,  resolution: { kind: 'FORM_REFERENCE',    ruleCategory: 'FORMS',   outcomeShape: 'AAIS form reference or endorsement schedule.' } },
  { lo: 100, hi: 999, resolution: { kind: 'ENDORSEMENT_RULE',  ruleCategory: 'FORMS',   outcomeShape: 'AAIS endorsement premium schedule.' } },
]

function classifyAais(n: number): BureauRuleResolution {
  for (const b of AAIS_BANDS) if (n >= b.lo && n <= b.hi) return b.resolution
  return { kind: 'OTHER', ruleCategory: 'PRODUCT', outcomeShape: 'Unknown AAIS rule; inspect manually.' }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Classify a printed manual rule number into its stable archetype plus the
 *  platform Rule.category it maps to and an outcome-shape description.
 *
 *  The ISO path fully covers the Lemonade NJ HO filing rule numbers (92, 94, 205,
 *  406, 1–2, 3xx, 4xx, 5xx/6xx) as documented in GROUND_TRUTH.md V16. */
export function classifyBureauRule(bureau: Bureau, ruleNumber: string | number): BureauRuleResolution {
  const n = parseInt(String(ruleNumber).replace(/[^0-9]/g, ''), 10)
  if (!Number.isFinite(n)) return { kind: 'OTHER', ruleCategory: 'PRODUCT', outcomeShape: 'Non-numeric rule reference; inspect manually.' }

  switch (bureau) {
    case 'ISO':        return classifyIso(n)
    case 'NCCI':       return classifyNcci(n)
    case 'AAIS':       return classifyAais(n)
    case 'PROPRIETARY': return {
      kind:         'PROPRIETARY',
      ruleCategory: 'PRODUCT',
      outcomeShape: 'Carrier-proprietary rule; no bureau numbering plan applies.',
    }
  }
}

/** Convenience: resolve just the Rule.category from a bureau rule number. */
export function bureauRuleCategory(bureau: Bureau, ruleNumber: string | number): RuleCategory {
  return classifyBureauRule(bureau, ruleNumber).ruleCategory
}
