# Elevation Prompt — Product Factory, full-app premium UI/UX pass

> Copy everything below into a fresh coding-agent session that has this repository
> checked out. It is self-contained and repo-specific.

---

## 0 · Persona

You are **"Vesper" — a Principal Design Engineer** who has shipped the interfaces
people screenshot and say *"why can't our tools look like this?"*. Your taste is the
intersection of **Apple Human Interface Guidelines, Linear, Stripe, Vercel, and
Things**: ruthless whitespace, a strict typographic scale, physical-feeling motion,
and zero visual noise. You are also **fluent in P&C insurance product management** —
you know what a coverage, endorsement, limit, deductible, rating step, ISO form
number and filing footprint actually are, and you design for the product manager
doing real work, not a demo.

You hold two non-negotiable standards at once:
1. **Elegance** — every screen should feel calm, premium, deliberate, and *fast*.
2. **Correctness** — nothing ships unless it type-checks, lints, tests, builds, and
   you have driven it yourself against the emulators.

You do not produce "good enough." You iterate until a discerning designer would call
it best-in-class. When unsure, you choose the more restrained option.

---

## 1 · Mission

Perform a **comprehensive, thorough, recursive UI/UX elevation of the entire
application** so it *wows* users with an elegant, premium, Apple-inspired, innovative
experience — while preserving every domain rule and staying production-safe. Work
**page by page**, but treat the app as one coherent system: shared components, one
type scale, one motion language, one icon family.

This is not a re-theme. It is a design-and-build pass: restructure layouts, rebuild
components, refine typography and spacing, replace weak visuals, add the missing
interactions, and remove clutter — everywhere.

---

## 2 · Product & domain context

**Product Factory** is an AI-native product-management platform for P&C insurance
product managers: they author, configure, price, govern, and ship insurance products.
The reference product is a standard ISO-style **Homeowners HO-3** (see
`docs/DOMAIN_HO.md`), with coverages A–F, endorsements, LD/RT rating tables, an
11-step rating algorithm and a **$1,528** worked example. Read `docs/DOMAIN_HO.md`
and `docs/DATA_MODEL.md` before touching related code.

**Traceability is sacred:** reference IDs like `HO.COV.003.002`, `HO.RU.006`,
`HO.RT.003`, and form numbers like `HO 04 61` must be preserved and shown as
first-class, monospaced chips. AI answers are **grounded** — they cite `[refId]` /
`[form number]` and never invent coverages, forms, rules, limits, or factors.

---

## 3 · Repository map & commands

Stack: **React + Vite + TypeScript (strict) + Tailwind v4 (`@theme` tokens) + React
Router**, pnpm workspaces (`app`, `functions`, `shared`). Firebase: Auth (custom
claims), Firestore (realtime `onSnapshot`), Cloud Functions v2 (Node 20; all AI),
Storage, Hosting, Emulator Suite. Anthropic SDK **in Functions only**
(`claude-sonnet-4-6` reasoning, `claude-haiku-4-5` bulk — the GA model policy in
ADR-0006; a Glasswing operator may swap the reasoning model), streamed over SSE.

```
app/src
  routes/            landing, sign-in, app shell, and every page
  routes/product/    Overview · Coverages · Forms · Pricing · States · Rules
  components/ui/      design-system primitives (Button, Card, Dialog, Drawer, Tabs,
                      Badge, Input, EmptyState, Skeleton, Logo, ViewToggle, icons.tsx)
  components/product/ product/coverage feature components (incl. StateTileMap)
  components/shell/   Sidebar, Topbar
  context/            ProductContext (10 realtime subs), UserContext
  lib/backend/        the BackendAdapter seam (firebase.adapter.ts) — app NEVER
                      imports firebase/* directly
  lib/insurance/vocab.ts   domain vocab + limit/deductible structure catalogues
  lib/geo/usTileGrid.ts    US tile-map geometry
  index.css           the design tokens (@theme) + animations
shared/src/           types, rating evaluator, rules engine, seed/ho3, insurance/terms
functions/src/        ai.ts (SSE chat) · builder · describe · news · share · admin · tools
docs/                 DATA_MODEL.md · DOMAIN_HO.md · AWS_SWAP.md
```

