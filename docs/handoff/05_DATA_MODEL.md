# 05_DATA_MODEL.md — Data Model, Firestore Schema, and TypeScript Contracts

## Canonical Source
All domain types: `shared/src/types.ts`. Zero platform imports — consumed by both `app/` (Vite) and `functions/` (Node 20).

---

## Firestore Collection Inventory

| Collection | Document key | Client access | Server writes | Notes |
|---|---|---|---|---|
| `users/{uid}` | Firebase Auth UID | ADMIN R/W; own doc read | `setUserRole` callable | Mirrors JWT custom claim (claim is authoritative) |
| `products/{pid}` | Auto ID | Any authed read; EDITOR+ write | Admin SDK (seed) | Top-level product entity |
| `products/{pid}/coverages/{cid}` | Auto ID | Same as parent | Admin SDK (seed) | Sub-collection per product |
| `products/{pid}/rules/{rid}` | Auto ID | Same as parent | Admin SDK (seed) | Sub-collection per product |
| `products/{pid}/formRules/{id}` | Auto ID | Same as parent | Admin SDK (seed) | Sub-collection per product |
| `products/{pid}/ratingPrograms/{gid}` | Auto ID | Same as parent | Admin SDK (seed) | Sub-collection per product |
| `forms/{formKey}` | Form number (e.g. `HO 00 03`) | Any authed read; EDITOR+ write | Admin SDK (seed) | Cross-product; `productRefIds[]` back-links |
| `ldTables/{refId}` | refId (e.g. `HO.LD.001`) | Any authed read; EDITOR+ write | Admin SDK (seed) | Limit/Deductible option tables |
| `rtTables/{refId}` | refId (e.g. `HO.RT.001`) | Any authed read; EDITOR+ write | Admin SDK (seed) | Rate factor tables |
| `dictionary/{id}` | Auto ID | Any authed read; EDITOR+ write | Admin SDK (seed) | Field definitions + usedIn (computed live) |
| `tasks/{id}` | Auto ID | Any authed read; EDITOR+ write | — | Product tasks + GTM board tasks |
| `projects/{id}` | Auto ID | Any authed read; EDITOR+ write | — | GTM launch projects |
| `feedback/{id}` | Auto ID | Any authed read; VIEWER create + vote; EDITOR+ manage | `shapeFeedback` | Product feedback items |
| `comments/{id}` | Auto ID | Any authed read; VIEWER create; EDITOR+ update/delete | — | Entity-level threaded comments |
| `news/{id}` | Auto ID | Any authed read; ADMIN write | `nightlyNews`/`refreshNews` | Market news items |
| `newsPrefs/{uid}` | Firebase Auth UID | Own doc R/W | — | Per-user news preferences + pinned hashes |
| `baseForms/{id}` | Auto ID | Any authed read; EDITOR+ write | — | Claims analysis form library |
| `searchIndex/{id}` | Auto ID | Any authed read; EDITOR+ write | `mutate()` + invalidation triggers | Flat search entries for global explorer |
| `seedReports/{id}` | Auto ID | Any authed read | Admin SDK (seed script) | Canary premium + counts per seed run |
| `meta/{doc}` | Document name | Any authed read | Admin SDK (functions) | Lightweight version signals |
| `productSummaries/{pid}` | Product ID | Any authed read | `summarizeProduct` callable (Admin SDK) | AI-generated product summary cache |
| `presence/{pid}/viewers/{uid}` | UID | Any authed read; own write | — | Viewer heartbeats per product |
| `taskTemplates/{id}` | Auto ID | Any authed read; ADMIN write | — | GTM task SLA config |
| `auditEvents/{id}` | Auto ID | ADMIN read; any authed create | `mutate()` | Append-only event log |
| `versions/{id}` | Auto ID | Any authed read; any authed create | `mutate()` | Point-in-time snapshots + diffs |
| `aiUsage/{id}` | Auto ID | ADMIN read | `telemetry.ts` (Admin SDK) | AI call cost telemetry |
| `groundingChunks/{id}` | Auto ID | Server-only (all deny client) | `reindexGrounding` (Admin SDK) | RAG chunk vectors; Firestore KNN index |
| `semanticCache/{id}` | Auto ID | Server-only (all deny client) | `semanticCache.ts` (Admin SDK) | Semantic response cache; KNN index |
| `costCounters/{id}` | Day/feature/session key or `breaker-anthropic` | Server-only (all deny client) | `costGuard.ts` (Admin SDK) | Rolling spend counters + circuit breaker |

