# Canonical Data Model — Product Reinvention Hub

This document describes the **underlying data structure** of the Product Reinvention Hub: the domain types in `@pf/shared`, how they map to Cosmos storage, and how faithfully the model represents P&C insurance product definition from both a **business** and **technical** perspective.

**Source of truth (code):**

| Layer | Location |
|---|---|
| Domain types | `shared/src/types.ts` |
| LOB registry | `shared/src/insurance/lobRegistry.ts` |
| Line archetypes | `shared/src/lines/types.ts`, `shared/src/lines/registry.ts` |
| Coverage tree / inventory | `shared/src/insurance/inventory.ts` |
| Terms (limits/deductibles) | `shared/src/insurance/terms.ts` |
| Rating evaluator | `shared/src/rating/evaluator.ts` |
| Rules engine | `shared/src/rules/engine.ts` |
| Seed reference products | `shared/src/seed/{personalHome,personalAuto,generalLiability}.ts` |
| Storage envelope | `server/lib/data.js` |
| Seed → Cosmos paths | `scripts/migrate-to-cosmos.ts` |
| Business methodology | `product_first_principles.md` |

---

## 1. What this model is (and is not)

### It is

A **P&C Product Component Model (PCM)** for carrier product management:

- Define products as hierarchical coverages with limits, deductibles, forms, rules, and rating algorithms
- Version, govern, audit, search, and AI-ground against that definition
- Import bureau/filing/workbook content into the same shape
- Simulate rating (deterministic evaluator) and product/form rules for reference lines
- Track go-to-market product-manufacture work (GTM process board)

### It is not

A full **policy administration / PAS** or claims-ledger system. There is no first-class policy, quote, endorsement transaction, billing, commission, reinsurance treaty, or loss-reserve entity. Claims Analysis uses **base forms + portfolio coverages** as RAG grounding for coverage determinations — it does not persist FNOL or claim financials as domain entities.

That scope is intentional: the app is a **product factory / reinvention hub**, not a policy system of record.

---

## 2. Business hierarchy (PCM)

Aligned with the methodology in `product_first_principles.md`:

```
Product  ──1:M──  Line of Business (logical)  ──1:M──  Coverage  ──1:M──  Sub-Coverage
                                                              │
                    ┌─────────────────────────────────────────┼────────────────────────┐
                    ▼                                         ▼                        ▼
              Terms (LIMIT /                  Forms (base, endorsements,         Rules (PRODUCT /
              DEDUCTIBLE / OPTION)            exclusions, notices, …)            RATING / FORMS)
                    │                                         │                        │
                    ▼                                         │                        │
              LD tables (option sets)                         │                        │
                                                              │                        │
RatingProgram (ordered steps)  ──lookup──►  RT tables (factor / rate grids)  ◄─────────┘
```

### Three specification pillars

| Pillar | Question | Entities |
|---|---|---|
| **Rules** | How is the product **governed**? | `Rule`, `FormRule` |
| **Forms** | How is the product **presented**? | `Form` (+ dynamic fields) |
| **Rating** | How is the product **priced**? | `RatingProgram`, `RatingStep`, `RTTable`, `LDTable` |

**Coverage is the atomic unit of protection.** Rates, rules, and forms exist to enable, govern, price, or present coverages.

### Canonical identity: `refId`

Every governed component carries a **Product Framework ID** (`refId`) used as the cross-spec linkage key (e.g. `PH.COV.001`, `GL.RU.007`, `HO 00 03`). Line-specific shapes live in `LobDefinition.refIdScheme`.

---

## 3. Domain entity catalog

### 3.1 Cross-cutting blocks

#### `GovernanceBlock` (most product entities)

| Field | Type | Meaning |
|---|---|---|
| `status` | `ACTIVE` \| `INACTIVE` \| `FUTURE` | Availability |
| `lifecycle` | `DRAFT` \| `IN_REVIEW` \| `APPROVED` \| `LAUNCHED` \| `RETIRED` | Product lifecycle |
| `reviewStatus` | `NOT_STARTED` … `REJECTED` | Review workflow |
| `reviewer` | string? | Reviewer label |
| `createdAt` / `updatedAt` | timestamp / ISO | Audit stamps |
| `updatedBy` | string | Actor |
| `rev` | number | Optimistic concurrency (server-incremented) |

