// lineProfiles.ts — claims-copilot line profiles. The Claims copilot is FORM-DRIVEN:
// the ATTACHED coverage form is the authority, and the form self-identifies its line.
// This registry maps a detected line code to the framing the copilot needs — a short
// claims-analysis briefing (coverage trigger, limit/aggregate structure, common
// exclusion families) and example loss scenarios — so the prompt and UI are line-aware
// WITHOUT hard-coding any single line. An unrecognised form falls back to the generic
// profile, so an arbitrary P&C form is still handled gracefully.
//
// Deliberately SEPARATE from the portfolio LOB registry (insurance/lobRegistry.ts, which
// drives product segmentation): a claims form need not correspond to a seeded product, so
// adding a line here never ripples into Products/Explorer/segmentation. Pure TypeScript.

// The line codes the base-form identify pass emits (identify_form `lob` enum). 'GENERIC'
// is the fallback profile used for any form whose line is unknown or unrecognised.
export type ClaimsLineCode = 'HO' | 'PA' | 'GL'

export interface ClaimsLineProfile {
  code:        ClaimsLineCode | 'GENERIC'
  displayName: string          // full line name for chips/tooltips, e.g. "General Liability"
  // One tight paragraph the system prompt appends when this line is detected: the coverage
  // trigger, the limit / aggregate structure and reset semantics, and the common exclusion
  // families — the line-specific knowledge a coverage analyst applies. Framed as guidance to
  // apply against the attached form, never as invented facts; the FORM remains authoritative.
  briefing:    string
  // Example loss scenarios that exercise THIS line's coverage grants + exclusions — the
  // one-tap starters offered once a form of this line is selected. Empty for GENERIC.
  scenarios:   readonly string[]
}

// ─── Homeowners (first-party property + liability) ──────────────────────────────
const HO_PROFILE: ClaimsLineProfile = {
  code:        'HO',
  displayName: 'Homeowners',
  briefing:
    'HOMEOWNERS line (ISO HO-style, e.g. HO 00 03). First-party property + liability. Coverages A & B ' +
    '(dwelling / other structures) are insured against risk of direct physical loss on an OPEN-peril basis ' +
    'subject to the Section I exclusions; Coverage C (personal property) on NAMED perils; plus D–F (loss of ' +
    'use, personal liability, medical payments). Sudden & accidental water discharge is covered; ' +
    'constant/repeated seepage, gradual leakage, wear & tear and mold/fungus/wet rot are excluded; water ' +
    'backing up through sewers/drains or a sump is excluded under the base form unless a Water Back-Up ' +
    'endorsement is on the policy; flood/surface water is excluded. Limits are the Declarations Coverage A ' +
    'amount with percentage sublimits and an all-peril (plus optional wind/hail) deductible.',
  scenarios: [
    'A pipe burst and flooded the kitchen',
    'A tree fell on the roof during a windstorm',
    'A guest slipped on the icy front steps and was injured',
    'Jewelry was stolen during a break-in',
  ],
}

// ─── Personal Auto (ISO PAP) ────────────────────────────────────────────────────
const PA_PROFILE: ClaimsLineProfile = {
  code:        'PA',
  displayName: 'Personal Auto',
  briefing:
    'PERSONAL AUTO line (ISO PAP, e.g. PP 00 01). Four parts: A — Liability (bodily injury and property ' +
    'damage the insured is legally obligated to pay others); B — Medical Payments (reasonable medical ' +
    'expenses regardless of fault); C — Uninsured/Underinsured Motorists; D — Coverage for Damage to Your ' +
    'Auto (Collision on an actual-cash-value basis; Other Than Collision / Comprehensive for theft, weather, ' +
    'animal strikes, glass). Standard exclusions: wear & tear, mechanical/electrical breakdown, freezing, ' +
    'racing, public/livery use, intentional damage, certain resident-relative and business uses. Limits are ' +
    'the per-person / per-accident and per-part limits on the Declarations, less any Part D deductible. A ' +
    'bodily injury that is NOT auto-related is outside the PAP — answer NOT_ADDRESSED. Confirm the specific ' +
    'Part (A/B/C/D) before determining.',
  scenarios: [
    'An at-fault collision injured the other driver',
    'A hailstorm dented the hood and roof',
    'The car was stolen from a parking lot',
    'A deer ran into the car on the highway',
  ],
}

