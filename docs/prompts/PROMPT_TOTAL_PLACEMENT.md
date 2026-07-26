# PROMPT — Import Brain: Total Placement (zero-orphan probabilistic assembly)

> Hand this file to a Claude Code session as the work order. It is a self-contained,
> iterative brief: it states the new invariant, the assembly order, the algorithm, the
> guardrails, and the done-when. Work in a lane worktree. ASCII only. No pushes.

---

## 0. Lane setup

- Branch off local `main` into a worktree: `.claude/worktrees/tp-placement`
  (lane name `tp/placement`). One writer per worktree.
- Rebuild the bridges after every `shared/src/**` edit
  (`pnpm build:import-brain`, `pnpm build:filing`, `pnpm build:fleet` as touched) and
  commit the regenerated `.cjs` in the same commit. Never hand-edit a `*-shared.cjs`.
- Full gate green before every commit: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Zero pushes to origin. This lane merges to LOCAL main only when I say so.

---

## 1. The mission (unchanged)

Convert semi-structured insurance documents into a governed canonical Product Component
Model (PCM) and price it deterministically. Extraction must stay grounded, cited, and
byte-faithful, and the four rating canaries must stay exact:
PH `$1,528`, PA `$1,002`, GL `$2,635`, filing-import `$1,281` (read from the locked tests).

---

## 2. THE ONE NEW NON-NEGOTIABLE — Total Placement

**Every piece of insurance data present in the source document MUST be placed somewhere in
the data model.** For every entity kind the importer recognizes — product, coverage,
sub-coverage, limit/deductible, form, rule, rating step, rating/reference table — there is
**no such thing as a dropped or dangling datum**. Each one either:

1. resolves to a first-class node at its own layer (a real coverage, a real form), **or**
2. is **placed under its most-probable parent** with an explicit probability, a rationale,
   the ranked alternatives it beat, and its source citation.

Today the pipeline has two escape hatches that this invariant closes:

- `resolveCoverageHierarchy` (`shared/src/insurance/coverageHierarchy.ts:85`) **promotes
  orphans to top level** with an `orphan-promoted` warning. Blind promotion is now a bug:
  an orphan sub-coverage must first be *offered a probable parent*; promotion is only the
  fallback when no candidate clears the floor, and even then it carries the ranked
  candidates it rejected.
- `matchCoverageByName` (`shared/src/insurance/conceptMatch.ts:161`) **returns `null`
  rather than guess**, and unaccounted residue lands in the `census_unaccounted` review
  bucket. That is correct for the *fill-only overlay* contract, but it leaves data
  un-placed. Total Placement adds a **probabilistic tier below the deterministic tiers**:
  when the deterministic match is `null`, we still compute a best-guess placement with a
  confidence, instead of leaving the datum homeless.

The success metric is a new invariant: **`orphanRate == 0`** on every corpus file — every
extracted entity has a resolved home (or is itself a top-level product), and every
placement that was probabilistic (not `given`/`derived`) is surfaced with its confidence
and alternatives so a human can audit it.

---

## 3. Placement is NOT invention (how this coexists with flag-not-invent)

This is the line you must not cross. Read `CLAUDE.md` NON-NEGOTIABLES again. Total
Placement is compatible with all of them because **placement infers a LOCATION for data
that demonstrably exists in the source; it never invents a VALUE, an id, or a fact.**

- **Flag-not-invent stays intact.** We never fabricate a coverage that isn't in the
  document, never mint a premium, never fill a silent field. `premiumGenerating: null`
  stays null. We are answering "where does this *already-present* datum belong?", not
  "what value should this be?".
- **Citations-or-discarded stays intact.** The datum being placed is a real cited cell;
  its citation rides with it into its new home. A placement with no source cell is illegal.