#### `StateScope`

| Field | Type | Meaning |
|---|---|---|
| `allStates` | boolean | Nationwide vs listed footprint |
| `states` | `string[]` | Two-letter state codes |

State is a **cross-cutting variation dimension**, not a hierarchy node — any product/coverage/form/rule/rating may be state-scoped.

---

### 3.2 Tenancy & identity (platform plane)

| Entity | Key fields | Notes |
|---|---|---|
| **Organization** | `tenantId`, `name`, `createdAt` | Customer isolation boundary. **Not** Azure Entra tenant id. Server-stamped on the storage envelope; never client-writable as a domain field. |
| **User** | `email`, `name`, `role`, `active`, `mustChangePassword` | Role is mirrored from JWT claim (authoritative). |
| **Role** | `VIEWER` … `SUPER_ADMIN` (+ inquiry personas) | Writes require EDITOR+ server-side. |

`DEFAULT_TENANT_ID = 'default'` homes pre-multi-tenant seed data.

---

### 3.3 Product framework

#### `Product`

| Field | Type | Business meaning |
|---|---|---|
| `refId` | string \| null | Framework product id (e.g. `PH.PROD.001`) |
| `name` | string | Market name |
| `lob` | `{ refId, name }` | **Embedded** LOB pointer (LOB is registry data, not a Cosmos entity) |
| `description` | string | Product description |
| `marketSegment` | string | e.g. Personal Lines / Property |
| `owner` | `{ uid, name }` | Product owner |
| `baseForm?` | upload meta + form number/edition | Base coverage form for AI extraction grounding |
| `lineage?` | `Lineage` | Provenance: blank / import / clone / AI scaffold |
| + `GovernanceBlock`, `StateScope` | | |

**LOB as data, not storage:** `shared/src/insurance/lobRegistry.ts` defines `LobDefinition` (sections, peril model, footprint, refId scheme, line intelligence). Products **reference** a LOB; the hierarchy “Product → LOB → Coverage” is projected at read time (inventory / explorer), not as nested Cosmos documents for LOB.

#### `Coverage` (+ sub-coverage)

| Field | Type | Business meaning |
|---|---|---|
| `refId` | string \| null | e.g. `PH.COV.001`, sub: `PH.COV.001.001` |
| `name` | string | Coverage name |
| `parentId` | string \| null | Parent coverage **refId** (null = top-level) |
| `order` | number | Display / sort order |
| `requirement` | `MANDATORY` \| `OPTIONAL` \| `UNKNOWN` | Product packaging |
| `claimsBasis` | string | e.g. Occurrence / Claims-Made |
| `premiumGenerating` | boolean \| null | null = source silent (import fidelity) |
| `source` | `BUREAU` \| `PROPRIETARY` | ISO/AAIS/etc. vs carrier |
| `formNumbers` | string[] | Forms that grant/modify this coverage |
| `terms` | `CoverageTerm[]` | Limits, deductibles, options |
| + governance + state scope | | |

Tree integrity: `buildCoverageTree()` nests by `parentId === parent.refId`; unresolved parents surface as **orphans** (never silently dropped). Server mutate validates parent existence.

#### `CoverageTerm`

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Stable term id |
| `kind` | `LIMIT` \| `DEDUCTIBLE` \| `OPTION` | Term class |
| `label` | string | Display label |
| `ldTableRef?` | string | Link to LD option table |
| `options?` | (string \| number)[] | Legacy flat options |
| `min` / `max` / `default` | numbers / mixed | Range + default |
| `basis` | string | e.g. per occurrence (legacy free text) |
| `unit?` | string | dollars, percent, … |
| `structure?` | limit/deductible structure enums | Typed shape (SINGLE, SPLIT, CSL, …) |
| `limitBasis?` | `PER_OCCURRENCE` \| `AGGREGATE` \| … | Limit measurement basis |
| `optionSet?` | `StandardOption[]` | **Canonical** state-aware option matrix |
| concept-linker fields | `states`, `coverageCode`, `linkBasis` | Import-derived linkage |