**Composite Indexes (firestore.indexes.json):**
- `tasks`: `column ASC, order ASC`
- `feedback`: `status ASC, priorityScore DESC`
- `versions`: `entityPath ASC, at DESC`
- `auditEvents`: `productId ASC, at DESC`
- `searchIndex`: `type ASC, title ASC`
- `groundingChunks`: `embedding` vector (dimension: 1024, flat)
- `semanticCache`: `embedding` vector (dimension: 1024, flat)

---

## Governance Block (mixin on most entities)

`shared/src/types.ts:16-25`

```ts
interface GovernanceBlock {
  status:       'ACTIVE' | 'INACTIVE' | 'FUTURE'
  lifecycle:    'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'LAUNCHED'
  reviewStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'BUSINESS_REVIEW' | 'APPROVED' | 'REJECTED'
  reviewer?:    string
  createdAt:    Timestamp | string | null
  updatedAt:    Timestamp | string | null
  updatedBy:    string
  rev:          number   // optimistic concurrency guard; incremented by mutate()
}
```

---

## Entity Schemas

### Product (`products/{pid}`)

```ts
interface Product extends GovernanceBlock, StateScope {
  refId:         string | null        // e.g. "HO.PROD.001"
  name:          string
  lob:           { refId: string; name: string }   // e.g. { refId: "HO", name: "Homeowners" }
  description:   string
  marketSegment: string
  owner:         { uid: string; name: string }
  baseForm?: {
    path: string; url: string; name: string; uploadedAt: unknown; uploadedBy: string
    formNumber?: string; title?: string; edition?: string; lob?: string
  } | null
  lineage?: {
    kind:    'BLANK' | 'IMPORT' | 'CLONE' | 'AI_SCAFFOLD'
    summary: string
    sources: { type: 'product'|'coverage'|'form'|'file'|'lob'; ref: string; name?: string }[]
    by:      { uid: string; name: string }
    at:      unknown
  } | null
}

interface StateScope {
  allStates: boolean
  states:    string[]   // 2-letter state codes
}
```

### Coverage (`products/{pid}/coverages/{cid}`)

```ts
interface Coverage extends GovernanceBlock, StateScope {
  refId:             string | null   // e.g. "HO.COV.001", "PA.COV.001.001"
  name:              string
  parentId:          string | null   // null = top-level; set = sub-coverage (nested tree)
  order:             number
  requirement:       'MANDATORY' | 'OPTIONAL'
  claimsBasis:       string
  premiumGenerating: boolean
  source:            'BUREAU' | 'PROPRIETARY'
  formNumbers:       string[]
  terms:             CoverageTerm[]
}

interface CoverageTerm {
  id:          string
  kind:        'LIMIT' | 'DEDUCTIBLE' | 'OPTION'
  label:       string
  ldTableRef?: string
  options?:    (string | number)[]   // legacy flat list
  min?:        number
  max?:        number
  default:     string | number | boolean
  basis:       string
  unit?:       string
  // Canonical typed model (optional; additive)
  structure?:  LimitStructure | DeductibleStructure
  limitBasis?: LimitBasis
  optionSet?:  StandardOption[]
}

// StandardOption — one selectable value in a limit/deductible term
interface StandardOption {
  id:              string
  type:            'FLAT' | 'PERCENT' | 'SPLIT' | 'CSL' | 'SCHEDULED' | 'WAITING_PERIOD'
  value:           number
  parts?:          number[]       // SPLIT: component values
  label?:          string
  allStates:       boolean
  states:          string[]
  isDefault:       boolean
  enabled:         boolean
  constraintNote?: string
}
```

### Rule (`products/{pid}/rules/{rid}`)

```ts
interface Rule extends GovernanceBlock, StateScope {
  refId:          string | null   // e.g. "HO.RU.001", "PA.RU.006"
  category:       'PRODUCT' | 'RATING' | 'FORMS'
  subCategory:    string          // e.g. "Eligibility", "Premium Adjustment"
  condition:      string          // IF clause
  outcome:        string          // THEN clause
  ldTableRef?:    string
  coverageRefIds: string[]
  formNumbers:    string[]
}
```

