// lines/types.ts — pure type vocabulary for the Line Intelligence Registry.
// Describes ANY P&C line as data: family, exposure basis, trigger, limit shape,
// aggregate pattern, rating-stage templates, bureau rule semantics, document
// fingerprints, and a translation recipe. No platform imports; zero runtime code.
//
// NOTE on LineLimitStructure: the existing `LimitStructure` in ../types.ts describes
// how a Coverage term is shaped (SINGLE, SPLIT, CSL, …). This type describes how an
// entire LINE ARCHETYPE's limit programme is typically structured — different concept,
// different vocabulary. Distinct name avoids re-export collision in index.ts.

// ─── Line family ──────────────────────────────────────────────────────────────

export type LineFamily =
  | 'PERSONAL_PROPERTY'       // Homeowners, condo, renters (HO-2/3/4/5/6/8)
  | 'PERSONAL_AUTO'           // ISO PAP PP 00 01, state-filed equivalents
  | 'DWELLING'                // Dwelling Fire / Landlord (DP-1/2/3)
  | 'UMBRELLA'                // Personal and commercial excess / umbrella
  | 'INLAND_MARINE'           // Scheduled + blanket personal/commercial IM
  | 'FLOOD'                   // NFIP / private flood (Risk Rating 2.0)
  | 'COMMERCIAL_PROPERTY'     // ISO CP 00 10 + causes of loss forms
  | 'GENERAL_LIABILITY'       // ISO CGL CG 00 01 (occurrence) / CG 00 02 (CM)
  | 'COMMERCIAL_AUTO'         // ISO CA 00 01, symbol-based fleet/non-fleet
  | 'WORKERS_COMP'            // WC 00 00 00; NCCI/state-bureau payroll-based
  | 'PACKAGE'                 // BOP (BP 00 03) and Commercial Package (CPP)
  | 'MANAGEMENT_LIABILITY'    // D&O, EPL, Fiduciary — proprietary-dominant CM
  | 'CYBER'                   // First/third-party cyber, ransomware, BI — CM
  | 'PROFESSIONAL_LIABILITY'  // E&O, step-rated to maturity — CM
  | 'CRIME'                   // Commercial crime / fidelity, discovery form

// ─── Exposure basis ───────────────────────────────────────────────────────────

// How the rating exposure unit is measured. A line may support multiple bases
// (e.g. GL uses payroll OR gross sales depending on class code).
export type ExposureBase =
  | 'COVERAGE_A_AMOUNT'        // Homeowners / Dwelling — building insured value
  | 'PAYROLL_PER_100'          // WC and some GL classes — annual payroll ÷ 100
  | 'GROSS_SALES_PER_1000'     // GL retail/products class codes — sales ÷ 1000
  | 'PER_VEHICLE'              // Auto — per-unit (symbol-based)
  | 'PER_UNIT'                 // IM / BOP / umbrella — per-scheduled-item or unit
  | 'AREA'                     // CP / IM — square footage
  | 'REVENUE'                  // Cyber / PL / D&O — annual revenue or assets
  | 'PER_LOCATION'             // CP / BOP / flood — per insured location
  | 'REPLACEMENT_COST_VALUE'   // CP blanket — total insured value at replacement cost
  | 'FLAT'                     // Umbrella / crime / some IM — flat charge per policy

// ─── Trigger type ─────────────────────────────────────────────────────────────

// When the insuring agreement responds: at the time of the occurrence (property
// and occurrence-form GL), or at the time the claim is first made against the
// insured (PL, D&O, Cyber, CM GL). CLAIMS_MADE_WITH_RETRO adds a retroactive
// date so incidents before the retro date are also excluded.
export type TriggerType =
  | 'OCCURRENCE'
  | 'CLAIMS_MADE'
  | 'CLAIMS_MADE_WITH_RETRO'

// ─── Limit structure (archetype level) ────────────────────────────────────────

