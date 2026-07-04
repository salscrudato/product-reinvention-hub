# DATA_MODEL.md — Canonical Firestore model

One versioned, metadata-rich schema unifying the four insurance spec domains:
Framework (structure) · Rules (logic + limits/deductibles) · Rating (pricing math)
· Forms (documents) — plus governance (lifecycle, review, audit, comments,
feedback). All app access goes through the BackendAdapter (`docs/AWS_SWAP.md`).

## Conventions
- `refId` — human-readable source ID (HO.COV.003.002, HO.RU.006, HO.LD.002,
  HO.RT.003, HO.FORM.RU.001). Unique when present; null for user-created items
  until assigned. Form docs are keyed by normalized form number (`HO-04-61`).
- Governance block on every domain entity:
  `status: ACTIVE|INACTIVE|FUTURE` · `lifecycle: DRAFT|IN_REVIEW|APPROVED|LAUNCHED`
  · `reviewStatus: NOT_STARTED|IN_PROGRESS|BUSINESS_REVIEW|APPROVED|REJECTED`
  · `reviewer` · `createdAt/updatedAt/updatedBy` · `rev` (int, optimistic concurrency).
- State applicability inline on entities: `{ allStates: boolean, states: string[] }`.
- Timestamps are Firestore Timestamps; money in integer cents where computed,
  displayed via a single currency util.

## Collections

users/{uid}
  email, name, role (mirror of custom claim — claim is authoritative),
  active, mustChangePassword, createdAt

products/{pid}
  refId, name, lob { refId, name }, description, marketSegment,
  governance block, states/allStates, owner { uid, name },
  health { score 0–100, findingCount, updatedAt }
  ├─ coverages/{cid}
  │    refId, name, parentId (null = coverage; set = sub-coverage — parent must
  │    exist, enforced in mutate()), order, requirement MANDATORY|OPTIONAL,
  │    claimsBasis, premiumGenerating, source BUREAU|PROPRIETARY,
  │    formNumbers[], governance, states/allStates,
  │    terms: [{ id, kind LIMIT|DEDUCTIBLE|OPTION, label, ldTableRef?,
  │             options?[], min?, max?, default, basis, unit, notes?,
  │             // canonical typed model (optional; derived from the legacy fields
  │             // above when absent, mirrored back on save — see shared/insurance/terms.ts):
  │             structure? (SINGLE|OCCURRENCE_AGGREGATE|EACH_CLAIM_AGGREGATE|SPLIT|
  │                         CSL|SCHEDULED  for limits · FLAT|PERCENT|PERCENT_MIN_MAX|
  │                         WAITING_PERIOD|SPLIT  for deductibles),
  │             limitBasis? (PER_OCCURRENCE|AGGREGATE|PER_PERSON|PER_CLAIM|PER_ITEM|PER_LOCATION),
  │             optionSet?: [{ id, type FLAT|PERCENT|SPLIT|CSL|SCHEDULED|WAITING_PERIOD,
  │                           value, parts?[], label?, allStates, states[] (⊆ coverage
  │                           scope), isDefault (exactly one enabled), enabled, constraintNote? }] }]
  ├─ rules/{rid}
  │    refId, category PRODUCT|RATING|FORMS, subCategory, condition, outcome,
  │    ldTableRef?, coverageRefIds[], formNumbers[], governance, states
  ├─ formRules/{id}
  │    refId, condition, outcome, formNumbers[], mandatory, governance
  └─ ratingPrograms/{gid}
       refId (HO.RAT.1), name, minimumPremium, states, governance,
       steps: [{ id, order, label,
                 op SET|MUL|ADD|MIN_FLOOR,
                 source { type RT|LD|INPUT|CONST, ref?, keys?[], value? },
                 condition? (input flag that gates the step),
                 roundTo? (int decimal places) }]
       // The evaluator executes steps in order and returns a full trace.

forms/{formKey}
  number, name, edition, category BASE_COVERAGE|DECLARATIONS|ENDORSEMENT|
  EXCLUSION|AMENDATORY|POLICY_NOTICE, claimsBasis, dynamic (bool),
  mandatoryDefault, attachmentCondition RULE|NONE, source BUREAU|PROPRIETARY,
  admitted, displayOnSchedule, multiUse, transactions[], coverageParts[],
  states/allStates, productRefIds[], description (AI plain-English, cached),
  dynamicFields: [{ name, dataType TEXT|CURRENCY|DATE|LIST|PERCENT, repeating,
                    options?[], notes? }], governance

ldTables/{refId}   name, defaultValue?, rows: [{ label, value, constraintNote? }]
rtTables/{refId}   name, columns[], rows[]  // layout preserved as-is for lookups

versions/{id}      entityType, entityPath, productId?, snapshot, 
                   diff: [{ field, before, after }], actor { uid, name }, at
auditEvents/{id}   actor, action, entityType, entityPath, productId?, at
                   // create-only; explored in /app/admin
comments/{id}      entityPath, refId?, body, author, resolved, at
tasks/{id}         title, column IDEATION|BUILD_FILE|TEST_APPROVE|LAUNCH_MONITOR,
                   productId?, assignee?, dueAt, checklist[{t,done}], order, governance
feedback/{id}      type IDEA|ISSUE|PRAISE, title, detail,
                   context { route, entityPath?, refId? }  // auto-captured by ⌘.
                   votes { count, voters[uid] }, status NEW|REVIEWING|PLANNED|
                   SHIPPED|DECLINED, impact 1–3, effort 1–3,
                   priorityScore  // votes × recency decay, recomputed on write
                   rank (Planned lane order), author, timestamps
news/{id}          urlHash (dedup), url, source, title, summary, tags[],
                   relatedProductIds[], fetchedAt
newsPrefs/{uid}    instruction (natural language), updatedAt
dictionary/{id}    name, type, description, allowedValues[], format, tags[],
                   usedIn[{ entityPath, label }], governance
shareLinks/{token} productId, createdBy, expiresAt
                   // never client-readable; served by the share Function
searchIndex/{id}   type, refId?, title, subtitle, path, keywords[]
                   // maintained by seed + mutate(); powers ⌘K
seedReports/{id}   counts, warnings[], workedExamplePremium, at

## Access + integrity
- Firestore rules: role from `request.auth.token.role`. VIEWER → read all domain
  data, write nothing (may vote/submit feedback + comment). EDITOR → write domain
  collections. ADMIN → users/settings too. `auditEvents`/`versions`: create-only.
  `shareLinks`: no client read/write (Functions only, Admin SDK).
- `mutate()` (adapter) = one WriteBatch: entity write + auditEvent + version
  (+ searchIndex upsert) + `rev` increment; save rejects on rev mismatch
  (friendly conflict toast). // AWS-SWAP: becomes a Lambda-side transaction.
- Custom claims set only via the `setUserRole` callable (ADMIN); the seed script
  bootstraps the first admin.
- Realtime: onSnapshot subscriptions give live multi-user updates + presence
  (`presence/{pid}/viewers/{uid}` heartbeat docs).

## Composite indexes (declare in firestore.indexes.json as needed)
tasks (column, order) · feedback (status, priorityScore desc) ·
news (fetchedAt desc) · versions (entityPath, at desc) ·
auditEvents (productId, at desc) · searchIndex (type, title)
