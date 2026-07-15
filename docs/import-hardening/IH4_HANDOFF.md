# IH4 HANDOFF — land wave 3, run the final gates, prove generalization, close the workstream

You are IH4, successor to IH3 in the import-hardening (IH) workstream. IH1 fixed F01–F08/F16
(+7 P0s), IH2 closed 11 items across two deployed waves, IH3 closed the final six numbered
items (F15, F21, F22, F23, F25, F26) and staged them on an UNPUSHED, FULLY-GATED wave 3.
Your job: push wave 3, run the tiered live gates, execute Phases W/P/M/G, and close out.

**Read first, in order:** this file; `ledger.json` (every entry's evidence names the fix, the
judge verdict, and the validation tier); `OPERATING_NOTES.md` (BINDING amendment + tiered
validation directive); `BASELINE.md`; `PLACEMENT.md`; `RESULTS/wave1-live-attempts.md` (the
live-run failure history — read before spending a dollar); `orchestration.md` (repo root);
`product_first_principles.md`; `CLAUDE.md`.

## Exact state at handoff (2026-07-15, ~02:30 EDT)

- **origin/main = `7d78d90`** (deployed, pipeline run 2478 green). **Local main is 13 commits
  ahead and UNPUSHED** — the wave-3 stack, in order: `75f7517` (IH2 F13), `b8d4f07` (IH2
  handoff docs), `35e02b2` (F15 SYNTH ids), `96f3c11` (corpus: filing-two-manuals),
  `0abcf36` (F22 targetForm), `6ee4b2f` (F21 clone editions), `e92afff` (F25 rule SYNTH),
  `f62ed83` (golden: CORE rule rename, lockstep), `cdc99ed` (F23 durable bundles),
  `02a356a` (F26 product SYNTH), `5e61e19` (golden: IM/PR product rename, lockstep),
  `086ef06` (wave-3 evidence + self-tune), plus this handoff commit.
- **The full gate is GREEN on `086ef06`**: `node tools/verify-commit.mjs` ✅, typecheck ✅,
  lint 0 errors, all workspace tests green (shared 604, root 268, app 397+, functions 186),
  build ✅, offline `pnpm import:eval` F1 1.0000 / extras 0 / linkage 1.000 on ALL FOUR
  formats. The handoff commit is docs-only, but re-run the gate on YOUR tip before pushing
  (standing rule: gate the exact sha you push).
- **Ledger: every numbered finding is dispositioned.** F15/F21/F22/F23/F25/F26 = FIXED_IH3
  (each judge-ACCEPTed, red-before-fix, two-fixture-locked). The `summary` block is a stale
  IH1 snapshot — recompute at close-out. Two unnumbered watch items: "F24?" (one unexplained
  32-min stage-4 silence in wave-1 attempt 1 — never recurred, never ledgered; watch) and
  checkpoint/resume (ARCH_ESCALATION, recorded inside F23's evidence — a mid-computation
  App Service restart still kills a run; bundle persistence deliberately does NOT cover it).
- **Wave-2 live CORE attempt FAILED** (~$60): stream died at ~97 min, row ~1310/1455;
  the app provably did NOT restart (platform logs pulled; health 200 after) — transport-level.
  Full forensics in `RESULTS/wave1-live-attempts.md` (wave-2 section) + `wave2-core-live.log`
  + the failure record committed in `docs/audit/import_eval_results-CORE.json`. Do NOT
  overwrite that failure record except with a real new run's results.
- **Spend context:** ~$210–250 total burned on failed CORE attempts across waves 1–2.
  IMPORT_CONTEXT stays no-cap with telemetry intact. This is why the tiered directive exists.
- Untracked operator files (`hardening-corpus*`, `docs/design-review/`) are another lane —
  never touch, never commit.

## What IH3 shipped (know these — they change how you run live tests)

