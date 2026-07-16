# CE3 REPORT — brain rewire: fleet reality shipped, mapper-vs-locks conflict found

Lane `ce/ce3-brain` (worktree `.claude/worktrees/ce3-brain`, fork = local `main` after
merging `ce/ce1-census` + `ce/ce2-goldens`). Model claude-fable-5. ASCII only. Zero pushes
to origin from this lane (CE5 owns the local merge). Four premium canaries EXACT throughout
(PH 1528 / PA 1002 / GL 2635 / filing-import 1281).

## 1. What shipped

| Step | Deliverable | State | Commit |
|---|---|---|---|
| 0 | Fleet reality: xai deprovision handling + WORKBOOK_DIGEST role | DONE | CE3-S1 |
| — | Preconditions: ce1+ce2 merged to local main, worktree, baseline gate | DONE | CE3-S0 |
| 8 | Observatory: importRun index + Blob artifacts + 3 read routes + SSE builders + CE4 fixture | DONE | CE3-S3 |
| 5/6/14/15 | Mapper conservation | INVESTIGATED, REVERTED (see sec 3) | — |
| 1/2/3/4/7/9 | Live census wiring, digest, windowed extraction, sweeper, checkpoint, hardening | NOT BUILT (scoped, sec 5) | — |

### Step 8 — observatory (CE3-S3, shipped)

Server-side, NOT app/src-blocked. `server/lib/ai/run-observatory.js` persists a compact
`importRun` index doc + per-stage Blob artifacts (the `run-results.js` injectable-seam
pattern: tenant-scoped, path-sanitized ids, honest `storage_not_configured`). Three
READ-shaped GET routes in `server/lib/ai/index.js` (`product:read` + `requireTenant`,
SUPER_ADMIN `X-Tenant-Id` honored via `resolveTenantForPrincipal`): `GET /api/ai/importRuns`
(newest 50), `/importRun/:runId`, `/importRun/:runId/artifact/:stage`. Wired into
`unifiedImport` run-close (best-effort — never fails the run). SSE builders
`brain:census/sweeper/cache/checkpoint` pin the wire shapes for the live stages (Steps 1/3/4)
to emit. CE4 fixture at `docs/import-census/fixtures/importRun.fixture.json` (CE4 copies it
into `app/src/fixtures/` — CE3 never writes under app/src). 5 locks:
`tests/import-brain/observatory.test.ts`. 30-day retention is a container-lifecycle TODO (R8).

### Step 0 — fleet reality (CE3-S1, shipped)

Operator statement 2026-07-16: Grok (grok-4.3 / `VERIFY_XAI`) is deprovisioned from
foundry-prodhub-dev; FLEET.md at d28c8a1 is stale on this point.

- `shared/src/ai/fleet.ts`: `EXTENDED_DEGRADE` map `{ VERIFY_XAI -> VERIFY_DEEPSEEK }` +
  `degradedExtendedRole()`; new `WORKBOOK_DIGEST` composite routing descriptor
  (`primary: DEEP_REASONER` on the `/responses` surface via `external.foundry.deepReason`,
  `fallback: GROUNDED_CITED` chat). No deployment id is hardcoded at any call site.
- `server/lib/import-brain/verify-lineage.js`: `isConfigured`-style probe guard — env
  opt-in `FOUNDRY_ENABLE_XAI=1`, process-lifetime 404/400 probe-death cache, injectable
  judge seam. Routes `xai -> deepseek` by default (the 2026-07-16 reality), makes a future
  re-provision a config flip (no code change). VERIFY_DEEPSEEK is the third judge lineage.
- Bridge `server/lib/fleet-shared.cjs` regenerated (`pnpm build:fleet`) + committed.
- 7 locks green: `tests/import-brain/verify-lineage.test.ts`.
- **Grok deprovision RECOMMENDATION for the operator:** the registry + guard no longer
  route to `grok-4.3` by default; `grok-4-20-reasoning` remains unreferenced anywhere in
  the tree (FLEET.md sec 3). Both are deprovision candidates.

## 2. Preconditions (CE3-S0)

CE1 (`ce/ce1-census`) merged clean into local main (7a2a2ec). CE2 (`ce/ce2-goldens`)
merged with ONE add/add conflict — `docs/import-census/ledger.json` — resolved as the
documented UNION of both lane ledgers (10 ce1 rows + 9 ce2 rows, zero dropped), UTF-16LE
normalized to UTF-8 (17dbfbe). Worktree `ce/ce3-brain` on the merged base. Baseline gate
GREEN (161 files / 1786 tests). CE2 was STILL ANNOTATING the 8th golden (hagerty-co-rv125)
at fork time — this lane worked against the 7 committed goldens2; the 8th + any late ce2
commits are a CE5 re-sync item.

## 3. Steps 5/6/14/15 — the mapper conservation conflict (the load-bearing finding)

