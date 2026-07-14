# Import-brain triage — cross-lane assist from Lane A (public-surfaces)

> **No-action-required FYI. I did not touch any import-brain file, did not call dev,
> and did not push anything** (a push would deploy and sever your in-flight SSE — the
> opposite of helping). This is pure read-only analysis of the result artifacts your
> own harnesses already drop in `docs/audit/`, plus one coordination offer.
>
> Reproduce anytime: `node tools/eval-triage.mjs` (read-only, zero-dep, never imported
> by app/server — running it cannot restart dev).

## The one reframe that saves the most time

**Your golden evals are not failing on accuracy — they never return a plan.** f1 /
numericExact / citation were never measured. Two *distinct* stream-death modes (don't
treat them as one bug):

| Line | Signature | Dur | What it almost certainly means |
|---|---|---|---|
| CORE, GL | `fetch: terminated` | **~48 min** | **CONN-DROPPED** — the stream was killed mid-flight. On shared dev this = **a deploy restarting the host**, not a code bug. |
| IM, PR | `This operation was aborted` | **exactly ~15 min (900 s)** | **CLIENT-ABORT** — a fixed harness/client timeout fired. |
| NJ-LEMONADE-2 (PDF) | `aborted` | ~120 s | CLIENT-ABORT on the PDF path at a *different*, shorter ceiling. |

Meanwhile **adversarial + safety is green**: 9/9 formats pass, **0 fabrications, 0
crashes**, garbage-PDF cleanly rejected, and those (small) inputs finish in 10–26 s. So
the brain's core logic and anti-invention guards are holding — the wall is **scale /
stream-survival**, not correctness.

## Highest-leverage lever: a push-free window (available *now*)

CORE/GL run ~48 min. An import that long **cannot survive a deploy landing inside its
window**, and each retry restarts the ~48-min clock — so on a busy push night it may
*never* get a clean run, regardless of code quality.

**Good news: as of ~01:55 every other lane (admin, audit, filing-B, public-surfaces-A)
is DONE.** If nobody pushes, you finally have a deploy-free runway. I'm deliberately
**not** pushing my triage note (it would deploy). Suggest you kick a fresh CORE/GL run
into the quiet window and, if it completes, *that's* your first real accuracy read.

## Two precise, fast things to check (hypotheses, not claims)

1. **Is the 900 s an *idle* timeout or a *total* one?** CORE/GL reached 48 min in the
   *same* batch that aborted IM/PR at 15 min — inconsistent with a single fixed total
   timeout. If your harness/`fetch` aborts on **inactivity** (no SSE bytes for N min),
   then IM/PR **stalled** — a stage stopped emitting the `:hb` keepalive (blocked event
   loop, or a rung with no heartbeat). Grep `scripts/import-eval.mts` for
   `AbortController` / `AbortSignal.timeout` / `setTimeout` / `900000` and check whether
   the timer **resets on each chunk**. If idle-based → the bug is a non-heart-beating
   stage on IM/PR, not a slow one.
2. **PDF path returns products with 0 coverages** (NJ-LEMONADE-1 & -3 "pass" but
   coverageCount 0). Distinct from the timeouts — the filing/PDF→coverages step yields a
   product shell with no coverages. Separate fix from the XLSX brain.

## Snapshot (live — your loop is actively rewriting these files)

```
PASS 9 · CLIENT-ABORT 3 · CONN-DROPPED 2 · ZERO-EXTRACTION 2 · source-gap(ok) 1
```

Numbers will move as your runs land; re-run `node tools/eval-triage.mjs` for the current cut.

---

## Deep-read findings (read-only, 3 parallel investigators · line refs are a snapshot; your files are live)

**My earlier "idle-timeout stall" guess was wrong — here's the corrected, evidence-backed picture.**
The `:hb` heartbeat is a **15-second `setInterval`** (`ai/unified-import.js:125`), not a 15-minute thing
(unit trap). Because it's an independent timer, a stage that just awaits the network keeps bytes
flowing — so silence-on-await does **not** cause the abort. The two failure modes are simpler and each
has a cheap fix:

### A. IM/PR `aborted @ ~15 min` = the harness guillotines a *healthy* run — cheapest unblock
- `scripts/import-live.mts` arms `setTimeout(() => controller.abort(), 900_000)` **once at request
  start** and **never resets it per SSE chunk** (`:124`, values at `:476/:513/:594`). It's a **total-elapsed
  15-min cap**, so a genuinely-streaming import that needs >15 min is killed even while bytes flow.
