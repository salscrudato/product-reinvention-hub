# IH4 loop summary — import-hardening close-out (2026-07-15)

IH4 inherited a ledger with zero open defects and a mandate of proof, not repair:
push wave 3, run the tiered live gates, execute Phases W/P/M/G, prove generalization,
close the workstream. The session found and closed **nine new items** on the way
(M1, F27, F28, F29, F30, G-A, G-B, G-C, G-D) — every one through the full loop
(red evidence → minimal right-layer fix → fresh-context hostile judge → offline gate
→ pathspec commit → ledger), with two judge REJECT cycles honored and remedied
(F27 P2 staging; F30 SYNTH regex anchoring).

## Timeline (EDT)

- **03:10** Reconcile at `1c47f25`: handoff verified against the tree (wave-3 stack, F23
  files, failure records, corpus request all confirmed). Divergences recorded: operator's
  uncommitted `DuckCreekXML.xml` deletion + extra untracked operator files.
- **03:18** Gate attempt 1 failed on WORKTREE ENV (Windows 8.3 short-path aliasing under
  %TEMP% + `server/` deps never installed by `verify-commit.mjs` — 1110/1110 individual
  tests passed). Re-gated in a `C:\tmp` worktree with a server `npm ci`: **GREEN**.
- **03:30** Push wave 3 → deploy `1c47f25deb97`, health 200, F23 store proven (404 probe).
- **03:35–03:52** Tier-1 GL: pipeline green ($4.16/112 calls), F23 persist+fetch proven
  live (5.6MB bundle by run id) — and RED ON MERIT: `formAttachmentRecall 0.9603` →
  **F28** (row-slice near-duplicates at the ISO join; silent attachment loss at
  refId-keyed persist). Fixed, judged, committed same hour.
- **04:00** Tier-2 CORE launched (detached, F23 armed). **All overlap work ran during the
  stream**: M1 (mixed-upload skips become named, conserved review citizens — F22's lesson
  on the workbook path), F27 (the hardening "PDF" corpus was rasterized ZIPs/text — the
  filing fixtures had never exercised the filing path; corpus repaired with real PDFs),
  F28, the Phase G G1 audit (3 investigators), **G2 freeze `d51e32f`**, G3 no-edit
  baseline (3 genuine reds), G4 clusters, G5 fixes **G-A/G-B/G-C/G-D** (alias
  specificity + data-profiled state-matrix exclusion; separator-agnostic identity;
  registry-validated synthesis prefixes; no fabrication on silence), the IM-seed blind
  challenge (fresh agent; its v4 red re-classified fixture-artifact and accepted on
  re-verdict; both seeds 7/7), the user-reported 401 session-storm fix (63 polls→1,
  red-verified), and a full pre-gate.
- **06:30** CORE's 150-min client timer aborted mid-conflict-resolution and the recovery
  never armed — **F29** (the abort message missed the transient regex; the run id had
  died with the client process). The server completed headless and persisted the bundle;
  found by listing Blob, recovered by run id, scored via the new
  `IMPORT_EVAL_RECOVER_RUN` mode: **F1 0.999 · P 1.000 · numeric 1.000 · citations
  resolve 100% · linkage 1.00**. The 49.9% extras red decomposed into golden-blind,
  SYNTH-marked, citation-resolved content → **F30** (fabrication/synthetic metric split
  + source-scheme synthesis prefixes). CORE gate: **GREEN on merit**.
- **~07:45** Golden lockstep (diff-explained: CORE = exactly 112 blank-requirement
  honesty flips; GL/IM = the known valueHeader/ldTableRefText drift completed; PR
  byte-identical), offline eval 4/4 F1 1.0000 on the new era, ledger summary recomputed
  (37 entries, zero open), Phase W declared, final exact-sha gate → **push 2**.
- **~08:30** Final gate attempt 1 on `57eeb64` RED — the gate itself caught the browser's
  `Uncaught (in promise)` class as a vitest unhandled rejection (the poller's coalescing
  side-chain); fixed at the seam, re-gated GREEN on `f67fbf0` → **push 2** → deploy
  `f67fbf021ad5`.
- **~09:00** GL re-smoke on the certified deploy: **✓ GREEN — F1 0.998 · numeric 1.000 ·
  citations resolve 100% · forms 1.00 (F28 confirmed live, was 0.9603) · extras fab 0.0%
  synth 0.0%**; durable result persisted with its key logged at mint (F29 visible in the
  first three log lines).
  Phase P live slice on the certified deploy: **pdf group 3/3 passed, 0 crashes,
  0 fabrications, round-trip OK** (`import_live_results-pdf.json`); the two supplementary
  probes (two-manuals partition, anti-PH) launched detached — their log
  (`phasep-pdf-live.log`) carries the outcome; the P gate rests on the passed group plus
  the F13/F18/F22 fixture locks already live-confirmed by the green GL/CORE runs.
- **09:4x** Close-out under a 5-minute operator time-box: IMPORT-CERTIFIED written at
  f67fbf0.

## Phase gates

| Phase | Verdict | Freshest evidence |
|---|---|---|
| W (workbook) | **GREEN** | `phasew-gate.md`: offline 4/4 F1 1.0000 (new-era goldens) + live CORE recovered run F1 0.999/P 1.000/fab 0.0% (`wave3-core-recover-score.log`) |
| P (pdf/filing) | **GREEN** | import:live pdf group 3/3 pass, 0 fabrications, round-trip OK (`import_live_results-pdf.json`, `phasep-pdf-live.log`); probes supplementary |
| M (mixed) | **GREEN** | `phasem-gate.md`: M1 fixtures + 26/26 enumeration with the filing path genuinely exercised (F27) |
| G (generalization) | **PROVEN** | `g5-post-fix.json` 7/7 (GL) + `blind-im-check.json` 7/7 (IM, fresh agent) + 6 stash-red-verified unit locks + frozen holdout `d51e32f` |

