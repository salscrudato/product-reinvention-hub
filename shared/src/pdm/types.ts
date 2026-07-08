// pdm/types.ts — the Product Data Model (PDM): a neutral, vendor-agnostic, LOSSLESS
// intermediate that describes an insurance product independently of any policy-admin
// platform. It is the pivot between our domain model (Product / Coverage / Form / Rule /
// RatingProgram / RTTable / LDTable) and any target export (Duck Creek today; others
// later). Pure TypeScript — zero platform imports, no Firebase, no AI.
//
// Design rules for this layer:
//   • Every node carries its `refId` (and forms additionally carry their form number),
//     because refIds and form-number chips are load-bearing and must survive end to end.
//   • Nothing is line-specific: Personal Home and Personal Auto both project into the
//     same shapes. Line nuance lives in `line` metadata, not in the node shapes.
//   • It is a projection, not a copy — but a lossless one for the constructs the export
//     targets care about (coverages, sub-coverages, typed limits/deductibles with their
//     eligible values, options, forms with editions + applicability, rating programs +
//     factor tables, rules as IF/THEN, and per-state variation).

// ─── State + effective-date applicability ─────────────────────────────────────
// The single way every node expresses "where / when this applies". `effectiveDate`
// is optional because our seed carries no dates; when a caller supplies one at build
// time it flows through unchanged (never fabricated — determinism + honesty).

export interface PdmApplicability {
  allStates:      boolean
  states:         string[]
  effectiveDate?: string   // ISO yyyy-mm-dd, only when explicitly supplied
}

// ─── Typed limits / deductibles / options ─────────────────────────────────────

export type PdmTermKind      = 'LIMIT' | 'DEDUCTIBLE' | 'OPTION'
export type PdmValueTypeKind =
  | 'FLAT' | 'PERCENT' | 'SPLIT' | 'CSL' | 'SCHEDULED' | 'WAITING_PERIOD' | 'FLAG'

/** One eligible (valid) value a term offers — the constrained value list. Mirrors a
 *  `StandardOption` but flattened for export, with its own applicability so a value
 *  offered only in some states round-trips. `value` is null for SPLIT / FLAG kinds. */
export interface PdmEligibleValue {
  id:             string          // stable id (option id or derived `opt-<value>`)
  label:          string          // human label (e.g. "$300,000", "5%")
  value:          number | null
  parts?:         number[]        // SPLIT components
  valueType:      PdmValueTypeKind
  isDefault:      boolean
  enabled:        boolean
  applicability:  PdmApplicability
  constraintNote?: string
}

/** A typed term on a coverage: a limit, a deductible, or an option/flag. Carries a
 *  derived, stable `refId` (`<coverageRefId>#<term key>`) so the term is addressable
 *  and round-trippable independently of its coverage. */
export interface PdmTerm {
  refId:          string
  key:            string          // the domain term id, e.g. "cov-e-limit"
  termKey:        string          // PascalCase semantic key for the target `t` attribute
  kind:           PdmTermKind
  label:          string
  structure:      string          // canonical structure (SINGLE / FLAT / PERCENT / …)
  basis:          string          // canonical limit basis (PER_OCCURRENCE / PER_PERSON / …)
  unit?:          string
  min?:           number
  max?:           number
  defaultValue:   string | number | boolean
  ldTableRef?:    string          // source LD table that supplied the value list, if any
  eligibleValues: PdmEligibleValue[]
  notes?:         string
  constraintNote?: string
}

// ─── Coverages (a tree: sub-coverages nested by parent) ───────────────────────

export type PdmRequirement = 'MANDATORY' | 'OPTIONAL'
export type PdmSource      = 'BUREAU' | 'PROPRIETARY'

export interface PdmCoverage {
  refId:             string
  name:              string
  termKey:           string        // PascalCase semantic key (e.g. "CoverageA") for the target `t`
  parentRefId:       string | null
  order:             number
  requirement:       PdmRequirement
  claimsBasis:       string
  premiumGenerating: boolean
  source:            PdmSource
  formNumbers:       string[]      // form-number chips — preserved verbatim
  section:           string        // LOB section label (e.g. "Section I — Property")
  applicability:     PdmApplicability
  terms:             PdmTerm[]
  children:          PdmCoverage[]  // sub-coverages, nested by parentRefId
}

// ─── Forms ────────────────────────────────────────────────────────────────────

export interface PdmFormEdition {
  edition:       string
  applicability: PdmApplicability   // state / effective-date attachment for this edition
}

export interface PdmDynamicField {
  name:      string
  dataType:  string
  repeating: boolean
  options?:  string[]
  notes?:    string
}