1. **F23 durable run results** (`server/lib/ai/run-results.js`, `scripts/lib/run-recovery.mts`):
   pass `runId` in the unifiedImport body → the server persists the finished bundle to Blob
   (`import-results/<tenant>/<runId>.json`) at completion — EVEN WITH A DEAD SOCKET (emit()
   is hardened; runs complete headless). `POST /api/ai/unifiedImportResult {runId}` fetches it
   (product:write, JWT tenant, works while AI/budget-gated). The eval/live scripts do all of
   this automatically now: run id minted per import, stream loss → poll the result endpoint
   (404 = still computing, keep waiting; network error = app restarting, keep polling),
   full re-runs OPT-IN via `IMPORT_EVAL_MAX_ATTEMPTS` (default 1 — a retry is a $70 bill),
   default stream timeout 150 min. NOT covered: a restart that kills the computation itself.
   Requires `AZURE_BLOB_CONNECTION` on the App Service (already configured — storage.js uses it).
2. **SYNTH convention is now total**: every minted id on every path carries the marker —
   filing (F15: `<prefix>.PROD.SYNTH.<token>`, `<prefix>.COV.SYNTH###`, RT/RAT/LD variants),
   workbook rule synthesis (F25: `<fwBase>.RULE.SYNTH###`), workbook product synthesis
   (F26: `<prefix>.PROD.SYNTH001`). Goldens were renamed in LOCKSTEP (CORE 468 rule ids;
   IM/PR product ids) and the offline gate proves F1 1.0000. **Cross-era caution:** a
   `--rescore` of PRE-wave-3 extraction dumps against these goldens false-misses (CORE ~468
   rules; IM/PR 1 product each) — pair dump and golden from the same era; fresh live dumps
   self-heal this.
3. **F22**: reconcileFiling's target form is the filing's OWN base form (form-code bridge:
   first NON-ZERO digit run — "HO3" ≡ "LEM 03" ≡ "LEM 03 05 23"); form-filtered rate-order
   variables are CONSERVED (cited unresolved items inside the ledger); min-premium/credit-cap
   rules are ledger citizens too (a pre-existing conservation hole, fixed).
4. **Known, deliberately-uncommitted golden drift**: regenerating GL/IM goldens adds
   `valueHeader`/`ldTableRefText` fields the HEAD parser emits but the goldens predate (IH2-era).
   Committing them TIGHTENS live scoring — that's a deliberate wave-boundary decision left
   to you; don't let `--write-golden` smuggle it in with something else.

## BINDING directives (unchanged + the IH3 additions)

- Charter verbatim: gate before every push (typecheck && lint && test && build + canaries
  PH $1,528 / PA $1,002 / GL $2,635 / filing $1,281); push = deploy (~7 min) and severs SSE —
  never push mid-live-run; stowaway-check + `git commit --only -m "…" -- <files>` (flags
  BEFORE the `--`); live tests only in accenture-test, tear down `draft-*` you create, never
  testco; IMPORT_CONTEXT no-cap with telemetry NEVER bypassed; grounding invariants (cited
  fields, byte-for-byte refIds, flagged-not-dropped, blank templates → empty plans); never
  weaken a check/threshold/golden — golden changes ride separate explained commits, lockstep
  with the parse.
- Generalization amendment (OPERATING_NOTES + ledger $schema): two-fixture rule, judge Q6,
  anti-overfit prohibitions, honest UNKNOWN over guesses, Phase G verbatim, final status
  exactly one of PROVEN / PARTIALLY_PROVEN / NOT_PROVEN / PARKED.
- **Tiered validation (2026-07-15 directive)**: Tier 0 offline eval/rescore for all scoring
  work; Tier 1 `IMPORT_EVAL_ONLY=GL` (or IM/PR) `--live` as the live smoke; Tier 2 full CORE
  `--live` ONCE, as the FINAL Phase W gate, detached, F23 armed, `IMPORT_EVAL_MAX_ATTEMPTS=1`.
  Overlap Tier-2 wall-clock with push-free offline work; watch via `az webapp log tail`
  (full path: `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`); only the PUSH is
  barred mid-run. Log the tier in every ledger evidence line.