### FormRule (`products/{pid}/formRules/{id}`)

```ts
interface FormRule extends GovernanceBlock {
  refId:       string | null
  condition:   string
  outcome:     string
  formNumbers: string[]
  mandatory:   boolean
}
```

### RatingProgram + Steps (`products/{pid}/ratingPrograms/{gid}`)

```ts
interface RatingProgram extends GovernanceBlock, StateScope {
  refId:          string    // e.g. "HO.RAT.1", "PA.RAT.1"
  name:           string
  minimumPremium: number
  steps:          RatingStep[]
}

interface RatingStep {
  id:        string
  order:     number
  label:     string
  op:        'SET' | 'MUL' | 'ADD' | 'MIN_FLOOR'
  source: {
    type:   'RT' | 'LD' | 'INPUT' | 'CONST' | 'SPP'
    ref?:   string       // RT/LD/SPP: table refId; INPUT: input field key
    keys?:  string[]     // RT: lookup key column names
    value?: number       // CONST
  }
  condition?: string     // name of a boolean input field; step skips when falsy
  roundTo?:   number
}
```

### Form (`forms/{formKey}`)

```ts
interface Form extends GovernanceBlock, StateScope {
  number:              string    // e.g. "HO 00 03", "PP 00 01"
  name:                string
  edition:             string    // e.g. "10 00"
  category:            'BASE_COVERAGE' | 'DECLARATIONS' | 'ENDORSEMENT' | 'EXCLUSION' | 'AMENDATORY' | 'POLICY_NOTICE'
  claimsBasis:         string
  dynamic:             boolean
  mandatoryDefault:    boolean
  attachmentCondition: 'RULE' | 'NONE'
  source:              'BUREAU' | 'PROPRIETARY'
  admitted:            boolean
  displayOnSchedule:   boolean
  multiUse:            boolean
  transactions:        string[]
  coverageParts:       string[]
  productRefIds:       string[]   // back-links to owning products
  description:         string     // AI-generated; cached
  dynamicFields:       DynamicField[]
}
```

### LDTable (`ldTables/{refId}`)

```ts
interface LDTable {
  name:          string
  defaultValue?: number
  rows:          { label: string; value: number; constraintNote?: string }[]
}
```

### RTTable (`rtTables/{refId}`)

```ts
interface RTTable {
  name:         string
  columns:      string[]
  rows:         Record<string, unknown>[]
  // Grid-editor metadata (additive, absent on legacy tables)
  dimensions?:  { key: string; label?: string; values: string[] }[]
  valueColumn?: string
}
```

### DictionaryEntry (`dictionary/{id}`)

```ts
interface DictionaryEntry extends GovernanceBlock {
  refId:         string | null   // e.g. "HO.DEF.001", "PA.DEF.001", "DEF.NNN"
  name:          string
  type:          'TEXT' | 'CURRENCY' | 'DATE' | 'LIST' | 'PERCENT'
  description:   string
  allowedValues: string[]
  format:        string
  tags:          string[]
  aliases?:      string[]        // match synonyms; drives "used in" back-refs
  usedIn?:       { entityPath: string; label: string }[]   // computed live, not persisted
}
```

### Feedback (`feedback/{id}`)

```ts
interface Feedback {
  type:           'IDEA' | 'ISSUE' | 'PRAISE'
  title:          string
  detail:         string
  context:        { route: string; label?: string; entityPath?: string; refId?: string }
  votes:          { count: number; voters: string[] }
  status:         'NEW' | 'REVIEWING' | 'PLANNED' | 'SHIPPED' | 'DECLINED'
  impact:         1 | 2 | 3
  effort:         1 | 2 | 3
  priorityScore:  number       // WSJF-style; indexed for sort
  rank?:          number
  // AI-shaped fields (additive)
  userStory?:          string
  acceptanceCriteria?: string[]
  reproSteps?:         string[]
  likelyFiles?:        string[]
  implementationPrompt?: string
  author:         { uid: string; name: string }
  screenshotUrl?:  string
  attachments?:    { name: string; url: string; mediaType: string }[]
  completionNote?: string
  createdAt:       unknown
  updatedAt:       unknown
}
```

### Task (`tasks/{id}`)

