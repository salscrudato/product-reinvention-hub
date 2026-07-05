# BASELINE_AUDIT.md — Scored critique of every route

**Product Reinvention Hub** · P&C insurance product-management platform (persona:
the insurance product manager). Audited on **2026-07-05** against `docs/DOMAIN_HO.md`,
`docs/DATA_MODEL.md`, `docs/AWS_SWAP.md`, and the elevation spec recovered from git
(`docs/ELEVATION_PROMPT.md`, deleted in `dc395de` — its §8–§10 mandates and §11 rubric
are the yardstick below).

This is a blunt baseline, not a victory lap. Where the app is genuinely good, it is
credited; where it falls short of the spec, it is named with a file path or refId.

## Method & evidence

- **Gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — **all green with
  zero code changes.** 19/19 vitest tests pass, including the canary
  *"produces $1,528 for the DOMAIN_HO worked example with exact per-step trace"*
  (`shared/src/rating/evaluator.test.ts`). Build warns only about chunk size (non-blocking).
- **Driven live.** The Firebase Emulator Suite (Firestore 8080, Auth 9099, Storage 9199,
  UI 4000, Hosting 5000) and Vite (5173) were already running and seeded. I drove the app
  headless via Playwright (chromium-1228) signed in as admin:
  - Sign-in → `/app` lands cleanly (the `mustChangePassword` gate is a dismissible banner,
    not a hard block). **Zero console/page errors across the whole session.**
  - Pricing recompute is **live and correct**: changing Territory `T002 → T005` moved the
    trace from `$1,528` to **`$2,123`** (s1 SET $1,040 → … → s11 MIN_FLOOR $2,123 rounded).
  - ⌘K palette opens and returns **grounded** results with refIds (search "scheduled" →
    `HO.COV.003.002`, `HO 04 61`, `HO.RT.007`).
  - ⌘. feedback modal opens with auto-attached route context ("Linked to /app").
  - Explorer confirmed to show **"Rules 0"** live (searchIndex omits rules).
- Every route was also inspected against the full-page screenshots committed in `1c8f037`
  (recovered from git; they were produced from this same seeded instance).

---

## Cross-cutting findings

**Strengths (system-level).** `app/src/index.css` is the strongest asset: a coherent
`@theme` token set (Accenture violet `#A100FF→#7A00E6`), a global pointer-affordance rule
(`button,[role="button"],[role="tab"],a[href],summary{cursor:pointer}`), a single
`focus-ring` utility, `prefers-reduced-motion` overrides that neutralise every animation,
tabular/lining numerals on `.font-mono`, and a full motion vocabulary (aurora, constellation
stroke-draw, node breathe, flow-step, rise-in). The adapter seam is respected — no
`firebase/*` import appears in app code outside `lib/backend`. Domain traceability is
excellent: refIds and form numbers are first-class mono chips almost everywhere, and the
grounded surfaces (Landing chat, Home suggestions, Pricing hints, ⌘K) cite real IDs.

**Systemic weaknesses.**
1. **Two primary nav destinations are dead stubs** — AI Builder (`/app/builder`) and Claims
   Analysis (`/app/claims`) both render `StubRoute` "coming soon" (`app/src/App.tsx:66,70`).
   They sit in the top-level rail and undercut the "AI-native" positioning.
2. **Explorer never got its §8F/§10.3 rebuild** — it is still a flat Fuse.js card grid
   (`app/src/routes/Explorer.tsx`), not the Finder-style products → coverages → sub-coverages
   Miller-columns browser the spec mandates.
3. **Pricing has no §10.2 grid** — the "Table" toggle is a read-only trace table
   (`app/src/routes/product/ProductPricing.tsx:96`), not the Excel-like ≤3-dimension RT/LD
   editor. This is the single largest missing feature.
4. **`lucide-react` is still imported in 15 files (42 distinct icons)** — see inventory at
   the end. §7.2/§12 require its total removal in favour of the in-house family
   (`app/src/components/ui/icons.tsx`), which already exists and is used elsewhere. The app
   ships two icon families side by side.
5. **searchIndex omits rules** → ⌘K and Explorer cannot find a single rule (Explorer shows
   "Rules 0" though the product has 10). A traceability hole for a product where rules matter.