export interface PdmForm {
  refId:               string        // forms have no PH./PA. refId — the form number IS the ref
  formNumber:          string        // load-bearing chip — preserved verbatim
  name:                string
  edition:             string
  editions:            PdmFormEdition[]  // ≥1; edition + its state/effective applicability
  category:            string
  source:              PdmSource
  admitted:            boolean
  mandatoryDefault:    boolean
  attachmentCondition: string        // 'RULE' | 'NONE'
  dynamic:             boolean
  coverageParts:       string[]
  applicability:       PdmApplicability
  description:         string
  dynamicFields:       PdmDynamicField[]
}

// ─── Rating: programs (ordered steps) + factor tables ─────────────────────────

export type PdmRatingOp         = 'SET' | 'MUL' | 'ADD' | 'MIN_FLOOR'
export type PdmRatingSourceType = 'RT' | 'LD' | 'INPUT' | 'CONST' | 'SPP'

export interface PdmRatingStep {
  refId:      string          // `<programRefId>#<step key>`
  key:        string          // the domain step id, e.g. "s4a"
  order:      number
  label:      string
  op:         PdmRatingOp
  sourceType: PdmRatingSourceType
  tableRef?:  string          // RT/LD/SPP source table
  inputKeys?: string[]        // RT lookup keys / INPUT field name(s)
  constValue?: number         // CONST value
  condition?: string          // gating boolean input field
  roundTo?:   number
}

export interface PdmRatingProgram {
  refId:          string
  name:           string
  minimumPremium: number
  applicability:  PdmApplicability
  steps:          PdmRatingStep[]
}

export type PdmTableKind = 'RT' | 'LD'

export interface PdmTableDimension {
  key:    string
  label:  string
  values: string[]
}

/** A factor / rate / limit table. Grid-modellable tables carry `dimensions` + a single
 *  `valueColumn`; hand-authored range/multi-value tables carry an empty `dimensions`
 *  array and preserve their raw `columns` + `rows` (custom layout) losslessly. */
export interface PdmRatingTable {
  refId:        string
  name:         string
  kind:         PdmTableKind
  columns:      string[]
  valueColumn:  string | null
  dimensions:   PdmTableDimension[]
  rows:         Record<string, unknown>[]
  defaultValue?: number   // LD tables only
}

// ─── Rules (IF / THEN) ────────────────────────────────────────────────────────

export type PdmRuleType =
  | 'ELIGIBILITY' | 'COVERAGE' | 'RATING' | 'FORM_ATTACH'

export interface PdmRule {
  refId:          string
  ruleType:       PdmRuleType
  category:       string          // domain category (PRODUCT / RATING / FORMS)
  subCategory?:   string
  condition:      string          // IF …
  actions:        string[]        // THEN … (one or more)
  coverageRefIds: string[]
  formNumbers:    string[]
  ldTableRef?:    string
  mandatory?:     boolean         // form-attach rules
  applicability:  PdmApplicability
}

// ─── Line-of-business metadata ────────────────────────────────────────────────

export interface PdmLine {
  refId:                string
  code:                 string     // "PH" | "PA"
  name:                 string     // "Personal Home"
  compactName:          string     // "PersonalHome" (no spaces — Duck Creek line Type)
  displayName:          string
  vertical:             string
  family:               string
  lineCategory:         string
  personalOrCommercial: string
  perilModel:           { kind: string; eligibleStates: string[]; label: string }
  sections:             { label: string; shortName: string }[]
  footprintStates:      string[]
}

// ─── Product (the PDM root) ───────────────────────────────────────────────────

export interface PdmProduct {
  refId:          string
  name:           string
  description:    string
  marketSegment:  string
  line:           PdmLine
  applicability:  PdmApplicability
  coverages:      PdmCoverage[]      // top-level; sub-coverages nested in `children`
  forms:          PdmForm[]
  rules:          PdmRule[]
  ratingPrograms: PdmRatingProgram[]
  ratingTables:   PdmRatingTable[]   // RT + LD unified
}

// ─── Traversal helpers (pure) ─────────────────────────────────────────────────

/** Every coverage in the tree, depth-first, parents before children — a flat list for
 *  counting / lookups without losing the nested structure the tree preserves. */
export function flattenCoverages(coverages: PdmCoverage[]): PdmCoverage[] {
  const out: PdmCoverage[] = []
  const walk = (c: PdmCoverage): void => {
    out.push(c)
    for (const child of c.children) walk(child)
  }
  for (const c of coverages) walk(c)
  return out
}

/** Every term across every coverage in the product. */
export function allTerms(product: PdmProduct): PdmTerm[] {
  return flattenCoverages(product.coverages).flatMap(c => c.terms)
}