- The loop for any NEW defect you find: reproduce red → minimal fix at the right layer →
  fresh-context hostile judge (six standing questions + corpus-probe + mint-site/consumer
  sweep mandate; REJECT → revise; 2 rejects → ESCALATE) → offline gate → pathspec commit →
  ledger with evidence/fixture/lesson/tier. IH2's judges rejected 5× and were right every
  time; IH3's judges found F25 and F26 as side-findings — give them the sweep explicitly.

## Your plan, in order

1. **Push wave 3.** Re-run the full gate on your exact tip → `git push` → watch the ADO
   pipeline (az CLI at the full path above; `az pipelines runs list` needs the devops
   extension dir prepended — see memory/az-cli-tooling) → confirm deploy → `/api/health` 200.
   Nothing is in flight; the deploy restart is safe.
2. **Tier-1 live smoke** on the new deploy: `IMPORT_EVAL_ONLY=GL pnpm import:eval --live`
   (tenant accenture-test creds via `/api/auth/bootstrap`, admin/admin — see scripts). This
   validates the deploy, the golden lockstep live, AND the F23 run-id/persist/recovery path
   (look for `run:persisted` in the log and fetch the result endpoint once yourself).
   GL should score ≥ its previous live baseline (F1 ~0.97 golden-matched; the offline gate
   said 1.0000 deterministic). If GL fails on MERIT, stop and run the defect loop.
3. **Tier-2: the ONE full CORE live run** (final Phase W gate). Detached `.cmd` regenerated
   with `Set-Content -Encoding Ascii` (checkout normalizes to LF = silent no-op), tee to
   `RESULTS/wave3-core-live.log`, `IMPORT_EVAL_TIMEOUT_MS` default already 150 min,
   `IMPORT_EVAL_MAX_ATTEMPTS` leave at default 1. The script mints the run id itself and
   polls the durable result on stream loss — if the stream drops and the bundle is
   recovered, THAT IS THE FIX WORKING; score on merit. If it fails for a reason persistence
   does not cover (e.g. mid-computation restart), STOP, record evidence in the attempts
   history, and report — do not re-run without diagnosis.
   **While it cooks (~110 min), do the push-free overlap work:**
   - **Phase M analysis**: mixed workbook+PDF gate. Today unified-import.js warns
     `mixed-upload` and skips PDFs when workbooks are present; corpus request
     `mixed-workbook-plus-pdf` exercises it offline. Decide with evidence whether
     warning + per-artifact completeness satisfies "cross-artifact merges accounted in
     conservation; no double-created entities; review UI surfaces per-artifact completeness"
     — or whether a red fixture demands a real merge slice. Do NOT build the merge without
     a red fixture demanding it.
   - **Phase G G1** (read-only assumption audit): seeds already enumerated — isoImport
     mapRequirement blank→MANDATORY; stage7 BOOLEANISH ''→false; coverageHierarchy's own
     case/whitespace-only nameKey; scaffold-product's old forced enum; F21's deep-clone
     minting (fixed — verify); F26's product synthesis (fixed — verify); emit() swallowing
     stringify errors (F23 judge note); no-TTL on import-results blobs; browser client not
     minting runIds. Draft `RESULTS/phaseg/pre-fix.json` + failure-cluster map. G-prefixed
     ledger ids for anything real.
4. **Phase W gate assembly**: offline run green (`RESULTS/phasew-offline-run.md`, IH2) +
   the wave-3 live CORE run green → record both + metrics JSON in RESULTS, declare the gate
   in the ledger and the orchestration.md IH row. Update the attempts history with the
   wave-3 attempt (pass or fail).
