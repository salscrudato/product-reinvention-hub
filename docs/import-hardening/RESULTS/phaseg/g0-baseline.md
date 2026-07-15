# Phase G — G0 baseline (recorded before any Phase G fix)

Baseline tree: `1c47f25` (wave-3 tip, deployed) — all 28 prior ledger items dispositioned.

| Surface | Baseline |
|---|---|
| Offline eval (Tier 0), all four formats | F1 1.0000 · numeric 1.0000 · extras 0 · linkage parent/edges/forms 1.000 (fresh run at 1c47f25, 2026-07-15) |
| Corpus enumeration | 25/25 completed, 0 unhandled, 1 handled error (corrupt container) — pre-F27; 26/26 after the corpus repair |
| GL live (Tier 1, deploy 1c47f25deb97) | F1 0.995 · numeric 1.000 · citations 100% · extras 1.9% · parent/edges 1.00 · **forms 0.9603 RED** (→ ledger F28, fixed) |
| Unit suites | shared 604 · root 130 (import) · app import 130 — green |
| Known honesty state (G1 audit) | three fabrication-on-silence clusters live at the mapper (→ G-D) |

G2 freeze: HOLDOUT_SHA `d51e32f` (7 GL variants + generator + G1 audit + G3 baseline).
G3 no-edit result: 4/7 green — reds v2 (alias ambiguity), v4 (separator notation +
junk-prefix synth), v5 (fabrication-on-silence). Clusters in `g4-clusters.md`;
fixes G-A/G-B/G-C/G-D (all judge-ACCEPTED, red-verified) → `g5-post-fix.json` 7/7.
Blind challenge: fresh-context agent, fresh seed (IM) — result recorded separately.
