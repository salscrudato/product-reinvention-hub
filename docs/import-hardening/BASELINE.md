# IMPORT HARDENING — IH1 baseline (verified ground truth at HEAD)

**Baseline HEAD:** `2b1f893febdfbc93152f5e5681836420954d5713` (2026-07-14).
Prior review packets referenced `efb8828` and `2b1f893`; all packet line numbers were
treated as navigation hints and re-verified at this sha.

## State reconciliation (Step 0)

- **PCM wave-0 work** (workbook.js `normalizeCellValue`, pooled stage-4 escalation,
  instrumented import-eval): **already shipped** in `efb8828`, which is on
  `origin/main`. Only `2b1f893` (a UI cursor fix, another lane's) was local-unpushed
  at session start — it rides IH1's wave.
- **PCM handoff outcomes at HEAD** (verified, not assumed):
  - (a) Attachment integrity: **BROKEN** — imports persist `coverage.terms: []`
    (no code assembles terms from LD tables), the UI counts `cov.terms`, pricing
    links off `terms` → dashes. Ledger **PCM-A** (BLOCKING, cost L).
  - (b) History/versioning: write side **works** (mutate + mutateBatch share
    `envelope()`, version zero written atomically — F19/PCM-C disproven); read side
    **broken** (`db.list` filters `kind='entity'`, no versions endpoint, shape
    mismatch). Ledger **PCM-B** (BLOCKING, cost M).
  - (c) `scripts/import-verify.mts` does **not** exist; `scripts/import-eval.mts`
    has **no** linkage/attachment metrics. Folded into ledger **F20**.

## Findings matrix F01–F20 (verified at HEAD by 4 read-only subagents + 1 deep tracer; spot-checked by the writer at every fix site)

| # | Verdict | Where (at 2b1f893) | One-line repro / disproof |
|---|---|---|---|
| F01 | **CONFIRMED** → fixed | `stage4-extract.js:106-110`; prompt `prompts.js:164` | Model A splits row 7 into 2 entities → row-keyed Map keeps only the last |
| F02 | **CONFIRMED** → fixed | `stage4-extract.js:119,:173` | kind coverage-vs-rule → `primary = ea ?? eb` silently adopts A's kind |
| F03 | **CONFIRMED** → fixed | `stage4-extract.js:285,:300` | 4 candidates → judge sees 3; verdict 'd' → `candidates[-1]` → lost |
| F04 | **CONFIRMED** → fixed | `stage2-header-lock.js:113-126` | preamble above header → synthetic-grid index 0 confirmed as absolute row |
| F05 | **CONFIRMED** → fixed | `stage4-extract.js:440-444` | `rowKind('PR.PROD001','coverage')` → 'coverage' (regex miss) |
| F06 | **CONFIRMED** → fixed | `stage7-plan.js:271,:306` | 2 product rows → second in neither plan, unresolved, nor warnings |
| F07 | **CONFIRMED** → fixed | `stage5-validate.js:97-99,:116`; no deref code | rowCounts init 0, never incremented; verbatim never compared to grid |
| F08 | **CONFIRMED** → fixed | `stage5-validate.js:134-155`; `stage7-plan.js:207` | validator refId-mismatch → reviewFlag only, entity auto-accepted |
| F09 | **ALREADY_FIXED** (warnings) / **PARTIAL_OPEN** (handling) | warnings `stage0-router.js:149-156`; caps `modelBuilder.ts:25-26` | 2280×29 visible CORE sheet still loses 280 rows past the cap (warned) |
| F10 | **CONFIRMED** → ledger P1 | `stage4-extract.js:32`; no stop_reason anywhere in `import-brain/` | maxTokens-truncated batch = parse-fail; truncation never detected as such |
| F11 | **CONFIRMED** → ledger | `stage7-plan.js:140-142,:186-187` | 'HO 3' vs 'HO-3' fail Pass-2 name join (punctuation not normalized) |
| F12 | **CONFIRMED** → ledger | `isoImport.ts:838,:882` | same number, editions '10 00' vs '05 11' → union-merged into one form |
| F13 | **CONFIRMED** → ledger | `stage-filing.js:291-297` | two 'manual' PDFs → `findIndex` extracts only the first, no warning |
| F14 | **CONFIRMED** → ledger | `stage-filing.js:341+` tool schema | document silent on requirement → model forced to invent MANDATORY/OPTIONAL |
| F15 | **CONFIRMED** → ledger | `unified-import.js:327,:344`; `stage-filing.js:432-433` | `HO-COV-001`/`FIL.NJ.PROD` carry no SYNTH marker vs real source ids |
| F16 | **CONFIRMED** → fixed | `constants.js:50` extractJson + per-stage parse fns | `{columns:null}` parses fine → silent null vote, no telemetry, no retry |
| F17 | **CONFIRMED** → ledger | `stage7-plan.js:449-454` (provenance-only remap) | GL.COV.001→GL.COV.999 remap: child's `parentId: GL.COV.001` never rewritten |
| F18 | **CONFIRMED** → ledger | `stage-filing.js:433`; `unified-import.js:353` | PP 00 01 (auto) filing → product minted with `lob:'PH'` (Personal Home) |
| F19 | **NOT_REPRODUCIBLE / ALREADY_FIXED** | `data.js:280,:354` | mutateBatch shares `envelope()` → version docs written per entity, atomically |
| F20 | **CHANGED** (3 of 4 sub-claims confirmed) → ledger | `import-eval.mts:220-224,:401-411,:362` | extras unpenalized + goldens circular + no linkage metrics; but forms ARE scored |
| PCM-A | **CONFIRMED** → ledger P1 | `isoImport.ts:541`; app `coverageAspects.ts:41-57` | import → `terms:[]` → UI Limits/Deductibles/Pricing = '–' |
| PCM-B | **CONFIRMED** → ledger P1 | `data.js:94`; `ProductContext.tsx:101,:115` | HistoryDrawer subscribes 'versions' via db.list → `kind='entity'` filter → [] forever |
| PCM-C | **ALREADY_FIXED** | `data.js:354` | import persist writes version zero (read side is the gap — PCM-B) |

Machine-readable, priority-scored: [`ledger.json`](ledger.json).

## P0 fixes shipped by IH1 (each locked by a fixture that fails at 2b1f893)

| Fix | Findings | What changed | Fixture |
|---|---|---|---|
| P0-1 | F01 | ONE multi-ref strategy: prompt says do-NOT-split; reconcile pairs by (row, occurrence); `expandMultiRefIds` is the single expansion point, post-consensus, with occurrence keys and the ORIGINAL cell text preserved as citation evidence | `hardening-p0-1-multirefid.test.ts` |
| P0-2 | F02, F03 | kind disagreement → reserved `__kind` conflict up the same ladder (write-back sets `entity.kind`); judge receives EVERY live candidate; any verdict letter resolvable; judge prompt un-hardcoded | `hardening-p0-2-ladder.test.ts` |
| P0-3 | F04 | header re-score runs against the authoritative `fp.cells` grid (absolute indices); legacy no-grid fingerprints can no longer confirm from synthetic samples (preamble-above-header fixture) | `hardening-p0-3-header.test.ts` |
| P0-4 | F05 | `refIdSegmentKind` added to the shared LOB registry (`lobRegistry.ts`, exported through `import-brain-shared.cjs`); `rowKind` routes through it (PR.PROD001 / CORE.PRD.001 cases locked) | `hardening-p0-4-rowkind.test.ts` |
| P0-5 | F06 | extra products / rating programs become **BLOCKING unresolved items with citations**; `multiple-products` / `multiple-rating-programs` warnings; conservation identity `proposed = accepted + unresolved` asserted in tests | `hardening-p0-5-conservation.test.ts` |
| P0-6 | F07, F08 | deterministic citation resolver (`resolveCitationsDeterministic`) against the normalized grid; strict fields byte-compared (containment allowed for multi-refId cells); severity policy — BLOCKING (invalid pointer, fabricated strict id, fabricated relation target) prevents auto-accept (stage-7 routes to unresolved with evidence); LLM validator demoted to semantics-only WARN; real source-row counts from `fp.dataRowCount`. **Adjunct:** fixed latent citation drift — `gatherRows` filtered blank interior rows so `i+headerRow+2` cell refs drifted below the first gap; `gridRows` now carries absolute grid indices through prompts, deterministic extraction, and the judge | `hardening-p0-6-citations.test.ts` |
| P0-7 | F16 | `parseWithRetry` (structured `malformed-model-output` telemetry + exactly one targeted retry; transport failures not double-retried) + `sanitizeEntities` shape guard; wired at stage1 classify/adjudicate, stage2 AI pick, stage3 both reasoners (NaN colIndex dropped+counted), stage4 votes/ladder/judge, stage5 validator. No zod added — repo has no runtime shape validator (`validateAgainstExpected` is a harness comparator), so minimal hand-rolled guards | `hardening-p0-7-schema.test.ts` |

**Pre-fix red proof (commands run this session):**

```
git stash push -- server/lib/import-brain/stage4-extract.js server/lib/import-brain/prompts.js
npx vitest run tests/import-brain/hardening-p0-1-multirefid.test.ts   # → 4/4 FAILED at 2b1f893
git stash pop

git stash push -- server/lib/import-brain server/lib/import-brain-shared.cjs \
  shared/src/insurance/lobRegistry.ts shared/src/import/brain-server-entry.ts \
  tests/import-brain/brain-routing.test.ts
npx vitest run tests/import-brain/hardening-p0-{2..7}*.test.ts        # → 25/26 FAILED at 2b1f893
git stash pop
```

(The single pre-fix pass is P0-5's benign no-regression case "a single-product plan
stays clean", which holds on both shas by design.)

Post-fix: `npx vitest run tests/import-brain/` → **9 files, 49/49 passing**.

**Commit granularity note:** the seven fixes interlock inside the same files
(stage4-extract.js carries P0-1/2/4 plus the gridRows and parse threads of P0-6/7),
so they ship as three consistent code commits — foundations (P0-4 parser + P0-7
helpers), stage-4 consensus (P0-1/2/4 wiring), and pipeline policy (P0-3/5/6) — each
naming its P0s. Every fix's fixture and pre-fix-red proof stands individually above.

## Corpus (Step 2)

- `samples/hardening/{workbooks,adversarial,pdf,mixed,manifest}` committed per the
  placement map — see [`PLACEMENT.md`](PLACEMENT.md). Checksums verified against the
  operator's `CHECKSUMS.md5`.
- Manifest ground truth: `samples/hardening/manifest/xlsx_ooxml_summary.json`
  (generated by `scripts/hardening-manifest.mjs`) — **28/29 workbooks parse, 218
  sheets, 29 hidden, 1 sheet exceeds the embed caps** (CORE `Rule References`,
  visible, 2280×29). The extensionless SECURA file is a ZIP container whose full
  ExcelJS parse throws — kept deliberately as a reader-robustness fixture.
- Offline enumeration pass: `node scripts/import-enumerate.mjs` drives every corpus
  file (plus the mixed-request combinations) through the REAL `unifiedImport`
  handler with a stubbed deterministic AI. **24/24 requests complete, 0 unhandled
  exceptions**, 1 handled error event (the corrupt container — correct behavior).
  Results: [`RESULTS/corpus-baseline.json`](RESULTS/corpus-baseline.json).
  Deliberately NOT in the golden pass/fail gate — IH2 gates it once the open
  conservation items land.

## Golden / canary status at ship time

- Offline golden parse-stability (`pnpm import:eval`, mapIsoWorkbook — untouched by
  IH1): expected stable; verified in the gate run recorded below.
- Live F1/numeric/citation targets were NOT re-run this session (95 min / ~$70 per
  CORE pass); IH1's changes leave the deterministic mapper untouched and the
  multi-refId expansion parity-by-design (expansion moved, not removed). **IH2's
  first live run is the confirmation gate for stage-4 prompt-contract parity.**
- Rating canaries PH $1,528 / PA $1,002 / GL $2,635: green in the gate run.

## HOSTILE SELF-REVIEW

**1. Which finding did you accept without reproducing, and why is that safe?**
F12 (form edition collision) and F13 (first-doc-per-role): I verified the code at
HEAD (isoImport.ts:838 key-by-number; stage-filing.js:291 findIndex) but did not
execute a colliding import. Safe because both went to the LEDGER, not to a fix — no
code was changed on their account, so a wrong reading costs IH2 a re-check, not a
regression. The same holds for every OPEN ledger entry. Everything I *changed* has
an executed fixture. PCM-A/PCM-B rest on a code-trace (fable-tier agent, writer
spot-checked isoImport.ts:541 and data.js:94) — no live import was persisted to
observe the dashes; the trace is three independent code facts that compose, and the
user's screenshot already witnessed the symptom.

**2. Can any model output still silently overwrite or drop an entity? Name the fixture that proves it cannot.**
The known overwrite (same-row collision) is dead — `hardening-p0-1-multirefid.test.ts`
proves same-row entities survive with occurrence keys. Silent drops still possible:
(a) **maxTokens-truncated batches** — after IH1 they produce telemetry + retry +
ladder + a `dropped-batch` review item, so they are *visible*, but the rows are
still not extracted (F10, OPEN, priority 1 — no fixture yet, that's IH2's first
job); (b) **rows past the 2000-row embed cap** never reach extraction (F09,
warned-not-fixed, manifest records the real 2280-row case); (c) **second document
per filing role** (F13, OPEN). I will not claim fixtures I don't have: F10/F09/F13
are the named survivors, ledgered with priorities.

**3. Do your new fixtures fail on the pre-fix commit? Show the command.**
Yes — commands + counts in "Pre-fix red proof" above: targeted `git stash push` of
exactly the IH1-modified files, `npx vitest run` on the seven fixture files at
2b1f893 → 4/4 and 25/26 failures, `git stash pop`, post-fix 49/49 green.

**4. What is the most dangerous item you did NOT fix, and what is its ledger cost?**
**PCM-A** (attachment integrity): every imported coverage persists with `terms: []`,
so Limits/Deductibles/Pricing render as dashes and the eval can't see it (F20).
It is the methodology's core violation (a coverage without limit/deductible/premium
is not a coverage) and it is user-visible today. Ledger cost **L** (BLOCKING,
priority 1): the fold ldTables→coverage.terms must be designed against the app's
canonical shape (seeded products), regenerate goldens, and re-verify live — deliberate
architecture work, exactly what Step 3 told me not to start.

**5. If IH2 read only ledger.json, would it act correctly?**
Yes for sequencing and scope: every entry carries status, priority (1–4 for open
items), file:line evidence at 2b1f893, a fixture pointer or an explicit "none yet —
IH2: <what to build>", and a lesson stating the fix direction. The summary block
gives the ordered open queue (PCM-A, PCM-B, F10 first). What ledger.json alone would
miss: the operational context (push=deploy waves, tenant rules, the live-eval
confirmation owed on stage-4 parity) — that lives here and in orchestration.md,
which the IH2 prompt already mandates reading. One trap flagged explicitly: F19 is
RESOLVED_PRIOR — IH2 must not "fix" the version write path; the gap is read-side
(PCM-B).