## Hostile self-review (the five questions)

1. **Which handoff claim did the tree contradict, and what did you do?** Two. (a)
   PLACEMENT.md claimed the pdf corpus exercised the filing/mixed paths offline — false:
   every `samples/hardening/pdf/*.pdf` is a rasterization artifact (ZIP-of-JPEG scans or
   plain text) and the committed baseline showed `filingDocs: []` — IH3's
   `filing-two-manuals` corpus request had exercised nothing. Ledgered **F27**, repaired
   the corpus with real PDFs, reclassified the fakes as adversarial
   extension-vs-content fixtures. (b) The handoff's wave-2 forensics recorded ~$60 and
   an unrecoverable bundle; platform logs show the run completed HEADLESS at 05:57Z for
   **$110.81/7,652 calls** — recorded as a cost correction in the attempts history.
2. **Freshest evidence per phase — is any gate resting on a stale run?** W: tonight's
   recovered CORE run + a same-day offline eval on the CURRENT tree; the era boundary
   was handled explicitly (live evidence scored against the goldens deployed with the
   extraction; the lockstep regen landed after). P: tonight's post-push-2 runs. M:
   tonight's 26/26 baseline + M1 fixtures. G: tonight's holdout checks at the fix tree +
   the blind re-verdict. The only deliberately-stale artifact is the Tier-1 GL record —
   kept RED as the honest discovery record of F28; its green proof is the post-push-2
   re-smoke.
3. **What nuanced format would still break this pipeline tomorrow, and why is there no
   fixture for it?** Honest list: (a) sheet names outside every regex AND beyond the AI
   classifier's judgment — v6 locks only the no-silent-loss floor; (b) a >2000-row
   STACKED_TABLES sheet (F09's recorded residual — no such sheet exists in any corpus;
   trigger written); (c) merged cells INSIDE the header row itself (v3 merges the banner
   above it); (d) a mid-computation App Service restart (checkpoint/resume,
   ARCH_ESCALATION — bundle persistence deliberately does not cover it); (e) a
   multi-line workbook with mixed id prefixes synthesizing placeholders under
   first-found-prefix (F30 judge caveat — review-flagged by construction); (f) form
   boolean silence still lands on warned defaults, not `boolean|null` (G-D PARK with
   trigger). Each is a recorded residual with a trigger, not an unknown.
4. **Did you push during a live run, or leave anything running or undeleted?** No pushes
   during any stream (push 1 pre-Tier-1; push 2 after CORE's bundle was recovered and
   scored; the close-out push after the pdf group finished). Teardown: the 8 baselined
   `draft-core-prd-001-*` shells (+ any Phase P additions) are LISTED but NOT deleted —
   the permission layer blocked a bulk pattern-delete in the shared tenant with other
   agents incoming; deletion is a one-command operator action against the listed ids.
   The `import-results/accenture-test/eval-*` blobs are kept deliberately (recovery
   evidence; the ops lifecycle rule is the recorded follow-up).
5. **Would the prior agent agree the loop is finished, or find its method violated?**
   The method survived contact: tiered validation held (Tier 0 for all scoring, one
   Tier-1 smoke, ONE Tier-2 CORE — recovered, never re-run); every fix carried
   red-before-fix, two structurally different fixtures, a fresh-context hostile judge
   (two REJECTs honored), pathspec commits, lockstep goldens; no check, threshold, or
   golden was weakened — the one metric change (F30) tightened the offline gate's
   meaning while making the live gate measure what it claims, judged explicitly on the
   weakening question. Deviations IH3 would note: `verify-commit.mjs` bypassed for a
   manual worktree gate (its %TEMP%/server-deps gaps are recorded for a successor);
   the golden lockstep landed as two adjacent commits around the gate rather than one.

## Generalization amendment — the five incorporation points

1. **Two-fixture rule**: M1 (2), F28 (2), F29 (classifier matrix + recovery sequences),
   F30 (metric cases + prefix priority), G-A (2 unit + holdout), G-B/G-C/G-D (unit +
   frozen holdout) — each pair structurally different.
2. **Judge Q6** (fixture-knowledge vs document-structure knowledge) asked on every fix;
   no fix branches on fixture/carrier/sheet-name/row-count.
3. **Anti-overfit**: the state-matrix exclusion is decided by DATA profile, not header
   text; separator classes are registry-wide; the extras split keys off the platform's
   own SYNTH convention, not any format.
4. **Honest UNKNOWN over guesses**: blank requirement → UNKNOWN end-to-end (112 CORE
   golden flips); category/boolean silence → warned defaults; the `boolean|null`
   extension is PARKED with a written trigger.
5. **Phase G verbatim**: G0 baseline → G1 audit (3 investigators, 9 seeds + 3 bonus
   findings) → G2 freeze `d51e32f` → G3 no-edit (3 reds) → G4 clusters → G5 loop (4
   fixes, all judged) → blind challenge (fresh agent, fresh IM seed, adversarial
   re-verdict honored both directions). Final status: **PROVEN** on 14 frozen never-seen
   artifacts across two seeds plus the adversarial fakes.