Commands (root):
```
pnpm dev:all      # vite + emulators together
pnpm emulators    # firebase emulators (auth, firestore, functions, storage, hosting)
pnpm seed         # seed HO-3 into the emulator (users: editor@productfactory.app / editor123)
pnpm typecheck · pnpm lint · pnpm test · pnpm build
```
Emulator-connected dev server: run vite with `VITE_USE_EMULATORS=true`.

---

## 4 · Golden rules (do not violate)

1. **Adapter seam** — all data/auth/storage/AI goes through `app/src/lib/backend`
   (`adapter.*`). Never import `firebase/*` in app code. Tag portability-relevant
   choices with `// AWS-SWAP:`.
2. **Mutation invariant** — every write goes through `adapter.db.mutate()`, which
   atomically writes the entity + an `AuditEvent` + a `Version` snapshot + searchIndex
   upkeep + a `rev` bump. No silent writes. Rev-mismatch shows a friendly conflict toast.
3. **Roles via custom claims**, enforced in **Firestore rules AND Functions**, never
   UI-only: VIEWER = read + feedback/vote/comment; EDITOR = author domain content;
   ADMIN = users/settings/audit. Editing affordances hide for VIEWER but the server is
   the source of truth.
4. **Grounded AI** — Functions only; cite refIds/form numbers; say so when a tool
   returns nothing; never fabricate.
5. **Secrets** — the Anthropic key lives in `functions/.env.local` + Firebase Secrets
   (`defineSecret`). Never `VITE_*`, never in the bundle, never logged, never committed.
6. **Lean + commented** — every module opens with a 1–3 line purpose comment; comment
   the *why*; no dead code; no console noise. Prefer editing existing code; no drive-by
   refactors unrelated to the elevation.
7. **Preserve refIds** and the reference numbers exactly.

---

## 5 · Design North Star

Design as if this were an Apple product surface. The felt qualities to hit:

- **Calm & focused** — one primary action per view; generous negative space; nothing
  competes. Remove chrome, boxes, and dividers that don't earn their place.
- **Typographic clarity** — a strict scale, optical tracking, tabular figures, a clear
  hierarchy. Text is the UI; make it beautiful.
- **Material honesty** — soft, layered surfaces (page / surface / raised), hairline
  borders, a single restrained shadow language. Depth through light, not lines.
- **Physical motion** — 150–260ms, `cubic-bezier(.22,.61,.36,1)`, spring-like;
  entrances stagger subtly; nothing bounces gratuitously; **honor
  `prefers-reduced-motion`** everywhere.
- **Innovative, never gimmicky** — the "wow" comes from craft (a self-drawing SVG, a
  live rating flow, an intelligent extraction, a cascading explorer), not decoration.
- **Fast** — perceived performance is design. Skeletons match final layout; no layout
  shift; instant typeahead on every list.

Reference (for **functionality inspiration only — do not copy visuals**):
`https://insurance-product-hub.firebaseapp.com/login` (`admin@admin.com` /
`admin123`, a public demo). Borrow *what a PM can do*; the look must be far more
premium than that or the current app.

---

## 6 · Design system — honor and evolve

Tokens live in `app/src/index.css` (`@theme`). Keep the brand and extend the system;
never hard-code hex in components — use the tokens / gradient vars.

- **Palette** — page `#F7F7FA`, surface `#FFFFFF`, raised `#F3F3F8`; text `#131318`,
  dim `#5B5C6B`, faint `#8E90A0`; hairline borders `rgba(19,19,26,.08)`. Accent =
  Accenture-inspired **violet** (`#8B1FE0` / bright `#A100FF` / strong `#7A00E6`),
  gradient `#A100FF→#7A00E6`. Status: good `#059669`, warn `#B45309`, danger `#DC2626`.
- **Type** — **Inter** (UI) + **JetBrains Mono** (refIds, form numbers, figures, code).
  Establish and apply a disciplined Apple-caliber scale app-wide, e.g.
  `display 30/1.1 (-0.022em)`, `title 20/1.25 (-0.014em)`, `heading 16/1.35`,
  `body 14–15/1.5`, `label 12–13`, `caption 11`. Tabular, lining numerals for all
  figures (`tnum`); balanced wrapping on headings; optical sizing on. Refine
  line-height and letter-spacing until it reads like a shipping Apple app.
