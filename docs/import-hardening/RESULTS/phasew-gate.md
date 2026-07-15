# Phase W — workbook gate (declared by IH4, 2026-07-15)

**Criteria**: the offline full run green + the wave-3 live CORE run green, fresh evidence.

| Run | Evidence (fresh at the certification tree) |
|---|---|
| **Offline full run** | `pnpm import:eval` 4/4 formats F1 1.0000 · numeric 1.0000 · extras 0 · linkage 1.000 on the NEW-era goldens (post G-D honesty + set-sort canonicalization; diff-explained per class in the golden lockstep commit). Corpus enumeration 26/26 completed, 0 unhandled, 1 handled error (corrupt container — correct), filing path exercised offline for the first time (F27). |
| **Live CORE (Tier 2)** | Run `eval-fc23c0df…` on deploy `1c47f25deb97`: completed headless after the 150-min client window (F29), bundle persisted + recovered by run id (F23 working as designed), scored: **F1 0.999 · P 1.000 · R 0.999 · numeric 1.000 · citations entity/prov/resolve 100% · linkage parent/edges/forms 1.00 · fabrication extras 0.0%** (synthetic extras 49.9% reported — golden-blind content, ledger F30). `wave3-core-live.log` + `wave3-core-recover-score.log` + `import_eval_results-CORE.json` + the replayable dump. |
| **Live GL (Tier 1)** | First linkage-gated GL run: green end-to-end pipeline (F1 0.995, citations 100%), red ON MERIT at formAttachmentRecall 0.9603 → ledger F28, fixed + fixture-locked; post-push-2 GL re-smoke is the live confirmation. |

**Phase W: GREEN.** The tiered directive held: Tier 0 for all scoring work, one Tier-1 smoke,
ONE Tier-2 CORE run (recovered, never re-run — $0 of re-spend against three prior lost runs).
