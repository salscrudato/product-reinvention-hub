# FINAL BUILD PASS — P1 baseline (verified ground truth at HEAD)

**Baseline HEAD:** `1c47f25deb9762bff2408a352d981371a7c8becf` (2026-07-15).
**origin/main:** `7d78d90` — HEAD is **13 commits ahead** (the held IH3 wave-3 stack; IH4
owns that push per [docs/import-hardening/IH4_HANDOFF.md](../import-hardening/IH4_HANDOFF.md)).
**Mode:** docs-only, pushes held, by operator directive ("run docs-only, I will tell you when
to push"). **Precondition:** the IMPORT-CERTIFIED stamp is **ABSENT** (grep zero hits
repo-wide; `docs/orchestration.md` does not exist — the live coordination file is root
[orchestration.md](../../orchestration.md)) — proceeding under the operator's explicit
docs-only override; ledger **RE-02** keeps the stamp on the books.
**Model note:** session confirmed on Fable 5 (`claude-fable-5`) — not silently dropped.

**About this file:** the previous `docs/build/BASELINE.md` and `ledger.json` were verified
**byte-identical duplicates** (SHA-256 compared this pass) of the canonical import-hardening
artifacts, which live untouched at
[docs/import-hardening/BASELINE.md](../import-hardening/BASELINE.md) and
[docs/import-hardening/ledger.json](../import-hardening/ledger.json). `docs/build/` is hereby
repurposed as the **master-pack home**: this baseline, the master
[`ledger.json`](ledger.json), and the P2/P4 specs. Nothing was destroyed.

> ⚠️ **Tracking quirk (P2–P5 read this):** `.gitignore:7` has an unanchored `build/` that
> catches `docs/build/` — this directory was never tracked before P1 (the "committed" IH
> artifacts live in `docs/import-hardening/`). P1 force-added (`git add -f`) exactly the six
> master-pack files; once tracked, edits show normally, but any **new** file added here
> needs `git add -f` (or rehome the pack and update the ledger paths). The stale IH wave
> logs in this directory stay untracked on purpose.

---

## 1. State reconciliation (Step 0 — 3 read-only Haiku subagents + writer spot-checks)