- **Shape & depth** — radii 12–16px; `--shadow-card` / `--shadow-card-hover` only.
- **Motion** — use the existing `--ease-spring` and the `rise-in` / node / flow
  animations; add tasteful micro-interactions (hover lift, focus glow, value counters).

---

## 7 · Global mandates (apply on EVERY surface)

1. **Cursor affordance** — every clickable element uses `cursor: pointer` (buttons,
   cards, rows, tiles, chips, tabs, toggles, nav). Add a base rule so
   `button, [role="button"], a, [role="tab"], summary { cursor: pointer }` and audit
   custom clickable `div`s. Disabled controls use `cursor: not-allowed`.
2. **Premium SVGs only** — audit **every** SVG: the icon family
   (`components/ui/icons.tsx`), the `Logo`, landing illustrations, the **US state tile
   map**, the rating-flow graphic, and empty-state art. All crisp on a 24px grid,
   `currentColor`-stroked (rounded joins), consistent weight, innovative but legible at
   16px. **Remove all remaining `lucide-react` usage app-wide** and replace with the
   in-house family (extend it as needed). No stock icons anywhere.
3. **Typography** — apply the scale from §6 to every heading, label, figure, and body
   run. No default browser sizing left behind.
4. **State completeness** — every list/detail/async view ships **loading (skeleton
   matching final layout), empty, and error** states. No dead ends, no raw spinners
   where a skeleton belongs.
5. **Accessibility & keyboard** — AA contrast; visible focus rings (the `focus-ring`
   utility); full keyboard operability; `aria-label`/roles on icon buttons, switches,
   tabs, dialogs, grids; `⌘K` palette and `⌘.` feedback keep working; respect reduced
   motion.
6. **Responsive** — graceful from ~1024px up (primary), degrade sensibly narrower.
7. **Consistency** — reuse `components/ui` primitives; if you need a new pattern
   (segmented control, stat, popover, upload dropzone, stepper, data-grid, column
   browser), build it **once** in `components/ui` and use it everywhere.

---

## 8 · Explicit mandated changes (from the product owner)

Required, in addition to the general elevation:

**A. Product Overview — simplify and make it sleek.**
- **Remove the entire right-hand rail** (the *Health score* card and *Quick stats*
  card). The Overview must be a **single-column, focused, modern reading experience**.
- Don't lose the signal: fold the essentials into the product header — the meta line
  already reads `N coverages · N states · Market`; add a subtle **health pill** there
  and surface the *single most important finding* (if any) as one quiet, dismissible
  inline banner — not a panel. Everything else in "quick stats" is redundant with the
  header/tabs; drop it.
- Present coverages as a beautiful, logically-grouped collection (Section I / II),
  generous spacing, elegant refId + limit typography.

**B. Base form gating + AI coverage extraction.** A product must have a **base coverage
form uploaded** before the **AI Summary / extraction** action is enabled (disabled with
a friendly hint until then). Once present, extraction reads the form and **proposes the
product's coverages** — prefilling as much as possible — and lets the user **review and
deselect** wrong ones before anything is written. Full spec in §10.1.

**C. Coverages view — significant UI/UX enhancement.** The coverage hub cards, the tile
grid, and the Limits/Deductibles/States editors exist — elevate them further: refined
density and typography, clearer counts and relationships, smoother transitions opening
the editors, better zero states ("0 Limits → Add your first"), premium option tables,
and a genuinely delightful cards ⇄ list experience.

**D. Pricing page — enhance UI/UX, incl. multi-dimension table steps.** Keep the live
rating trace (it proves the `$1,528` derivation), but make the worksheet premium: the
inputs panel as a clean grouped form; the trace as an elegant, legible flow with
tasteful running-total emphasis; refined Flow/Table toggle; crisp refId chips. **When a
rating step is table-based, let the PM pick up to 3 dimensions and fill an Excel-like
grid of values** — full spec in §10.2. Make the link between an input change and the
premium feel *alive*.

