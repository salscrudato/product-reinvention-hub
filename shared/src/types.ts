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

// ─── Provenance / lineage ─────────────────────────────────────────────────────
// A draft product records what it leveraged so its origin is always visible and
// auditable. `sources` cite REAL entities (an existing product/coverage/form refId,
// an uploaded workbook filename, or the LOB it was scaffolded against) — the same
// grounding discipline the AI paths follow, so provenance is never invented.

export type LineageKind = 'BLANK' | 'IMPORT' | 'CLONE' | 'AI_SCAFFOLD'

export interface LineageSource {
  type: 'product' | 'coverage' | 'form' | 'file' | 'lob'
  ref:  string            // product/coverage refId, form number, filename, or LOB refId
  name?: string           // human label, when the ref alone isn't self-describing
}

export interface Lineage {
  kind:    LineageKind
  summary: string                     // one-line human description of the origin
  sources: LineageSource[]            // what this draft cloned / imported / leveraged
  by:      { uid: string; name: string }
  at:      unknown                    // ISO string in seed/wire; Timestamp in Firebase
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
  // The uploaded base coverage form that gates + grounds AI coverage extraction.
  // Required at product-create time (see NewProductModal / ScaffoldProductModal);
  // the identify pass fills in formNumber/title/edition/lob when the form states them.
  baseForm?:     {
    path: string; url: string; name: string; uploadedAt: unknown; uploadedBy: string
    formNumber?: string; title?: string; edition?: string; lob?: string
  } | null
  // Provenance — set on drafts (import/clone/scaffold/blank). Absent on legacy/seeded
  // products. Display-only; never gates behaviour, so leaving it off is always safe.
  lineage?:      Lineage | null
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
  notes?:          string
  constraintNote?: string   // display-only note about a coverage term constraint
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
  actor:        { uid: string; name: string }
  action:       'create' | 'update' | 'delete' | 'export-duckcreek'
  entityType:   string
  entityPath:   string
  productId?:   string
  // export-duckcreek only: the manuScriptID that was emitted in the downloaded file.
  manuScriptID?: string
  at:           unknown
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

// ─── GTM launch tracker ────────────────────────────────────────────────────────
// A Project is a product launch with a hard deadline; its board is seeded from the
// generic L1–L4 insurance product process, back-scheduled so the last pre-launch task
// lands exactly on the deadline. See shared/src/gtm + shared/src/seed/gtmProcess.ts.

/** The kind of work a task represents — drives the coloured work-type chip. */
export type TypeOfWork =
  | 'Differentiating' | 'Analytical' | 'Transactional' | 'Regulatory / Compliance'

/** How a board task got here: 'seeded' from the process template, or an 'adhoc' one-off. */
export type TaskOrigin  = 'seeded' | 'adhoc'
export type ProjectStatus = 'planning' | 'active' | 'launched' | 'archived'

/** A product launch with a deadline. Its tasks (below) are scoped by `projectId`.
 *  Not a governed insurance entity, so it carries its own lean `status` rather than a
 *  GovernanceBlock — but every write still flows through mutate() (createdAt/updatedAt/
 *  updatedBy + the `rev` conflict guard are written by the atomic envelope). */
export interface Project {
  refId:            string | null      // line-style id chip (PRJ.NNN), minted at the write seam
  name:             string
  description:      string
  productId?:       string | null      // optional link to a Product
  targetLaunchDate: string             // ISO yyyy-mm-dd — the launch deadline (the schedule pivot)
  status:           ProjectStatus
  owner:            { uid: string; name: string }
  createdAt:        unknown
  updatedAt:        unknown
  updatedBy?:       string
  rev:              number
}

export interface Task extends GovernanceBlock {
  title:         string
  /** The board column — the four GTM columns map onto this canonical enum. */
  column:        TaskColumn
  productId?:    string
  assignee?:     { uid: string; name: string }
  /** Canonical due date. ISO string on GTM board tasks (null on ongoing governance);
   *  a Firestore Timestamp on legacy product tasks. Read via a millis coercion. */
  dueAt?:        unknown
  checklist:     { t: string; done: boolean }[]
  order:         number
  /** Completed tasks grey out and sort to the bottom / into the Completed section. */
  done?:         boolean
  /** Planned effort in working days (e.g. "market research" = 5). Illustrative timing. */
  durationDays?: number
  // ── GTM launch-tracker fields (additive; present on project-board tasks only) ──
  projectId?:    string          // owning Project — board tasks are scoped by this
  origin?:       TaskOrigin       // 'seeded' from the process, or an 'adhoc' one-off
  phaseL2?:      string           // process lineage — L2 phase (e.g. "Product Design")
  groupL3?:      string           // process lineage — L3 group (e.g. "Product Pricing")
  taskL4?:       string           // process lineage — L4 task (mirrors `title`)
  phaseOrder?:   number           // 1..5; ≤4 pre-launch, 5 = post-launch governance
  slaDays?:      number           // business-day SLA the backward schedule used
  ownerRole?:    string           // owning role (e.g. "Product Mgr.") — a role, not a person
  typeOfWork?:   TypeOfWork       // work-type colour chip
  startDate?:    string | null    // ISO — back-scheduled start (drives the runway geometry)
  ongoing?:      boolean          // governance task with no fixed due date
  // Board completion is `done` (+ `completedAt`); `status`/`lifecycle` stay the governance
  // enum on GovernanceBlock and are unused by the tracker (never written on task creates).
  completedAt?:  unknown          // ISO when marked done; null when reopened (Completed sort)
}

// ─── Feedback ────────────────────────────────────────────────────────────────

export type FeedbackType   = 'IDEA' | 'ISSUE' | 'PRAISE'
export type FeedbackStatus = 'NEW' | 'REVIEWING' | 'PLANNED' | 'SHIPPED' | 'DECLINED'

export interface Feedback {
  type:           FeedbackType
  title:          string
  detail:         string
  // `label` is the human surface name (e.g. "Personal Home · Coverages"); `entityPath`
  // + `refId` pin the exact coverage/form/rule the user was viewing when they submitted.
  context:        { route: string; label?: string; entityPath?: string; refId?: string }
  votes:          { count: number; voters: string[] }
  status:         FeedbackStatus
  impact:         1 | 2 | 3
  effort:         1 | 2 | 3
  priorityScore:  number
  rank?:          number
  // AI-shaped story fields (additive; the capture drawer turns raw input into a structured
  // story before it lands). All optional so pre-shaping and seed records stay valid.
  userStory?:          string     // "As a … I want … so that …" one-liner narrative
  acceptanceCriteria?: string[]   // 2..4 testable "done" bullets
  reproSteps?:         string[]   // ISSUE only — ordered steps to reproduce
  likelyFiles?:        string[]   // ISSUE only — grounded repo paths for the affected surface
  // A deploy-ready Claude Code implementation brief the AI writes for this story. Sensitive
  // (it names files/approach) so the UI reveals it to the maintainer only — never invented.
  implementationPrompt?: string
  author:         { uid: string; name: string }
  screenshotUrl?:  string
  // Supporting documents/images the submitter attached (Storage URLs) — fed to the AI vision/
  // document pass and kept for reference. `mediaType` drives how each is rendered/downloaded.
  attachments?:    { name: string; url: string; mediaType: string }[]
  completionNote?: string
  createdAt:       unknown
  updatedAt:       unknown
}

// ─── News ────────────────────────────────────────────────────────────────────

export interface NewsImage {
  url?:           string   // absolute https URL; omitted when kind='generated'
  kind:           'og' | 'twitter' | 'inline' | 'generated'
  dominantColor?: string   // hex color or deterministic fallback
  alt:            string   // always present, defaults to article title
}

export interface News {
  urlHash:           string
  url:               string
  source:            string
  title:             string
  summary:           string         // card lead sentence + legacy fallback
  bullets:           string[]       // 3 structured PM takeaways (What/Who/Why); 2 when only 2 are substantiated
  imageUrl?:         string         // DEPRECATED: absolute https hero image; omitted when none found (backward compat)
  imageAlt?:         string         // DEPRECATED: alt text for the hero image (backward compat)
  image?:            NewsImage      // structured image metadata (additive; docs without it are still valid)
  tags:              string[]
  relatedProductIds: string[]
  fetchedAt:         unknown
}

export interface NewsPrefs {
  instruction:   string
  pinnedHashes?: string[]   // SHA-1 url hashes the user has pinned
  updatedAt:     unknown
}

// ─── Dictionary ──────────────────────────────────────────────────────────────

export interface DictionaryEntry extends GovernanceBlock {
  // Citable definition id — the traceability token the grounded AI cites in brackets,
  // e.g. [DEF.003]. Seeded terms use a line prefix (HO.DEF.001, PA.DEF.001); terms a
  // user creates in-app get a neutral DEF.NNN. Nullable to mirror the other refId shapes.
  refId:         string | null
  name:          string
  type:          DynamicFieldType
  description:   string
  allowedValues: string[]
  format:        string
  tags:          string[]
  // Curated match synonyms — the surface forms this term/field actually appears under in
  // coverage/rule/form text (e.g. "NamedInsured" for "Named Insured"). Drives the computed
  // "used in" back-references. Optional + additive; matching always includes `name`.
  aliases?:      string[]
  // "Used in" back-references are computed LIVE from the current coverages/forms/rules via
  // computeDictionaryUsage() — never persisted — so they can never go stale. Kept optional
  // for wire/back-compat; do not rely on a stored value.
  usedIn?:       { entityPath: string; label: string }[]
}

// ─── Search ──────────────────────────────────────────────────────────────────

export type SearchEntityType = 'product' | 'coverage' | 'rule' | 'form' | 'ldTable' | 'rtTable' | 'dictionary' | 'task' | 'project'

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
  workedExamplePremiums?: Record<string, number> // per-product worked examples (HO-3, Personal Auto, …)
  at:                    unknown
}

