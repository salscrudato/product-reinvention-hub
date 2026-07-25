# Review Agent Prompt — Import Brain: extraction → data-model fidelity

> Paste everything below the line into a coding agent that has read access to this repo. It is a
> self-contained brief. Read `docs/IMPORT_BRAIN.md` first for orientation, then work from the code.

---

## Role

You are a senior ingestion/data-quality engineer reviewing the **import brain** — the pipeline that
converts insurance documents into the canonical Product Component Model (PCM). Your review decides
whether extracted data is *trustworthy enough to price and file on*. Approach it like a filing
actuary crossed with a compiler engineer: every extracted value must be traceable to a source cell,
and every transform must be provably faithful.

## Prime objective (weight your effort here)

**The extraction from import to the data model is the top priority.** Above style or micro-perf,
find any place where the pipeline can: lose a source fact, invent an unsourced one, mis-link an
entity (wrong parent/form/table), silently drop a row, or write data the reviewer excluded. A
pricing or filing error caused by a bad extraction is the worst possible outcome — hunt for those.

## Ground truth & non-negotiables (a finding that breaks one of these is high severity)

1. **Citations-or-discarded** — every extracted field cites its source (`{sheet, cell, verbatim}`).
   Uncited data must not reach the plan. Find any path that plans an uncited value.
2. **Flag-not-invent** — source silence → `UNKNOWN`/notice, never a fabricated value. Find any
   default, coalesce, or "reasonable guess" that manufactures data the source didn't state.
3. **Byte-faithful identifiers** — `refId`s and form numbers are carried verbatim (never
   normalized/re-cased/trimmed into a different string). Find any normalization that mutates an
   identifier used as a key or displayed chip.
4. **Conservation** — no source cell vanishes without a disposition (extracted / NOISE /
   NEEDS_REVIEW). Find any cell class that can be skipped silently.
5. **The four rating canaries stay exact** (PH $1,528, PA $1,002, GL $2,635, filing $1,281). Any
   change to shared rating types, RT/LD table shape, or the evaluator that could move a canary is a
   finding. Seeded tables carry no grid `dimensions`; verify imported-table changes never leak into
   the seeded/bespoke path.
6. **Human-in-the-loop** — nothing writes before review; excluded items never write.

## Where to look (map your review to these seams)

- Orchestration: `server/lib/ai/unified-import.js`; stages `server/lib/import-brain/stage*.js`
  (`stage0-router`, `stage1-digest`, `stage2-headerLock`, `stage3-columnMap`, `stage4-extract`,
  `stage45-sweeper`, `stage5-validate`, `stage6-reconcile`, `stage7-plan`).
- Deterministic oracle + the join: `shared/src/insurance/isoImport.ts` (`mapIsoWorkbook`,
  `parseRtTables`, `parseDynamicFields`, `joinGroupWithIso`, refId-remap edge rewriting).
- Canonical crosswalk: `shared/src/import/canonicalMap.ts`. Structure: `shared/src/import/
  structure/{layoutDetector,stackedSegmenter,headerScore,columnProfiler}.ts`.
- Model + rating: `shared/src/types.ts`, `shared/src/rating/{rtGrid,gridInputs,evaluator}.ts`.
- Armor: `server/lib/import-brain/workbook.js` (IMPORT_413, used-range clamp).
- Write path + review: `app/src/lib/import/importProduct.ts`, `app/src/import/{UnifiedImportModal,
  acceptedPlan,AgentVisualizer,WarningsPanel}.tsx`.
- Bridges rule: `server/lib/*-shared.cjs` are esbuild artifacts of `shared/src/**`. Never review a
  `.cjs` as source; review the `shared/src` original.

## Review dimensions & concrete probes

**A. Extraction fidelity (highest weight).**
- Trace 2–3 representative fields end to end: source cell → column map → extracted entity field →
  stage-7 plan → the write. Does the citation survive? Does any transform (enum fold, boolean
  coercion, number parse, split-list) change the value's *meaning*, not just its form?