6. **Motion is concentrated on Landing/Pricing.** Interior list/table/board routes (Forms,
   Rules, Tasks, Dictionary, Admin, Explorer) are essentially static — no entrance stagger or
   micro-interaction, against §7's app-wide motion mandate.
7. **Single-product emptiness.** With one seeded product, Home, Products, Tasks, Feedback,
   Dictionary and States all leave large dead lower regions; layouts don't rebalance for
   sparse data.
8. **Docs drift.** `CLAUDE.md`'s design-system section still documents a *magenta* gradient
   (`#C026D3→#EC4899`) while the shipped tokens are Accenture *violet*; and the live spec
   (`docs/ELEVATION_PROMPT.md`) was deleted from the tree.

**Verified domain-truth display bugs** (details in appendix): Coverage C "% of A" renders as
**"$50"** instead of "50%"; every rated coverage shows **"Pricing 14"** (the whole program's
step count, not its own); the Pricing *flow* mixes `$1,147.70` and `$1,147.7`.

---

## Per-route critique & 10-axis scores

Axes (1–5): **L**ayout · **T**ypography · **S**pacing/density · **C**olor/depth · **M**otion ·
**I**conography/SVG · **A**ffordance · **St**ates · **D**omain truth · **A11y**.

### 1. Landing — `/`
The showpiece delivers: aurora glow, a self-drawing SVG constellation feeding a central
"Product Manager" node (Coverages A–F, Rating, Live news, Tasks, AI copilot), a hero with a
gradient accent word, and a grounded chat box seeded with *"Trace how the $1,528 HO-3 premium
is built"* plus "every answer cites its `refId` and form number." Weakness: a large empty
vertical band separates the hero from the three module cards, so the page reads as two
disconnected folds; the "chat" is a teaser that routes to sign-in rather than a live surface.
- **L** 4 · strong hero+SVG, but a dead mid-page band splits the composition.
- **T** 5 · display scale, gradient word, inline mono `refId` — exemplary.
- **S** 4 · generous; the hero→cards gap is too loose.
- **C** 5 · aurora + glass cards + restrained violet.
- **M** 5 · aurora, constellation stroke-draw, node breathe, edge-flow.
- **I** 5 · bespoke inline constellation and module glyphs; no stock art.
- **A** 4 · chat + Sign-in clear; module cards' interactivity is ambiguous.
- **St** 3 · no real loading/empty/error; the chat is static.
- **D** 5 · cites $1,528, HO-3, refId, "grounded in your data."
- **A11y** 4 · good contrast; decorative SVG; some affordances under-signalled.

### 2. Sign-in — `/sign-in`
Calm, centered, premium: logo, aurora, labelled Email/Password, primary "Sign in"
(`variant="primary"`, correct gradient), and a "Continue as admin" demo shortcut with the
seed identity in the footer. The card sits above optical center with a lot of empty space
below. Submit shows a spinner and disables while busy.
- **L** 4 · centered but top-heavy; empty lower half.
- **T** 5 · clean hierarchy.
- **S** 4 · comfortable card; page balance slightly off.
- **C** 4 · aurora + surface card.
- **M** 3 · only the background aurora moves.
- **I** 4 · logo + shield glyph.
- **A** 5 · unmistakable primary action + secondary shortcut.
- **St** 4 · busy/disabled states; error via toast.
- **D** 4 · demo-workspace framing, seed admin shown.
- **A11y** 4 · labelled inputs, focus rings.

### 3. Home — `/app`
An assistant-first workspace: "Ask your product portfolio" with four **grounded** suggestion
chips (Texas SPP forms, HO-3 premium trace, Coverage F eligibility rules, wind/hail options)
and a composer, plus a right rail "Today's Focus" (My open tasks with due-in dates, Awaiting
review, Health findings 100, Latest news). The center chat is vertically centered, leaving a
large empty upper band that unbalances the page; the rail's section icons read as a different
(lighter/mono) family than the sidebar.
- **L** 3 · centered chat leaves a dead upper band; rail is good but unbalanced.
- **T** 4 · solid; rail labels a touch generic.
- **S** 3 · vertical centering wastes space.
- **C** 4 · restrained; accent square logo.
- **M** 3 · little entrance motion.
- **I** 3 · mixed families; rail glyphs faint.
- **A** 4 · suggestion cards + composer clear.
- **St** 4 · "Nothing awaiting review" / "No news items yet" empties present.
- **D** 5 · suggestions cite Cov F, wind/hail, HO-3; health pill.
- **A11y** 4 · reasonable; composer labelled.