// Describes how a LINE's limit programme is typically structured in filings.
// Different from the Coverage-level LimitStructure in ../types.ts.
export type LineLimitStructure =
  | 'SPLIT'                            // BI per-person / per-accident / PD (auto)
  | 'CSL'                              // Combined single limit (auto / umbrella)
  | 'PER_OCCURRENCE_PLUS_AGGREGATE'    // GL occurrence + general aggregate
  | 'PER_OCCURRENCE_PLUS_TWO_AGGREGATES' // CGL full: occ + genAgg + PCO agg
  | 'SINGLE_AGGREGATE_WITH_SUBLIMITS'  // Cyber / D&O — one agg, per-IA sublimits
  | 'SCHEDULED'                        // IM — per-item scheduled values
  | 'BLANKET'                          // CP / IM — blanket TIV
  | 'PERCENTAGE_DEDUCTIBLE'            // Flood / coastal wind — % of insured value

// ─── Aggregate pattern ────────────────────────────────────────────────────────

// How the line's aggregate resets or is segmented.
export type AggregatePattern =
  | 'NONE'                              // No aggregate (personal lines per-occurrence)
  | 'GENERAL_AGGREGATE'                 // Single policy-period aggregate (CGL Cov A+B+C)
  | 'PRODUCTS_COMPLETED_OPS_AGGREGATE'  // Separate PCO aggregate (CGL Coverage A sub-agg)
  | 'PER_INSURING_AGREEMENT_SUBLIMIT'   // Cyber / D&O — per-IA cap within the aggregate
  | 'REINSTATED_BY_SERP'                // Aggregate reinstated by separate endorsement (rare)

// ─── Rating stage archetypes ──────────────────────────────────────────────────

// Named ordered-step templates that lower to the existing evaluator ops
// (SET | MUL | ADD | MIN_FLOOR) and sources (RT | LD | INPUT | CONST | SPP).
// Each template describes the SEQUENCE pattern; the fixture's RatingProgram
// contains the concrete steps with table refs and keys.
//
// Lowering map (authoritative in ratingKit.ts RATING_STAGE_LOWERING):
//   LOSS_COST_TIMES_LCM            → SET RT (territory) + MUL CONST (LCM scalar)
//   BASE_RATE_RELATIVITY_CHAIN     → SET RT (class/territory) + MUL RT (factor tables...)
//   KEY_FACTOR_CURVE               → MUL RT (key-factor table by coverage amount)
//   ILF_STEP                       → MUL RT (increased-limits table by limit)
//   EXPERIENCE_MOD                 → MUL RT or INPUT (e-mod scalar)
//   SCHEDULE_RATING_CAPPED         → MUL RT (schedule credit/debit, capped)
//   PREMIUM_CAPPING                → MUL CONST (capping factor; condition-gated)
//   MINIMUM_PREMIUM_FLOOR          → MIN_FLOOR CONST (min-premium scalar)
//   ADDITIVE_SCHEDULED_PREMIUMS    → ADD RT (per-SPP-item flat) or ADD INPUT (flat charge)
//   CLAIMS_MADE_STEP_FACTOR        → MUL RT (step-factor table by policy year 1..5+)
//   PACKAGE_MODIFICATION           → MUL RT or CONST (package discount/surcharge)
export type RatingStageArchetype =
  | 'LOSS_COST_TIMES_LCM'
  | 'BASE_RATE_RELATIVITY_CHAIN'
  | 'KEY_FACTOR_CURVE'
  | 'ILF_STEP'
  | 'EXPERIENCE_MOD'
  | 'SCHEDULE_RATING_CAPPED'
  | 'PREMIUM_CAPPING'
  | 'MINIMUM_PREMIUM_FLOOR'
  | 'ADDITIVE_SCHEDULED_PREMIUMS'
  | 'CLAIMS_MADE_STEP_FACTOR'
  | 'PACKAGE_MODIFICATION'

// ─── Document role fingerprint ────────────────────────────────────────────────