`StandardOption` models filing-realistic option matrices: per-option type (`FLAT` / `PERCENT` / `SPLIT` / `CSL` / …), state applicability, default, enabled.

---

### 3.4 Rules pillar

#### `Rule`

| Field | Type | Meaning |
|---|---|---|
| `refId` | string \| null | e.g. `PH.RU.001` |
| `category` | `PRODUCT` \| `RATING` \| `FORMS` | Rule pillar |
| `subCategory` | string | Eligibility, Limits, Deductibles, … |
| `condition` | string | Trigger (business language) |
| `outcome` | string | Action / end state |
| `ldTableRef?` | string | Linked option table |
| `coverageRefIds` | string[] | Coverages governed |
| `formNumbers` | string[] | Forms involved |
| + governance + state | | |

#### `FormRule`

Attachment conditions: `condition`, `outcome`, `formNumbers`, `mandatory`.

**Business distinction (methodology):** product rules govern *what can be sold/packaged*; underwriting rules on individual risks are out of scope as a separate repository. Executable simulation exists for seed lines (HO / PA / GL selection contexts) in `shared/src/rules/engine.ts`.

---

### 3.5 Forms pillar

#### `Form`

| Field | Type | Meaning |
|---|---|---|
| `number` | string | Form number chip (e.g. `HO 00 03`, `CG 00 01`) — **load-bearing** |
| `name` | string | Form title |
| `edition` | string | Edition date |
| `category` | `BASE_COVERAGE` \| `DECLARATIONS` \| `ENDORSEMENT` \| `EXCLUSION` \| `AMENDATORY` \| `POLICY_NOTICE` \| `SCHEDULE` \| `POLICY_CONDITIONS` \| `OTHER` \| `MARKETING` | Form taxonomy |
| `claimsBasis` | string | Occurrence / claims-made alignment |
| `dynamic` | boolean | Variable fields present |
| `mandatoryDefault` | boolean | Default attach |
| `attachmentCondition` | `RULE` \| `NONE` | Whether a form rule drives attach |
| `source` | `BUREAU` \| `PROPRIETARY` | |
| `admitted` | boolean | Admitted paper |
| `displayOnSchedule` | boolean | Schedule visibility |
| `multiUse` | boolean | Multi-use form |
| `transactions` | string[] | Transaction types |
| `coverageParts` | string[] | LOB section short names (e.g. Section I) |
| `productRefIds` | string[] | Products that use this form |
| `description` | string | Plain-English (often AI-cached, grounded) |
| `dynamicFields` | `DynamicField[]` | Declarations / schedule variables |
| + governance + state | | |

---

### 3.6 Rating pillar

#### `RatingProgram`

| Field | Type | Meaning |
|---|---|---|
| `refId` | string | e.g. `PH.RAT.1` |
| `name` | string | Algorithm name |
| `minimumPremium` | number | Floor |
| `steps` | `RatingStep[]` | Ordered calculation |
| `creditFloor?` | number | Max cumulative credit (e.g. Rule 92) |
| `ratingGroups?` | summary[] | Import concept-linker groups |

#### `RatingStep`

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Step id |
| `order` | number | Order of calculation (ROC) |
| `label` | string | Human label |
| `op` | `SET` \| `MUL` \| `ADD` \| `MIN_FLOOR` | Arithmetic op |
| `source.type` | `RT` \| `LD` \| `INPUT` \| `CONST` \| `SPP` | Factor source |
| `source.ref` / `keys` / `value` | | Table ref, lookup keys, constant |
| `condition?` | string | Skip when input falsy |
| `roundTo?` | number | Decimal places |
| `isCredit?` | boolean | Counts toward credit floor |

#### Tables