- **refIds stay byte-faithful.** Never mint, normalize, or overwrite a refId to force a
  match. Probabilistic placement attaches through NEW optional fields (section 6); it never
  touches `refId`, and it never overwrites a `given` or `derived` link
  (`conceptMatch.ts:9-10` contract).
- **Surfaced, never silent.** Every probabilistic placement posts to the conservation
  ledger and appears in the review UI with its confidence, rationale, and alternatives.
  Low-confidence placements (below `CONFIDENCE_REVIEW`) are review-flagged, not hidden.
  A human can always see "the brain *guessed* this went here, and here's why, and here's
  what else it considered."

If you ever find yourself minting an id, filling a value, or hiding a low-confidence guess
to make a number go green, STOP — that is the wrong direction.

---

## 4. The layered "caking" assembly order

Assemble the product in strict bottom-up layers. Each layer resolves ONLY against layers
already placed beneath it. Never let a lower layer reach up to an unplaced higher one.

```
Layer 0  PRODUCTS        all products found become the base cake. If the source has one
                         product, that's the single base. If it has many (multi-product
                         framework), each is a base layer. Nothing floats above "no product".

Layer 1  COVERAGES       every coverage is placed under a product. A coverage with no clear
                         product parent is placed under the most-probable product (or the
                         sole product); if truly ambiguous across >1 product, it is placed
                         under the argmax and the alternatives are recorded.

Layer 2  SUB-COVERAGES   a sub-coverage IS a `Coverage` with `parentId` set (there is no
                         separate type -- `shared/src/types.ts:198`). Every sub-coverage is
                         placed under a coverage (by explicit sub-field, then refId
                         segment-nesting, then coverage-group name, then SEMANTIC similarity
                         to a Layer-1 coverage). Promotion to top-level (`parentId = null`)
                         is the LAST resort, and only with recorded rejected candidates.

Layer 3  LIMITS / DEDUCTIBLES / OPTIONS   two homes: `CoverageTerm` (`types.ts:169` --
                         kind/label/ldTableRef/options/default, the per-coverage limit or
                         deductible node) and standalone `LDTable` (`types.ts:317`). Placed
                         under the coverage/sub-coverage they constrain, by explicit backlink
                         (`ldTableRef`/`backLinkWas`), then code map (BI/PD/UM/UIM via
                         `resolveCoverageCode`), then semantic name match.

Layer 4  RATING / REFERENCE TABLES (RT tables)   placed under the coverage they rate.

Layer 5  FORMS           attached to the coverage(s)/sub-coverage(s) that reference them,
                         then to the product as a package/base form when unreferenced.

Layer 6  RULES           attached to the coverage / table / form they govern.

Layer 7  RATING STEPS    attached to the coverage/table they compute against. In the CORE
                         workbook, rating steps carry NO ids and the coverage name is a free
                         string (carry-forward column) -- these are placed purely by
                         insurance-semantic name match to Layer 1/2 (see worked example 7b).
```

