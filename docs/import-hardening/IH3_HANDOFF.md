# IH3 HANDOFF — finish the import-hardening workstream

You are IH3, successor to IH2 in the IH workstream. IH2 ran the fixed harden-loop through
11 iterations; you finish the remaining items, the phase gates, and Phase G. **Read first,
in order:** this file; `ledger.json`; `OPERATING_NOTES.md`; `BASELINE.md`; `PLACEMENT.md`;
`orchestration.md` (repo root); `product_first_principles.md`; the generalization amendment
recorded in `OPERATING_NOTES.md` + the ledger `$schema` line (BINDING — two-fixture rule,
judge question 6, anti-overfit prohibitions, Phase G, final status vocabulary).

## Exact state at handoff (2026-07-15)

- **origin/main = `7d78d90`** (pipeline run 2478 ✅, deployed). Local: **`75f7517` (F13)
  unpushed** — it rides wave 3.
- **Dispositioned FIXED_IH2** (each judge-ACCEPTed, red-before-fix, two-fixture-locked):
  F11 (join punctuation), PCM-B (versions read path), F20 (eval fabrication/linkage/
  conservation/citation-resolution gates), PCM-A (terms fold; 1 reject: phantom terms),
  F17 (remap edge rewrite), F10 (stop_reason + batch halving + cell-budget), F12 (form
  (number, edition) identity + snapshot rides), F09 (embed-cap continuation; 1 reject:
  stacked-tables honesty), F14 (UNKNOWN schema end-to-end; 1 reject: egress honesty ×3),
  F18 (lob threading; 1 reject: F22 ledgering), F13 (role partition; 1 reject: contract
  shape + fingerprint scalars). F19/PCM-C stay disproven — never touch the version WRITE path.
- **OPEN:** `F15` (SYNTH ids — next, design below), `F22` (targetForm threading + conserve
  filtered rate-order variables, HIGH), `F23` (persist finished bundles / retry economics,
  HIGH), `F21` (clone/scaffold edition minting, MED), `F24?` — attempt-1's unexplained
  32-min stage-4 silence (watch for recurrence; only 1 occurrence, NOT ledgered).
- **Ledger `summary` block is a stale IH1 snapshot** — recompute at close (`/harden-converge`).
- **Phase W:** offline full run **green** (`RESULTS/phasew-offline-run.md`). The live CORE
  gate run is **IN FLIGHT** on the wave-2 deploy → `RESULTS/wave2-core-live.log`
  (150-min budget, tenant accenture-test). A background watcher greps for `Results →|✗ CORE`.
  **NO PUSHES until it finishes.** If it passed: Phase W gate = assembled (record both runs +
  metrics JSON into RESULTS and declare the gate in the ledger/orchestration row). If it
  failed: diagnose from the log + `docs/audit/import_eval_results-CORE.json`, fix, re-run
  (a CORE run ≈ 110–130 min, ≈ $70 — never retry blindly, see F23 and
  `RESULTS/wave1-live-attempts.md`).
- **Spend context:** ~$150–190 was burned on wave-1's failed CORE attempts (recorded
  honestly). IMPORT_CONTEXT is no-cap; telemetry always intact.

## The loop (unchanged — repeat until STOP)

ORIENT (ledger, severity×confidence/cost) → REPRODUCE (red BEFORE edit; NOT_REPRODUCIBLE
with disproof otherwise) → FIX (minimal, right layer; never weaken checks; golden/snapshot
changes ride separate explained commits) → JUDGE (fresh hostile subagent; context = diff +
invariants + acceptance line + SIX standing questions — Q6: "Does this diff encode knowledge
of the fixture, or knowledge of the document structure and insurance meaning?"; give judges
a CORPUS-PROBE mandate — every real defect IH2's judges caught came from probing real
workbooks; REJECT → revise; 2 rejects → ESCALATE) → GATE (typecheck/lint/test/build +
canaries + `pnpm import:eval`; corpus enumeration when stage0-7 changed — diff
`RESULTS/corpus-baseline.json`, restore if only timing churn) → COMMIT (stowaway-check +
`git commit --only -- <files>`; message `IH2/IH3 <id>: <title>`) → LEDGER (evidence, fixture
id, lesson; every closed class ships a permanent fixture) → WAVE every 3-5 closed items
(gate → push → pipeline watch → detached live slice; no pushes mid-live-run) → SELF-TUNE
every 5 iterations (OPERATING_NOTES ≤40 lines).

## Next work, in order

1. **F15 — SYNTH id markers** (S). Design (from the wave-3 archaeology; full report:
   `.claude … tasks/w2ivxunjo.output`, key facts also in the ledger entry): every
   filing-path minted id gets the SYNTH marker + registry prefix + KIND TOKEN IN SEGMENT 2
   (so `refIdSegmentKind` parses it), keeping the global-uniqueness token as a LATER segment:
   reconcile.ts — product `${prefix}.PROD.SYNTH.${token}`, RT `${prefix}.RT.SYNTH.${token}.${concept}`,
   rating `${prefix}.RAT.SYNTH.${token}.1`, LD `${prefix}.LD.SYNTH.${token}.DEDUCTIBLE`,
   coverages `${prefix}.COV.SYNTH${pad3}`, rules `${prefix}.RU.SYNTH${pad3}` (prefix is the
   F18 lobDef prefix, already in scope). unified-import fallback `HO-COV-###` →
   `${fbPrefix}.COV.SYNTH###`; `FIL.${state}.PROD` → `${fbPrefix}.PROD.SYNTH.FIL${state}`
   (both mint sites + stage-filing catch fallback). docIds keep flowing through dashId —
   zero persist changes; steps reference built.refId so rating stays internally consistent.
   Red fixture: assert every minted refId in the reconciled njLemonade golden matches
   /\.SYNTH/ AND `refIdSegmentKind()` returns the right kind; check reconcile.test.ts golden
   assertions for pinned FIL.* regexes (update = explained golden-change commit). Rebuild
   `build:filing`. Grep scripts/import-live.mts for FIL.* expectations.