// ─── Evaluator I/O ───────────────────────────────────────────────────────────

export interface SppItem {
  itemClass:       string
  appraisedValue:  number
}

/** The generic input bag the evaluator reads by key. Each line supplies its own
 *  concrete inputs shape — the Homeowners `RatingInputs` bag, the Personal Auto
 *  worked-example inputs — and both satisfy this, so `evaluate()` stays line-agnostic
 *  (no Homeowners assumption). `sppItems` is typed because the SPP source kind reads it directly. */
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

// How a vehicle is used — the input the PA eligibility rule reads [PA.RU.001].
// 'personal' is the eligible base case; 'commercial' is ineligible for PP 00 01.
export type PaVehicleUse = 'personal' | 'commercial'

/** Submission context the Personal Auto rules engine reads. Each field maps
 *  directly to a PA rule or LD table so every engine branch is traceable. */
export interface PASelectionContext {
  riskState:            string          // 2-letter garaging-state code
  vehicleUse:           PaVehicleUse    // personal vs commercial [PA.RU.001]
  biLimit:              number          // elected BI per-person limit (PA.LD.001)
  pdLimit:              number          // elected PD per-occurrence limit (PA.LD.002)
  medPayElected:        boolean         // Part B elected
  medPayLimit?:         number          // PA.LD.003 (when medPayElected)
  umElected:            boolean         // Part C UM/UIM elected [PA.RU.006]
  umLimit?:             number          // PA.LD.004; must be ≤ biLimit [PA.RU.007]
  collisionElected:     boolean         // Part D Collision elected
  collisionDed?:        number          // PA.LD.005 (when collisionElected)
  compElected:          boolean         // Part D Comprehensive elected
  compDed?:             number          // PA.LD.006 (when compElected)
  rentalElected:        boolean         // Rental Reimbursement; requires physical damage [PA.RU.008]
  towingElected:        boolean         // Towing and Labor; requires physical damage [PA.RU.009]
  loanLeaseGapElected?: boolean         // when true → PP 04 46
  namedNonOwner?:       boolean         // when true → PP 03 01
}

/** Submission context the General Liability rules engine reads. Maps directly to
 *  GL rules and LD tables so every engine branch is traceable to its rule refId. */
export interface GLSelectionContext {
  riskState:            string   // 2-letter state code (for state-specific endorsements)
  classCode:            string   // ISO GL class code (e.g. '41677')
  occLimit:             number   // per-occurrence limit (GL.LD.001) [GL.RU.007 checks ≤ genAgg]
  genAggregate:         number   // General Aggregate (GL.LD.002)
  occDeductible:        number   // BI/PD per-occurrence deductible (GL.LD.004)
  pcoElected:           boolean  // Products-Completed-Operations elected [GL.RU.003]
  pcoAggregate?:        number   // PCO Aggregate (GL.LD.003); required when pcoElected [GL.RU.003]
  additionalInsuredReq: boolean  // additional insured required by contract [GL.FORM.RU.003]
}

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
  /** Optional phase/category label (e.g. "Product Research", "Product Pricing"),
   *  used only to group the task-selection picker; not persisted on the Task. */
  group?:     string
}