- Worse: **abort is excluded from the retry path.** The transient regex is `/terminated|fetch failed|
  ECONNRESET|socket|other side closed/i` (`:114`) — `"This operation was aborted"` doesn't match, so a
  timeout = **instant hard fail, no retry.** (`import-eval.mts` uses a 45-min cap `:263` — also below the
  ~48-min real runtime, and same no-reset/no-retry-on-abort behavior.)
- **So IM/PR aren't failing on accuracy or crashing — they're being cut off mid-success.** The ~1-line
  unblock: make the timeout an **inactivity watchdog** (reset the timer on each chunk in the read loop)
  instead of a total cap — a healthy stream then never dies, only a truly-silent one does. Or, minimally,
  raise the cap above true completion (≥60–75 min) *and* add `aborted` to the retry regex.

### B. CORE/GL `terminated @ ~48 min` = deploy severance (already retried, but re-severed)
- `terminated` **is** in the retry regex, so it retries — but a 48-min import just gets re-severed by the
  next deploy, and each retry restarts the 48-min clock. **The push-freeze is the only real fix here**
  (see above; every other lane is done, so the window is free now).

### C. Why it takes 48 min — the long pole is **Stage 4 (row extraction)**, and it's fixable without a rewrite
Stage 4 is the only stage whose call count scales with **row count** (the biggest workbook dimension);
STACKED_TABLES rate manuals always miss the deterministic fast path (`stage4-extract.js:442`) and take the
expensive AI path. It compounds with the pipeline's most conservative concurrency. Concrete, independent
serial→parallel wins (all their code, all safe under the `noCap` import budget):
- **Stage-4 per-field judge loop** `stage4-extract.js:262-292` — serial `for…await` of gpt-5.1 calls, one
  per conflicted field → `Promise.all`. Sharpest micro-serialization *inside* the long pole.
- **Stage-5 validation batches** `stage5-validate.js:114` — serial gpt-5.1 batches within a sheet → parallelize.
- **Stage-3 column batches** `stage3-column-map.js:241` — serial opus+gpt-5.1 batches → parallelize.
- **Sheet-level caps are conservative** (stage-4 sheets=2 `:703`, stage-3 sheets=3 `:274`) — comment says
  they exist to avoid "stampeding Foundry," not for cost; raisable under `noCap`.
- **Constant-factor trims (accuracy budget permitting):** Stage-1 fires **2 prefilter calls/sheet** that
  rarely short-circuit on content-heavy workbooks (`stage1-classify.js:120-138`); and every unit runs an
  **Anthropic+OpenAI 2× ensemble** (deliberate decorrelation — the biggest single call-volume multiplier,
  the first knob if latency must beat accuracy).
- **Event-loop hygiene:** `deterministicExtract` runs a tight **synchronous** loop over every row × cols ×
  up to 51 state columns with no yield (`stage4-extract.js:449-514`). On a huge sheet this can starve the
  15-s heartbeat and let Azure's ~230-s proxy idle-drop the stream → chunk it with a `setImmediate` yield
  every N rows.

### Recommended order (fastest measurement first)
1. **Fix the harness timeout** (inactivity watchdog, or raise cap + retry on abort) — **~1 line, unblocks a
   real accuracy read immediately** without touching the pipeline. This alone flips IM/PR from "fail" to a
   measured result.
2. **Freeze pushes** → let CORE/GL finish a clean 48-min run → first honest accuracy numbers.
3. **Then** parallelize the three serial loops + raise sheet concurrency to pull 48 min down.

**Bottom line: don't restart.** The pipeline is well-built (adversarial + safety green, defensive
try/catch everywhere, deterministic fast paths). The blockers are a too-tight harness timeout, deploy
severance, and a few serial loops — all surgical fixes, none of which a from-scratch rebuild would reach faster.

---

## READY-TO-APPLY: harness timeout fix (your files — I did NOT edit them; local, no deploy)

The identical pattern is in **`scripts/import-live.mts` `readSseOnce` (~:122-172)** and
**`scripts/import-eval.mts` `postImportOnce` (~:276-315)**. Change the total-elapsed abort into an
inactivity watchdog that resets on every chunk (the 15-s `:hb` heartbeat keeps it alive → a healthy
stream of any length never dies; only true silence aborts). Two edits per file:

```diff
   const controller = new AbortController()
-  const timer = setTimeout(() => controller.abort(), timeoutMs)
+  // Inactivity watchdog (not a total cap): abort only after timeoutMs of SILENCE —
+  // no bytes at all, not even the 15-s :hb heartbeat. A healthy long stream never times out.
+  let timer = setTimeout(() => controller.abort(), timeoutMs)
+  const bump = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), timeoutMs) }
```
```diff
     for (;;) {
       const { done, value } = await reader.read()
       if (done) break
+      bump()   // any byte (including :hb) resets the inactivity watchdog
       buf += decoder.decode(value, { stream: true })
```

- Because it's now inactivity-based, you can also **lower `timeoutMs`** (e.g. live 900_000→120_000,
  eval 2_700_000→180_000) for *faster* dead-stream detection without risking a healthy run — optional.
- Belt-and-suspenders (optional): add `aborted` to the transient-retry regex (`import-live.mts:114`,
  `import-eval.mts:268`) so a genuine watchdog fire still retries:
  `…|other side closed|aborted/i`.

**No deploy needed** — these run locally; edit, re-run `pnpm import:live` / `import:eval` in the
push-free window, and IM/PR/CORE/GL should finally complete and give you the first real
f1/numericExact/citation read.

---

## Filing import: the console crash + 0-variables (diagnosis from live logs, NOT edited — files are in flight)

**Crash** (`TypeError: Cannot read properties of undefined (reading 'length')` in the Builder chunk,
during a filing PDF import): it's a **frontend render** fault, and it belongs to the **live-visualizer
(F3·A)** lane — `app/src/import/{UnifiedImportModal,unifiedImportClient}.tsx/ts` are both `M` right now.
Root signal: the deployed client only captures `key === 'bundle'` (`unifiedImportClient.ts:124`), but the
filing pipeline emits **`filing:bundle`** (`stage-filing.js:373`). So a filing import yields no rendered
bundle on the deployed build → an unguarded `.length` (e.g. `plan.summary.warnings.length`) hits
undefined. **F3·A is already fixing the filing:bundle handling** — leaving that to them, not colliding.
- Backend confirms it's not a thrown reconcile: deployed logs show **no** `[stage-filing] reconcileFiling
  failed`, **no** `MODULE_NOT_FOUND`; `filing-shared.cjs` loads and exports all four helpers; the import
  ran (10 calls, $2.23). So `reconcileFiling` produced a real plan+summary — the gap is purely client-side.
- **Optional backend belt-and-suspenders** (import-brain, `stage-filing.js`): the two fallback paths
  (stub `reconcile` at :217 and the `catch` plan at :361-370) build a plan with **no `summary`** — latent
  crash sources if `filing-shared` ever fails to load or reconcile throws. Add
  `summary:{warnings:[],unmappedColumns:[],sheetsSkipped:[],defects:[]}` to both so no filing bundle can
  ever ship a summary-less plan. (Not the cause of *this* crash, but correct hardening.)

**0 variables / 0 coverages** (NJ Lemonade rate-order + manual): a **quality** gap, not a crash. Those
PDFs are scanned / CID-font (per the `buildContentBlock` comment) → they take the native-PDF **vision**
path, and the vision extraction is returning empty (or the citation-required sanitizers drop everything).
Import-brain territory; distinct from the timeout + crash work.

## Brain-loop restart brief (if the import-brain agent is re-engaged — recommend redirect, NOT restart)

Evidence the loop WORKS, so don't rebuild from scratch: **GL offline f1=1.0**, **IM live-completed in
8 min (f1 0.31 — real recall gap now measurable)**, adversarial 9/9 + 0 fabrications, filing import runs
to a bundle. Ordered, unblocked-first worklist:
1. **Harness inactivity-watchdog** (diff above) — local, no deploy → makes IM/PR/CORE complete + measurable.
2. **Freeze pushes** — logs show 3 redeploys in 25 min; that's what severs CORE/GL at ~48 min.
3. **Stage-4 latency** — parallelize the serial judge loop (`stage4-extract.js:262-292`), stage-5 batches
   (`stage5-validate.js:114`), stage-3 batches (`stage3-column-map.js:241`); raise sheet concurrency (2/3).
4. **IM recall** — recall 0.19 (found 3,780/19,427); the first genuine accuracy target now that it completes.
5. **PDF extraction quality** — scanned-PDF vision path returns 0; separate track.
The **frontend filing crash is F3·A's**, already in progress — not a brain-loop task.