// ─── General Liability (ISO CGL) ────────────────────────────────────────────────
const GL_PROFILE: ClaimsLineProfile = {
  code:        'GL',
  displayName: 'General Liability',
  briefing:
    'GENERAL LIABILITY line (ISO CGL, e.g. CG 00 01). Third-party liability. Read the attached form to ' +
    'confirm its COVERAGE TRIGGER: the base CG 00 01 is OCCURRENCE-triggered (it responds to bodily injury / ' +
    'property damage that occurs during the policy period); a CLAIMS-MADE variant (e.g. CG 00 02) instead ' +
    'responds to claims first made during the period — never assume; the form states which. Coverage A — ' +
    'Bodily Injury & Property Damage Liability; Coverage B — Personal & Advertising Injury; Coverage C — ' +
    'Medical Payments. LIMIT STRUCTURE: an Each-Occurrence limit caps any single occurrence, but the total ' +
    'the insurer pays is capped by the GENERAL AGGREGATE (all Coverage A + B + C loss EXCEPT ' +
    'products-completed-operations) and a SEPARATE Products-Completed-Operations Aggregate; both aggregates ' +
    'RESET at the start of each policy period. COMMON EXCLUSION FAMILIES (base CG 00 01 Coverage A): ' +
    'expected/intended injury; contractual liability; liquor liability; workers’ comp & employer’s liability; ' +
    'pollution; aircraft/auto/watercraft; damage to the insured’s OWN product, work, or property in the ' +
    'insured’s care/custody/control; and recall of products/work. CGL is third-party only — it does not pay ' +
    'first-party damage to the insured’s own product or completed work. Confirm which Coverage (A/B/C) ' +
    'responds and which aggregate the loss erodes.',
  scenarios: [
    'A customer slipped and fell in the store aisle',
    'A product we manufactured injured a consumer',
    'Faulty work we completed damaged a client’s property',
    'A competitor says our advertisement libeled them',
  ],
}

// ─── Generic fallback (form-driven, no assumed line) ────────────────────────────
// Used for any form whose line is unknown/unrecognised. It teaches the model to derive
// everything from the attached form rather than assuming a specific line.
const GENERIC_PROFILE: ClaimsLineProfile = {
  code:        'GENERIC',
  displayName: 'this coverage form',
  briefing:
    'UNRECOGNISED LINE. Do not assume a line the form does not state. Read the attached form’s insuring ' +
    'agreement to determine what it covers and its COVERAGE TRIGGER (property: risk of direct physical loss; ' +
    'liability: occurrence vs claims-made). Identify its LIMIT STRUCTURE (single limits, or per-occurrence ' +
    'limits capped by one or more aggregates that reset each period) and apply the form’s OWN exclusions. ' +
    'Ground every conclusion in the form’s language and cite the section or form number.',
  scenarios: [],
}

const PROFILES: Record<ClaimsLineCode, ClaimsLineProfile> = {
  HO: HO_PROFILE,
  PA: PA_PROFILE,
  GL: GL_PROFILE,
}

/** The generic, no-assumed-line profile — the safe default for an unrecognised form. */
export const DEFAULT_CLAIMS_LINE_PROFILE = GENERIC_PROFILE

/** All named (non-generic) line profiles, in a stable order — for prompt/UI enumeration. */
export const CLAIMS_LINE_PROFILES: readonly ClaimsLineProfile[] = [HO_PROFILE, PA_PROFILE, GL_PROFILE]

/** Resolve the claims line profile for a detected line code. Case-insensitive; any code
 *  that is not a recognised line (empty, 'OTHER', unknown) resolves to the generic profile,
 *  so the copilot stays form-driven for an arbitrary uploaded form. */
export function resolveClaimsLineProfile(code?: string | null): ClaimsLineProfile {
  const c = (code ?? '').trim().toUpperCase()
  return (c in PROFILES ? PROFILES[c as ClaimsLineCode] : DEFAULT_CLAIMS_LINE_PROFILE)
}