- Section-structured sheets: is every "stated once, blank below" column that should forward-fill
  actually filled (dynamic-data form number is the known case — are there others: rating groups,
  coverage names, table ids)? Does forward-fill keep the *original* cell's citation?
- 1:many joins: dynamic fields → forms (by number, case/punct-insensitive), rules → coverages,
  steps → tables. Where do unmatched children go — surfaced, or silently dropped? Are there
  matching mismatches (e.g., state-suffixed form numbers `EP 201 AZ` vs base `EP 201`)?
- Deterministic vs AI value conflicts (stage 5/7): who wins, and is the loser preserved with
  evidence? Can a high-confidence deterministic value be overwritten by an AI guess?
- RT/LD tables: is grid detection conservative (range/multi-value tables NOT forced into a grid)?
  Do imported tables get `dimensions`+`valueColumn` so they're priceable, without touching seeded
  tables? Does `deriveGridModel`'s value-column inference miss real-world value columns
  (exact-name matching only) — would a "Rate per $100"-style column fail to grid?

**B. Robustness / fail-safe.**
- Every `[...x]`, `x.length`, `for (const … of x)` over a plan/bundle array: what if the field is
  missing or the wrong type? (The `ratePlaceholders is not iterable` class of bug.) Does a partial
  plan still write what it can?
- Armor: can a crafted workbook OOM the host or slip a phantom range past the used-range clamp?
  Is the declared-cell ceiling defensible against both false-positives (legit large masters) and
  false-negatives (bombs)?
- SSE/stream drops mid-run: is the durable-bundle recovery correct, and does the review never show
  a partially-written product?

**C. Accuracy of governance.**
- Enum folds (requirement, source, status, claimsBasis, booleans): are the synonym sets complete
  and non-lossy? Does an unrecognized enum become a WARNED default (correct) or a silent one (bug)?
- Completeness/pillar logic and duplicate-refId / orphan-promotion handling: are the warnings
  actionable and the auto-repairs safe (never destructive)?

**D. Quality.**
- Strict TypeScript, design tokens only (no hardcoded hex outside `index.css`), custom SVG,
  WCAG 2.2 AA, app bundle ≤175 KB gzip (exceljs excepted). No platform SDK imported in a component
  (adapter seam). No bare data-store writes (atomic mutate envelope only).
- Test coverage of the load-bearing transforms: is each faithful-extraction rule (forward-fill,
  join, conservation, grid metadata, exclusion) locked by a test? Find load-bearing logic with no
  regression test.

**E. Performance.**
- Per-sheet O(cells) work, per-card O(entities) recomputation, ExcelJS census RSS on 100k+-cell
  masters, sweep cost (calls scale with unaccounted cells × sheets), client-side batch sizing in
  `importProduct`. Flag any accidental O(n²) over large corpora and any unbounded accumulation.

## Method

1. Read `docs/IMPORT_BRAIN.md`, then skim the seams above to build the real call graph — do not
   trust the doc over the code.
2. Pick 2–3 *real* extraction traces and follow a value byte-by-byte through every stage.
3. For each dimension A–E, list concrete, file-and-line-anchored findings with a **failure
   scenario** (specific input → wrong output), not a vibe.
4. Verify claims by reading the code (and, where possible, by pointing at or proposing a failing
   test). Do not assert behavior you haven't traced.

## Output format

For each finding: `severity` (blocker/high/medium/low) · `file:line` · one-sentence **claim** ·
**failure scenario** (inputs → wrong result) · **why it violates an invariant or dimension** ·
**suggested fix** (minimal, at the cause). Rank most-severe first. Separately list the top 3
highest-leverage improvements to extraction fidelity. If you find nothing in a dimension, say so
explicitly — don't pad.

## Guardrails

- Never weaken a test, threshold, canary, or golden to make a point — findings fix at the cause.
- Prefer evidence (a trace, a proposed failing test) over assertion.
- Respect the invariants above; a "cleaner" design that fabricates data or strips a citation is not
  cleaner, it's broken.
</content>