| Entity | Purpose |
|---|---|
| **`LDTable`** | Limit/deductible **option sets** (`rows: { label, value, constraintNote? }`) |
| **`RTTable`** | Rate/factor grids (`columns`, `rows`, optional `dimensions` for grid editor) |

Evaluator I/O: line-specific `RatingInputs` / selection contexts feed a line-agnostic `evaluate()` with full step trace (`TraceEntry[]`). Headline canaries: HO-3 **$1,528**, PA **$1,002**, GL **$2,635**.

---

### 3.7 Platform / collaboration entities

| Entity | Purpose |
|---|---|
| **Version** | Per-mutate snapshot + field diff (`entityPath`, `rev`, `op`) |
| **AuditEvent** | Create/update/delete trail; hash-chained per path |
| **SearchIndexEntry** | Full-text index projection |
| **Comment** | Threaded comments on entity paths |
| **DictionaryEntry** | Citable data dictionary (`DEF.*` / `HO.DEF.*`); usage computed live |
| **Project** | GTM product launch with deadline |
| **Task** | Board work item (governance + GTM process fields) |
| **Feedback** | Ideas / issues / praise with priority scoring |
| **News** / **NewsPrefs** | Curated industry news + user prefs |
| **SeedReport** | Seed integrity report + worked-example premiums |
| **BaseForm** (claims) | Uploaded base form library for Claims Analysis |
| **ChangeSet** | Typed parent↔clone product diff for filings / SERFF |

---

## 4. Storage structure (technical)

### 4.1 Cosmos document envelope

Every domain write goes through `adapter.db.mutate()` → server `data.js` atomic batch:

```
kind: 'entity' | 'audit' | 'version' | 'searchIndex' | 'chainHead' | 'tenant' | 'user' | …
pk:   `${tenantId}|${baseKey(path)}`
tenantId: server-stamped (never from client data)
path: logical path (see below)
coll: parent collection path
entityType: product | coverage | rule | form | …
rev: optimistic concurrency
data: domain payload (Product, Coverage, …)
```

**Atomic batch per mutation:** entity + audit event + version + search index + chain head (+ optional grounding chunk). Audit events are **SHA-256 hash-chained** per `entityPath`.

### 4.2 Partition key

```
baseKey(path) =
  if path starts with products/{productId}/… → productId
  else → first segment (forms, ldTables, rtTables, dictionary, …)

pk = `${tenantId}|${baseKey}`
```

So all coverages/rules/rating for one product share a partition with that product; global form/LD/RT tables partition by collection base.

### 4.3 Logical path conventions

| Entity | Path pattern | Example |
|---|---|---|
| Product | `products/{productId}` | `products/PH.PROD.001` |
| Coverage | `products/{productId}/coverages/{dashId}` | `…/coverages/PH-COV-001` |
| Rule | `products/{productId}/rules/{dashId}` | `…/rules/PH-RU-001` |
| Form rule | `products/{productId}/formRules/{dashId}` | |
| Rating program | `products/{productId}/ratingPrograms/{dashId}` | `…/PH-RAT-1` |
| Form | `forms/{formKey}` | form number dash-encoded |
| LD table | `ldTables/{refId}` | `ldTables/PH.LD.001` |
| RT table | `rtTables/{refId}` | `rtTables/PH.RT.001` |
| Dictionary | `dictionary/{id}` | |
| Project / Task | `projects/…`, `tasks/…` | |
| Base form | `baseForms/{id}` | Claims library |
| System tenant/user | `kind:tenant` / `kind:user`, `pk: __system__` | |

Doc ids for nested product children use **dot → dash** encoding of `refId` (`PH.COV.001` → `PH-COV-001`). `parentId` stores the **refId with dots**.

### 4.4 What clients never write

Envelope keys stripped from client payloads: `tenantId`, `pk`, `kind`, `coll`, `path`. Reserved base `filings` is immutable create-only (filing importer).

---

## 5. Seed reference portfolio

Three fully wired products exercise the model end-to-end:

| Product | refId | Base form archetype | Rating canary |
|---|---|---|---|
| Personal Home — HO-3 Special Form | `PH.PROD.001` | `HO 00 03` | **$1,528** |
| Personal Auto (ISO PAP-style) | `PA.PROD.001` | `PP 00 01` | **$1,002** |
| General Liability (CGL occurrence) | `GL.PROD.001` | `CG 00 01` | **$2,635** |

Each seed includes: product, coverages (incl. sub-coverages), LD/RT tables, rating program, forms, product rules, form rules, dictionary entries.

**Line Intelligence Registry** (`shared/src/lines`) additionally describes archetypes for a broader P&C set (WC, BOP, Cyber, CP, Crime, Umbrella, …) for import classification and scaffolding — not all are fully seeded products.

---

## 6. Relationship map (compact)

```
Organization (tenantId)
  └── Product
        ├── lob → LobDefinition (registry, not stored)
        ├── Coverage*  (parentId → Coverage.refId)
        │     ├── CoverageTerm* → LDTable?
        │     └── formNumbers → Form.number
        ├── Rule* → coverageRefIds, formNumbers, ldTableRef
        ├── FormRule* → formNumbers
        └── RatingProgram
              └── RatingStep* → RTTable | LDTable | INPUT | CONST | SPP

Form (global, productRefIds[])
LDTable / RTTable (global by refId)
DictionaryEntry  (usage computed from coverages/rules/forms)
Project → Task*  (GTM process)
BaseForm         (claims analysis uploads)
```

---

## 7. Fidelity assessment: is this a correct insurance representation?

### Verdict

**Yes — for its stated domain: P&C product definition (PCM + three pillars).**  
It is a **correct and professionally coherent** business model of how modern carriers structure **product specifications**, and a **sound technical model** for multi-tenant, audited product configuration.  
It is **not** a complete model of the entire insurance value chain (policy, billing, claims finance, reinsurance).

---

### 7.1 Business view — strengths

| Practice | How the model reflects it | Assessment |
|---|---|---|
| Coverage-centric product definition | Coverage + sub-coverage + terms | **Strong** — matches Freeman/Jones PCM axioms |
| Governed / presented / priced split | Rules / Forms / Rating pillars | **Strong** — industry product-spec discipline |
| Framework IDs across artifacts | `refId` on all components; form numbers as chips | **Strong** — traceability for filings & ops |
| Parent/child coverage | `parentId` → parent `refId` | **Strong** |
| Limits & deductibles as first-class | Terms + LD tables + structures (SPLIT, CSL, %) | **Strong** for personal + commercial lines |
| Bureau vs proprietary | `source: BUREAU \| PROPRIETARY` | **Correct** |
| State variation | `StateScope` on entities + per-option state | **Correct** as cross-cutting dimension |
| Form taxonomy | Base, endorsements, exclusions, declarations, notices | **Aligned** with ISO-style catalogs |
| Rating as ordered steps + tables | ROC-style program; factor tables; min premium; credit floor | **Correct** for mono-line algorithms used here |
| Product vs underwriting rules | Product rules modeled; UW risk rules largely out of scope | **Correct scoping** for a product hub |
| Effective dating / versions | `rev` + version snapshots + lifecycle | **Good** operational versioning; not full multi-interval effective dating per component field |

### 7.2 Business view — intentional gaps / simplifications

| Topic | Reality in carriers | In this app | Impact |
|---|---|---|---|
| **LOB as node** | Often first-class hierarchy node (package multi-LOB) | Embedded `{refId,name}` on Product; LOB registry offline | Fine for monoline seed products; **package multi-LOB products are thinner** |
| **Policy / quote / bind** | PAS core | Not modeled | Expected — wrong product category |
| **Policy transactions** | New business, renewals, endorsements, cancels | Forms have `transactions[]` metadata only | Spec-level, not executable PAS |
| **Underwriting rules repository** | Separate from product rules | Mostly product-rule documentation + line simulators | Correct for product factory; incomplete for full underwriting desk |
| **Claims / loss history / reserves** | Claims systems | Claims Analysis = form RAG + determination, not claim entity | Correct for CX/coverage intelligence, not claims core |
| **Reinsurance, pricing actuarial models** | Separate systems | Not modeled | Out of scope |
| **Independent component effective dates** | Filing often needs `effFrom`/`effTo` per row | Lifecycle + rev history, not interval calendars | Acceptable for hub; **filing examiners may want richer effective dating** |
| **Class / territory codes as master data** | Shared reference data | Lived inside RT tables + dictionary | Works; not a full class-code MDM |