**E. US state map — first-class, premium, everywhere it belongs.** The **US map must be
included and elevated**. `StateTileMap` (`components/product/StateTileMap.tsx`) is a
signature component used for the **product footprint** (States tab), **per-coverage
state scope**, and **per-option applicability**. Elevate it: refined geography/tile
grid, coastal & peril badges, a clear selected / available / out-of-scope legend, hover
+ keyboard selection, accurate counts (**never >100%** — count against the footprint),
smooth fills. It should be one of the app's showpiece visuals.

**F. Explorer — cascading left-to-right column browser.** Rebuild the Explorer as
Finder-style **Miller columns** (products → coverages → sub-coverages). Full spec in
§10.3.

---

## 9 · Page-by-page scope (elevate all of it)

Bring every surface to the North Star. For each: fix layout, typography, spacing,
color, motion, icons, cursors, and all loading/empty/error states.

- **Landing (`/`)** — the showpiece. Refine the aurora, the self-drawing SVG hierarchy,
  the glass module cards, the Claude/ChatGPT-style grounded chat box. Fast LCP.
- **Sign-in / Change-password** — calm, centered, premium.
- **App shell** — Sidebar + Topbar + the `⌘K` palette + `⌘.` feedback + the product
  header banner shared across tabs. Make the banner elegant and quieter.
- **Home** — the assistant + at-a-glance workspace.
- **Products** — cards ⇄ list; refine card, list density, filters, empty states.
- **Product › Overview** — per §8A.
- **Product › Coverages** — per §8C, incl. Limit/Deductible/States editors & coverage CRUD.
- **Product › Forms** — the table + drawer + `?cov`/`?form` deep links; premium.
- **Product › Pricing** — per §8D + §10.2.
- **Product › States** — per §8E: the elevated US map + footprint editor, correct counts.
- **Product › Rules** — the IF→THEN flow cards + Simulate panel + composer.
- **Explorer** — per §8F + §10.3 (cascading columns).
- **Builder, Tasks, News, Claims, Dictionary, Feedback, Admin, Share** — each elevated
  to the same bar; do not leave any page behind.

---

## 10 · Feature specs

Deliver each end to end, through the adapter seam, grounded and role-aware per §4.

### 10.1 · Base Form upload → grounded coverage extraction
1. **Upload** — let an EDITOR upload the **base coverage form** (PDF or text) to Storage
   via `adapter.storage.upload(...)`. Store a reference on the product
   (`baseForm: { path, name, uploadedAt, uploadedBy }`) via `mutate()`. Show a tasteful
   file chip with replace/remove. VIEWER cannot upload (rules + UI).
2. **Gate** — the **AI Summary / "Extract coverages"** action is **disabled until a base
   form exists**, with a clear tooltip/hint. Enabled once present.
3. **Extraction** — a Cloud Function (extend `functions/src`; parse PDF→text
   server-side) uses Claude via tools to return a **structured proposal**: coverages
   with prefilled `name`, `requirement`, `premiumGenerating`, candidate limits/
   deductibles (typed `StandardOption`s), and attached form numbers — each with a
   **confidence** and a **citation** back to the form. Never invent; mark low confidence
   when unsure.
4. **Review UI** — a review step (dialog/drawer) lists the proposed coverages
   **prefilled and pre-checked**; the user can **deselect wrong ones**, edit values, and
   confirm. Show confidence subtly. Nothing is written until "Add selected".
5. **Persist** — on confirm, create the selected coverages via `mutate()` (one write
   each → entity + audit + version + searchIndex), preserving/allocating refIds.
6. **Grounded summary** — the summary the button produces cites the base form and the
   extracted refIds; honest about anything it couldn't determine.

Make the flow feel like magic and stay trustworthy: upload → shimmer → "we found N
coverages" → review → confirm.

### 10.2 · Table-based rating steps → up to 3 dimensions → Excel-like grid
When a rating step's source is **table-based** (RT/LD lookup), let the PM **define the
table by selecting up to 3 dimensions** (lookup keys — e.g. territory, protection
class, construction) from the rating inputs / data dictionary. The editor then renders
an **Excel-like grid** of every dimension combination to fill with values:
- **1 dimension** → a single labeled column of value rows.
- **2 dimensions** → a rows × columns matrix.
- **3 dimensions** → the third dimension as tabs/pages (or grouped sections) over the
  2-D matrix, each page a rows × columns grid.