CE3's mission is "nothing of substance can leave a workbook unaccounted." The natural
offline attack — make the deterministic mapper (`mapIsoWorkbook`) account for every cell —
was built and DROVE eval2 offline from the CE2 expected-RED baseline (7/7 deeply red,
substanceCoverage 0-45%) to:

- **gl-base GREEN on all four CE3 gates** (unaccountedEntityCells 0, substanceCoverage
  100%, counting invariants clean, ldTableRef n/a), gl-2026 one ENTITY cell from green
  (cov 99.1%), and cov 88-100% across the other files.

The mechanism: harvest every source row's verbatim residue onto its named entity
(`sourceCellValues`), carry form refIds, flip to multi-product, and mint review-flagged
conservation entities (generic region extraction, content-signature routing, column-value
/ column-header / cell-ref / name@row / refid-token entities) for the substance the named
parsers leave. This is the value-presence proxy eval2 offline scores against
(CENSUS_INTERFACE): a cell is accounted iff its canonicalized value survives into the plan.

**It was reverted, because it is irreconcilable with the file allowlist. Verify-first,
definitive:**

1. Those conservation entities land in `plan.coverages` / `plan.forms`, which BREAKS 36
   tests — including THREE in `app/src/**` (FORBIDDEN, CE4-owns):
   `app/src/lib/import/fidelity.test.ts`, `glRobustness.test.ts`, `isoFixture.test.ts` —
   plus `shared/src/insurance/isoImport.test.ts` and the eval1 extras gate.
2. `app/src/lib/import/isoFixture.test.ts` reads `samples/iso/sample-GL-framework.xlsx`
   and LOCKS the mapper output (coverages == 105, forms == 816, all-canonical fields).
   **`samples/iso/sample-GL-framework.xlsx` is BYTE-IDENTICAL (same SHA256, `7A188D2FCD80…`)
   to the eval2 corpus file `Product_Framework_General_Liability.xlsx` (= eval2 `gl-base`).**
   So the SAME workbook is simultaneously (a) locked byte-for-byte by an uneditable app/src
   test and (b) demanded by the eval2 goldens2 counting-invariant floors to mint additional
   form/refId entities. `samples/iso/sample-PR-framework.xlsx` is structurally identical to
   the corpus `All_Lines_Master` (PCM 19916, ROC 24674, Rules Repository 69942, Sheet1 2569
   all match); content-triggered conservation fires on both, so the app/src PR fidelity test
   locks All_Lines' output too.
3. These cannot both hold. Editing `app/src/**` is FORBIDDEN; weakening the fidelity
   snapshots violates "tests are law." So the eval2 goldens2 gates are **irreconcilable with
   the pre-existing app/src fidelity locks on the shared corpus**, within CE3's allowlist.

**Reverted `shared/src/insurance/isoImport.ts` to HEAD (byte-identical).** 143
previously-failing tests GREEN; eval1 byte-identical; four canaries exact. The exploratory
conservation modules (`shared/src/import/mapper/conserve.ts`, `regionExtract.ts`) were
removed from the tree (preserved in a local patch outside the repo) so nothing dead ships.

### Why the census path does not escape the conflict

eval2 supports `--census <path>` with per-sheet `accounted` A1 refs that OVERRIDE the
value-presence proxy (import-eval2.mts `scoreGolden`). One might keep the mapper
byte-identical and pass the ACCOUNTING gates (unaccountedCells, substanceCoverage) by
emitting a census whose `accounted` set is census-complete. But (a) an HONEST `accounted`
set = cells the pipeline actually EXTRACTED (not merely censused), which for the messy
masters is a fraction < 0.985; and (b) the COUNTING-INVARIANT floors
(`countingInvariants`) read `plan.coverages/forms` via the fixed `planToEntities`, NOT the
census — so SECURA's form floor (759), All_Lines' `__TOTAL__` (2532 distinct refIds), etc.
stay red no matter the census, because meeting them requires minting plan entities, which
re-triggers the app/src break. The census path moves the accounting gates but not the
counting floors.

## 4. eval2 offline board — byte-identical mapper (honest BEFORE = the CE2 baseline)

With the mapper reverted, eval2 offline is the CE2 expected-RED baseline: the deterministic
path loses the substance the counting floors measure. This is not a CE3 regression — it is
the un-mutated truth, and it is red precisely where the app/src locks forbid the fix. The
four-gate status the conservation approach REACHED before revert (recorded for CE5's
adjudication): gl-base 4/4 green; gl-2026 cov 99.1% (1 ENTITY cell); client-master unaccEnt
0; the sampled masters 88-95% cov. That improvement is achievable the day the conflict in
sec 3 is adjudicated.

## 5. What is NOT built (honest scope, for CE5 / continuation)