### 4. Products — `/app/products`
Portfolio/Drafts tabs, instant search, Cards/List toggle, Export and New product. The single
seeded card is well-composed (HO.PROD.001 · ACTIVE · LAUNCHED · Homeowners LOB, five module
tiles, "15 states · Personal Lines … · Summary", gradient top accent). With one product the
page is mostly empty; the module-tile icons are muted and low-contrast; meta values truncate
awkwardly ("Personal Line…", "Product Fac…").
- **L** 3 · one card top-left; vast empty canvas.
- **T** 4 · good; truncations ragged.
- **S** 3 · sparse.
- **C** 4 · card gradient accent is a nice touch.
- **M** 3 · minimal.
- **I** 3 · module-tile glyphs faint/low-contrast.
- **A** 4 · card, tiles, toggle, filters.
- **St** 4 · tabs, typeahead, empty handled.
- **D** 5 · refId, governance badges, 15 states.
- **A11y** 4 · fine.

### 5. Product › Overview — `/app/products/:id/overview`
§8A landed: single column, **no right rail**, a health pill (`95 · 1 finding`) folded into the
header, and the single top finding surfaced as one quiet dismissible banner ("Other Structures —
Increased Limits has no form attachment rule → Review"). Coverages are grouped Section I / II
with refId chips, requirement/Rated badges, limit lines and endorsement lists. Two issues: the
purple header block is tall and its right-edge gradient washes over the Comments/History/Export/
Share actions; and **Coverage C's "% of A" prints "$50"** (percent rendered as currency).
- **L** 4 · clean single column; header block heavy.
- **T** 5 · refId mono + limit figures read well.
- **S** 4 · generous grouping.
- **C** 4 · header gradient a bit dominant; overlaps actions.
- **M** 3 · finding banner rise-in only.
- **I** 4 · in-house glyphs; status dots.
- **A** 4 · cards open; finding Review/dismiss.
- **St** 4 · finding + endorsement states.
- **D** 3 · "$50" percent-as-currency bug (`CoverageCollection.tsx:16`).
- **A11y** 4 · dismissible banner, headings.

### 6. Product › Coverages — `/app/products/:id/coverages`
§8C is substantial: Cards/List, typeahead, a base-form chip (`DOMAIN_HO.md` with replace/
remove) gating an enabled **Extract coverages** action, Add coverage, and per-coverage cards
with a six-tile aspect grid (Limits/Deductibles/States/Forms/Pricing/Rules) split into
Coverages and Endorsements sections. Weaknesses: the stat-tile icons are gray and low-contrast;
the hover edit/delete toolbar renders as a black block over the card (visual glitch on Coverage E
in the capture); and **"Pricing 14"** appears on every rated coverage — that count is the whole
rating program's step total, not the coverage's own participation (`coverageAspects.ts:34`).
- **L** 4 · cards⇄list + sections; dense but organised.
- **T** 4 · refid chips good.
- **S** 3 · tile grid busy; hover toolbar glitch.
- **C** 3 · stat tiles muted/gray.
- **M** 3 · minimal transitions opening editors.
- **I** 3 · aspect icons faint.
- **A** 4 · hover actions, base-form chip, Extract, Add.
- **St** 4 · counts + zero states.
- **D** 3 · misleading per-coverage "Pricing" count.
- **A11y** 4 · buttons labelled.

### 7. Product › Forms — `/app/products/:id/forms`
The most polished data view: a clean table (Number, Name, Edition, Category, Dyn, States) with
mono form numbers/editions and color-coded category badges (Base Coverage / Amendatory /
Endorsement / Exclusion / Declarations / Policy Notice), search + category filter + count. Domain
truth is exact — coastal HO 03 12 shows only FL/GA/NC/SC/TX; CA/TX amendatories scope correctly;
12 forms. It is, however, static and the row-open affordance is subtle; names truncate.
- **L** 5 · textbook table layout.
- **T** 5 · mono numbers, colored categories.
- **S** 4 · comfortable rows.
- **C** 4 · category color system.
- **M** 2 · fully static.
- **I** 4 · category chips carry meaning.
- **A** 3 · row click/hover under-signalled.
- **St** 4 · search, filter, count.
- **D** 5 · coastal/state scoping exact; 12 forms.
- **A11y** 4 · header semantics.

### 8. Product › Pricing — `/app/products/:id/pricing`
§8D is a genuine showpiece: a grouped inputs panel drives a live trace that proves the
`$1,528` derivation, with per-step op badges, grounded source expressions
(`HO.RT.001[territory=T002]`), running totals, a Flow/Table toggle, SVG export, "Reset to
$1,528", and honest inline gating ("Wind/hail deductible not available for OH [HO.RU.008]",
Cov F $5,000 blocked below Cov E $300k [HO.RU.006]). Recompute is live and correct (verified
T005 → $2,123). Two gaps: **§10.2's Excel-like ≤3-dimension table-step editor is absent** (the
"Table" view is only the trace as a table), and the *flow* view mixes decimal precision
(`$1,147.70` vs `$1,147.7`) and overlaps a running total on the connector.
- **L** 5 · two-column worksheet.
- **T** 4 · strong; flow decimal inconsistency.
- **S** 4 · flow total overlaps connector in spots.
- **C** 5 · gradient final-premium block.
- **M** 5 · flow-step-in, live counter.
- **I** 5 · in-house rating-flow SVG + export.
- **A** 5 · selects/checkboxes/reset/toggle all clear.
- **St** 4 · skeletons + no-program empty.
- **D** 5 · live $1,528; grounded hints; T005→$2,123 correct.
- **A11y** 4 · labelled controls, tablist toggle. (Note: §10.2 grid missing — see gaps.)

