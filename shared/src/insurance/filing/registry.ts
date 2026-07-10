// filing/registry.ts — the FILING CONCEPT REGISTRY: the stable, cross-carrier semantics that
// let the importer generalise from one filing's anatomy to the next. Two kinds of knowledge:
//
//   1. RULE-NUMBER semantics. ISO-style rate manuals number their rules on a stable plan, and
//      the number band tells you what a rule IS before you read a word of it: low numbers for
//      base loss costs / multipliers / zip-to-territory tables; characteristic factor tables;
//      a maximum-credit cap; a premium-capping rule; a minimum-premium rule; 3xx scheduled
//      property; 4xx protective devices; 5xx/6xx endorsement schedules. classifyRuleNumber()
//      maps a printed rule number onto a ManualRuleKind archetype.
//
//   2. CONCEPT identity. A rate-order variable ("All Perils Deductible"), a manual rule title
//      ("406. DEDUCTIBLES"), and a form coverage ("Coverage C — Personal Property") refer to
//      the same underlying concept under different surface forms. matchConcept() normalises a
//      name and resolves it to a canonical concept key, so the pure reconcile can JOIN the
//      three documents deterministically (normalized-name + registry aliases), and knows each
//      concept's stage, default op, and whether it is a CREDIT (for the max-credit cap).
//
// Pure TypeScript; the reconcile + parser depend on it; the gate exercises it directly.
import type { ManualRuleKind, FilingOp, RateOrderStage } from './types'

// ─── Rule-number → archetype ────────────────────────────────────────────────────────

/** Classify a printed manual rule number into its stable archetype. Ranges follow the ISO
 *  homeowners numbering plan the reference filing uses; unknown numbers fall to 'OTHER'. */
export function classifyRuleNumber(ruleNumber: string): ManualRuleKind {
  const n = parseInt(String(ruleNumber).replace(/[^0-9]/g, ''), 10)
  if (!Number.isFinite(n)) return 'OTHER'
  // Exact, semantically load-bearing rules first.
  if (n === 92)  return 'CREDIT_CAP'      // maximum credits
  if (n === 94)  return 'PREMIUM_CAP'     // renewal premium capping
  if (n === 205) return 'MIN_PREMIUM'     // minimum premium (per-form floors)
  if (n === 406) return 'DEDUCTIBLE'      // deductible factor matrices
  // Bands.
  if (n >= 1 && n <= 2)     return 'BASE_LOSS_COST'      // base loss cost, LCM, zip→territory LCMF
  if (n >= 300 && n <= 399) return 'SCHEDULED_PROPERTY'  // scheduled property, rate per $100
  if (n >= 400 && n <= 499) return 'PROTECTIVE_DEVICE'   // protective-device credits (ex-406)
  if (n >= 500 && n <= 699) return 'ENDORSEMENT_SCHEDULE'// endorsement premium schedules
  // 3..91, 93, 95..204 — characteristic/credit/surcharge factor tables (the adjusted-base chain).
  if (n >= 3 && n <= 204)   return 'FACTOR_TABLE'
  return 'OTHER'
}

// ─── Concept registry ─────────────────────────────────────────────────────────────

export interface ConceptEntry {
  key:      string          // canonical concept key
  label:    string          // human label
  stage:    RateOrderStage
  op:       FilingOp
  /** True when this factor is one of the credits subject to the maximum-credit rule. */
  isCredit: boolean
  aliases:  string[]        // surface forms as they appear across the three documents
}

/** Normalise a name to a comparison key: lowercase, punctuation → space, collapse spaces.
 *  So "All-Perils Deductible", "ALL PERILS DEDUCTIBLE" and "All Perils  Deductible" agree. */