```ts
interface Task extends GovernanceBlock {
  title:         string
  column:        'IDEATION' | 'BUILD_FILE' | 'TEST_APPROVE' | 'LAUNCH_MONITOR'
  productId?:    string
  assignee?:     { uid: string; name: string }
  dueAt?:        unknown
  checklist:     { t: string; done: boolean }[]
  order:         number
  done?:         boolean
  durationDays?: number
  // GTM fields (additive; present on project-board tasks)
  projectId?:    string
  origin?:       'seeded' | 'adhoc'
  phaseL2?:      string
  groupL3?:      string
  taskL4?:       string
  phaseOrder?:   number
  slaDays?:      number
  ownerRole?:    string
  typeOfWork?:   'Differentiating' | 'Analytical' | 'Transactional' | 'Regulatory / Compliance'
  startDate?:    string | null
  ongoing?:      boolean
  completedAt?:  unknown
}
```

### Project (`projects/{id}`)

```ts
interface Project {
  refId:            string | null   // e.g. "PRJ.001"
  name:             string
  description:      string
  productId?:       string | null
  targetLaunchDate: string          // ISO yyyy-mm-dd (the back-schedule pivot)
  status:           'planning' | 'active' | 'launched' | 'archived'
  owner:            { uid: string; name: string }
  createdAt:        unknown
  updatedAt:        unknown
  updatedBy?:       string
  rev:              number
}
```

### News (`news/{id}`)

```ts
interface News {
  urlHash:           string    // SHA-1 of URL; dedup key
  url:               string
  source:            string
  title:             string
  summary:           string
  bullets:           string[]  // 2-3 structured PM takeaways (What/Who/Why)
  image?:            { url?: string; kind: 'og'|'twitter'|'inline'|'generated'; dominantColor?: string; alt: string }
  tags:              string[]
  relatedProductIds: string[]
  fetchedAt:         unknown
}
```

### SearchIndexEntry (`searchIndex/{id}`)

```ts
interface SearchIndexEntry {
  type:     'product' | 'coverage' | 'rule' | 'form' | 'ldTable' | 'rtTable' | 'dictionary' | 'task' | 'project'
  refId?:   string
  title:    string
  subtitle: string
  path:     string
  keywords: string[]
}
```

### AuditEvent (`auditEvents/{id}`)

```ts
interface AuditEvent {
  actor:       { uid: string; name: string }
  action:      'create' | 'update' | 'delete' | 'export-duckcreek'
  entityType:  string
  entityPath:  string
  productId?:  string
  manuScriptID?: string   // DuckCreek export only
  at:          unknown
}
```

### Version (`versions/{id}`)

```ts
interface Version {
  entityType: string
  entityPath: string
  productId?: string
  snapshot:   unknown    // full entity snapshot at time of write
  diff:       { field: string; before: unknown; after: unknown }[]
  actor:      { uid: string; name: string }
  at:         unknown
}
```

---

## RefId Scheme

Format: `<LOB>.<SEGMENT>.<NNN>` (e.g. `HO.COV.001`, `PA.RU.006`, `HO.DEF.003`)

| Segment codes | Collection |
|---|---|
| `COV` | coverages |
| `RU` | rules |
| `FORM.RU` | formRules |
| `LD` | ldTables |
| `RT` | rtTables |
| `DEF` | dictionary |
| `RAT` | ratingPrograms |
| `PROD` | products |

**Minting:** Server-authoritative. `allocateRefId()` (`firebase.adapter.ts`) reads `meta/refCounters`, increments in a Firestore transaction, returns the next `<LOB>.<SEGMENT>.<NNN>`. Never minted client-side. Sub-coverage IDs use a 3-segment pattern: `<LOB>.COV.<parent-NNN>.<child-NNN>`.

---

## Atomic Mutation Envelope

Every entity write in the application uses `adapter.db.mutate()` (client) or `auditedMerge()` (server). These wrap:
1. Entity set/merge (the actual data)
2. `auditEvents/{id}` create (append-only)
3. `versions/{id}` create (snapshot + diff)
4. `searchIndex/{id}` set (keyword index entry)
5. All four in one Firestore `batch.commit()`

`rev` is incremented on every update. Conflict check: if `rev` in the write payload doesn't match the stored `rev`, a `MutationConflictError` is thrown before the batch fires.

---

## BackendAdapter Contract (client-side seam)

`app/src/lib/backend/types.ts`

