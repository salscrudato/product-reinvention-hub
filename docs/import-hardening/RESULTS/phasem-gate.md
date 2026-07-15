# Phase M — mixed workbook+PDF gate (declared by IH4, 2026-07-15)

**Gate criteria** (from the phase plan): cross-artifact merges accounted in conservation;
no double-created entities; review UI surfaces per-artifact completeness.

## Decision: honest-skip stands; NO cross-artifact merge is built

No red fixture demands a merge. The mixed-upload semantics remain: workbooks win, the
PDFs are skipped — and the two-different-line-manuals case stays behind F13's recorded
ARCH_ESCALATION trigger (a multi-product split, not a merge). Building a merge without
a red fixture demanding it is prohibited by the anti-overfit rules.

## What the gate found and fixed (ledger M1 + F27)

1. **M1 (FIXED_IH4)** — the skip was a filter above the conservation ledger (F22's
   lesson): skipped PDFs surfaced as one count-only warning, unnamed, uncounted. Now
   every skipped document is a review citizen in F13's exact contract shape: named
   `unprocessed-document` unresolved item + named warning + `proposed`/`unresolved`
   counted together; the aggregate mixed-upload notice stays. Judge ACCEPT; two
   structurally different fixtures (`hardening-m1-mixed-visibility.test.ts`).
2. **F27 (FIXED_IH4)** — the offline fixture that claimed to exercise this path never
   did (its "PDF" was a ZIP of JPEG scans; magic-byte routing correctly sent it down
   the workbook path). The corpus was repaired with real PDFs; the enumerate baseline
   now shows the path genuinely exercised: `mixed-workbook-plus-pdf` routes the real
   PDF to `filingDocs` and accounts it (`proposed 107 = accepted 106 + unresolved 1`).

## Gate evidence (all Tier 0 / offline, fresh at this tree)

| Criterion | Evidence |
|---|---|
| Merges accounted in conservation | No merge exists (by design, trigger recorded). The multi-workbook merge request (`multi-workbook-merge`) conserves: baseline Δ=0, duplicate-free plan (M1 fixture 2 asserts `new Set(covIds).size === covIds.length`). |
| No double-created entities | Exact-dup pair request: one plan, honest counts (baseline). M1 fixture 2: 2-workbook merge + PDF, zero duplicate refIds. F28 closed the same-refId near-duplicate class at the join. |
| Per-artifact completeness on the review surface | M1: every skipped doc is a NAMED unresolved item (`UnresolvedSection` renders `u.name`) + named warning (`WarningsPanel`); consumer sweep verified in the M1 judge record. |

**Phase M: GREEN** — criteria met with the honest-skip design; merge remains a
written trigger (a red fixture demanding cross-artifact entity fusion), not a build.