### 7.3 Technical view — strengths

| Concern | Implementation | Assessment |
|---|---|---|
| Single domain contract | Pure TS in `@pf/shared`, zero platform imports | **Excellent** portability |
| Adapter seam | All I/O via `adapter`; no SDK in UI | **Enforced invariant** |
| Atomic multi-doc mutations | Entity + audit + version + index + chain | **Strong** integrity model |
| Tenant isolation | Partition + `tenantId` filter; server stamp only | **Correct multi-tenant design** |
| Concurrency | `rev` / expectedRev conflicts | **Standard optimistic locking** |
| Audit integrity | Hash chain per entity path | **Above average** for product tools |
| Rating determinism | Pure evaluator + canary tests | **Load-bearing quality gate** |
| Import fidelity | `UNKNOWN` / null origin markers; concept-linker link basis | **Thoughtful** for imperfect source docs |
| Line extensibility | LOB registry + line intelligence archetypes | **Scalable** toward more LOBs |

### 7.4 Technical view — tradeoffs

| Choice | Tradeoff |
|---|---|
| Document-oriented (path/entity) vs relational graph | Flexible for nested product trees; cross-product joins are application-level |
| Forms/LD/RT often **global** by refId | Reuse across products; must carefully scope product linkage via `productRefIds` / refs |
| Rules as **text condition/outcome** (+ selective executable engines) | Readable product specs; not a full DROOLS-style production rule server for all lines |
| Shallow merge on update | Safe for partial edits; nested deep merge is not automatic |

---

## 8. Overall correctness summary

| Lens | Verdict |
|---|---|
| **Business (product definition)** | **Correct.** PCM hierarchy, three pillars, coverage atomicity, forms taxonomy, rating ROC, bureau/proprietary, and state variation match how serious P&C product organizations specify products. |
| **Business (full insurance enterprise)** | **Incomplete by design.** No policy, premium accounting, claims financials, or reinsurance — do not treat this as a PAS data model. |
| **Technical (platform)** | **Correct and robust** for multi-tenant product configuration: shared types, atomic mutate, tenancy, audit chain, deterministic rating canaries. |
| **Technical (insurance computation)** | **Correct for seeded monoline algorithms** (HO/PA/GL canaries). Broader lines use archetypes + import; full executable rating per line is progressive, not universal. |

**Bottom line:** The underlying data structure is a **faithful Product Component Model for P&C product management**, implemented with production-grade multi-tenant technical discipline. Use it as the system of record for **what the product is** (coverages, forms, rules, rates); do not confuse it with the systems of record for **policies written** or **claims paid**.

---

## 9. Quick reference — TypeScript entry points

```ts
// Domain core
import type {
  Product, Coverage, CoverageTerm, Rule, FormRule, Form,
  RatingProgram, RatingStep, LDTable, RTTable,
  Organization, User, GovernanceBlock, StateScope,
  DictionaryEntry, Project, Task, Version, AuditEvent,
} from '@pf/shared'

// LOB / hierarchy projections
import { resolveLob, LOB_REGISTRY } from '@pf/shared'
import { buildCoverageTree, buildInventoryRows } from '@pf/shared'

// Computation
import { evaluate } from '@pf/shared'          // rating
import { evaluateRules } from '@pf/shared'     // product rules (line-aware)
```

---

*Generated from the repository’s shared domain types and server storage envelope. When code and this document diverge, **the code wins** — update this file after material type changes.*