- **Steps 1-4 (live pipeline):** census into stage 0 + AccountingLedger, hidden-sheet
  extraction flip, dup-cluster stage-7 fold, workbook digest (dual-model + WORKBOOK_DIGEST
  synthesis + bounded window-request tool), windowed extraction (column continuation,
  ledger FACT posting, deepseek judge tail), extraction cache (item 8), sweeper stage 4.5.
  These are SERVER-side (`server/lib/import-brain/**`, `server/lib/ai/**`) and do NOT touch
  the app/src-locked mapper — they are the correct home for the accounting the offline
  mapper cannot do within the locks, and are unblocked.
- **Step 7:** per-stage checkpoint/resume + SIGKILL kill-test.
- **Step 8:** evidence-graph observatory (`importRun` index doc, Blob stage artifacts, the
  three read routes, SSE `brain:census/sweeper/cache`, the CE4 fixture).
- **Step 9:** two-fixture hardening locks per mechanism.

## 6. RECOMMENDATION FOR CE5 (adjudicate the conflict, sec 3)

Pick one, explicitly, at merge:
1. **CE4 relaxes the app/src fidelity snapshots** to allow strictly-additive conservation
   entities (the diff is provably additive — eval1 F1/numeric/parent/edges/forms all 1.0,
   nothing removed or changed, only extras). Then the offline conservation lands and the
   four gates go green as demonstrated. This is the cleanest if CE4 owns those tests.
2. **Route conservation to the LIVE brain + sweeper (Steps 1-4)** — the server path is not
   app/src-locked — and score eval2 `--live`/`--census` against the ledger's FACT set.
   The offline board stays at the CE2 baseline by design (the deterministic mapper is a
   parse-stability oracle, not a lossless extractor); the LIVE path is the lossless one.
3. **Accept the deterministic offline mapper cannot meet the counting floors on the sampled
   masters** and gate those files' eval2 offline expectations accordingly, documenting the
   floor as a LIVE-only gate.

Recommended: (2) — it matches the prompt's own architecture (Steps 1-4 build the ledger and
sweeper) and keeps every locked test green.

## 7. Hostile self-review

**1. Where was the pipeline most tempted to invent, and what stopped it?** The generic
region extractor on SECURA "Ref Connect Pull" — multi-form composite cells beg to be split
into per-form entities. It was held to VERBATIM (the whole cell became one review-flagged
group entity, `genericKind:'multi-value-reference'`, never split), and refId minting for
names was operator-normalized only (never a source-shaped id), so `fabricationMetrics`
(source-shaped-only) could not be tripped by a name entity. This is moot in the shipped
tree (reverted) but was the live temptation.

**2. Ledger vs plan disagreement?** Not applicable in the shipped tree — no live ledger was
wired (Step 1 unbuilt). The CE1 consumedSpans remain observational.

**3. Worst-case token cost of the digest window tool (Step 2)?** Not built. Design bound
stands from the prompt: max 12 requests x 40x40 cells x 2 models per workbook.

**4. If CE1 under-segmented a stacked table, does the pipeline lose data or surface review?**
In the shipped (byte-identical) mapper: the pre-existing behavior (CE1's parser-armor +
stacked segmentation) is unchanged — it surfaces, it does not silently lose. The
conservation layer that would have added review items for the residue is reverted.

**5. Lowest-substanceCoverage file + its review bucket?** In the shipped tree the whole
offline board is at the CE2 baseline; the lowest is `client-master` (0.0% substanceCoverage
offline) — a 3-product inventory whose values (`0MM`, `2M`) the deterministic mapper does
not extract because the sheet is not a recognized template. A human WOULD agree those
belong in review — which is exactly what the LIVE sweeper (Step 4, unbuilt) is for.

**6. What was left red / out of scope, and why is it honest not lazy?** Steps 1-4/7/8/9.
Honest because: the offline mapper path (Steps 5/6) hit a HARD allowlist conflict that no
amount of mapper work resolves within CE3's file boundaries (sec 3, proven by SHA256); the
correct fix is server-side (the live pipeline), which is a large, separate build. Shipping a
byte-identical mapper + the fleet-reality fix + this precise conflict finding is more useful
to CE5 than a mapper that green-boards eval2 by breaking three forbidden tests.

## 8. Done-when status

- [x] Gate green (typecheck + lint + test + build) on the shipped tree.
- [x] Four canaries exact; eval1 byte-identical; bridges regenerated + committed.
- [x] Step 0 fleet reality shipped + locked (7 tests).
- [x] The Steps 5/6 conflict proven (SHA256) and documented for CE5.
- [ ] eval2 offline four gates green on all files — BLOCKED by the sec-3 conflict; the path
      to green is demonstrated and handed to CE5 for adjudication.
- [ ] Steps 1-4/7/8/9 — NOT built (scoped, sec 5).
- [x] Zero pushes to origin from this lane. Ledger + this report complete.