2. **Corpus growth:** add `filing-two-manuals` to `samples/hardening/mixed/mixed_requests.json`
   pairing `NJ_HO_Manual_02_27_24.pdf` + `PersonalAuto_WA_Rate_Washington_Auto_Rate_Manual_Version_2_11.pdf`
   (the F13 two-manuals live probe; files already in samples/hardening/pdf).
3. **WAVE 3** (after the live CORE run finishes): full gate → push F13+F15+corpus+docs →
   pipeline watch → then the **Phase P live slice** on that deploy: `IMPORT_LIVE_ONLY=pdf`
   (`pnpm import:live`, detached .cmd pattern) + a two-manuals probe + the PP_00_01 anti-PH
   probe (must come out with the PA hint honored + UNKNOWN requirement/premium — F14/F18
   live confirmation). Phase P gate checklist is in the original mission (roles incl.
   two-manuals + multi-role; 100% cited rate-order/manual extractions; UNKNOWN not guessed;
   conservation).
4. **Phase M:** corpus `samples/hardening/mixed/` — mixed workbook+PDF requests. Gate:
   cross-artifact merges accounted in conservation; no double-created entities; review UI
   surfaces per-artifact completeness before persist. Expect to need a small fixture around
   `mixed-upload` handling in unified-import (today PDFs are skipped with a warning when
   workbooks present — decide whether that plus completeness data satisfies the gate or a
   real merge slice is demanded by a red fixture; do NOT build the merge without one).
5. **F22 + F23** (both HIGH, OPEN): F22 = thread targetForm from base form/line + make
   filtered rate-order variables CONSERVED; F23 = persist the finished bundle server-side
   keyed by request id (small slice of checkpoint/resume — the ARCH_ESCALATION trigger is
   already written: two burned $70 runs) + eval retry policy env. F21 (MED) if budget allows.
6. **Phase G** — execute the amendment VERBATIM (G0 baseline → G1 read-only assumption audit
   → G2 frozen holdout suite committed as `IH GENERALIZATION TEST FREEZE: holdout corpus`
   (record HOLDOUT_SHA) → G3 no-edit pre-fix.json → G4 failure-clusters.json → G5 cluster
   fixes through the loop → blind challenge with fresh agents/seeds → final-metrics.json +
   final-report.md). Known G1 seeds already recorded in ledger entries: isoImport
   mapRequirement blank→MANDATORY; stage7 BOOLEANISH ''→false; coverageHierarchy's own
   case/whitespace-only nameKey; scaffold-product's old forced enum; deep-clone number-only
   minting (F21). Final status is exactly one of PROVEN / PARTIALLY_PROVEN / NOT_PROVEN /
   PARKED — never stronger than the evidence (fewer than 3 genuinely unseen artifacts ⇒
   at most PARTIALLY_PROVEN).
7. **Close-out:** ledger fully dispositioned + summary recomputed; OPERATING_NOTES current;
   `RESULTS/loop-summary.md` with the 5 hostile self-review questions (and the amendment's
   5 incorporation points); orchestration.md IH row + push/deploy log updated with your
   final sha; every accenture-test draft torn down (drafts named `draft-*` created by the
   live runs — list via POST /api/db/list as bootstrap admin, delete via mutate);
   `git status` clean; memory file `project-import-hardening-ih2.md` updated to "done".

## Operational gotchas IH2 learned (beyond OPERATING_NOTES)

- **vi.mock does NOT intercept stage-filing's lazy CJS `require` of filing-shared.cjs** —
  filing tests exercise the REAL bundle; rebuild it or your test tests stale code.
- **Node buffers stdout to files**: a detached run's log lags ~64KB; absence of recent
  lines ≠ stall. Judge stalls by App Service logs (`az webapp log tail`), not the local log.
- **Bundle rebuild matrix:** shared/src/insurance/* or shared/src/import/* → `build:import-brain`;
  shared/src/insurance/filing/* → `build:filing` (BOTH when a file feeds both). Commit bundles.
- **.cmd files**: regenerate with `Set-Content -Encoding Ascii` before every detached run
  (checkout normalizes to LF → silent no-op). Start-Process cmd /c, log to RESULTS/.
- **Monitors cap at 60 min** — long waits need re-arming or a background until-loop.
- **docs/audit/import_eval_results*.json + fidelity artifacts churn on every local run** —
  commit only at wave tips with the diff explained; otherwise `git checkout --`.
- **Judges**: run them synchronous (`run_in_background: false`); resume the SAME judge via
  SendMessage for re-verdicts after a REJECT; their transcripts are the review record.
- Stale pre-IH1 dumps (`import_eval_extracted-IM/PR.json`) legitimately FAIL `--rescore`
  extras gates — replace with fresh live dumps at a wave boundary, then rescore green.
- The archaeology reports for F13/F14/F15/F18 (full shapes + line numbers) live in the IH2
  session task outputs; everything essential was copied into ledger entries — trust the
  ledger + re-verify lines at HEAD.

## Non-negotiables (unchanged)

Gate before every push; canaries green; stowaway-check + `--only` always; live tests only
in accenture-test (never testco, never the user's Core product); IMPORT_CONTEXT no-cap with
telemetry intact; grounding invariants (cited fields, byte-for-byte refIds, flagged-not-
dropped, blank templates → empty plans); prefer honest UNKNOWN/unresolved over any guessed
value; every closed bug class ships a permanent fixture; the corpus only grows.
