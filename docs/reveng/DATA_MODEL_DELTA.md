# DATA_MODEL_DELTA — DATA_MODEL.md vs the code AS BUILT (`d28c8a1`)

> `docs/reveng/` dossier. The repo-root `DATA_MODEL.md` is the canonical data-model doc.
> This file is the reconciliation against `shared/src/types.ts` (820 lines) and friends:
> what the doc gets right (spot-confirmed), what DRIFTED, and what the code contains that
> the doc omits. **The delta list is the deliverable.** DATA_MODEL.md's own footer says
> "when code and this document diverge, the code wins" — this is that divergence list.

## 1. Confirmations (doc claim -> code evidence)

| Doc claim | Code evidence | Status |
|---|---|---|
| `GovernanceBlock` (status/lifecycle/reviewStatus/rev) composed on governed entities | `shared/src/types.ts:24-33`; used by Product (`:99`), Coverage (`:198`), Rule (`:216`), Form (`:383`), Task (`:488`) | CONFIRMED |
| `StateScope {allStates, states[]}` cross-cutting, not a hierarchy node | `types.ts:35-38` | CONFIRMED |
| Product.lob is an EMBEDDED `{refId, name}` pointer; LOB is registry data, not a Cosmos entity | `types.ts:102`; `LOB_REGISTRY` `shared/src/insurance/lobRegistry.ts:430-436` | CONFIRMED |
| Coverage tree nests by `parentId === parent.refId`; orphans surface, never dropped | `types.ts:201`; `resolveCoverageHierarchy` orphan-promotion `shared/src/insurance/coverageHierarchy.ts:85` | CONFIRMED |
| `premiumGenerating: boolean \| null` — null = "source silent" (flag-not-invent) | `types.ts:206` | CONFIRMED |
| `CoverageTerm.optionSet` = canonical state-aware `StandardOption[]` matrix | `types.ts:156-167,186` | CONFIRMED |
| Rule categories PRODUCT/RATING/FORMS | `types.ts:214` | CONFIRMED |
| `RatingProgram.creditFloor` (Rule 92 max-credit cap), opt-in, byte-identical without it | `types.ts:306`; evaluator corrective step `shared/src/rating/evaluator.ts:46-106` | CONFIRMED |
| Form.number is the load-bearing chip | `types.ts:384` | CONFIRMED |
| Storage envelope: `kind/pk/tenantId/path/coll/entityType/rev/data`; reserved keys stripped from client data | `server/lib/data.js:214,226` (`RESERVED_ENVELOPE_KEYS = tenantId,pk,kind,coll,path`) | CONFIRMED |
| pk = `${tenantId}\|${baseKey(path)}`; product subtree shares its product's partition | `data.js:44` | CONFIRMED |
| Atomic batch = entity + audit + version + searchIndex (+ chainHead + chunk) | `data.js:276-292` | CONFIRMED (doc's section 4.1 lists chainHead in the kind union but its "atomic batch" sentence says "(+ optional grounding chunk)" — chainHead ALWAYS rides too, `data.js:284-286`) |
| Audit events SHA-256 hash-chained per entityPath | `shared/src/audit/chain.ts:118-122` (`AUDIT_HASH_FIELDS` + `computeAuditHash`) | CONFIRMED |
| Doc-id convention: dot->dash of refId for nested children; parentId keeps dots | `dashId` `shared/src/insurance/isoImport.ts:311`; validator candidates `data.js:240-250` | CONFIRMED — but see drift D2: the doc presents ONE convention; the server brain mints a SECOND (lowercase) one |
| `filings` base is create-only/reserved | `data.js:220,224` (`RESERVED_BASES`) | CONFIRMED |
| Seed portfolio PH.PROD.001 / PA.PROD.001 / GL.PROD.001 with canaries $1,528/$1,002/$2,635 | `shared/src/seed/personalHome.ts:45`, `personalAuto.ts`, `generalLiability.ts`; `workedExample.canary.test.ts` | CONFIRMED |
| `DEFAULT_TENANT_ID = 'default'` | `types.ts:84` | CONFIRMED |
| Shallow merge on `op:'update'` (partial update; nested deep-merge NOT automatic) | `data.js:261-262` | CONFIRMED |
| ChangeSet typed parent<->clone diff exists | exported via `shared/src/index.ts:48`, `shared/src/changeset/diff.ts` | CONFIRMED |

## 2. DRIFTS (doc says X, code says Y)

| # | Topic | Doc says | Code says | Severity |
|---|---|---|---|---|
| D1 | **Version restore** | section 3.7: Version = "per-mutate snapshot + field diff" | Post-audit-chain version docs carry **no snapshot** (`app/src/lib/backend/versionRead.ts:43`); `HistoryDrawer.tsx:6-7,141` shows restore ONLY for legacy rows that still have one ("never invented"). Restore is **dormant** at this tree. (NOTE: `origin/main`'s P4 wave `4b2a3dd` "finish the dormant restore, server-side" changes this — not in this tree.) | HIGH for anyone building on history |
| D2 | **Doc-id convention is presented as single** | section 4.3: "Doc ids ... use dot->dash encoding" | THREE minter sites, TWO conventions: case-preserving `dashId` (`isoImport.ts:311`) vs lowercasing `toDocId` (`server/lib/import-brain/stage7-plan.js:40-43`) and the filing fallback (`unified-import.js:374`). The validator honors only the case-preserving form (`data.js:243`). | HIGH — this is the diagnostic's root-cause finding, live at HEAD |
| D3 | **TenantProfile** | section 3.2 table implies tenancy entities live in the shared model | No `TenantProfile` type exists in `@pf/shared`; per-tenant config lives in `shared/src/platform/tenantConfig.ts` (NOT exported by the barrel; server consumes it via `platform-shared.cjs` through `server/lib/platform-config.js`) | LOW |
| D4 | **Version read cap** | not mentioned | `/api/db/versions` caps at 2000 (`data.js:427-442`), and filing point-in-time replay reads TOP 2000 — histories past that silently truncate | MED (compliance-adjacent) |
| D5 | **SearchIndexEntry** | section 3.7 lists one SearchIndexEntry model | TWO schemes exist: rich seeded `SearchIndexEntry` (`scripts/migrate-to-cosmos.ts`) vs lean runtime `idx:` docs (`data.js:281`); same fork for grounding chunks (`ent:groundingChunks~...` seeded vs `chunk:<path>` runtime, `data.js:145-175`) | MED — known drift (Platform_Review F5), unconverged at HEAD |
| D6 | **"Server mutate validates parent existence"** (section 3.3) | True but incomplete | Validation tries dotted + dashed candidates only (`data.js:243`); a lowercase-minted parent is unreachable -> `INVALID_PARENT` (see D2). Also each candidate costs a sequential `readEntity` (latency on deep trees) | MED |

## 3. Omissions — in the code, absent from the doc

Concept-linker provenance layer (all optional/golden-invisible, added on this branch):

| Field | Line | Purpose |
|---|---|---|
| `LinkBasis = 'given' \| 'derived' \| 'ai-proposed'` | `types.ts:22` | provenance trichotomy on every reconstructed link |
| `CoverageTerm.coverageCode / linkBasis / states / allStates` | `types.ts:190-195` | import-derived linkage + per-state table families |
| `Rule.tableRefIds / tableLinkBasis / resolvedCoverageRefId` | `types.ts:231-235` | reference-table links; rule-cited-a-coverage resolution |
| `RatingStep.groupName / groupRefId / groupCoverageRefIds / packageFormNumbers / groupMatchBasis / ratePlaceholderRef` | `types.ts:270-279` | rating-group enrichment + minted rate-table placeholder (`PREFIX.RTB.NNN`) |
| `RatingProgram.ratingGroups?: RatingGroupSummary[]` | `types.ts:284-291,300` | concept-linker group summaries |
| `LDTable.kindHint / state / coverageCodes / coverageRefIds / ruleRefIds / backLinkWas / optionValues / mintedId / linkBasis` | `types.ts:328-345` | table linkage + stale-ref recovery channel (`backLinkWas`) + synth marker (`mintedId`) |

Other code-only entities/fields the doc omits or under-describes:

| Item | Line | Note |
|---|---|---|
| `Lineage {kind: BLANK/IMPORT/CLONE/AI_SCAFFOLD, sources, by, at}` | `types.ts:54-60` | doc mentions lineage on Product but not the shape |
| `Role` full set incl. 5 inquiry personas + SUPPORT + POLICYHOLDER | `types.ts:13` | doc says "VIEWER … SUPER_ADMIN (+ inquiry personas)" without POLICYHOLDER/SUPPORT |
| GTM task fields: `seedRefId, seedBatchId, phaseL2, groupL3, taskL4, phaseOrder, slaDays, ownerRole, typeOfWork, valueOfWork, disposition, startDate, ongoing, completedAt` | `types.ts:509-526` | the Process-Value-Explorer / task-seeding-v2 layer |
| `Feedback.userStory / acceptanceCriteria / reproSteps / likelyFiles / implementationPrompt / attachments` | `types.ts:553-562` | AI-shaped feedback payload |
| `News / NewsPrefs` shapes (urlHash identity, pinnedHashes) | `types.ts:577-596` | doc lists names only |
| `SeedReport.workedExamplePremiums` (plural, per-line) | `types.ts:636-642` | doc shows only the single $1,528 |
| Selection contexts: `SelectionContext` (HO-3), `PASelectionContext`, `GLSelectionContext`, `RulesResult`, `TermOption`, `RuleViolation` | `types.ts:722-800` | rules-engine I/O, line-specific |
| Rating I/O: `RatingInputs`, `RatingInputMap`, `RatingInputField`, `EvaluatorResult`, `TraceEntry`, `SppItem` | `types.ts:646-708` | evaluator I/O incl. the full step trace |
| `HoOccupancy` / `PaVehicleUse` enums | `types.ts:714,718` | eligibility enums |
| `RTTable.dimensions / valueColumn`, `RTTableDimension` | `types.ts:356-367` | grid-editor metadata |
| `DynamicField.options` | `types.ts:379` | LIST-type enumerations |
| Money invariant module | `shared/src/money.ts:1-64` | 2-decimal dollars enforced round-trippable through integer cents; sub-cent drift throws |
| Line Intelligence Registry | `shared/src/lines/` | doc mentions it (section 5) but not that `inferLob(signals)` and `synthesizeRefId(lob, kind, seq)` (`lobRegistry.ts:517,542`) are the import brain's id-grammar authority |
| Portfolio facet derivation | `lobRegistry.ts:609,619` (`deriveSegmentAxes`, `productSegments`) | facets derived live from the registry, never hard-coded |

## 4. Storage-envelope precision notes (beyond the doc)

- Envelope id escaping: `idFor()` escapes `/ \ ? #` to `~` — entity ids look like
  `ent:products~P1~coverages~PH-COV-001` (`data.js:46`).
- Version diff semantics: delete -> `diff:null`; create -> `{before:{}, changed:all}`;
  update -> `{before:changedFieldsOnly, changed:newValues}` (`data.js:267,280`).
- ChainHead (`chn:<path>`) is a PERSISTENT anchor that survives entity deletes; its
  `_etag` rides the batch as `ifMatchETag` -> 412 -> bounded x3 retry serializes
  concurrent writers (`data.js:284-286,303-317`).
- Embeddings are attached to the chunk op IN the same transactional batch, best-effort
  (failure -> chunk stored without vector, lexical fallback) — `data.js:177-207`,
  `server/lib/embed.js` (96 texts/request, 8000-char truncate, int8 quantization).
- `mutateBatch` chunks at `BATCH_OPS = 96` per partition (`data.js:39,369`) and is NOT
  atomic across partitions — reports `batch_partial` without rolling back committed chunks.
- Presence lives in its OWN container with pk `${tid}:${pid}` and is deliberately outside
  the envelope/audit machinery (`data.js:404-410`, `cosmos.js:15`); no TTL/cleanup job.
- The no-bare-writes census pins EVERY Cosmos write call in `server/` to an allowlist with
  rationale — 8 files, 31 calls, exact-count asserted
  (`app/src/__invariants__/no-bare-writes.test.ts:27-60,99`).

## 5. Verdict

DATA_MODEL.md is accurate at the architecture level (PCM hierarchy, three pillars,
envelope, partitioning, seed portfolio) — every structural claim sampled was confirmed.
Its blind spots are (a) the **dormant-restore reality** of version docs, (b) the
**second docId convention** the server brain introduced, (c) the **dual chunk/searchIndex
schemes**, and (d) the entire **concept-linker provenance layer** added on this branch.
Update priority: fold sections 2 (drifts) and 3 (concept-linker fields) into DATA_MODEL.md
after the docId canonicalization lands, so the doc doesn't immortalize the bug.