| Area | Verdict | Evidence (at 1c47f25) |
|---|---|---|
| **Import hardening (IH1→IH3)** | **CONFIRMED** | 28/28 ledger entries closed (9 IH1, 11 IH2, 6 IH3, 2 RESOLVED_PRIOR) in docs/import-hardening/ledger.json; all six spot-checked fixture files exist (`tests/import-brain/hardening-p0-1-multirefid.test.ts`, `hardening-f10-truncation.test.ts`, `hardening-f23-run-results.test.ts`, `shared/src/insurance/filing/reconcile-synth-ids.test.ts`, `isoImport.test.ts` F25/F26 cases, `app/src/lib/draft/cloneProduct.test.ts`); F23 result persistence live in code (`server/lib/ai/run-results.js:45` blob path `import-results/<tenant>/<runId>.json`, wired at `unified-import.js:204`); IH4 handoff staged. **P2–P5 must not rebuild any F/PCM item.** |
| **UX experience (CX wave R0 + prior)** | **CONFIRMED** | All R0 surfaces at HEAD: `StreamRenderer.tsx`, `WaveformLoader.tsx`, `PriorityRail.tsx`, `AgentVisualizer.tsx`, `server/lib/ai/task-summary.js` (grounded, `_stripUncited`), `refresh-news.js` (real `web_search_20250305` at :87, honest 501), `news-image.js`. Home renders ChatComposer/StreamRenderer/WaveformLoader/PriorityRail/PortfolioMetrics (Home.tsx:302-389). R0 commits reachable from HEAD (2ed0f57 ancestor-verified). No daily-brief endpoint exists → BRIEF workstream is net-new (spec'd). |
| **Export — Duck Creek (old)** | **CONFIRMED REMOVED** | `8825cbd` deleted the flattened exporter end-to-end (`shared/src/duckcreek/**`, `server/lib/duckcreek.js`, `*.duckcreek.xml` goldens, `docs/DUCKCREEK_MAPPING.md`); zero `duckcreek` hits in code today; `/api/duckcreek/*` 404 stands. |
| **Export — Rating Tool / Unity workbooks** | **MISSING (brief premise stale)** | Zero hits for `TableConfig`/`CoverageConfig`/`ratingTool` in code **and in all git history** — the brief's "existing transform" and "existing export tests" never existed. P3 **builds** the producer (ledger XE-03); the updated `(1).xlsx` pair are the structural goldens. Only exporter today: `app/src/lib/export/excel.ts` (portfolio shapes). |
| **Versioning / history** | **PARTIAL** | Read path CONFIRMED (`GET /api/db/versions` server/lib/data.js:427; `versionRead.ts`; ProductContext.tsx:104). Restore **dormant**: UI exists (HistoryDrawer.tsx:140-166) but gated on `snapshot != null` (:237) while versionRead.ts:43 always maps null — can never fire. History XLSX export **MISSING**. → HISTORY_SPEC + ledger HI-01..04. |
| **Enterprise gates** | **CONFIRMED** | Audit chain (`shared/src/audit/chain.ts`, verify endpoint data.js:472), no-bare-writes census (`app/src/__invariants__/no-bare-writes.test.ts`), canaries with exact assertions (HO-3 $1,528 `shared/src/rating/evaluator.test.ts:16`; PA $1,002 `personalAuto.evaluator.test.ts:18`; GL $2,635 `generalLiability.evaluator.test.ts:27`), bundle budget (175 KB initial / 25 css / 25 chunk — `scripts/check-bundle-budget.mjs:16-18`), `tools/stowaway-check.mjs`, `tools/verify-commit.mjs`, `.gitleaks.toml`, cookie session + break-glass (auth.js:130, admin.js:16). Golden egg present (reportWebVitals.ts:16-17) — RESOLVED_PRIOR, not rebuilt. |
| **Defaults targets** | **VERIFIED CURRENT STATE** | Products render expanded (`ProductHierarchy.tsx:90,:175` `useState(true)`); Dictionary flag `page.dictionary` `defaultEnabled: true` (`featureFlags.ts:57`), Sidebar obeys it (:32) → DEFAULTS_SPEC pins both flips; code deferred to the implementing wave by docs-only. |

## 2. Brief-vs-reality discrepancies (recorded so no wave chases ghosts)

1. `docs/orchestration.md` — does not exist; the coordination file is **root**
   `orchestration.md`. IMPORT-CERTIFIED absent there too.
2. `docs/export-templates/author-xml/sample-overlay.xml` and
   `docs/export-templates/MAPPING.md` — do not exist. The overlay structural goldens are
   `Carrier_SampleProductBase.xml` / `Carrier_SampleProductBase3.xml` (minimal base-chain
   manuscripts) + `DCT_SampleProduct_3_0_0_0.xml` (SP3, full overlay, line-parity-verified
   against the schema guide's citations).
3. "TableConfig is now 23 sheets and the **Config sheet is gone**" — 23 sheets **confirmed**
   (TOC + 21 tables + Config); Config **is present**, moved to the last sheet and reshaped to
   `TableName | EffectiveDate | EffectiveDateRenewal | IsVersion | ManuscriptID | SheetName |
   State Applicable`. No OLD workbooks exist anywhere in repo or history to diff against —
   the observed `(1).xlsx` shapes are pinned as the goldens (ledger XE-03/RE-04).
4. "the existing transform" for the workbook pair — never existed (see reconciliation row 4).
5. The filing-importer memory sha `2b4d019b` is unreachable from HEAD (pre-filter-repo
   rewrite); the feature itself is present (creditFloor / $1,281 canary lineage intact in
   shared rating code) — sha references from that era are navigation hints only.

## 3. What P1 produced this wave (docs-only)

- [`XML_EXPORT_SPEC.md`](../export-templates/author-xml/XML_EXPORT_SPEC.md) — the binding
  Duck Creek Author XML export spec (overlay model + delta lint, canonical→node map, Unity
  rate boundary + Open-Question-1 resolution, 17-row HITL inventory, validation ladder with
  two-way proof, two-way plug recommendation).
- [`ledger.json`](ledger.json) — master ledger, 21 entries across
  EXPERIENCE/XML_EXPORT/HISTORY/BRIEF/RELEASE/BACKLOG, voice parked with trigger.
- [`HOME_BRIEF_SPEC.md`](HOME_BRIEF_SPEC.md) · [`NEWS_TENANT_SPEC.md`](NEWS_TENANT_SPEC.md) ·
  [`HISTORY_SPEC.md`](HISTORY_SPEC.md) · [`DEFAULTS_SPEC.md`](DEFAULTS_SPEC.md).
- Raw material committed under `docs/export-templates/` (author-xml corpus + the two
  PA_PROD_001 workbooks + E+ OH BRD) so every spec citation resolves in-repo.
- **Deferred by the docs-only hold** (now ledgered, test-first, one commit each when the hold
  lifts): EX-01 collapse-all default, EX-02 dictionary flag flip, XE-03 golden pinning.
  Foreign worktree state left untouched: `docs/design-review/`, `docs/kurt-brief.md`,
  `hardening-corpus*`, and the unstaged deletion of `docs/reference/DuckCreekXML.xml`.

## 4. HOSTILE SELF-REVIEW (items 1–4; item 5 is deliberately NOT in any committed file)

**1. Which XML_EXPORT_SPEC decision am I least sure of, and what did I recommend so P3 does
not guess?** The override restatement depth (guide Open Question 2 — merge vs. replace on
`override="1"`). Recommended binding, stated normatively in SPEC §1.2: **full restatement**
of every overridden node, because it is correct under both engine semantics, plus the
R-flatten lint to keep full-restatement from sliding into flattening. P3 implements one rule;
if a real engine import later proves merge semantics, the relaxation is localized to the
emitter's restatement depth — the node map and lint shapes survive.

**2. If P3 emits an overlay from my spec and it fails to import, which section is the
likeliest culprit?** §1.1 base binding — a wrong or version-skewed `inherited` id (or the
`.xml` suffix leaking from the workbook file-name form into the bare-id attribute, which the
spec explicitly warns on) falsifies every override claim downstream. Second: §1.2 restatement
depth on partially-overridden nodes; third: L3 coherence (case-sensitive `keyRef@name` vs.
workbook header row 8).

**3. Is the Unity-vs-inline rate boundary unambiguous — could P3 accidentally inline a rate
table?** The boundary is MUST/MUST-NOT (SPEC §3.6): tables ride TableConfig, the overlay
carries only `lookup/tableRef/keyRef` wiring; and the failure mode is mechanically caught —
lint **R-rates** FAILS any local `<table>` with `<data>` whose id collides with the
TableConfig manifest. Accidental inlining requires writing an emitter the spec never asks
for AND naming its table identically to a manifest row; the second condition is the tripwire.
Residual honesty: a P3 that inlines a rate table under a NOVEL id (matching no manifest row)
would slip R-rates — but such a table is also invisible to every lookup the spec emits, so
R-idref/L3 leaves it dead weight, and the two-way proof's table count mismatch flags it.

**4. Did I reconcile prior work honestly, or risk P2–P5 rebuilding something already
shipped?** Three independent read-only agents (import hardening / UX+export / versioning+
gates) reported with file:line, and the two claims that mattered most were **negative**
findings I verified twice: the Unity transform does not exist (code + full git history), and
restore is dormant-not-missing (UI present, gate impossible). The known rebuild traps are
written down: 28/28 IH items closed (do not re-fix F19/PCM-C — write side was never broken),
golden egg RESOLVED_PRIOR, R0 surfaces all present. Weakest spot, named: agents grepped for
the names I gave them — a Unity exporter under a wholly different vocabulary could in theory
have been missed, which is why XE-03's first task is a fresh workspace-wide sweep before
writing code.
