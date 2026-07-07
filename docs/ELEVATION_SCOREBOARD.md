# ELEVATION_SCOREBOARD.md — UI/UX elevation instrument

The **instrument**, not the scoring pass. One row per user-facing surface, one column
per rubric axis. Scores are intentionally **blank** here — a later pass fills each cell
0–5 (0 = absent/broken, 3 = competent/shippable, 5 = reference-grade) and writes the
per-surface **current score** (mean of the ten axes, or a weighted call) plus a short
note pointing at the highest-leverage fix.

Baseline established against live code at commit `61bddd1` (see the divergence notes at
the foot of this file). Routes are from [app/src/App.tsx](../app/src/App.tsx).

## Rubric axes (columns)

| Axis | What it measures |
|---|---|
| **layout** | Grid, alignment, hierarchy, responsive behavior, use of the viewport |
| **typography** | Type scale, weight, measure, tabular/mono numerals, rhythm |
| **spacing/density** | Whitespace, padding rhythm, information density vs. breathing room |
| **color/depth** | Token discipline (no hard-coded hex), elevation, contrast, surfaces |
| **motion** | Purposeful transitions, easing, `prefers-reduced-motion` respect |
| **iconography/SVG** | In-house icon family only, 24px grid consistency, bespoke SVG quality |
| **affordance** | Clear, discoverable controls; hover/focus/active; keyboard reachability |
| **states** | Loading / empty / error / conflict states actually shipped |
| **domain-truth** | refId + form-number fidelity, correct insurance semantics, cited AI |
| **a11y** | AA contrast, labelled controls, focus order, screen-reader friendliness |

Score legend per cell: **0** absent · **1** poor · **2** weak · **3** competent ·
**4** strong · **5** reference-grade.

## Scoreboard

| Surface | Route | layout | typography | spacing/density | color/depth | motion | iconography/SVG | affordance | states | domain-truth | a11y | Current score | Notes |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Landing | `/` | | | | | | | | | | | | Public showpiece; `routes/Landing.tsx` (constellation SVG, aurora). |
| Sign-in | `/sign-in` | | | | | | | | | | | | `routes/SignIn.tsx`; dev "Continue as admin" bypass present (temp). |
| Home | `/app` (index) | | | | | | | | | | | | Portfolio chat; `routes/Home.tsx`; SSE grounded AI. |
| Products | `/app/products` | | | | | | | | | | | | Portfolio list; `routes/Products.tsx` (ProductCard/Row). |
| Product › Overview | `/app/products/:id/overview` | | | | | | | | | | | | `routes/product/ProductOverview.tsx`; health, governance. |
| Product › Coverages | `.../coverages` | | | | | | | | | | | | `ProductCoverages.tsx`; typed Limit/Deductible/Option editors. |
| Product › Forms | `.../forms` | | | | | | | | | | | | `ProductForms.tsx`; form-number chips, attachment rules. |
| Product › Pricing | `.../pricing` | | | | | | | | | | | | `ProductPricing.tsx`; live rating trace ($1,528), SVG export. |
| Product › States | `.../states` | | | | | | | | | | | | `ProductStates.tsx`; StateTileMap, footprint scope. |
| Product › Rules | `.../rules` | | | | | | | | | | | | `ProductRules.tsx`; RuleBuilder, condition/outcome. |
| Explorer | `/app/explorer` | | | | | | | | | | | | `routes/Explorer.tsx`; cross-entity search/index browse. |
| Tasks | `/app/tasks` | | | | | | | | | | | | `routes/Tasks.tsx`; four lanes, dnd-kit board. |
| News | `/app/news` | | | | | | | | | | | | `routes/News.tsx`; market-news scout + NL prefs. |
| Claims | `/app/claims` | | | | | | | | | | | | `routes/Claims.tsx`; grounded coverage-analysis workspace (real). |
| Data Dictionary | `/app/dictionary` | | | | | | | | | | | | `routes/Dictionary.tsx`; canonical field defs, usedIn. |
| Feedback | `/app/feedback` | | | | | | | | | | | | `routes/Feedback.tsx`; ⌘. capture, one-vote, priority lanes. |
| Admin | `/app/admin` | | | | | | | | | | | | `routes/Admin.tsx`; users/roles, audit trail, settings. |
| Builder / Drafts | `/app/builder` | | | | | | | | | | | | **STUB** — `StubRoute` "AI Builder … coming soon" (App.tsx:67). |

### Additional real surfaces (not in the base list, but user-facing)

| Surface | Route | layout | typography | spacing/density | color/depth | motion | iconography/SVG | affordance | states | domain-truth | a11y | Current score | Notes |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Must-Change-Password | `/must-change-password` | | | | | | | | | | | | `routes/MustChangePassword.tsx`; first-login forced reset. |

## Baseline divergences (code vs. archived docs)

Recorded per the "code wins" rule; the reference docs were removed from the working tree
in commit `61bddd1 "chore: lean the repo to code only"` and now live only in git history
(parent `3da7284`).

1. **Docs deleted from the tree.** Root/app/functions/shared `CLAUDE.md`, `README.md`,
   all of `docs/` (CURRENT_CODEBASE, DATA_MODEL, DOMAIN_HO, AWS_SWAP, BASELINE_AUDIT,
   the six ADRs), sample forms, screenshots and tooling were removed. Intent/invariants
   were reconstructed from history for this baseline. This scoreboard is the first file
   re-added under `docs/`.
2. **Claims is now a real surface.** Archived `app/CLAUDE.md` described "builder + claims
   (StubRoute)". Code wires `claims` → a full `Claims` component (App.tsx:71); only
   `builder` remains a `StubRoute`. The scoreboard reflects the code.
3. **Multi-line (GL) product exists.** The HO-only reference docs predate a second seeded
   product — **Monoline General Liability (GL.PROD.001)** with its own worked example
   ($2,789). `shared/src/seed/gl.ts`, `rating/gl.evaluator.test.ts`, `rating/kits.ts`,
   `insurance/lobRegistry.ts`, `insurance/isoImport.ts` and `rating/rtGrid.ts` are new
   code with no doc coverage. The $1,528 HO-3 canary is unchanged and still load-bearing.
4. **`baseForms` collection** (Claims base-form library) exists in `firestore.rules`
   (line 96) but is not in the archived DATA_MODEL.md.
