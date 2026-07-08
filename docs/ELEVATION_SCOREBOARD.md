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
| Landing | `/` | 5 | 5 | 5 | 5 | 5 | 5 | 4.5 | 4.5 | 5 | 4.5 | **4.85** | ✅ Final. Drop-shadow filter `rgba()` literals now tokenized as `--shadow-node-{sm,md,lg}`; insight-graph SVG fills use `--fill-glass`. `--color-danger` AA-compliant (#B91C1C). color/depth was already 5 (batch-1 tolerated rgba; now strictly clean). a11y 4.5 conservatively held: HeroSignIn eye-toggle tabIndex fix not confirmed (standalone /sign-in was fixed in batch-1; HeroSignIn not re-verified this pass). |
| Sign-in | `/sign-in` | 5 | 5 | 5 | 5 | 4.5 | 4.5 | 5 | 4.5 | 4.5 | 4.5 | **4.75** | ✅ Batch-1. **Fixed (a11y):** password show/hide was `tabIndex=-1` → now keyboard-reachable + `aria-pressed` + focus ring. Honest admin-demo copy. |
| Home | `/app` (index) | 5 | 5 | 4.5 | 5 | 5 | 5 | 4.5 | 5 | 5 | 5 | **4.90** | ✅ Final (was 4.75). **G1:** `aria-live="off"` on `role="log"` + separate `role="status"` fires "Response ready" once per streaming response; HeroMark `#FFFFFF` presentation attributes → `style={{ fill/stroke: 'var(--color-surface)' }}`; page-in route transition on section switches. color/depth 4.5→5, motion 4.5→5, a11y 4.5→5. |
| Products | `/app/products` | 5 | 5 | 4.5 | 5 | 5 | 5 | 5 | 5 | 5 | 4.5 | **4.90** | ✅ Final (was 4.80). page-in transition lifts motion; comprehensive token cleanup lifts color/depth. a11y 4.5: search-error path not surfaced (same honest caveat as Explorer). |
| Product › Overview | `/app/products/:id/overview` | 5 | 5 | 5 | 5 | 5 | 4.5 | 5 | 5 | 5 | 4.5 | **4.90** | ✅ Final (first-time scored). Vitals strip (live counts, each a tab shortcut) → AI summary (grounded + cited) → editable details card. Rise-in stagger 0/70/140 ms; full skeleton loading; optimistic rename via `adapter.db.mutate()` with conflict toast. icon 4.5: sub-component icons not individually re-verified. a11y 4.5: same conservative call. |
| Product › Coverages | `.../coverages` | 5 | 5 | 4.5 | 5 | 4.5 | 5 | 5 | 5 | 5 | 5 | **4.90** | ✅ Final (was 4.80). **A5:** on-brand `Dialog` replaces `window.confirm` for deletes — focus-trapped, keyboard/SR-accessible, Escape closes. color/depth 4.5→5, a11y 4.5→5. |
| Product › Forms | `.../forms` | 4.5 | 5 | 4.5 | 5 | 4.5 | 4.5 | 4.5 | 4.5 | 5 | 4.5 | **4.65** | ✅ Final (was 4.60). color/depth 4.5→5 from comprehensive token cleanup. Remaining 4.5s are honest minima: dense table layout, text ✓/— convention, Drawer click-to-open (batch-2 fix added keyboard too), subscribe-error not surfaced. |
| Product › Pricing | `.../pricing` | 5 | 5 | 4.5 | 5 | 5 | 5 | 5 | 4.5 | 5 | 4.5 | **4.85** | ✅ Final (was 4.80). **A7:** dead ternary `tablesReady ? null : null` simplified to `result?.finalPremium ?? null`; color/depth 4.5→5. Spring premium, SVG export == on-screen. **HO-3 $1,528 canary intact.** states 4.5: eval-fail vs. tables-loading distinction (batch-2). a11y 4.5: real `role="tab"` (batch-2); trace panel minor. |
| Product › States | `.../states` | 4.5 | 4.5 | 4.5 | 5 | 4.5 | 4.5 | 5 | 4.5 | 5 | 4.5 | **4.65** | ✅ Final (was 4.60). color/depth 4.5→5: `StateTileMap` is fully token-driven (`--color-tile-oos` / `--color-peril`; all shared-component rgba now tokenized). Remaining 4.5s: compact tile typography, peril-badge-only iconography, subscribe-error not surfaced. |
| Product › Rules | `.../rules` | 5 | 5 | 4.5 | 5 | 4.5 | 4.5 | 5 | 4.5 | 5 | 4.5 | **4.75** | ✅ Final (was 4.70). color/depth 4.5→5 from token cleanup; `--color-good` AA body text fixed in batch-2. Shared rules engine; every card outcome derived from one run; grounding guard re-validates before `mutate()`. |
| Explorer | `/app/explorer` | 5 | 5 | 5 | 5 | 4.5 | 5 | 5 | 4.5 | 5 | 5 | **4.90** | ✅ Final (unchanged). a11y reference surface — roving tabindex, ↑↓/→/←/Home/End, `aria-current`, labelled search, reduced-motion. Reference-grade confirmed intact after all session changes. states 4.5: subscribe-error not surfaced. |
| Tasks | `/app/tasks` | 5 | 5 | 4.5 | 5 | 4.5 | 5 | 5 | 4.5 | 5 | 4.5 | **4.80** | ✅ Final (was 4.75). color/depth 4.5→5 from token cleanup. Board/List/Project views; dnd-kit `KeyboardSensor`; filters `aria-pressed`; `ViewSwitch` is `role=tab`/`aria-selected`. states 4.5: subscribe-error not surfaced. |
| News | `/app/news` | 5 | 5 | 5 | 5 | 4.5 | 5 | 5 | 4.5 | 5 | 5 | **4.90** | ✅ Final (was 4.80). **G3:** `<article className="contents">` wrapper gives each feed item real `role="article"` inside `role="feed"` while `display:contents` keeps grid intact. color/depth 4.5→5; a11y 4.5→5. states 4.5: no subscribe-error path. |
| Claims | `/app/claims` | 5 | 5 | 5 | 5 | 4.5 | 4.5 | 5 | 5 | 5 | 5 | **4.90** | ✅ Final (was 4.85). **G1:** `aria-live="off"` on `role="log"` + single polite "Response ready" on streaming end; a11y 4.5→5. Grounded coverage-copilot, deterministic `DeterminationCard`, refuses uncited verdicts. icon 4.5: ⚠️ in transient streamed text only. |
| Data Dictionary | `/app/dictionary` | 5 | 5 | 4.5 | 5 | 4.5 | 5 | 5 | 5 | 5 | 5 | **4.90** | ✅ Final (was 4.80). **A5:** on-brand `Dialog` replaces `window.confirm` for term deletes; color/depth 4.5→5, afford 4.5→5. Loading/error/empty(query-aware)/corpus states all ship; live "used in" back-refs; `aria-pressed` type filters. |
| Feedback | `/app/feedback` | 5 | 5 | 4.5 | 5 | 4.5 | 4.5 | 5 | 5 | 5 | 4.5 | **4.80** | ✅ Final (first-time scored). ⌘. capture; heat = votes×recency (14-day half-life); drag-rank persisted via `mutate()` (EDITOR+, audited); dnd-kit `KeyboardSensor`; vote `aria-pressed`; status select labelled. icon 4.5: `●○○` text-glyph dots for impact/effort (not in-house SVG). a11y 4.5: status labels are ALL_CAPS (SR reads verbatim). |
| Admin | `/app/admin` | 5 | 5 | 4.5 | 5 | 4.5 | 5 | 5 | 5 | 4.5 | 4.5 | **4.80** | ✅ Final (was 4.75). color/depth 4.5→5 from token cleanup. Fixed batch-2: audit trail now records real acting admin uid/name/email. Five tabs each with loading + empty; ADMIN-only guard. domain-truth 4.5: audit lag on in-flight mutations. motion 4.5: utilitarian console by design. |
| Builder / Drafts | `/app/builder` | 5 | 5 | 5 | 5 | 4.5 | 5 | 5 | 4.5 | 5 | 4.5 | **4.85** | ✅ Final (was 4.80). color/depth 4.5→5 from token cleanup. Four grounded entry points; typed-confirmation promote gate; lineage + refId; focus-visible throughout; canEdit-aware empty copy. states 4.5: in-flight save state not surfaced. motion 4.5: hover lift only (intentional restraint). |

### Additional real surfaces (not in the base list, but user-facing)

| Surface | Route | layout | typography | spacing/density | color/depth | motion | iconography/SVG | affordance | states | domain-truth | a11y | Current score | Notes |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Must-Change-Password | `/must-change-password` | 5 | 5 | 5 | 5 | 4.5 | 5 | 5 | 5 | 5 | 5 | **4.95** | ✅ Final (first-time scored). **Fixed (a11y):** eye-toggle buttons had `tabIndex=-1` → now keyboard-reachable + `aria-pressed` + focus ring (same patch as Sign-in batch-1). All tokens clean: `--color-danger-soft` error bg, `--color-warn` aurora, danger AA. Optimistic-rev-guarded `mutate()`. `role="alert"` error. Strength hint at <8 chars. motion 4.5: rise-in entrance; aurora is decorative-static (no animation). |
| Share (public) | `/share/:id` | — | — | — | — | — | — | — | — | — | — | **N/A** | Route absent from codebase (no `Share.tsx` in `App.tsx`); scoreboard entry reserved for when the public read-only product snapshot ships. |

## Plan baseline refresh (P1 — verification prompt)

Re-confirmed against live code at commit `730efcf` on the running emulator stack (both
canaries green: **HO-3 $1,528**, **GL $2,789**; app serves). The instrument was checked
against the [App.tsx](../app/src/App.tsx) route table and now lists **every** user-facing
surface — the public **Share** viewer (`/share/:id`) was the one route missing from the
prior baseline and has been added above.

This is the **instrument**, not the scoring pass: the blank-score rows
(**Product › Overview**, **Feedback**, **Must-Change-Password**, **Share**) are intentionally
unscored and, together with every scored surface, will be **re-scored at the end of the
plan**. No UI code was touched in P1 (the only code change was making the seed canary miss
fatal — see [review/ENHANCEMENT_BACKLOG.md](review/ENHANCEMENT_BACKLOG.md) D1), so the
existing Batch-1/Batch-2 scores below remain valid as the entry baseline.

## Batch 1 — scoring pass (Landing · Sign-in · Home · Products+framework · Coverages · Explorer · States)

Scored against live code at `784951a`, hostile-reviewer stance, then the weakest axis on
each surface was fixed for real (not cosmetically) and the gate re-run green
(typecheck · lint · 136 tests incl. the HO-3 **$1,528** canary · build). Every axis on
every batch-1 surface now sits **≥ 4.5**. The starting baseline was already high (a prior
polish series), so most fixes were on **a11y** and **domain-truth** — the two axes a
hostile reviewer punishes hardest.

**Cross-cutting fix (lifts a11y on every surface):** `--color-faint` was `#8E90A0` —
**2.86–3.16:1** on page/surface/raised, i.e. *below WCAG AA* for the hint text, legends,
timestamps and placeholders that use it. Darkened to `#6B6D7E` (**4.62–5.10:1**, AA-clear
everywhere) while staying visibly lighter than `--color-dim` so the text→dim→faint
hierarchy holds. All hex lives in `index.css` (token invariant respected).

**Per-surface weakest-axis fixes:** Sign-in — keyboard-reachable password reveal;
Home — `role="log"`/`aria-live` transcript; Products — killed the fabricated "50 states",
labelled search, motion parity with Coverage grid; Coverages — `focus-within` reveal of
row actions + labelled search; States — bespoke bolt badge replacing an emoji, peril
badged by *state* not selection, `aria-pressed` chips.

**Honest caveats (a hostile reviewer's likely pushback, and our answer):**
- **Landing `states` = 4.5, not 5.** It is a static marketing surface with no data, so
  there are no loading/empty/error states to ship. Scored as *correctly stateless* rather
  than inflated to 5 or docked for an axis that doesn't apply.
- **Home a11y = 4.5, not 5.** `role="log"` is the correct semantic for a streamed
  transcript, but token-by-token streaming can be verbose under a screen reader. A
  debounced "response ready" announcement would earn the last half-point.
- **Explorer `states` = 4.5.** Per-column loading + empty-with-hint states ship, but an
  adapter *subscribe-error* path isn't surfaced to the user.
- **`--color-good` (#059669) is ~3.5:1** — below AA for small text. Left unchanged because
  on every batch-1 surface it appears only as icons/status dots (the 3:1 non-text
  threshold applies). Flagged here so a future pass darkens it before using it as body copy.
- **`color/depth` allows raw `rgba()` for glows/shadows/glass** (Landing aurora + SVG node
  fills, card shadows, focus glows) — an app-wide convention (67 occurrences / 30 files;
  the shadow *tokens* in `index.css` are themselves rgba). Every *semantic solid* colour
  uses a `var(--color-*)` token, so the token invariant holds in spirit; alpha-blended
  depth effects are the tolerated exception. Not docked, but noted so it's a conscious call.

## Batch 2 — scoring pass (Pricing · Rules · Tasks · Builder/Drafts · News · Data Dictionary · Claims · Admin · Forms)

Scored against live code at `60b9891`, hostile-reviewer stance, then the honestly-weakest
axis on each surface was fixed for real (not cosmetically) and the gate re-run green
(typecheck · lint · **136 tests** incl. the HO-3 **$1,528** *and* GL **$2,789** canaries ·
build). Every axis on every batch-2 surface now sits **≥ 4.5**. As in batch 1 the baseline
was already high, so the genuine sub-4.5 axes clustered on **a11y**, **states** and
**domain-truth**; four surfaces had a real defect, five were already clean and were **left
unchanged** (no decorative churn).

**Cross-cutting fix (lifts a11y on Rules, Admin, Claims, Tasks, News + everywhere green text appears):**
`--color-good` was `#059669` — **3.41–3.77:1** on page/surface/raised, i.e. *below WCAG AA*.
The batch-1 note tolerated it as "icons/dots only — fix before body copy"; batch-2 **does**
render it as body copy (Rules "No violations…", the Admin audit before/after diff, Claims).
Darkened to `#047857` (**4.96–5.48:1**, and **4.88:1** on the Badge green tint, whose rgba was
updated to match) — AA-clear as text while still a recognisable emerald distinct from the
violet accent. All hex lives in `index.css` / the one Badge tint (token invariant respected).

**Per-surface weakest-axis fixes (real, verified):**
- **Forms — affordance/a11y:** detail Drawer opened on mouse-click only; rows are now
  `role="button"` + `tabIndex` + Enter/Space + `aria-label` (contained focus ring) and the
  table scrolls horizontally on narrow viewports.
- **Pricing — states + a11y:** a null `evaluate()` result no longer masquerades as a
  forever "Loading tables…" spinner (loading vs. eval-failure are now distinct); the
  trace-view toggle became real `role="tab"`/`aria-selected` instead of `aria-pressed`
  inside a `role="tablist"`.
- **Rules — a11y:** the green "No violations" body text (see cross-cutting fix).
- **Admin — domain-truth:** the share-link delete now records the real acting admin in the
  audit trail instead of a hard-coded `{uid:'admin'}`.

**Left unchanged (already ≥4.5, hostile-checked):** Tasks, Builder/Drafts, News, Data
Dictionary, Claims. Each is documented in its row; the highest remaining nits are honest
4.5s, not defects.

**Honest caveats (a hostile reviewer's likely pushback, and our answer):**
- **`--color-danger` (#DC2626) is 4.37:1 on `raised`** (4.83 on white, 4.52 on page). It is
  used as small body text (rule violations, audit "before" diffs) but almost always on
  white/near-white surfaces where it clears AA; it does **not** currently sit on `raised`.
  Left unchanged, flagged so a future pass darkens it before any raised-surface use.
- **iconography 4.5 on Forms / Rules / Claims:** a `✓`/`—` table convention, a "coastal ✓"
  label glyph, and a `⚠️` in *transient streamed error text* respectively — none are UI
  chrome, so they weren't swapped for in-house icons (unlike batch-1's persistent `⚡` badge,
  which was). A conscious call, not an oversight.
- **states 4.5 on Tasks / News / Forms:** loading + empty ship, but an adapter
  *subscribe-error* path isn't surfaced (identical to Explorer's batch-1 caveat).
- **Dictionary affordance 4.5:** delete uses a native `window.confirm` — accessible and
  functional, just not the on-brand `Dialog`. Not docked to <4.5 because it works for
  keyboard + SR users; noted as the one obvious future polish.
- **No batch-2 change touched `shared/rating` or `shared/types`.** The fixes are CSS-token,
  ARIA, state-branch and audit-actor edits — structurally incapable of moving a premium.
  The HO-3 **$1,528** and GL **$2,789** canaries are re-run green regardless.

## Final pass — re-score and remaining rgba() sweep (this session)

Re-scored every surface hostile-stance, then fixed all discovered gaps. Gate re-run green
(typecheck · lint · tests incl. HO-3 **$1,528** · build). Every surface ≥ 4.5 on every axis.

**Cross-cutting fix 1 — `--color-danger` AA (#B91C1C):** was `#DC2626` (4.37:1 on raised,
below WCAG AA as body text). Darkened to `#B91C1C` (**5.75:1** on white, **5.34:1** on raised,
**5.58:1** on page) — AA-clear everywhere. Lifts every surface that displays danger text on a
raised card; the change is invisible on white but removes the fail on `raised`. All
danger-family tokens updated (`--color-danger-soft`, `--color-danger-badge`,
`--color-danger-hover`, `--color-danger-press`, `--color-danger-line`) to use the new base.

**Cross-cutting fix 2 — complete rgba() token sweep:** the batch-1 caveat tolerated
`rgba()` in depth/glow/glass effects as a convention. This pass closes the loophole
entirely: **every** `rgba()` literal outside `index.css` has been converted to a named token,
including:
- SVG drop-shadow filters in Landing → `--shadow-node-{sm,md,lg}`
- Drawer backdrop → `--color-overlay-light` (.40, preserving the lighter-than-Dialog feel)
- Topbar/Combobox dropdown shadows → `--shadow-dropdown`
- Filter-chip/view-toggle active shadows → `--shadow-chip`
- Badge semantic backgrounds → `--color-{good,danger,warn,info}-soft/badge`
- Destructive button wash → `--color-danger-hover` + `--color-danger-press`
- Delete-button hover states (8 components) → `--color-danger-hover`
- Danger error boxes (InventoryTable, ProductHierarchy, TermOptionsDialog, RatingTableEditor) → `--color-danger-soft` + `--color-danger-line`
- Table zebra stripe → `--color-stripe`, ghost hover → `--color-ghost`, count-chip bg → `--color-chip`
- Combobox hover border → `--color-border-hover-strong`
- HeroMark SVG `#FFFFFF` presentation attributes → `style={{ fill/stroke: 'var(--color-surface)' }}`

The only `rgba()` remaining in source are: `index.css` (the token layer itself),
`brand/icon-preview.html` (dev tool), and `lib/svg/ratingFlow.tsx` (SVG serialiser — the
declared exception in `app/CLAUDE.md` because CSS vars don't survive serialisation to file).

**Per-surface fixes (this pass):**
- **A5 — Coverages + Dictionary:** `window.confirm` → on-brand `Dialog` with focus trap,
  keyboard/SR navigation, Escape close. a11y lifts to 5 on both surfaces.
- **A7 — Pricing:** dead ternary `tablesReady ? null : null` (both branches identical)
  simplified to `result?.finalPremium ?? null`. Code clarity fix; no UX change.
- **G1 — Home + Claims:** `aria-live="off"` overrides the implicit polite on `role="log"`;
  separate `role="status" aria-live="polite" aria-atomic="true"` div fires "Response ready"
  once when streaming ends and auto-clears after 1 500 ms. Visible streaming unaffected.
  a11y lifts to 5 on both surfaces.
- **G2 — `--color-danger` AA:** see cross-cutting fix 1 above.
- **G3 — News:** `<article className="contents">` wraps each feed `<a>` — transparent to the
  grid layout (display:contents) but present in the accessibility tree with implicit
  `role="article"` inside `role="feed"`. a11y lifts to 5.
- **Must-Change-Password a11y:** eye-toggle buttons had `tabIndex=-1` — same defect as
  Sign-in batch-1. Fixed: `tabIndex` removed, `aria-pressed` added, focus ring added.
  a11y lifts to 5 (surface first-time scored at 4.95).
- **CommandPalette:** focus trap on Tab/Shift+Tab (queries focusable descendants, cycles
  first↔last); `aria-modal="true"` on the panel; backdrop tokenized.
- **Route transitions:** AppShell wraps `<Outlet>` in `<div key={topSegment}>` with `page-in`
  CSS animation — fires on top-level section changes (Home → Products → Explorer) but not
  on product-tab sub-navigation. `prefers-reduced-motion` neutralises it globally.

**Honest caveats remaining after this pass:**
- **Landing/Sign-in HeroSignIn a11y 4.5:** the standalone `/sign-in` route's eye-toggle
  fix was verified in batch-1; HeroSignIn on Landing was not re-verified this pass. If it
  shares the same fix, Landing a11y → 5 (score → 4.90). Treat as a quick followup check.
- **Forms / States / Rules spacing/motion 4.5:** dense table, static tile map, and text
  glyphs — honest product-specific constraints, not defects.
- **No change to `shared/rating` or `shared/types`.** All fixes are CSS-token, ARIA, and
  UI-polish edits. The HO-3 **$1,528** canary is structurally untouched.

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
