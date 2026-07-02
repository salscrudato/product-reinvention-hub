// Shared domain types — mirror of every Firestore collection shape in docs/DATA_MODEL.md.
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
}

// ─── Coverages ──────────────────────────────────────────────────────────────

export interface CoverageTerm {
  id:          string
  kind:        TermKind
  label:       string
  ldTableRef?: string
  options?:    (string | number)[]
  min?:        number
  max?:        number
  default:     string | number | boolean
  basis:       string
  unit?:       string
  notes?:      string
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

// ─── Share + Search ──────────────────────────────────────────────────────────

export interface ShareLink {
  productId:  string
  createdBy:  string
  expiresAt:  unknown
}

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
  workedExamplePremium:  number
  at:                    unknown
}

// ─── Evaluator I/O ───────────────────────────────────────────────────────────

export interface SppItem {
  itemClass:       string
  appraisedValue:  number
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
}

// Utility: unsubscribe function returned by realtime subscriptions
export type Unsubscribe = () => void