export function normalizeConcept(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// The reference set of concepts, drawn from the NJ Lemonade homeowners filing but written as
// GENERIC homeowners rating concepts (the same names recur across HO filings). Each entry's
// aliases cover the rate-order label AND the manual rule title. Extend, never fork.
export const FILING_CONCEPTS: ConceptEntry[] = [
  // Base-loss-cost chain.
  { key: 'baseLossCost',   label: 'Base Loss Cost',            stage: 'BASE_LOSS_COST', op: 'ADD', isCredit: false, aliases: ['iso base loss cost', 'base loss cost', 'loss cost'] },
  { key: 'lossCostMult',   label: 'Loss Cost Multiplier',      stage: 'BASE_LOSS_COST', op: 'MUL', isCredit: false, aliases: ['loss cost multiplier', 'lcm', 'iso premium adjustment factor'] },
  { key: 'lossCostMod',    label: 'Loss Cost Modification Factor', stage: 'BASE_LOSS_COST', op: 'MUL', isCredit: false, aliases: ['loss cost modification factor', 'loss cost modification factors', 'lcmf'] },
  { key: 'protConstr',     label: 'Protection-Construction Factors', stage: 'BASE_PREMIUM', op: 'MUL', isCredit: false, aliases: ['protection construction factors', 'protection construction', 'protection class construction'] },
  { key: 'keyFactor',      label: 'Key Factor',                stage: 'BASE_PREMIUM', op: 'MUL', isCredit: false, aliases: ['key factor', 'key premium'] },
  // Adjusted-base factor chain — surcharges + characteristics (debits/neutral).
  { key: 'multiFamily',    label: 'Multi-Family Structure Surcharge', stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['multi family structure surcharge', 'multi family structure'] },
  { key: 'tier',           label: 'Tier',                      stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['tier', 'tier rating factors', 'tier factor'] },
  { key: 'allPerilDed',    label: 'All Perils Deductible',     stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['all perils deductible', 'all peril deductible', 'deductibles', 'deductible'] },
  { key: 'hurricaneDed',   label: 'Hurricane Deductible',      stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['hurricane deductible'] },
  { key: 'lossSettlement', label: 'Loss Settlement Option - Personal Property', stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['loss settlement option personal property', 'loss settlement options personal property', 'loss settlement options'] },
  { key: 'roofType',       label: 'Type of Roof',              stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['type of roof', 'roof type'] },
  { key: 'roofAge',        label: 'Roof Age',                  stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['roof age'] },
  { key: 'squareFootage',  label: 'Square Footage',            stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['square footage'] },
  { key: 'stories',        label: 'Number of Stories',         stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['number of stories'] },
  { key: 'bathrooms',      label: 'Number of Bathrooms',       stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['number of bathrooms'] },
  { key: 'residenceType',  label: 'Type of Residence',         stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['type of residence', 'residence type'] },
  { key: 'coverageAPerSqFt', label: 'Coverage A Per Square Foot', stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['coverage a per square foot'] },
  { key: 'swimmingPool',   label: 'Swimming Pool Surcharge',   stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['swimming pool surcharge'] },
  { key: 'highRiskDog',    label: 'High Risk Dog Surcharge',   stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['high risk dog surcharge'] },
  { key: 'oneFamily',      label: 'One-Family Dwelling Surcharge', stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: false, aliases: ['one family dwelling surcharge'] },
  { key: 'bceg',           label: 'Building Code Effectiveness Grading Windstorm', stage: 'ADJUSTED_BASE', op: 'ADD', isCredit: false, aliases: ['building code effectiveness grading windstorm', 'building code effectiveness grading'] },
  // Credits — subject to the maximum-credit rule (Rule 92 in the reference filing).
  { key: 'ageOfDwelling',  label: 'Age of Dwelling Credit',    stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['age of dwelling credit', 'age of dwelling', 'age of dwelling factors'] },
  { key: 'renovation',     label: 'Renovation Credit',         stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['renovation credit', 'renovation credits'] },
  { key: 'loyalty',        label: 'Loyalty Credit',            stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['loyalty credit', 'loyalty credits'] },
  { key: 'newHome',        label: 'New Home Purchase Credit',  stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['new home purchase credit'] },
  { key: 'bundle',         label: 'Bundle Credit',             stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['bundle credit'] },
  { key: 'gatedCommunity', label: 'Gated Community Credit',    stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['gated community credit'] },
  { key: 'managementCo',   label: 'Management Company Credit', stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['management company credit'] },
  { key: 'fireProtection', label: 'Fire Protection Credit',    stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['fire protection credit', 'protective devices'] },
  { key: 'theftProtection',label: 'Theft Protection Credit',   stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['theft protection credit'] },
  { key: 'waterAlert',     label: 'Water Alert Credit',        stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['water alert credit'] },
  { key: 'windProtective', label: 'Wind Protective Device Credit', stage: 'ADJUSTED_BASE', op: 'MUL', isCredit: true, aliases: ['wind protective device credit', 'wind protective device credits'] },
  // Additional-coverage flat premiums (summed into Total).
  { key: 'waterBackup',    label: 'Water Back-up and Sump Discharge or Overflow Coverage', stage: 'ADDITIONAL_COVERAGE', op: 'ADD', isCredit: false, aliases: ['water back up and sump discharge or overflow coverage', 'water back up and sump discharge', 'limited water back up and sump discharge or overflow coverage'] },
  { key: 'equipmentBreakdown', label: 'Equipment Breakdown Coverage', stage: 'ADDITIONAL_COVERAGE', op: 'ADD', isCredit: false, aliases: ['equipment breakdown coverage'] },
  { key: 'sppBicycle',     label: 'Scheduled Personal Property - Bicycle', stage: 'ADDITIONAL_COVERAGE', op: 'ADD', isCredit: false, aliases: ['scheduled personal property bicycle', 'bicycles'] },
  { key: 'sppJewelry',     label: 'Scheduled Personal Property - Jewelry', stage: 'ADDITIONAL_COVERAGE', op: 'ADD', isCredit: false, aliases: ['scheduled personal property jewelry', 'jewelry'] },
]

const BY_KEY = new Map(FILING_CONCEPTS.map(c => [c.key, c]))

// Alias → concept, longest-alias-first so a specific alias ("loss cost modification factor")
// wins over a broad one ("loss cost") when a name contains both.
const ALIAS_INDEX: { norm: string; entry: ConceptEntry }[] = FILING_CONCEPTS
  .flatMap(entry => entry.aliases.map(a => ({ norm: normalizeConcept(a), entry })))
  .sort((a, b) => b.norm.length - a.norm.length)

/** Resolve a surface name (from any of the three documents) to a concept, or null when it
 *  matches nothing the registry knows. Exact normalized-alias match first (cheap, precise),
 *  then a contains-match against the longest alias so "Yes: Loyalty Credit" still resolves. */
export function matchConcept(name: string): ConceptEntry | null {
  const norm = normalizeConcept(name)
  if (!norm) return null
  for (const { norm: a, entry } of ALIAS_INDEX) if (a === norm) return entry
  for (const { norm: a, entry } of ALIAS_INDEX) if (norm.includes(a) || a.includes(norm)) return entry
  return null
}

export function conceptByKey(key: string): ConceptEntry | undefined { return BY_KEY.get(key) }