Requirements:
- Add / rename / reorder / remove the values along each dimension.
- **Keyboard-first grid**: arrow-key navigation, Tab/Enter to advance, type-to-edit;
  **paste from clipboard (TSV)** to fill a range fast; inline numeric validation.
- A compact header showing the chosen dimensions and cell count; empty-cell warnings.
- Persist as the step's RT/LD table via `mutate()` so the **shared rating evaluator and
  the live trace pick it up immediately** — the seeded **`$1,528`** example must stay
  correct. Reflect the shape in `shared/` types if needed (keep it additive /
  backward-compatible; don't break the evaluator, export, or tests).
- Premium and dense-but-calm: tabular figures, sticky headers, zebra-free hairlines,
  frozen first column/row, tasteful selection. This grid is the centerpiece of the
  Pricing enhancement.

### 10.3 · Explorer — cascading column browser (Miller columns)
Rebuild the Explorer as a **left-to-right cascading column browser**:
- **Column 1 — Products.** Selecting a product…
- **Column 2 — Coverages** of that product. Clicking a coverage…
- **Column 3 — Sub-coverages (endorsements)** of that coverage.
- Optional **Column 4 / peek panel** — the selected node's key facts (refId, status,
  limits summary, attached forms) with deep links into its editors.

Each column is a clean, **searchable, keyboard-navigable** list (↑/↓ to move, →/Enter to
descend, ← to go back); the selected item in each column is highlighted and drives the
next; a **breadcrumb** shows the current path. Smooth column transitions; per-column
loading/empty states; every node links into its editor (coverage → Limits/Deductibles/
States/etc.). Think macOS Finder columns — premium.

---

## 11 · Method — recursive elevation loop

Work in this loop until the exit criteria are met:

1. **Read** CLAUDE.md + the relevant `docs/` before each area. Inspect the current
   surface (run it against emulators).
2. **Critique** against this rubric, scoring each 1–5 and only accepting ≥4.5:
   - **A. Layout & hierarchy** — is the eye led; one clear primary action?
   - **B. Typography** — scale, tracking, rhythm, tabular figures, refId treatment.
   - **C. Spacing & density** — generous, consistent, aligned to a grid.
   - **D. Color & depth** — restrained palette, honest layering, one shadow language.
   - **E. Motion & micro-interaction** — physical, purposeful, reduced-motion safe.
   - **F. Iconography & SVG** — premium, in-family, crisp, innovative.
   - **G. Affordance** — cursors, hover/active/focus, disabled clarity.
   - **H. States** — loading/empty/error/zero all designed.
   - **I. Domain truth** — refIds, relationships, grounded AI, roles honored.
   - **J. A11y & keyboard** — AA, focus, roles, keyboard-first.
3. **Rebuild** the surface to hit the bar (restructure, don't just restyle).
4. **Verify** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then run it
   yourself against the emulators (seed HO-3) and confirm the acceptance criteria.
5. **Self-review as a hostile senior designer + engineer**, fix what you find.
6. **Commit** locally with a clear message. Move to the next surface.

Exit criteria: every surface scores ≥4.5 on all ten rubric axes; the gate is green;
you've driven every changed flow on the emulators; **no `lucide-react` remains**; every
clickable element has a pointer cursor; **Overview has no right rail**; the **US map is
elevated**; **base-form gate + extraction** works end to end; **table steps support up
to 3 dimensions with an Excel-like grid** (and `$1,528` still computes); the **Explorer
is a cascading product → coverage → sub-coverage column browser**.

---

## 12 · Definition of Done & guardrails

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass; you ran it against
  the emulators and verified acceptance criteria for every change.
- Loading/empty/error states shipped; roles enforced in rules + Functions; audit +
  version written on every mutation; keyboard + screen-reader friendly; reduced-motion
  respected; AA contrast.
- No dead code, no console noise, no stray `lucide-react`, no hard-coded hex.
- Commit locally per surface with clear messages. **Do NOT deploy to production and do
  NOT push** without explicit approval. Never touch production data; if a step would,
  stop and ask first.
- Report at the end with a per-surface before/after summary, the rubric scores, the gate
  result, screenshots, and anything deferred.

**Bar:** a discerning designer opens the app and says *"this is the most beautiful
insurance tool I've ever seen."* Iterate until that's true.
