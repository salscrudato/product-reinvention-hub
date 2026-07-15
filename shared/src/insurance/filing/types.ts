// filing/types.ts — the platform-free wire + domain shapes for the FILING importer, the
// platform's second ingestion mechanism (the ISO-workbook importer is the first). Where the
// workbook importer maps structured spreadsheets, this one turns the DOCUMENTS carriers
// actually file — a rate order of calculations, a rate manual, a policy form — into a
// reviewable, governed product.
//
// These shapes deliberately extend the existing grounded-extraction contract
// (insurance/extraction.ts): every proposal carries a 0..1 confidence and a citation, and the
// policyForm stage reuses that module's ExtractionResult verbatim rather than re-inventing a
// coverage model. The reconcile stage emits the SAME ImportPlan/PlannedEntity shape the
// workbook importer produces (insurance/isoImport.ts), so both ingestion paths share one
// persistence path (app/src/lib/import/importProduct.ts → adapter.db.mutate()).
//
// Zero platform imports — pure TypeScript, consumed by both functions/ (the SSE pipeline) and
// app/ (the review UI), and exercised deterministically by the gate.
import type { ExtractionResult } from '../extraction'
import type { ImportPlan } from '../isoImport'

// ─── CLASSIFY ────────────────────────────────────────────────────────────────────
// A filing is a SET of documents; the first job is to decide what each one is from
// structural cues (title lines, rate-order phrasing, numbered-rule density, a
// form-number-and-edition footer) — never from the filename alone.

export type FilingDocRole = 'rateOrder' | 'manual' | 'policyForm' | 'other'

export interface FilingDocClassification {
  name:       string          // the uploaded filename (for display + lineage)
  role:       FilingDocRole
  /** F13: additional roles this SAME document genuinely fulfils (e.g. a manual
   *  carrying a rate-order appendix). Never includes 'other' or the primary. */
  secondaryRoles?: FilingDocRole[]
  cue:        string          // the structural cue that decided the role — a citation
  confidence: number          // 0..1
}

// ─── EXTRACT · rate order of calculations ──────────────────────────────────────────
// The rate order is an ORDERED list of rating variables, each Premium (additive) or Factor
// (multiplicative), grouped into staged sub-totals, with per-form applicability columns and
// annotations that reference the maximum-credit and minimum-premium rules.

/** Operation a rate-order variable performs on the running premium.
 *  Premium → additive (ADD); Factor → multiplicative (MUL). */
export type FilingOp = 'ADD' | 'MUL'

/** The staged sub-totals of a homeowners-style rate order (standard filing anatomy). */
export type RateOrderStage =
  | 'BASE_LOSS_COST'      // ISO base loss cost × LCM × LCMF → Lemonade Base Loss Cost
  | 'BASE_PREMIUM'        // × protection-construction × key factor → Base Premium
  | 'ADJUSTED_BASE'       // × the long factor chain (tier/ded/characteristics/credits) → Adjusted Base
  | 'INCREASED_LIMIT'     // form-specific increased-dwelling chain (e.g. LEM 06)
  | 'ADDITIONAL_COVERAGE' // flat additional-coverage premiums summed into Total

export interface RateOrderVariable {
  name:       string          // e.g. "Tier", "All Perils Deductible", "Loyalty Credit"
  op:         FilingOp
  stage:      RateOrderStage
  forms:      string[]        // per-form applicability, e.g. ["HO3"] or ["HO3","HO4","HO6"]
  citation:   string
  confidence: number
}

export interface RateOrderExtraction {
  variables:         RateOrderVariable[]
  /** The referenced maximum-credit rule (e.g. "Rule 92") — drives the evaluator creditFloor. */
  maxCreditRuleRef?: string
  /** The referenced minimum-premium rule (e.g. "Rule 205") — drives the MIN_FLOOR step. */
  minPremiumRuleRef?: string
  note?:             string
}

// ─── EXTRACT · rate manual ─────────────────────────────────────────────────────────
// The manual carries ISO-style NUMBERED RULES whose semantics are stable across carriers
// (see filing/registry.ts). Each rule is classified, then either yields a TABLE (handed as a
// schema + verbatim source region to the deterministic parser) or SCALAR facts, or its
// eligibility/qualification prose becomes a Rule condition→outcome draft.

export type ManualRuleKind =
  | 'BASE_LOSS_COST'      // territory → loss cost (the SET seed of the chain)
  | 'FACTOR_TABLE'        // a 1-D or 2-D multiplicative factor table
  | 'SCALAR'              // a single factor / flat amount (e.g. LCM = 1.727)
  | 'DEDUCTIBLE'          // deductible factor matrix (covA band × deductible amount)
  | 'CREDIT_CAP'          // maximum-credit rule → program.creditFloor
  | 'MIN_PREMIUM'         // minimum premium (per-form dollar floors) → MIN_FLOOR
  | 'PREMIUM_CAP'         // renewal premium capping (documented, not evaluated)
  | 'SCHEDULED_PROPERTY'  // 3xx: scheduled-property rate per $100
  | 'PROTECTIVE_DEVICE'   // 4xx: protective-device credit factors
  | 'ENDORSEMENT_SCHEDULE'// 5xx/6xx: endorsement premium schedules
  | 'ELIGIBILITY'         // prose eligibility/qualification → a Rule draft
  | 'OTHER'

