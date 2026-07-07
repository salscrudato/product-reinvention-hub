// Shared domain types — mirror of every Firestore collection shape.
// Zero platform imports; consumed by both app (Vite) and functions (Node 20).

// ─── Governance ─────────────────────────────────────────────────────────────

export type Status       = 'ACTIVE' | 'INACTIVE' | 'FUTURE'
export type Lifecycle    = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'LAUNCHED'
export type ReviewStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'BUSINESS_REVIEW' | 'APPROVED' | 'REJECTED'
export type Role         = 'VIEWER' | 'EDITOR' | 'ADMIN'
export type Requirement  = 'MANDATORY' | 'OPTIONAL'
export type Source       = 'BUREAU' | 'PROPRIETARY'
export type TermKind     = 'LIMIT' | 'DEDUCTIBLE' | 'OPTION'

export interface GovernanceBlock {
  status:       Status
  lifecycle:    Lifecycle
  reviewStatus: ReviewStatus
  reviewer?:    string
  createdAt:    unknown   // Firestore Timestamp in Firebase; null/ISO in seed/wire
  updatedAt:    unknown
  updatedBy:    string
  rev:          number    // incremented by mutate(); conflict guard
}

export interface StateScope {
  allStates: boolean
  states:    string[]
}

// ─── Users ──────────────────────────────────────────────────────────────────

export interface User {
  email:              string
  name:               string
  role:               Role   // mirror of custom claim — claim is authoritative
  active:             boolean
  mustChangePassword: boolean
  createdAt:          unknown
}

// ─── Products ───────────────────────────────────────────────────────────────

export interface Product extends GovernanceBlock, StateScope {
  refId:         string | null
  name:          string
  lob:           { refId: string; name: string }
  description:   string
  marketSegment: string
  owner:         { uid: string; name: string }
  health:        { score: number; findingCount: number; updatedAt: unknown }
  // The uploaded base coverage form that gates + grounds AI coverage extraction.
  baseForm?:     { path: string; url: string; name: string; uploadedAt: unknown; uploadedBy: string } | null
}

// ─── Coverages ──────────────────────────────────────────────────────────────

// How a limit/deductible is *shaped* — mirrors how P&C filings express amounts.
export type LimitStructure =
  | 'SINGLE'                // one limit applies to all covered loss
  | 'OCCURRENCE_AGGREGATE'  // per-occurrence limit plus a policy aggregate
  | 'EACH_CLAIM_AGGREGATE'  // per-claim limit plus aggregate (claims-made lines)
  | 'SPLIT'                 // component limits, e.g. BI per person / per accident / PD
  | 'CSL'                   // combined single limit
  | 'SCHEDULED'             // per-item / scheduled values

export type DeductibleStructure =
  | 'FLAT'                  // fixed dollar amount
  | 'PERCENT'              // percentage of insured value or loss
  | 'PERCENT_MIN_MAX'      // percentage bounded by a dollar min & max
  | 'WAITING_PERIOD'       // time-based (hours/days), e.g. business income
  | 'SPLIT'                // separate deductibles by peril/component

// What a limit amount is measured against.
export type LimitBasis =
  | 'PER_OCCURRENCE' | 'AGGREGATE' | 'PER_PERSON' | 'PER_CLAIM' | 'PER_ITEM' | 'PER_LOCATION'

// The concrete kind of a single option value.
export type OptionValueType =
  | 'FLAT'           // dollar amount (value)
  | 'PERCENT'        // percentage (value = integer percent)
  | 'SPLIT'          // components in `parts`, e.g. [100000,300000,100000]
  | 'CSL'            // combined single limit (value)
  | 'SCHEDULED'      // scheduled/per-item cap (value)
  | 'WAITING_PERIOD' // hours (value = hours)

/** One standard, selectable option inside a limit/deductible term. Each option
 *  carries its own type, applicability (a StateScope), a default flag and an
 *  enabled flag so the option matrix models real filing variation — a limit
 *  offered only in some states, one marked the default, some disabled. Integrity
 *  the editor enforces: exactly one enabled option is the default; each option's
 *  applicability ⊆ its coverage's state scope; values stay within [min,max].
 *  (Distinct from `TermOption` below, which is the rules engine's availability I/O.) */
export interface StandardOption {
  id:              string
  type:            OptionValueType
  value:           number
  parts?:          number[]
  label?:          string          // display override; derived from value when absent
  allStates:       boolean
  states:          string[]
  isDefault:       boolean
  enabled:         boolean
  constraintNote?: string
}