### 9. Product › States — `/app/products/:id/states`
§8E delivers a signature: a bespoke US tile-map with an accurate geographic grid, footprint
selection in violet, coastal wind/hail lightning badges (FL/GA/NC/SC/TX), a clear legend
(In footprint / Coastal / Not filed), "15 states selected · All footprint · Clear", and SVG
export. The full A–Z chip strip beneath duplicates the map's information, and there is a large
empty region below. Keyboard operability of the tiles needs confirming.
- **L** 4 · map + chip strip somewhat redundant; empty lower.
- **T** 4 · mono state codes.
- **S** 4 · balanced map.
- **C** 4 · footprint/coastal palette clear.
- **M** 3 · fills only.
- **I** 5 · bespoke tile map + coastal badges is a highlight.
- **A** 4 · All footprint/Clear, tiles, chips.
- **St** 4 · selection count + export.
- **D** 5 · 15 footprint / 5 coastal exact; counts against footprint.
- **A11y** 3 · tile keyboard selection/labels unverified.

### 10. Product › Rules — `/app/products/:id/rules`
Grounded IF→THEN cards grouped by category (Product 7, Rating 3) with refId chips, category/
subcategory badges, and related coverage/form/LD chips; a Simulate panel and New rule composer
exist. Domain truth is exact (HO.RU.001–010; HO.RU.006 "Coverage F $5,000 → requires Coverage E
≥ $300,000"). Weaknesses: card heights are ragged (rules with no chips leave dead space), the
inner IF/THEN panels use a heavy lavender fill, and this route still imports `lucide-react`
(`CheckCircle`, `AlertTriangle`, `AlertCircle`).
- **L** 4 · grouped cards; ragged heights.
- **T** 4 · IF/THEN legible.
- **S** 3 · heavy inner fills; uneven cards.
- **C** 4 · category color coding.
- **M** 2 · static.
- **I** 3 · lucide icons in `ProductRules.tsx:5`.
- **A** 4 · Simulate, New rule, search.
- **St** 4 · grouped/empty handled.
- **D** 5 · refId/form chips; constraints correct.
- **A11y** 4 · reasonable.

### 11. AI Builder — `/app/builder`  ⚠ STUB
A `StubRoute` empty state ("Generate product structures … with Claude — coming soon.",
`App.tsx:66`) with a faint dotted grid and a lucide `Wand2`. It is a prominent Workspace nav
item pointing at nothing — the biggest credibility gap for an "AI-native" product.
- **L** 2 · lone centered empty state. **T** 3 · fine copy. **S** 2 · vast void.
- **C** 2 · flat. **M** 2 · static dots. **I** 2 · lucide placeholder glyph.
- **A** 1 · no action at all. **St** 2 · only an empty state, no real states.
- **D** 1 · zero domain content. **A11y** 3 · text legible.

### 12. Explorer — `/app/explorer`
Functional but **wrong shape**: a flat searchable card grid with type-filter tabs (All 49 /
Products 1 / Coverages 10 / Forms 12 / Rules 0 / LD 6 / RT 10 / Dictionary 10) and Fuse.js
fuzzy search (`Explorer.tsx`). §8F/§10.3 mandate a cascading products → coverages →
sub-coverages Miller-columns browser with a breadcrumb and peek panel — none of that is here.
The "Rules 0" tab is a live-confirmed traceability bug (searchIndex has no rule entries), and it
imports seven lucide icons.
- **L** 2 · flat grid, not the mandated column browser.
- **T** 4 · titles + mono subtitles.
- **S** 4 · even card grid.
- **C** 3 · plain cards.
- **M** 2 · static.
- **I** 3 · lucide icons (`Explorer.tsx:7`).
- **A** 3 · cards navigate; tabs + search.
- **St** 4 · skeleton, empty, 90-cap note.
- **D** 3 · "Rules 0" — rules unindexed.
- **A11y** 4 · focus-visible outlines on cards.

### 13. Tasks — `/app/tasks`
A clean four-lane kanban (Ideation & Design / Build & File / Test & Approve / Launch & Monitor)
matching the seeded eight-task lifecycle with due dates (D+7…D+110), Board/List toggle, and
Mine/Overdue/product filters. Cards omit checklist progress and assignees, and the board leaves
a large empty area below with only two cards per lane. Uses lucide (LayoutGrid/List/CheckSquare/
Filter).
- **L** 4 · standard board; empty below. **T** 4 · clear. **S** 3 · sparse lanes.
- **C** 4 · lane headers + card chips. **M** 3 · (drag only). **I** 3 · lucide toolbar.
- **A** 4 · toggle/filters/cards. **St** 4 · filters + empty. **D** 5 · seed lifecycle exact.
- **A11y** 4 · fine.

### 14. News — `/app/news`
A tidy shell: "Market News — curated nightly by an AI agent", a natural-language "What should the
agent track?" preference textarea + Save, Refresh now, and an excellent empty state explaining the
06:00 ET nightly agent. Static and lucide-iconed (Newspaper/RefreshCw/ExternalLink/Sparkles), but
the concept and empty state are strong; the scheduled agent is real (`functions/src/news.ts`).
- **L** 4 · preference card + empty state. **T** 4 · clear. **S** 4 · fine.
- **C** 4 · restrained. **M** 2 · static. **I** 3 · lucide set.
- **A** 4 · textarea/Save/Refresh. **St** 5 · best-in-app empty state. **D** 4 · HO-3/TX/FL prompt.
- **A11y** 4 · labelled.

### 15. Claims Analysis — `/app/claims`  ⚠ STUB
A `StubRoute` ("Loss-ratio trends and emerging risk signals.", `App.tsx:70`) with a lucide
`BarChart3` and dotted grid. A prominent Intelligence nav item pointing at nothing.
- **L** 2 · lone empty state. **T** 3 · copy fine. **S** 2 · void.
- **C** 2 · flat. **M** 2 · static. **I** 2 · lucide placeholder.
- **A** 1 · no action. **St** 2 · only empty. **D** 1 · no content. **A11y** 3 · legible.

### 16. Data Dictionary — `/app/dictionary`
Card grid of the ten seeded canonical fields with color-coded type badges (Currency/List/Date/
Text), descriptions, format/allowed-value chips, and tags; search + type filters + New field. Matches
`docs/DOMAIN_HO.md` exactly. Card heights are uneven (short cards leave gaps) and it uses lucide
(BookOpen/Plus/Search/Trash2/Link2).
- **L** 4 · card grid; uneven heights. **T** 4 · type badges + mono format. **S** 3 · ragged.
- **C** 4 · typed color system. **M** 2 · static. **I** 3 · lucide set.
- **A** 4 · search/filter/new. **St** 4 · handled. **D** 5 · 10 fields match spec. **A11y** 4.

### 17. Feedback — `/app/feedback`
A well-modelled backlog board (New / Reviewing / Backlog·Planned) with type badges (Idea/Issue/
Praise), vote counts + upvote, a priority bar, impact/effort dot meters, a Move… lane selector,
a drag handle on Planned, and auto-captured route context links — faithful to the DATA_MODEL
feedback shape. Lanes are sparse (one card each) and it uses six lucide icons. (One seed item is
intentionally stale — it claims the pricing trace "does not display it yet," which it now does.)
- **L** 4 · lanes; sparse. **T** 4 · clear. **S** 3 · one card/lane.
- **C** 4 · type/priority coloring. **M** 3 · (drag). **I** 3 · lucide set.
- **A** 4 · vote/move/drag/context. **St** 4 · lanes handled. **D** 4 · refId/route context.
- **A11y** 4 · fine.

### 18. Admin / Settings — `/app/admin`
Tabs Users / Audit Log / Seed Report / Settings; the Users tab lists the three seed users with a
role `<select>`, a role badge, Deactivate, and New user — role management is real (not UI-only;
the Firestore 403 on unauthenticated reads confirms rules enforce access). Empty lower region;
uses six lucide icons.
- **L** 4 · tabs + user rows; empty below. **T** 4 · clear. **S** 3 · sparse.
- **C** 4 · role badges. **M** 2 · static. **I** 3 · lucide set.
- **A** 4 · role dropdown/deactivate/new. **St** 4 · tabbed. **D** 5 · 3 users, 3 roles, audit/seed tabs.
- **A11y** 4 · labelled controls.

### 19. Change password — `/must-change-password`
Calm centered card ("Set a new password" / "Your account requires a password change …") with New
+ Confirm fields (min-8 hint), a warn "!" glyph, and a primary Set-password action; enforced for the
temp-password admin. Sits above optical center with empty space below; static.
- **L** 4 · centered; top-heavy. **T** 5 · clean. **S** 4 · comfortable card.
- **C** 4 · warn accent. **M** 2 · static. **I** 4 · warn glyph.
- **A** 5 · unambiguous. **St** 4 · min-length/match validation + toast. **D** 4 · forced-change gate.
- **A11y** 4 · labelled inputs.

---

## Scoreboard (1–5 per axis)

| Route | L | T | S | C | M | I | A | St | D | A11y | Avg |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Landing | 4 | 5 | 4 | 5 | 5 | 5 | 4 | 3 | 5 | 4 | 4.4 |
| Sign-in | 4 | 5 | 4 | 4 | 3 | 4 | 5 | 4 | 4 | 4 | 4.1 |
| Home | 3 | 4 | 3 | 4 | 3 | 3 | 4 | 4 | 5 | 4 | 3.7 |
| Products | 3 | 4 | 3 | 4 | 3 | 3 | 4 | 4 | 5 | 4 | 3.7 |
| Overview | 4 | 5 | 4 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 3.9 |
| Coverages | 4 | 4 | 3 | 3 | 3 | 3 | 4 | 4 | 3 | 4 | 3.5 |
| Forms | 5 | 5 | 4 | 4 | 2 | 4 | 3 | 4 | 5 | 4 | 4.0 |
| Pricing | 5 | 4 | 4 | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 4.6 |
| States | 4 | 4 | 4 | 4 | 3 | 5 | 4 | 4 | 5 | 3 | 4.0 |
| Rules | 4 | 4 | 3 | 4 | 2 | 3 | 4 | 4 | 5 | 4 | 3.7 |
| AI Builder | 2 | 3 | 2 | 2 | 2 | 2 | 1 | 2 | 1 | 3 | 2.0 |
| Explorer | 2 | 4 | 4 | 3 | 2 | 3 | 3 | 4 | 3 | 4 | 3.2 |
| Tasks | 4 | 4 | 3 | 4 | 3 | 3 | 4 | 4 | 5 | 4 | 3.8 |
| News | 4 | 4 | 4 | 4 | 2 | 3 | 4 | 5 | 4 | 4 | 3.8 |
| Claims | 2 | 3 | 2 | 2 | 2 | 2 | 1 | 2 | 1 | 3 | 2.0 |
| Dictionary | 4 | 4 | 3 | 4 | 2 | 3 | 4 | 4 | 5 | 4 | 3.7 |
| Feedback | 4 | 4 | 3 | 4 | 3 | 3 | 4 | 4 | 4 | 4 | 3.7 |
| Admin | 4 | 4 | 3 | 4 | 2 | 3 | 4 | 4 | 5 | 4 | 3.7 |
| Change pw | 4 | 5 | 4 | 4 | 2 | 4 | 5 | 4 | 4 | 4 | 4.0 |

**Column averages:** L 3.7 · T 4.2 · S 3.4 · C 3.9 · M 2.8 · I 3.4 · A 3.9 · St 3.8 · D 4.1 · A11y 3.9.
Weakest axes app-wide: **Motion (2.8)**, **Spacing/density (3.4)**, **Iconography/SVG (3.4)** — the
last dragged down almost entirely by residual `lucide-react`.

---

## Biggest gaps (prioritized)

1. **Ship or hide the two dead stubs.** AI Builder (`App.tsx:66`) and Claims Analysis
   (`App.tsx:70`) are top-level nav items that render "coming soon." For an AI-native pitch,
   AI Builder especially must become real (§9/§10.1 patterns already exist to borrow).
2. **Rebuild Explorer as the §8F/§10.3 Miller-columns browser** (products → coverages →
   sub-coverages, breadcrumb, peek panel, keyboard nav). It is still a flat Fuse grid.
3. **Implement §10.2 in Pricing** — the Excel-like ≤3-dimension RT/LD table-step editor
   (dimension picker, grid, TSV paste, keyboard nav) that persists via `mutate()` and keeps
   `$1,528` correct. The "Table" toggle today is only a trace table.
4. **Remove all `lucide-react`** (15 files, 42 icons — inventory below) and standardise on
   `components/ui/icons.tsx`. This alone lifts the Iconography axis across ~10 routes.
5. **Index rules in searchIndex** so ⌘K and Explorer can find them (Explorer "Rules 0" is a
   live-confirmed hole); verify `mutate()`/seed emit `type:'rule'` entries.
6. **Fix the domain-truth display bugs:** Coverage C "% of A" → "50%" not "$50"
   (`CoverageCollection.tsx:16` + seed term `unit/basis`); make the coverage "Pricing" count
   coverage-specific, not the whole program's step total (`coverageAspects.ts:34`); unify
   Pricing-flow decimals (`$1,147.70` vs `$1,147.7`).
7. **Add app-wide motion.** Interior list/table/board routes (Forms, Rules, Tasks, Dictionary,
   Admin, Explorer) are static; add entrance stagger and hover/focus micro-interactions per §7.
8. **Rebalance sparse-data layouts.** Home (center chat dead band), Products/Tasks/Feedback/
   Dictionary/States all leave large empty regions on the single-product seed; and Landing's
   hero→cards mid-page void.
9. **Tighten the product header banner** — it is tall/heavy and its right-edge gradient washes
   over the Comments/History/Export/Share actions across all six product tabs.
10. **Polish Coverages** — lift stat-tile icon contrast and fix the hover edit/delete toolbar
    that renders as a black block over the card.
11. **Improve States a11y** — confirm/finish keyboard selection and per-tile labels on the map.
12. **Reconcile docs** — `CLAUDE.md` still documents the old magenta gradient
    (`#C026D3→#EC4899`) vs the shipped violet; restore `docs/ELEVATION_PROMPT.md` (the live spec)
    to the tree.

---

## `lucide-react` inventory (grep of `app/src`)

Still imported in **15 files** — **42 distinct icons** (plus the `LucideIcon` type). §7.2/§12
require zero. The in-house replacement family already exists at
`app/src/components/ui/icons.tsx`.

| # | File | Line | Imported from `lucide-react` |
|---|---|---|---|
| 1 | `app/src/App.tsx` | 7 | `Wand2`, `BarChart3` |
| 2 | `app/src/components/ErrorBoundary.tsx` | 5 | `AlertTriangle` |
| 3 | `app/src/components/product/CommentsPanel.tsx` | 4 | `CheckCircle` |
| 4 | `app/src/routes/Admin.tsx` | 6 | `Shield`, `Plus`, `UserX`, `UserCheck`, `Search`, `FileClock` |
| 5 | `app/src/routes/Dictionary.tsx` | 7 | `BookOpen`, `Plus`, `Search`, `Trash2`, `Link2` |
| 6 | `app/src/routes/Explorer.tsx` | 7 | `Search`, `Database`, `FileText`, `Hash`, `BookOpen`, `CheckSquare`, `Package` |
| 7 | `app/src/routes/Feedback.tsx` | 13 | `Lightbulb`, `Bug`, `Heart`, `ArrowBigUp`, `Link2`, `GripVertical` |
| 8 | `app/src/components/product/ExportMenu.tsx` | 6 | `Download`, `FileSpreadsheet`, `FileCode2`, `ChevronDown` |
| 9 | `app/src/components/product/HistoryDrawer.tsx` | 4 | `RotateCcw`, `ChevronDown`, `ChevronRight` |
| 10 | `app/src/routes/News.tsx` | 6 | `Newspaper`, `RefreshCw`, `ExternalLink`, `Sparkles` |
| 11 | `app/src/components/product/RuleBuilder.tsx` | 8 | `ArrowRight`, `Plus`, `X` |
| 12 | `app/src/components/product/ShareModal.tsx` | 3 | `Copy`, `Check`, `ExternalLink`, `Loader2` |
| 13 | `app/src/routes/stub/StubRoute.tsx` | 3 | `type LucideIcon` (type only) |
| 14 | `app/src/routes/Tasks.tsx` | 12 | `LayoutGrid`, `List`, `CheckSquare`, `Filter` |
| 15 | `app/src/routes/product/ProductRules.tsx` | 5 | `CheckCircle`, `AlertTriangle`, `AlertCircle` |

Distinct icons (42): AlertCircle, AlertTriangle, ArrowBigUp, ArrowRight, BarChart3, BookOpen,
Bug, Check, CheckCircle, CheckSquare, ChevronDown, ChevronRight, Copy, Database, Download,
ExternalLink, FileClock, FileCode2, FileSpreadsheet, FileText, Filter, GripVertical, Hash,
Heart, LayoutGrid, Lightbulb, Link2, List, Loader2, Newspaper, Package, Plus, RefreshCw,
RotateCcw, Search, Shield, Sparkles, Trash2, UserCheck, UserX, Wand2, X.

---

## Appendix — verified findings with citations

- **$1,528 canary** — passes (`shared/src/rating/evaluator.test.ts`); live trace and
  T005→$2,123 recompute both correct.
- **Coverage C "% of A" → "$50"** — `app/src/components/product/CoverageCollection.tsx:12-19`
  formats a numeric term as `$${v}` unless `t.unit === '%'` / `t.basis` contains "percent"; the
  seed's Coverage C term isn't flagged percent, so 50 prints as "$50" on Overview.
- **"Pricing 14" on every rated coverage** — `app/src/components/product/coverageAspects.ts:34`:
  `pricing: cov.premiumGenerating ? ratingProgram.steps.length : 0` (program-wide, not per-coverage).
- **Explorer "Rules 0"** — `app/src/routes/Explorer.tsx:80` counts `searchIndex` entries of
  `type:'rule'`; the seed emits none, so ⌘K + Explorer cannot surface any rule.
- **Stubs** — `app/src/App.tsx:66` (`/app/builder`), `:70` (`/app/claims`) both render `StubRoute`.
- **Missing §10.2 grid** — `app/src/routes/product/ProductPricing.tsx:53-135` (`TracePanel`): the
  "Table" view is a read-only trace table, not a dimension/grid editor.
- **Flat Explorer vs §10.3** — `app/src/routes/Explorer.tsx` (Fuse grid + tabs, no Miller columns).
- **Roles enforced server-side** — unauthenticated Firestore REST `list` returns 403
  PERMISSION_DENIED (rules, not UI-only).
- **Design tokens vs docs** — `app/src/index.css:22-51` ships violet `#A100FF→#7A00E6`;
  `CLAUDE.md` design section still lists magenta `#C026D3→#EC4899`.
- **No console/page errors** observed across the full driven session.