```ts
interface BackendAdapter {
  auth: {
    onUser(cb: (user: AppUser | null) => void): Unsubscribe
    signIn(email, password): Promise<void>
    signOut(): Promise<void>
    getIdToken(): Promise<string>
  }
  db: {
    get<T>(path: string): Promise<T | null>
    list<T>(path: string, opts?: QueryOpts): Promise<T[]>
    subscribe<T>(path: string, cb: (data: T | null) => void): Unsubscribe
    mutate(payload: MutationPayload): Promise<{ id: string; refId: string | null }>
    mutateBatch(payloads: MutationPayload[]): Promise<void>
    vote(feedbackId: string): Promise<void>
    setNewsPins(instruction: string, pins: string[]): Promise<void>
    tx<T>(fn: (txn: Transaction) => Promise<T>): Promise<T>
  }
  storage: {
    upload(path: string, file: File): Promise<string>
    getUrl(path: string): Promise<string>
  }
  fns: {
    call<T>(name: string, data?: unknown): Promise<T>
    stream(name: string, data: unknown, onEvent: (e: StreamEvent) => void): Promise<void>
  }
  presence: {
    heartbeat(productId: string): Unsubscribe
    onViewers(productId: string, cb: (viewers: PresenceUser[]) => void): Unsubscribe
  }
}
```

---

## Rating Engine (pure, shared)

`shared/src/rating/evaluator.ts`

`evaluate(program: RatingProgram, inputs: RatingInputMap, rtGetter, ldGetter): EvaluatorResult`

Steps execute in `order` sequence. Operations:
- `SET`: `running = factor` (replaces)
- `MUL`: `running *= factor`
- `ADD`: `running += factor`
- `MIN_FLOOR`: `running = Math.max(running, minimumPremium)`

Factor resolution by source type:
- `RT`: call `rtGetter(ref, keys)` → table lookup → numeric factor
- `LD`: call `ldGetter(ref, value)` → row match → numeric value
- `INPUT`: `inputs[ref]` → numeric value
- `CONST`: `step.source.value`
- `SPP`: sum of `inputs.sppItems` appraised values weighted by item class factor

**Canary contracts (must never change):**
- HO-3 worked example → `$1,528` (`shared/src/rating/evaluator.test.ts`)
- Personal Auto worked example → `$1,002` (`shared/src/rating/evaluator.test.ts`)

---

## Rules Engine (pure, shared)

`shared/src/rules/` — evaluates PRODUCT/FORMS rules against a `SelectionContext` (HO-3) or `PASelectionContext` (Personal Auto).

Returns `RulesResult`:
```ts
interface RulesResult {
  availableOptions:    Record<string, TermOption[]>  // keyed by ldTableRef
  formsThatAttach:     string[]
  violations:          { ruleRefId: string; message: string; severity: 'error' | 'warning' }[]
  evaluatedRuleRefIds: string[]
}
```

---

## LOB Registry

`shared/src/insurance/lob.ts` (ASSUMPTION: path is approximate; exact path not verified)

Registered lines: `HO` (Homeowners), `PA` (Personal Auto). Each entry provides: `prefix`, `name`, `ratingKit`, `workedExample` inputs. Used by scaffolding, extraction, and rating digest to stay line-agnostic.

---

## Firestore Security Role Matrix

| Collection | VIEWER | EDITOR | ADMIN |
|---|---|---|---|
| users | Own doc read | — | Full R/W |
| products + sub-collections | Read | R/W | R/W |
| forms, ldTables, rtTables, dictionary | Read | R/W | R/W |
| tasks, projects | Read | R/W | R/W |
| feedback | Read + create + vote | R/W | R/W |
| comments | Read + create | Update/delete | R/W |
| news | Read | — | R/W |
| newsPrefs | Own doc R/W | Own doc R/W | Own doc R/W |
| baseForms | Read | R/W | R/W |
| searchIndex | Read | R/W | R/W |
| auditEvents | — | Create | Read + create |
| versions | Read + create | Read + create | Read + create |
| productSummaries | Read | Read | Read |
| taskTemplates | Read | Read | R/W |
| aiUsage | — | — | Read |
| groundingChunks | DENY | DENY | DENY |
| semanticCache | DENY | DENY | DENY |
| costCounters | DENY | DENY | DENY |