export interface CoverageTerm {
  id:          string
  kind:        TermKind
  label:       string
  ldTableRef?: string
  options?:    (string | number)[]   // legacy flat option list (kept in sync w/ optionSet)
  min?:        number
  max?:        number
  default:     string | number | boolean
  basis:       string                // free-text legacy basis (e.g. "per occurrence")
  unit?:       string
  notes?:      string
  // ── Canonical typed model (optional; derived from the legacy fields above when
  //    absent, and written back on first edit). See shared/insurance/terms.ts. ──
  structure?:   LimitStructure | DeductibleStructure
  limitBasis?:  LimitBasis
  optionSet?:   StandardOption[]
}

export interface Coverage extends GovernanceBlock, StateScope {
  refId:             string | null
  name:              string
  parentId:          string | null   // null = top-level; set = sub-coverage
  order:             number
  requirement:       Requirement
  claimsBasis:       string
  premiumGenerating: boolean
  source:            Source
  formNumbers:       string[]
  terms:             CoverageTerm[]
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export type RuleCategory = 'PRODUCT' | 'RATING' | 'FORMS'

export interface Rule extends GovernanceBlock, StateScope {
  refId:           string | null
  category:        RuleCategory
  subCategory:     string
  condition:       string
  outcome:         string
  ldTableRef?:     string
  coverageRefIds:  string[]
  formNumbers:     string[]
}

export interface FormRule extends GovernanceBlock {
  refId:       string | null
  condition:   string
  outcome:     string
  formNumbers: string[]
  mandatory:   boolean
}

// ─── Rating ──────────────────────────────────────────────────────────────────

export interface RatingStep {
  id:        string
  order:     number
  label:     string
  op:        'SET' | 'MUL' | 'ADD' | 'MIN_FLOOR'
  source: {
    type:   'RT' | 'LD' | 'INPUT' | 'CONST' | 'SPP'
    ref?:   string    // RT/LD/SPP: table ref; INPUT: input field name
    keys?:  string[]  // RT: names of RatingInputs fields to use as lookup keys
    value?: number    // CONST: the constant value
  }
  condition?: string  // name of a boolean RatingInputs field; step skips when falsy
  roundTo?:   number  // decimal places to round running total after this step
}

export interface RatingProgram extends GovernanceBlock, StateScope {
  refId:          string
  name:           string
  minimumPremium: number
  steps:          RatingStep[]
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export interface LDRow {
  label:           string
  value:           number
  constraintNote?: string
}

export interface LDTable {
  name:          string
  defaultValue?: number
  rows:          LDRow[]
}

// rows layout is preserved as-is; lookup logic lives in the concrete getter
export interface RTTable {
  name:    string
  columns: string[]
  rows:    Record<string, unknown>[]
  // Grid-editor metadata — additive; absent on legacy tables handled by line-specific
  // getters. Setting dimensions does NOT change how existing getters read rows; it only
  // tells the grid UI how to render and write cells.
  dimensions?:  RTTableDimension[]
  valueColumn?: string   // column holding the factor/rate (inferred when absent)
}

/** Dimension descriptor for a grid-editor-managed RT table.
 *  Each dimension is a lookup key column; `values` is the PM-defined ordered list.
 *  Purely additive — absent on legacy hand-authored tables. */
export interface RTTableDimension {
  key:    string    // column name used as lookup key
  label?: string    // display label (falls back to key when absent)
  values: string[]  // ordered list of distinct values the PM defined
}

// ─── Forms ───────────────────────────────────────────────────────────────────

export type FormCategory        = 'BASE_COVERAGE' | 'DECLARATIONS' | 'ENDORSEMENT' | 'EXCLUSION' | 'AMENDATORY' | 'POLICY_NOTICE'
export type AttachmentCondition = 'RULE' | 'NONE'
export type DynamicFieldType    = 'TEXT' | 'CURRENCY' | 'DATE' | 'LIST' | 'PERCENT'

export interface DynamicField {
  name:       string
  dataType:   DynamicFieldType
  repeating:  boolean
  options?:   string[]
  notes?:     string
}

export interface Form extends GovernanceBlock, StateScope {
  number:              string
  name:                string
  edition:             string
  category:            FormCategory
  claimsBasis:         string
  dynamic:             boolean
  mandatoryDefault:    boolean
  attachmentCondition: AttachmentCondition
  source:              Source
  admitted:            boolean
  displayOnSchedule:   boolean
  multiUse:            boolean
  transactions:        string[]
  coverageParts:       string[]
  productRefIds:       string[]
  description:         string   // AI-generated plain English, cached
  dynamicFields:       DynamicField[]
}

// ─── Audit + Versions ─────────────────────────────────────────────────────────

export interface VersionDiff {
  field:  string
  before: unknown
  after:  unknown
}

export interface Version {
  entityType: string
  entityPath: string
  productId?: string
  snapshot:   unknown
  diff:       VersionDiff[]
  actor:      { uid: string; name: string }
  at:         unknown
}

export interface AuditEvent {
  actor:      { uid: string; name: string }
  action:     'create' | 'update' | 'delete'
  entityType: string
  entityPath: string
  productId?: string
  at:         unknown
}

// ─── Collaboration ───────────────────────────────────────────────────────────

export interface Comment {
  entityPath: string
  refId?:     string
  body:       string
  author:     { uid: string; name: string }
  resolved:   boolean
  at:         unknown
}

export type TaskColumn = 'IDEATION' | 'BUILD_FILE' | 'TEST_APPROVE' | 'LAUNCH_MONITOR'

export interface Task extends GovernanceBlock {
  title:      string
  column:     TaskColumn
  productId?: string
  assignee?:  { uid: string; name: string }
  dueAt?:     unknown
  checklist:  { t: string; done: boolean }[]
  order:      number
}

// ─── Feedback ────────────────────────────────────────────────────────────────

export type FeedbackType   = 'IDEA' | 'ISSUE' | 'PRAISE'
export type FeedbackStatus = 'NEW' | 'REVIEWING' | 'PLANNED' | 'SHIPPED' | 'DECLINED'

export interface Feedback {
  type:          FeedbackType
  title:         string
  detail:        string
  context:       { route: string; entityPath?: string; refId?: string }
  votes:         { count: number; voters: string[] }
  status:        FeedbackStatus
  impact:        1 | 2 | 3
  effort:        1 | 2 | 3
  priorityScore: number
  rank?:         number
  author:        { uid: string; name: string }
  createdAt:     unknown
  updatedAt:     unknown
}

// ─── News ────────────────────────────────────────────────────────────────────

export interface News {
  urlHash:           string
  url:               string
  source:            string
  title:             string
  summary:           string
  tags:              string[]
  relatedProductIds: string[]
  fetchedAt:         unknown
}

export interface NewsPrefs {
  instruction: string
  updatedAt:   unknown
}

// ─── Dictionary ──────────────────────────────────────────────────────────────

export interface DictionaryEntry extends GovernanceBlock {
  name:          string
  type:          DynamicFieldType
  description:   string
  allowedValues: string[]
  format:        string
  tags:          string[]
  usedIn:        { entityPath: string; label: string }[]
}

// ─── Search ──────────────────────────────────────────────────────────────────

export type SearchEntityType = 'product' | 'coverage' | 'rule' | 'form' | 'ldTable' | 'rtTable' | 'dictionary' | 'task'

export interface SearchIndexEntry {
  type:      SearchEntityType
  refId?:    string
  title:     string
  subtitle:  string
  path:      string
  keywords:  string[]
}

// ─── Seed Report ─────────────────────────────────────────────────────────────

export interface SeedReport {
  counts:                Record<string, number>
  warnings:              string[]
  workedExamplePremium:  number                  // HO-3 canary ($1,528) — kept for back-compat
  workedExamplePremiums?: Record<string, number> // per-product worked examples (HO-3, GL, …)
  at:                    unknown
}

// ─── Evaluator I/O ───────────────────────────────────────────────────────────

export interface SppItem {
  itemClass:       string
  appraisedValue:  number
}

/** The generic input bag the evaluator reads by key. Each line supplies its own
 *  concrete inputs shape — HO-3 `RatingInputs`, GL `GLRatingInputs` — and both
 *  satisfy this, so `evaluate()` stays line-agnostic (no Homeowners assumption).
 *  `sppItems` is typed because the SPP source kind reads it directly. */
export interface RatingInputMap {
  sppItems?:      SppItem[]
  [key: string]:  unknown
}

/** One field in a line's rating-input worksheet — drives the data-driven pricing
 *  panel for any line that isn't the bespoke HO-3 worksheet. Options may be inline
 *  or sourced from an LD table (`ldTableRef`) resolved at render time. */
export interface RatingInputField {
  key:         string
  label:       string
  kind:        'number' | 'select' | 'boolean' | 'text'
  options?:    { label: string; value: number | string }[]
  ldTableRef?: string
  step?:       number
  min?:        number
}

/** All inputs the HO-3 rating engine reads from a submission. */
export interface RatingInputs {
  territory:           string         // "T001".."T005"
  pc:                  number         // 1..10
  construction:        string         // "F" | "M"
  covA:                number         // dollars (e.g. 400000)
  allPerilDed:         number         // 500 | 1000 | 2500 | 5000
  windHailElected:     boolean
  windHailPct?:        number         // 1 | 2 | 5 (percent integer)
  covCPct:             number         // 50 | 70 | 75
  covELimit:           number         // 100000 | 300000 | 500000
  covFLimit:           number         // 1000 | 2000 | 5000
  rcElected:           boolean        // Personal Property Replacement Cost
  deviceCredit:        string         // "none" | "local" | "central"
  tier:                string         // "A" | "B" | "C"
  waterBackupElected:  boolean
  waterBackupLimit?:   number         // 5000 | 10000 | 25000
  sppElected:          boolean
  sppItems?:           SppItem[]
  [key: string]:       unknown        // allows generic INPUT source resolution
}

export interface TraceEntry {
  stepId:         string
  label:          string
  op:             'SET' | 'MUL' | 'ADD' | 'MIN_FLOOR'
  sourceRef:      string
  factorOrAmount: number
  rounded:        boolean
  runningTotal:   number
}

export interface EvaluatorResult {
  finalPremium: number
  trace:        TraceEntry[]
}

// ─── Rules Engine I/O ────────────────────────────────────────────────────────

// How the dwelling is occupied — the input the HO-3 eligibility rules read.
// PRIMARY_OWNER is the eligible base case; the others gate [HO.RU.001]/[HO.RU.010].
export type HoOccupancy = 'PRIMARY_OWNER' | 'TENANT_NONOWNER' | 'SEASONAL' | 'SECONDARY'

export interface SelectionContext {
  riskState:          string   // 2-letter state code
  covELimit:          number
  covFLimit:          number
  allPerilDed:        number
  windHailElected:    boolean
  windHailPct?:       number
  covA:               number
  rcElected:          boolean
  deviceCredit:       string
  waterBackupElected: boolean
  waterBackupLimit?:  number
  sppElected:         boolean
  dayCareCoverage:    boolean
  otherStructuresInc: boolean
  // Eligibility inputs [HO.RU.001]/[HO.RU.010]. Optional and default to an eligible
  // owner-occupied primary dwelling, so callers that don't collect occupancy keep
  // producing the same result (no spurious eligibility violation).
  occupancy?:         HoOccupancy
  companionPolicy?:   boolean   // a companion primary policy is in force (seasonal/secondary)
}

export interface TermOption {
  label:           string
  value:           number
  constraintNote?: string
  available:       boolean
  violationReason?: string
}

export interface RuleViolation {
  ruleRefId: string
  message:   string
  severity:  'error' | 'warning'
}

export interface RulesResult {
  availableOptions:   Record<string, TermOption[]>  // keyed by term ldTableRef
  formsThatAttach:    string[]                       // form numbers
  violations:         RuleViolation[]
  // Rule refIds whose conditions this engine actually evaluates (eligibility +
  // hard constraints). The Rules surface uses this to show a live satisfied/violated
  // state for those rules rather than mislabelling an engine-evaluated rule as merely
  // "documented". Rules gated purely by an LD table or a form attachment are already
  // reflected via availableOptions / formsThatAttach and need not appear here.
  evaluatedRuleRefIds: string[]
}

// Utility: unsubscribe function returned by realtime subscriptions
export type Unsubscribe = () => void

// ─── Task Templates ──────────────────────────────────────────────────────────

/** One entry in the lifecycle SLA set. Stored in Firestore `taskTemplates`
 *  (editable by ADMIN); the code constant is the fallback when that collection
 *  is empty. dueAt = projectStartDate + daysOffset calendar days. */
export interface TaskTemplate {
  title:      string
  column:     TaskColumn
  /** Days from project creation — the SLA value. */
  daysOffset: number
  /** Human-readable SLA label shown in the task prefill preview, e.g. "7 days". */
  slaLabel:   string
}