5. **Phase P live slice** (after CORE lands; don't run concurrent imports — the shared
   instance is the suspected wedge factor): `IMPORT_LIVE_ONLY=pdf pnpm import:live` detached,
   + the two-manuals probe (corpus `filing-two-manuals`: NJ HO manual + WA PA auto manual —
   F13 partition live) + the PP_00_01 anti-PH probe (must come out PA-hinted with UNKNOWN
   requirement/premium — F14/F18/F22 live confirmation: the PA filing's rating program
   should now POPULATE where the manual resolves it). Gate checklist: roles incl. two-manuals
   + multi-role; 100% cited rate-order/manual extractions; UNKNOWN not guessed; conservation.
6. **Phase M gate** per your step-3 analysis.
7. **Phase G verbatim**: G0 baseline → G2 frozen holdout committed as
   `IH GENERALIZATION TEST FREEZE: holdout corpus` (record HOLDOUT_SHA) → G3 no-edit
   baseline → G4 clusters → G5 fixes through the loop → blind challenge with fresh
   agents/seeds → final-metrics.json + final-report.md. Fewer than 3 genuinely unseen
   artifacts ⇒ at most PARTIALLY_PROVEN. Never claim stronger than the evidence.
8. **Close-out**: ledger fully dispositioned + `summary` recomputed (`/harden-converge`);
   `RESULTS/loop-summary.md` with the 5 hostile self-review questions + the amendment's 5
   incorporation points; orchestration.md IH row + push/deploy log with your final sha;
   tear down every accenture-test draft the live runs created (`draft-*` — list via
   POST /api/db/list as bootstrap admin, delete via mutate); `git status` clean;
   update the memory file `project-import-hardening-ih2.md` → workstream done.

## Operational gotchas (hard-won — do not relearn these)

- Monitors/watchers die with the session; a background watcher from a previous session is
  NOT running. Arm your own (persistent Monitor on the log, filter for
  `Results →|✗ CORE|✓ CORE` + stall heuristic) or poll `az webapp log tail`.
- Node file-buffers detached stdout ~64KB — absence of recent log lines ≠ stall.
- `git commit --only` requires `-m` BEFORE the `--` pathspec, and NEW files need `git add`
  first (--only alone errors on untracked paths).
- The metering test (`tests/server/metering.test.ts`) can flake at ~5s under full parallel
  runs — passes in isolation; verify before treating as a regression. Node-24 artifacts:
  sources.test.ts resolveImageUrl + isoFixture snapshot churn are env artifacts (repo wants 20).
- `docs/audit/import_eval_results*.json` + `docs/audit/fidelity/*` churn on EVERY local
  eval/test run — `git checkout --` them unless committing wave evidence deliberately.
- Never `git checkout --` a file that holds an UNCOMMITTED live-run record you still need.
- Bundle rebuild matrix: `shared/src/insurance/*` or `shared/src/import/*` →
  `pnpm build:import-brain`; `shared/src/insurance/filing/*` → `pnpm build:filing`; BOTH
  when a file feeds both. Commit bundles with the source.
- vi.mock does NOT intercept lazy CJS requires — filing tests exercise the REAL
  filing-shared.cjs; rebuild before testing.
- Judges: synchronous (`run_in_background: false`); resume the SAME judge via SendMessage
  for re-verdicts; transcripts are the review record.
- The import-enumerate offline harness (`node scripts/import-enumerate.mjs`) is the corpus
  robustness baseline — regenerate + diff `RESULTS/corpus-baseline.json` when stage0–7
  change; restore if only durationMs churn. `--only <substring>` clobbers the full baseline —
  always follow with a full regeneration.
- Live creds: `tmp_keys.md` (gitignored, repo root) first; real Cosmos is
  cosmos-prodhub-dev-1r99 (memory/reference-cosmos-real-account); AI_SPEND_CEILING_USD=250
  on the App Service (import exempt).

## DONE-WHEN (unchanged from the charter)

Every ledger item dispositioned with evidence; Phases W, P, M gates declared with live
proof; Phase G executed verbatim with an honest final status; orchestration.md updated with
the final sha; accenture-test clean; `git status` clean; never a claim stronger than the
evidence. N_MAX=25 iterations; STOP conditions per the charter; never stop with a dirty tree.