// Which document role this fingerprint identifies, using the same taxonomy the
// filing importer's classify stage uses (rate order, manual, policy form, …) plus
// additional regulatory document types (ERC packages, SERFF schedules).
export type DocumentRole =
  | 'RATE_ORDER'          // State regulator's order accepting the filing
  | 'MANUAL'              // Filed rating manual with factor tables and rules
  | 'POLICY_FORM'         // ISO or proprietary coverage form (the insuring agreement)
  | 'RULES'               // Underwriting / eligibility rules supplement
  | 'CLASS_TABLE'         // Classification table (class codes, SIC codes, NAICS)
  | 'TERRITORY_TABLE'     // Territory or ZIP-to-territory mapping table
  | 'DECLARATIONS'        // Declarations page or specimen declarations
  | 'ERC_PACKAGE'         // Experience Rating Calculation package (NCCI WC)
  | 'SERFF_SCHEDULE'      // SERFF filing schedule / transmittal

export interface DocumentRoleFingerprint {
  role:             DocumentRole
  /** Regex patterns or keyword tokens that signal this role in a document title or
   *  first-page text. Evaluated against the lower-cased, whitespace-normalised text. */
  signals:          string[]
  /** Weight contributed to this role's classification confidence [0, 1].
   *  Multiple signals are OR-ed; the highest-matching weight wins. */
  confidenceWeight: number
}

// ─── Translation recipe ───────────────────────────────────────────────────────

// Declarative mapping describing how this line's documents become platform entities
// (Product / Coverage / Rule / Form / LDTable / RTTable / RatingProgram). The
// adaptive importer (Prompt 12) will consume this to drive extraction and reconcile.
export interface TranslationRecipe {
  /** Regex that matches the authoritative base form number, e.g. "^(HO|LEM)\\s*00\\s*03". */
  primaryFormPattern: string
  /** Ordered rating-stage sequence the adaptive importer should expect in the rate order. */
  ratingProgramStructure: RatingStageArchetype[]
  /** How a multi-form upload splits into product entities. */
  productSplitStrategy:
    | 'SINGLE_PRODUCT'               // One product, one form (most lines)
    | 'SINGLE_PRODUCT_MULTI_FORM'    // One product, form variations as endorsements
    | 'SIBLING_PRODUCTS_PER_FORM'    // HO-3 vs HO-5: separate sibling products
  /** For SIBLING_PRODUCTS_PER_FORM: the identifying form-level dimension. */
  formSplitDimension?: string
  /** Default evaluator op for rate-order variables not matching a known concept. */
  defaultVariableOp: 'MUL' | 'ADD' | 'SET'
  /** Whether the rate order includes a carrier loss cost multiplier (LCM) step. */
  hasLcmStep: boolean
  /** Whether the rating program applies an experience modification factor. */
  hasExpMod: boolean
  /** Whether claims-made step factors ramp up to a mature rate over policy years. */
  hasClaimsMadeStepFactors: boolean
  /** Non-standard mapping notes (optional). */
  notes?: string
}

// ─── Bureau rule number semantics (per-archetype entry) ───────────────────────

// Each archetype declares which bureau numbering plan applies and what the
// key rule-number ranges mean. The global bureauRules.ts lookup is the runtime
// classifier; this entry is the archetype's own semantic annotation.
export interface BureauRuleNumberSemantics {
  bureau:      'ISO' | 'NCCI' | 'AAIS' | 'PROPRIETARY'
  rangeStart:  number
  rangeEnd:    number
  kind:        string   // ManualRuleKind or bureau-specific archetype label
  description: string
}

// ─── Line archetype ───────────────────────────────────────────────────────────

// The complete descriptor for one P&C line of business. Each registered line
// has exactly one LineArchetype. The adaptive importer resolves the archetype by
// family or by lobRefId to drive classification, extraction, and reconcile.
export interface LineArchetype {
  /** References a LobDefinition.refId in LOB_REGISTRY, or a virtual refId for
   *  lines not yet registered as seeded products (e.g. "WC.FAMILY"). */
  lobRefId:                   string
  displayName:                string
  family:                     LineFamily
  exposureBases:              ExposureBase[]
  triggerTypes:               TriggerType[]
  limitStructures:            LineLimitStructure[]
  aggregatePatterns:          AggregatePattern[]
  ratingStageArchetypes:      RatingStageArchetype[]
  bureauRuleNumberSemantics:  BureauRuleNumberSemantics[]
  documentRoleFingerprints:   DocumentRoleFingerprint[]
  translationRecipe:          TranslationRecipe
}
