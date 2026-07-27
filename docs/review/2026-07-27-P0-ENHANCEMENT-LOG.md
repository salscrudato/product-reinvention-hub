# P0 enhancement log — import brain

- Date: 2026-07-27 · Branch `main` · Baseline HEAD `3e4773b`
- Section 9 requires one row per change: what changed, which defect it addresses, the
  file:line evidence consulted, the gate result **with measured numbers**, and why it was the
  cheapest correct fix. Appended as work proceeds.
- **Every number below was measured by running the named command. Nothing here is projected.**

---

## 0. Baseline (step zero, run once, unchanged)

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` at `3e4773b`:

| step | result |
|---|---|
| typecheck | **PASS** (shared + app) |
| lint | **PASS** — 10 warnings, all pre-existing (3× `no-useless-escape` in `conserve.ts`, 2× `no-unsafe-optional-chaining` in `isoImport.test.ts`, 5× `only-export-components`/`exhaustive-deps` in app) |
| test | **PASS** — 196 files, **2148 passed**, 1 file / 4 tests skipped |
| build | **PASS** |
| `pnpm import:eval` | **4/4 green** — GL/IM/PR/CORE all F1 1.0000, numeric 1.0000, extras 0 |
| `phaseg-holdout --check` | **7/7 green** |
| `import-eval2 --offline` | **8/8 RED** — the documented baseline, not a regression (see §1) |

Baseline is clean. The eval2 board is red at its documented level; §1 explains why that is the
starting condition rather than a blocker.

---

## 1. Prior-state audit — what was already landed, verified in code

The task lists D1–D10. Before writing anything I checked each **in the source**, not in commit
messages or review prose. Most of P0 was already in the tree. Recording it so the next reader does
not re-do it, and so the two items that were genuinely open are visible.

| defect | state | evidence (file:line, read at HEAD) |
|---|---|---|
| **D1** eval2 re-baseline | **landed** | board at HEAD committed; verdict doc `docs/review/2026-07-26-NUMERIC-FIDELITY-VERDICT.md` carries 11 cell-evidenced claims (§3.2 asked ~10); `import-promote-e2e.mts:250-280` has `COV_TERM_FLOOR` + `STEP_COVREF_FLOOR` as **gated** floors and the card-figures section (`:284-320`); `ldTableRefResolutionRate ≥ 0.95` blocks at `import-eval2.mts:217` and appears in the committed board's `thresholds` |
| **D2** step→coverage links | **landed** | `isoImport.ts:1666` attaches `coverageRef` from `splitList(at(cells,'ids'))`; forward-fill under the `GLOBAL_STEP` guard at `:1631,1646`; segment-flexible resolution at `:2251-2263` with `step_coverage_ref_dangling` defects; `coverageRef` is in `ISO_ORACLE_FIELDS` (`stage7-plan.js:264`) and the oracle-ownership test exists (`hardening-placeholder-and-steps.test.ts` "D9 the mapper is the ORACLE…") |
| **D3** stacked sheets | **landed** | plural marker grammar `RULE_ID_MARKER_PATTERN` (`layoutDetector.ts:55`) + `canonicalMetaKey` (`:60`); sheet-level lock published at `stage2-header-lock.js:100-107`; re-segmentation against the uncapped grid at `stage0-router.js:463-492`; `cellsStartRow` per sub-table at `stackedSegmenter.ts:206`; the stage-5 BLOCKING→WARN downgrade is **deleted**, with the reason recorded at `stage5-validate.js:103-109` |
| **D4** starved legs | **landed** | `PREFILTER_MAX_TOKENS = 1024`, `CLASSIFY_MAX_TOKENS = 2048` (`stage1-classify.js:32-33`), `JUDGE_MAX_TOKENS = 2048` (`stage4-extract.js:92`); `REFUSAL_STOP_REASONS` as an explicit vote class (`constants.js:75`); per-family participation counters via `recordVote` (`constants.js:82-90`) surfaced on `brain:spend` |
| **D5** blind validator | **landed** | `stage5-validate.js` resolves citations against `fpByName` and ships ACTUAL cell content; `cited-vs-actual-mismatch` is in the discrepancy kinds (`:32`) and in the prompt (`prompts.js:192`) |
| **D6** unread columns | **landed (prior session)** | `stage4-extract.js` sub-threshold recovery + `unread-column` review item + `brain:columns` coverage ledger |
| **D7** cache poisoning | **landed** | `extract-cache.js`: `isCleanStop` gating (`:133`), `{raw, stopReason}` persisted (`:113-124`), `bypassCache` on the retry (`:151-163`), `PROMPT_VERSION = 'stage4/v2'` (`:43`), `contentHash` in the key (`:70-78`) |
| **D8** first-char verdicts | **landed** | forced tools with enum-constrained fields at `stage1-classify.js:46-73`; judge forced tool per `prompts.js:284`; membership validation in the parse helpers (`:117-138`) |
| **D9** consensus arithmetic | **blocked, correctly** | the task itself blocks D9 on D4 participation ≥ 0.95 measured on a full large-book run. That is a **live** run; not measured this session, so D9 is untouched. |
| **D10** silent drops / noise / durability | **landed (prior session)** | prefilter breadcrumb + sweep scope, `map-unverified`, column-citation join, verified FACT posting, digest↔classify crosswalk, sentinel + bracketed match, content-hash resume guard, drain guard, nomination persist boundary |

**Genuinely open after this audit:** the two pipeline defects the verdict document itself named as
actionable (§4 of that doc) — the edition-date loss and the duplicate form representation — plus
several Section 5 model items. §2 below takes the first.

---

## 2. Change rows

### Row 1 — the EDITION DATE column that was mapped and then read by nobody

| field | content |
|---|---|
| **What changed** | `shared/src/import/mapper/conserve.ts`: added `editionColumnOf()` (locates a grid's edition column using the alias vocabulary isoImport already declares) and taught the form-token harvest to attach `edition` + `editionCitation` from the **same row** the form token was found on, byte-for-byte, plus a `conserve:form-edition` consumed span so the sweeper does not re-read a cell the harvest just consumed. `shared/src/insurance/isoImport.ts`: named flag `IMPORT_FORM_EDITION_HARVEST` (default on, `=0` restores the old path) threaded into `runConservationPass`. New lock: `tests/import-brain/hardening-form-edition-harvest.test.ts` (10 tests). |
| **Defect** | D1 §3.2 follow-through — the verdict document's §4 item 1: *"the one unambiguous, immediately actionable pipeline defect in this population"*. Also the deterministic-mapper twin of D6 (mapped-but-never-read), which D6's stage-4 fix cannot reach. |
| **Evidence consulted** | `isoImport.ts:604` — `FW_FIELDS.edition = ['EDITION DATE','EFFECTIVE DATE','FORM EDITION']` is **declared**, so `mapColumns` claims the column and it never appears in `unmapped`. `grep "'edition'"` over all 2,730 lines returns **exactly one** consumer, `isoImport.ts:984`, inside `parseForms`, which reads `FORM_FIELDS` off the *Forms Specifications* sheet — a different sheet and a different field map. `finalizeCoverages` (`:655-680`) reads `forms: splitList(at(cells,'forms'))` and no edition. `conserve.ts:302` minted the form with `{ formNumber: tok }` only. `canonicalMap.ts:267` — form identity is (number, edition). Verdict doc §3.1: `GL Product Framework!I` populated on **110 of 110** data rows. |
| **Gate result (measured)** | `pnpm import:eval` **flag off and flag on are identical**: GL/IM/PR/CORE all F1 1.0000, numeric 1.0000, **extras 0** — the goldens do not move, because full ISO template exports are structurally ineligible for the conservation pass (`conservationEligible`). `phaseg-holdout --check` **7/7**. All four canaries **exact** (30 tests, 4 files). `pnpm test` **2158 passed** (was 2148; +10 new). typecheck/lint/build **PASS**. eval2 `--offline`, flag off → on, per file: `…General_Liability_2026_Example` **0.000 → 0.394**; `…General_Liability` **0.000 → 0.127**; `…SECURA_Property` **0.000 → 0.069**; other five unchanged at 0.000. **Zero files regressed**; red count unchanged 8/8 (they fail on other thresholds). |
| **Why this is the cheapest correct fix** | The verdict document proved `MATCH-by-refId` was **0** across the entire 1218-claim corpus — *"not one claim resolves by refId and finds its value"*. This is the first change to produce a non-zero refId-keyed numeric fidelity on that board. It reads a value the source states in a cell adjacent to one already being read, needs no new model call, no new prompt and no new stage, and cannot touch identity: the edition is attached as a **field**, never folded into a refId (locked by test). Risk is bounded by construction — only `form-token`-mechanism entities are affected, they are already `needsReview: true`, and the goldens measured identical. |

**What this row does NOT fix, stated plainly.** The largest remaining miss population on
`Product_Framework_All_Lines_Master` (146 claims, still 0.000) is the same edition column bound by
the golden to **coverage** refIds (`PR.COV001.*`), not form refIds. Attaching an `edition` to a
coverage is dubious modelling — a coverage has no edition, the form does — and the verdict document
already flagged the golden's own inconsistency here (§3.1 note: the same column is bound to a form
on row 6 and to a coverage on row 7). Chasing that half would be optimizing against a known-bad
annotation. It is left open deliberately, not overlooked.

---

## 3. Findings that CONTRADICT the task prompt — recorded, not acted on

Section 2 says work from code, never from prose, *including the prompt*. Two instructions are
refuted by code and were deliberately **not** executed:

1. **"Stop keying on the rate table marker, which occurs zero times in either real workbook."**
   True for the two Hagerty books, false for the corpus as a whole. `layoutDetector.ts:30-37`
   carries counted evidence: `samples/iso/sample-GL-pricing.xlsx` emits `RATE TABLE ID:` **×7** and
   `RTTable.N` **×7**; `sample-GL-rules.xlsx` emits `LDTable.N` **×37**. Removing the primary
   markers would break the ISO golden path that pins the GL canary. The plural `RULE ID(s):`
   grammar the instruction also asks for is already present (`:55`). **No change made.**

2. **"Delete the dead escalation helper, its unused event…"** `escalateAnthropic` (`ai-call.js:247`)
   indeed has no caller, but `brain:escalation` is fully plumbed — producer
   `unified-import.js:373`, consumer `AgentVisualizer.tsx`, with green tests. Deleting the event
   turns tests red, which Section 2 bars. The correct fix is to *call* the hook at the inline ladder
   sites, not to delete it. **Not deleted; left for a change that adopts it.** (Open item.)

---

## 4. Verification requested mid-task: no hardcoded GL line of business

The refId prefix is **derived per product**, never hardcoded. Verified:

- `isoImport.ts:2445` — `const refPrefix = refIdPrefix(productRefId ?? firstFw?.coverages[0]?.refId ?? '') || lob.prefix`. The workbook's **own** product/coverage refId wins; the registry LOB prefix is only a fallback. A CORE book yields `CORE`, an E+ book yields `EPLS`.
- `conserve.ts:225` — `/^[A-Za-z]{2,6}$/.test(input.refPrefix) ? input.refPrefix.toUpperCase() : 'WB'`. The last-resort fallback is `WB`, not `GL`.
- `lobRegistry.ts:605` — `synthesizeRefId` delegates to `lob.refIdScheme.synthesize`, i.e. per-LOB from the registry.
- `stage4-extract.js` — SYNTH minting derives `sourcePrefix` from the first real refId any sheet extracted, with `XX` as the honest last resort.

A repo-wide sweep for `'GL'` literals in `shared/src` and `server/` returns only: the LOB registry's
own GL entry (one of PH/PA/GL/IM/PR), JSDoc/`examples:` strings in `canonicalMap.ts` (prompt
material that deliberately shows several prefixes), the separate **claims** module's
`ClaimsLineCode`, test fixtures, and the holdout harness's `--seed GL` default. **No hardcoded LOB
on the import path.**

---

## 5. Open items (measured state, not projections)

- **D9** — blocked on D4 participation ≥ 0.95 measured on a **live** large-book run. Not measured this session.
- **Duplicate form representation** — verdict doc §3.3 item 10, 99 claims (8.1%): the same form emitted twice, a token stub keyed by the real number and a region-blob record keyed by a synthetic id that holds the data. Diagnosed, not fixed.
- **Section 5 model items** not yet done: `output_config.effort:"high"` on the opus deep-reasoning calls (**requires a live re-probe first — none run this session**), digest synthesis off the premium tier, third-family adjudication, ladder cap → 8192, the sub-4096 cached-prefix no-op check, filing ladder start tier, OCR wiring, fallback extractor budget visibility, `MISSING_DEPLOYMENTS` TTL, orphaned `proposeMapping` deletion.
- **No model parameter was changed in this session, so no live probe was required or performed.**