/** How the deterministic parser should read a table's rows out of its source-text region.
 *  The MODEL discovers this schema + the region boundaries; DETERMINISTIC code parses the
 *  rows (filing/tableParser.ts). The model never transcribes the rows itself. */
export interface ManualTableSchema {
  layout:       'triples' | 'matrix' | 'pairs'
  /** Dimension key column names in order. `triples`/`pairs`: the row-key columns; `matrix`:
   *  the single row-label dimension (the column dimension comes from `columnKeys`). */
  keyColumns:   string[]
  /** The looked-up value column name (factor/rate/lossCost/lcmf/charge). */
  valueColumn:  string
  /** `matrix` only: the column-header values that form the 2nd dimension (e.g. deductible
   *  amounts ["1000","2500","5000"]); the parser reads one value per column per row. */
  columnKeys?:  string[]
  /** The subset of `keyColumns` that are LOOKUP dimensions (the rest are descriptive row data,
   *  e.g. a zip→territory→factor table looks up by zip; territory is informational). Defaults to
   *  all keyColumns. Keeps a descriptive key from becoming a required query dimension. */
  lookupKeys?:  string[]
  /** The verbatim text region the deterministic parser reads. Bounded to the one table — NOT
   *  a structured transcription — so a mis-parse can never silently invent a factor. */
  rowRegion:    string
}

export interface ManualRule {
  ruleNumber: string           // "1", "2", "13", "92", "205", "406" — as printed
  title:      string
  kind:       ManualRuleKind
  /** Normalized concept key from the registry (filing/registry.ts) used to JOIN this rule to a
   *  rate-order variable and/or a form coverage. Empty when unrecognised. */
  concept:    string
  table?:     ManualTableSchema
  /** Scalar facts: a single factor, or per-form dollar floors (min premium), or a cap fraction. */
  scalars?:   { label: string; value: number; form?: string }[]
  /** Eligibility/qualification prose distilled into an IF→THEN draft. */
  ruleDraft?: { condition: string; outcome: string }
  citation:   string
  confidence: number
}

export interface ManualExtraction {
  rules: ManualRule[]
  note?: string
}

// ─── The full extraction bundle ─────────────────────────────────────────────────────

export interface FilingExtraction {
  classifications: FilingDocClassification[]
  rateOrder:       RateOrderExtraction
  manual:          ManualExtraction
  /** The policy form runs the EXISTING four-section extractCoverages machinery. */
  policyForm:      ExtractionResult
  /** Filing jurisdiction (2-letter), read from the manual/rate-order header. */
  filingState:     string
  /** The base policy form's self-identified number + edition (e.g. "LEM 03", "05 23"). */
  baseFormNumber:  string
  baseFormEdition: string
  /** Human product name inferred from the documents (e.g. "Lemonade Homeowners"). */
  productName:     string
}

// ─── RECONCILE output — one reviewable, governed bundle ─────────────────────────────
// A deterministic join of the three extractions into ONE proposal bundle. `plan` is the
// writable ImportPlan (reused by the persistence path); `review` is the staged, per-item
// display (confidence + citation); `unresolved` lists everything that could NOT be grounded
// — never guessed, never silently dropped. The counts prove the conservation law:
// proposed === accepted + unresolved.

/** A rate-order variable or manual fact that could not be resolved to a concrete
 *  RT/LD/scalar source (multiplicative) or rate schedule / flat premium (additive).
 *  'classify' entries (F13) are whole DOCUMENTS the extractors did not consume. */
export interface UnresolvedItem {
  stage:    'rateOrder' | 'manual' | 'policyForm' | 'classify'
  kind:     string          // e.g. "multiplicative-step", "additive-step", "table", "unprocessed-document"
  name:     string
  reason:   string          // why it could not be resolved
  citation: string          // where it came from — always present
}

/** One accepted proposal, shown in the review UI with its confidence + citation. `docId`
 *  links to the corresponding PlannedEntity in `plan` so per-item accept can filter it. */
export interface FilingReviewItem {
  section:    FilingReviewSectionKey
  label:      string
  refId?:     string
  docId?:     string
  confidence: number
  citation:   string
  /** For rating steps: the resolved op + source ref, for at-a-glance auditing. */
  detail?:    string
}

export type FilingReviewSectionKey = 'product' | 'coverages' | 'tables' | 'rules' | 'rating'

export interface FilingReviewSection { items: FilingReviewItem[]; note?: string }

export interface FilingImportPlan {
  /** Writable entities in the SAME shape the workbook importer produces (reused by
   *  app/src/lib/import/importProduct.ts). Coverages are parent-before-child ordered. */
  plan:            ImportPlan
  filingState:     string
  baseFormNumber:  string
  baseFormEdition: string
  review: {
    product:   FilingReviewSection
    coverages: FilingReviewSection
    tables:    FilingReviewSection
    rules:     FilingReviewSection
    rating:    FilingReviewSection
  }
  unresolved: UnresolvedItem[]
  /** The conservation law: proposed === accepted + unresolved (asserted by the golden test). */
  counts: { proposed: number; accepted: number; unresolved: number }
}