Implement this as an explicit ordered pass. After each layer, assert its placement is total
(every entity of that kind has a `placementParentRefId` or is itself the layer's root) and
post the layer's residue to the ledger before starting the next layer. Do not begin Layer
N+1 until Layer N is conserved.

---

## 5. The placement algorithm (insurance understanding + semantic similarity)

Reuse and extend the existing linker; do not rebuild it. The deterministic core stays first,
the probabilistic tier is strictly additive underneath it.

**Tier order for placing one orphan against the candidate set in the layer below:**

1. **Explicit structural signal** (existing, unchanged): sub-coverage field, refId
   segment-nesting, coverage-group name. `basis = 'given'`.
2. **Deterministic concept match** (existing, `conceptMatch.ts`): `matchCoverageByName:161`
   is already a 4-tier resolver (exact normalized name; synonym-folded token-overlap >= 0.6;
   raw token-overlap >= 0.6; token-containment) that ALREADY strips parentheticals and
   "excluding" tails and drops the near-universal "LIABILITY" token, backed by
   `foldSynonyms`/`ABBREV_FOLD` and `COVERAGE_CODE_MAP` (BI/PD/CSL/UM). It returns a match
   or `null`. On match, `basis = 'derived'`. DO NOT weaken its null-rather-than-guess
   contract; the probabilistic tier sits strictly BELOW it.
3. **NEW — probabilistic placement** (fires only when tiers 1-2 return `null`): score the
   orphan against EVERY candidate parent in the layer below and place at the argmax.
   Combine, as a documented weighted blend:
   - **Insurance-semantic signal (domain-first):** infer the orphan's coverage code by the
     same domain rules (a name containing "bodily injury" -> BI regardless of qualifiers;
     "comprehensive"/"OTC" -> physical damage; "UM"/"UIM" -> uninsured/underinsured), and
     prefer candidates that share the inferred code. Strip parenthetical/scope qualifiers
     ("(Excluding Camper Trailer)", "(per accident)") BEFORE matching; the stripped
     qualifier becomes a scope note on the placement, not a reason to fail the match.
   - **Lexical similarity:** token-overlap / stemmed Jaccard / edit distance on the
     normalized names (extends the existing `matchCoverageByName` tiers).
   - **Embedding similarity (fleet EMBED role):** cosine over name+context embeddings for
     the residual cases lexical overlap can't separate. Route through the fleet EMBED role
     and the cost guard (IMPORT_CONTEXT exempt); cache by content hash; telemetry never
     bypassed. Never hardcode a model string.
   Record `placementConfidence = blendedScore`, `placementBasis = 'probabilistic'`, the
   top-N `placementAlternatives` (each with its score), and a one-line
   `placementRationale` ("matched code BI; lexical 0.62; embedding 0.81; beat 'PD Liability'
   0.44").
4. **Last resort — promote with evidence:** if the argmax score is below the placement
   floor, promote to the layer's root (product for a coverage, top-level for a
   sub-coverage) as today, BUT stamp `placementBasis = 'promoted'`, keep the rejected
   `placementAlternatives`, and post a `census_unaccounted`-style review item. Never a
   silent drop, never a blind promote.

**Confidence bands** reuse the existing constants
(`server/lib/import-brain/constants.js`): `CONFIDENCE_ACCEPT = 0.85`,
`CONFIDENCE_REVIEW = 0.60`, `CONFIDENCE_DISCARD = 0.40`. A probabilistic placement at or
above `ACCEPT` is auto-accepted (still audit-visible); between `REVIEW` and `ACCEPT` is
review-flagged; below `REVIEW` is placed-but-flagged with alternatives foregrounded. Nothing
below `DISCARD` is asserted as fact without a review item.

Where a model is used to break a tie or propose a placement, hook the existing fill-only AI
overlay (`server/lib/ai/propose-mapping.js` + `AliasOverlay` at `isoImport.ts:74-96`, which
already carries `ratingGroupLinks/tableCoverageLinks/ruleReferenceLinks` stamped
`linkBasis:'ai-proposed'`) — extend it, don't add a parallel one. Decorrelate the checker
(different model family), exactly as the existing ensemble seams do. A model may *nominate* a
placement; it can never *mint an id* — the accepted placement always cites the source cell,
and every proposed target refId must already exist in the deterministic model's id sets.

---

## 6. Data-model additions (placement provenance)

Mirror the existing `LinkBasis` trichotomy (`shared/src/types.ts:22`, `'given' |
'derived' | 'ai-proposed'`) and the existing golden-invisible linker fields
(`Rule.tableRefIds/tableLinkBasis/resolvedCoverageRefId`,
`LDTable.coverageRefIds/linkBasis/backLinkWas`, `RatingStep.group*`). Add, on every
placeable entity, a small optional and golden-invisible placement record:

```
placementParentRefId?: string        // the resolved home (null only for a layer root)
placementBasis?: 'given' | 'derived' | 'probabilistic' | 'promoted'
placementConfidence?: number         // 0..1, present when basis != 'given'
placementAlternatives?: { refId: string; score: number; label?: string }[]
placementRationale?: string          // one human-readable line; ASCII
placementScopeNote?: string          // e.g. "Excluding Camper Trailer" stripped qualifier
```

Rules:
- All new fields OPTIONAL and absent from the golden diff surface, so GL/IM/PR/CORE goldens
  stay byte-identical (verify: no golden regen, no threshold move).
- These fields are the audit trail. The review UI and the observatory read them; the
  brain-side `AccountingLedger` (`shared/src/import/census/accounting.ts`) posts one
  disposition entry per placement, and each probabilistic/promoted placement also becomes a
  first-class review item (the same lane as `census_unaccounted`).
- Do NOT overwrite `refId`, `docId`, or any `given`/`derived` link to force placement.

---

## 7. Worked examples (make these pass)

**7a. Sub-coverage with a scope qualifier that isn't a listed coverage.**
Source rating/framework row: `Bodily Injury (Excluding Camper Trailer)` with no refId.
Listed coverages include `Bodily Injury Liability` (e.g. `PA.COV.001.001` /
`CORE.COV.xxx`). Expected: strip `(Excluding Camper Trailer)` -> `Bodily Injury` -> domain
code BI -> place under the BI coverage with high `placementConfidence`,
`placementBasis = 'probabilistic'`, `placementScopeNote = 'Excluding Camper Trailer'`,
and `placementAlternatives` listing e.g. Property Damage (low score). NOT promoted to a new
top-level coverage; NOT dropped.

**7b. Rating steps with no ids (the CORE workbook reality).**
`Core Rating Specifications` carries a coverage NAME in a carry-forward column and no refId
on any step. Expected: every rating step is placed under a Layer-1/2 coverage by
insurance-semantic name match; a step whose name matches no coverage above the floor is
placed under the best candidate AND review-flagged with alternatives, never left orphaned.
After the pass, `orphanRate` over rating steps is 0.

**7c. LD/RT table with a stale/lonely backlink.**
An LD table whose stated coverage ref doesn't resolve (the existing `danglingTableRefs`
case, e.g. GL `LDTable.122` -> no table). Expected: keep the honest dangling-ref record
(don't guess a fake table id), but ALSO place the table under its most-probable coverage by
code + name similarity so the LD table itself is not orphaned; record both facts.

---

## 8. The conservation invariant + gate (entity-level)

Extend conservation from cell-level to entity-level.

- Today `conserve.ts` + the census answer "was every source CELL accounted for?" The truth
  engine is the `AccountingEntry` disposition enum (`shared/src/import/census/types.ts`:
  `FACT | SCHEMA | NOISE | HEADER | MERGE_SHADOW | NEEDS_REVIEW | UNACCOUNTED`), with
  `substanceCoverage = (FACT + SCHEMA) / (nonEmpty - NOISE - HEADER - MERGE_SHADOW)` and
  `rollupSheet` THROWING if posted entries != nonEmpty (`accounting.ts:89`) -- cell
  conservation is enforced, not assumed. The four CE3 gates
  (`unaccountedEntityCells == 0`, `substanceCoverage >= 0.985`, counting invariants clean,
  `ldTableRefResolutionRate >= 0.95`-or-null) must all STAY green. `UNACCOUNTED` is the
  cell-level orphan; `orphanRate` below is its entity-level twin.
- ADD an entity-level metric to `scripts/import-eval2.mts` (and expose it in the offline
  gate): **`orphanRate`** = (entities with no resolved `placementParentRefId` that are not a
  layer root) / (total placeable entities). Gate at `orphanRate == 0`. Also report
  `probabilisticPlacementRate` and the placement confidence histogram so a reviewer sees how
  much of the product was assembled by guess vs. given.
- The gate must remain **honest**: a placement that only cleared the floor by a hair is
  still counted as placed (orphanRate 0) but shows up in `probabilisticPlacementRate` and
  the review queue. Do not weaken any existing threshold; do not regenerate any golden. If a
  corpus file has provably-unreachable placement (document it the way CE3 documented the
  all-lines twin exception), prove it, don't excuse it.

---

## 9. How to work — the iterative loop

Iterate in small, reversible steps. Each iteration:

1. **Measure.** Run the offline board and record per-file `orphanRate` and the biggest
   orphan bucket:
   `tsx scripts/import-eval2.mts --offline --census docs/import-census/ce3-accounted.census.json`
   plus `pnpm import:eval` (eval1, F1/citations/parent metrics).
2. **Pick the worst.** Take the file with the highest `orphanRate`, inspect its largest
   un-placed entity kind (likely rating steps, then LD tables, then sub-coverages).
3. **Diagnose at the cause.** Read the actual source rows and the current linker tier that
   returned `null`. Write down WHY it orphaned (no code match? qualifier not stripped? no
   candidate in the layer below yet because ordering is wrong?).
4. **Implement the smallest fix** in `shared/src/**` (linker/hierarchy/conserve) +
   rebuild the bridge. Prefer extending an existing tier over adding a new mechanism.
5. **Verify.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then the four
   canaries exact, then re-run eval1 + eval2. Accept only if: gate green, canaries exact,
   `orphanRate` strictly dropped on the target file, and NO other file regressed, NO golden
   changed, NO threshold moved.
6. **Lock it.** Add/extend a unit test that pins the new placement (a fixture row ->
   expected `placementParentRefId` + basis), so the behavior can't silently regress. Then
   commit (stage explicitly; stowaway check; `git commit --only <paths>`).
7. **Repeat** until `orphanRate == 0` on every corpus file (or provably-unreachable,
   documented). Keep a running ledger in `docs/import-census/` (one entry per iteration:
   file, bucket, root cause, fix, before/after orphanRate).

Stop conditions: all corpus files at `orphanRate == 0` with the four gates still green and
the four canaries exact; or a documented impossibility proof for any residual.

---

## 10. Inherited non-negotiables (do not break any of these)

- Adapter seam; atomic mutation envelope; audit hash-chain — untouched by this work.
- Four canaries exact, read from the locked tests only.
- Citations-or-discarded; flag-not-invent; refIds/form-number chips byte-for-byte.
- Model ids from the fleet registry only, through the cost guard; import under
  `IMPORT_CONTEXT` (no-cap) but telemetry never bypassed; never `claude-fable-5`, never a
  hardcoded model string.
- Signature-gate the new behavior so workbooks that don't carry the un-keyed-reference /
  orphan signature import BYTE-IDENTICALLY to today (GL/IM/PR/CORE goldens unchanged).
- Tests are law: never weaken a test, threshold, canary, or golden to go green.
- Verify-first: every claim in the final report comes from a run, not from reading code.
- Secrets in `process.env` only; `COSMOS_DB` pinned to `prodhub-sal` for any Cosmos-touching
  script (never the live `prodhub`).

---

## 11. Done-when

- [ ] `orphanRate == 0` on all offline corpus files (or documented impossibility proof).
- [ ] The four CE3 gates still green (unaccountedEntityCells 0, substanceCoverage >= 0.985,
      counting invariants clean, ldTableRefResolutionRate >= 0.95-or-null).
- [ ] eval1 offline still 4/4 at F1 = 1.0, zero fabrication, citations = 1.0,
      parentResolutionRate == 1.
- [ ] Four premium canaries EXACT.
- [ ] Full gate green at every commit; bridges rebuilt + committed.
- [ ] Worked examples 7a/7b/7c pinned by unit tests.
- [ ] New placement provenance fields optional + golden-invisible (no golden regen).
- [ ] Placement ledger + a short report (red-to-green per file, hostile self-review:
      "where was placement most tempted to guess wrong, and what line makes a wrong guess
      auditable rather than silent?").
- [ ] Zero pushes to origin.

---

## 12. Appendix — current-state file map (start here)

- `server/lib/import-brain/index.js` — `runAdaptiveImportBrain:57`; opens one
  `AccountingLedger` per censused sheet (:75-83), posts the accounting rollup (:223-234).
- `server/lib/import-brain/stage7-plan.js` — `buildImportPlan:271` (pure, no AI); ISO-join
  `joinGroupWithIso:156` (uses `nameKey:150` sequence-aligned name match); conservation
  (one product / one rating program; extras -> BLOCKING unresolved, :322-332); orphan
  promotion + SYNTH mint. This is where the layered placement passes are assembled + asserted.
- `server/lib/import-brain/stage45-sweeper.js` — `sweepUnaccounted:95`; `acceptAnswer:65`
  is the ONLY model-answer -> ledger path (rejects out-of-batch / off-vocabulary / id-mint).
  The probabilistic placement of swept residue plugs in here.
- `shared/src/insurance/coverageHierarchy.ts:85` — `resolveCoverageHierarchy` (today's
  orphan-promoted path; add the probabilistic tier upstream of promotion).
- `shared/src/insurance/conceptMatch.ts` — `matchCoverageByName:161` (4-tier, add the
  probabilistic tier BELOW it), `COVERAGE_CODE_MAP:90`, `resolveCoverageCode:212`,
  `matchRuleReferenceToTables:253`, `matchGroup:328`, `foldSynonyms:78`.
- `shared/src/import/mapper/conserve.ts` — `conservationEligible:51` (gate:
  `MIN_SHEETS=4` / `MAX_SPECIES=2` / no dup sheets / zero ref-table signature),
  `runConservationPass:220`, `unharvestedSheets:199` (flag-not-invent residue); extend to
  entity-level placement conservation.
- `shared/src/import/census/accounting.ts` + `census/types.ts` — the disposition ledger
  (`post/postSpan/rollupSheet/rollupWorkbook`); `orphanRate` derives from here.
- `shared/src/insurance/isoImport.ts` — mapper import path; wires conserve at :2235-2290
  (notices `conservation_harvest`/`conservation_unharvested`); `AliasOverlay:74-96`.
- `server/lib/ai/propose-mapping.js` — the fill-only AI overlay (`linkBasis:'ai-proposed'`);
  extend for model-nominated placement.
- `shared/src/types.ts` — `Coverage:198` (parentId = sub-coverage signal), `CoverageTerm:169`
  (limits/deductibles), `LDTable:317`, `RatingStep:248`, `Rule:216`, `Form:383`,
  `LinkBasis:22`; add the placement provenance fields near the existing linker fields.
- `shared/src/import/canonicalMap.ts` — `CANONICAL_MAP:124` keyed by `CanonicalEntityKind`
  (product|coverage|form|dynamicField|ratingProgram|ratingStep|rtTable|ldTable|rule|formRule);
  the field dictionary that grounds every entity kind's aliases.
- `scripts/import-eval2.mts` — the conservation board (census gates); add `orphanRate` +
  `probabilisticPlacementRate` + the placement confidence histogram.
- `scripts/import-eval.mts` + `scripts/lib/import-eval-metrics.mts` — eval1 gated field
  metrics (F1 >= 0.95, numeric >= 0.98, citations = 1.0, parentResolutionRate == 1,
  parentEdgeRecall/formAttachmentRecall >= 0.98).
- `docs/import-census/CE3_REPORT.md`, `CENSUS_INTERFACE.md` — the conservation/census
  contract this work extends.
- `docs/DOMAIN_PA.md` — the canonical PA hierarchy (Parts A/B/C/D -> subs -> CoverageTerm/LD
  /RT -> rating steps -> forms -> rules); the insurance-semantic ground truth for placement.
```
