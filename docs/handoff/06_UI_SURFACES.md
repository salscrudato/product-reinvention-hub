# 06_UI_SURFACES.md — UI Surfaces, Routes, and Component Inventory

## Stack
React 19 + React Router v7 (lazy-loaded routes) + Tailwind CSS v4 (design-token-driven, all tokens in `app/src/index.css`). All route components are `React.lazy()`-split. `AppShell` wraps all authenticated routes; `Landing` and `MustChangePassword` are unshelled.

---

## Screen Inventory

### S01 — Landing (`/`)
**File:** `app/src/routes/Landing.tsx`
**Auth:** No
**Description:** Sign-in gate and app introduction. Contains a Firebase email/password login form, the app logo, and a brief product pitch. Anonymous visitors who do not sign in are auto-signed-in anonymously (read-only VIEWER). On successful sign-in, redirects to `/app`.

---

### S02 — Must Change Password (`/must-change-password`)
**File:** `app/src/routes/MustChangePassword.tsx`
**Auth:** Yes (all roles)
**Description:** Forced on first login when `user.mustChangePassword = true`. Blocks navigation to the main app until the password is changed via Firebase.

---

### S03 — AppShell (`/app`)
**File:** `app/src/routes/AppShell.tsx`
**Auth:** Yes
**Description:** Authenticated wrapper shell. Contains:
- Left sidebar navigation with links to all top-level routes
- Header bar with user identity, role chip, and notifications
- `VersionWatcher` — subscribes to `meta/` to detect catalogue staleness and show a soft reload banner
- `CaptureContext` provider — global feedback capture panel that can be opened from any screen via a floating button
- `<Outlet />` renders the current nested route

---

### S04 — Home / Dashboard (`/app` index)
**File:** `app/src/routes/Home.tsx`
**Auth:** Yes (all roles)
**Description:** Portfolio cockpit. Three regions:
1. **Portfolio AI Chat** — primary interaction surface. Full SSE streaming chat powered by `analyzeClaim` on the server. Features:
   - Single input box with send button and regenerate button
   - RAF-batched token rendering to avoid layout thrash during streaming
   - Per-session `sessionId` for cost-cap and semantic cache scoping
   - `Regenerate` button bypasses semantic cache for a fresh Sonnet call
   - `NoticeBanner` shown when budget is degraded or breaker open
   - Rendered citations are clickable: navigate to the entity in the explorer or product workspace
   - `aria-live` region announces stream completion for screen readers
2. **Priority Rail** (`PriorityRail`) — top-priority feedback items and overdue tasks shown as compact cards
3. **Portfolio Metrics** (`PortfolioMetrics`) — aggregate counts: products, coverages, forms, rules

---

### S05 — Products (`/app/products`)
**File:** `app/src/routes/Products.tsx`
**Auth:** Yes (all roles)
**Description:** Portfolio product browser. Three view modes switchable via icon toggle:
- **Card grid** — product cards showing name, LOB, lifecycle chip, coverage/form counts, AI-generated headline
- **List** — tabular compact list with sortable columns
- **Hierarchy** — coverage tree structure across all products

Filter bar: lifecycle filter chips (DRAFT / IN_REVIEW / APPROVED / LAUNCHED), LOB filter, search typeahead. Clicking a product card navigates to `ProductWorkspace`.

---

### S06 — Product Workspace (`/app/products/:id`)
**File:** `app/src/routes/product/ProductWorkspace.tsx`
**Auth:** Yes (all roles)
**Description:** Workspace shell for a single product. Loads all product sub-collections via `ProductProvider`/`useProductCtx` with Firestore real-time subscriptions. Contains:
- **Hero header**: product name (inline rename for EDITOR+), LOB chip, lifecycle chip, state count chip, refId chip
- **Sibling switcher**: dropdown showing other products in the same LOB; switches workspace without leaving the tab
- **Tab strip**: Overview · Coverages · Forms · Pricing · States · Rules
- **Side panels** (toggled via header action buttons):
  - `HistoryDrawer` — version history with diff viewer and one-click restore
  - `CommentsPanel` — threaded comments scoped to the product
  - `ExportMenu` — DuckCreek XML + Excel export options
- **`PromoteDraftDialog`**: lifecycle promotion flow (DRAFT → IN_REVIEW → APPROVED → LAUNCHED)
- `GlobalCommandBar` — ⌘K quick-action launcher available on all tabs
- `useCapture` publishes `{route, label, entityPath}` as feedback context for the capture panel

---

### S07 — Product Overview (`/app/products/:id/overview`)
**File:** `app/src/routes/product/ProductOverview.tsx`
**Auth:** Yes (all roles)
**Description:** AI-generated product summary with metadata. Calls `summarizeProduct` callable (haiku, cached). Displays:
- Headline summary card + highlight tiles (coverage count, form count, premium, states)
- Coverage highlights: top coverage names/notes
- Considerations section (AI-drafted caveats)
- Lineage chip (BLANK / IMPORT / CLONE / AI_SCAFFOLD) with source drill-down
- Base form metadata: form number, title, edition (from `identifyBaseForm` result)
- `Regenerate` button clears the `productSummaries` cache and re-runs the haiku call

---

### S08 — Product Coverages (`/app/products/:id/coverages`)
**File:** `app/src/routes/product/ProductCoverages.tsx`
**Auth:** Yes (all roles; EDITOR+ to edit)
**Description:** Coverage tree editor. Three view modes: **cards** / **list** / **tree** (toggled via icon strip).
- `FacetPanel` (collapsible left rail) — filter by requirement, premium-generating, source, status, state, search
- `CommandBar` search — fuzzy coverage name search
- Cards view: top-level coverages only; sub-coverages expand in-place via `expandedId`; each card shows refId chip, requirement chip, form number chips, term count
- Deep-link support: `?cov=<id|refId>` scrolls to and opens the matching coverage
- Edit dialogs (EDITOR+ only):
  - `TermOptionsDialog` — limit/deductible/option editor with StandardOption grid; shows constraint notes and state filter per option
  - `CoverageStatesDialog` — state footprint multi-select
  - `CoverageFormsDialog` — form association picker (searches `forms` collection)
  - `CoverageEditDialog` — full metadata edit (name, requirement, source, claims basis, etc.)
- Delete button: gated on `coverage.parentId === null || no children` (no orphan sub-coverages)
- `useCapture` publishes focused coverage refId as feedback context

---

### S09 — Product Forms (`/app/products/:id/forms`)
**File:** `app/src/routes/product/ProductForms.tsx`
**Auth:** Yes (all roles; EDITOR+ to edit)
**Description:** Forms library scoped to the product (filtered via `productRefIds` array-contains). Grid + list toggle. Filter: category chips (BASE_COVERAGE / ENDORSEMENT / EXCLUSION / etc.), state filter, mandatory/optional toggle. Each form card shows: form number chip, edition, category, mandatory chip, AI-generated description (lazy-loaded on expand). `describeForm` callable is triggered on first expand. EDITOR+ can edit form metadata via `FormEditDialog`.

---

### S10 — Product Pricing (`/app/products/:id/pricing`)
**File:** `app/src/routes/product/ProductPricing.tsx`
**Auth:** Yes (all roles)
**Description:** Interactive rating worksheet. Two-pane layout:
- **Left pane**: rating input form — HO-3 has a bespoke input worksheet (`RatingWorksheet`); other lines use a data-driven field list from `RatingInputField[]` defined in the LOB kit
- **Right pane**: premium result + trace table showing each `RatingStep` (label, op, factor, running total)
- `run_rating` tool result is displayed immediately (client calls the tool via `adapter.fns.call('chat', ...)` with a pre-canned message); ASSUMPTION: the rating may call the chat function with a run_rating tool call rather than a dedicated endpoint
- `RulesResult` integration: ineligible options are grayed out with violation reason tooltip
- Live rules result (`useRulesEngine`) gates which limits/deductibles/forms are available

---

### S11 — Product States (`/app/products/:id/states`)
**File:** `app/src/routes/product/ProductStates.tsx`
**Auth:** Yes (all roles; EDITOR+ to edit)
**Description:** US state footprint tile map. 50-state grid rendered as coloured tiles (active / inactive / future). Clicking a tile toggles state inclusion for EDITOR+. Coverage-level overrides (sub-state footprints per coverage) shown on hover. State count chip in the product header reflects this.

---

### S12 — Product Rules (`/app/products/:id/rules`)
**File:** `app/src/routes/product/ProductRules.tsx`
**Auth:** Yes (all roles; EDITOR+ to compose)
**Description:** Rules table + AI rule composer. Three rule categories tabbed: PRODUCT / RATING / FORMS.
- Table columns: refId chip, subCategory, condition (IF), outcome (THEN), form chips, coverage chips
- Live rules engine integration: rules in `evaluatedRuleRefIds` show a satisfied/violated badge based on a test context
- **AI Rule Composer**: right-side panel opened via "Draft Rule" button (EDITOR+). SSE-streaming from `draftRule` endpoint. Shows thinking steps (tool calls displayed as `[tool name]` chips), then the drafted rule with structured fields. One-click "Accept" writes via `mutate()`.
- `NoticeBanner` shown when budget is degraded or breaker open

---

### S13 — Builder (`/app/builder`)
**File:** `app/src/routes/Builder.tsx`
**Auth:** Yes (EDITOR+ to create)
**Description:** Draft product workbench. Shows only products where `lifecycle !== 'LAUNCHED'` (drafts). Four creation entry points (button row):
1. **AI Scaffold** — opens `ScaffoldProductModal`; runs `scaffoldProduct` SSE; creates product from the structured AI output
2. **ISO Workbook Import** — opens `ImportWorkbookModal`; client-side Excel parse via `exceljs`; runs the ISO import pipeline (`shared/src/insurance/isoImport.ts`); writes product + coverages + forms + rules atomically
3. **Clone** — opens `CloneProductModal`; duplicates an existing product with all sub-collections; sets `lineage.kind='CLONE'`
4. **Blank** — opens `NewProductModal`; minimal product form; sets `lineage.kind='BLANK'`

Draft cards show coverage count, form count, lineage chip. **Promote** button (per card) opens `PromoteDraftDialog` to advance lifecycle. **Delete** button opens `DeleteDraftDialog` (deletes sub-collections first).

---

### S14 — Explorer (`/app/explorer`)
**File:** `app/src/routes/Explorer.tsx`
**Auth:** Yes (all roles)
**Description:** Global entity search across all indexed entity types (product, coverage, rule, form, ldTable, rtTable, dictionary, task, project). Uses `interpretSearch` callable to translate natural-language queries into structured filter params, then queries `searchIndex`. Results rendered as cards with entity-type color coding. Clicking a result navigates to the owning entity (product workspace tab / dictionary entry / task).

---

### S15 — Tasks / GTM Board (`/app/tasks`)
**File:** `app/src/routes/Tasks.tsx`
**Auth:** Yes (all roles; EDITOR+ to edit)
**Description:** GTM launch Kanban board backed by dnd-kit drag-and-drop. Two views:
1. **Project board** — tasks scoped to a Project, grouped by `projectId`. Project selector dropdown. Back-scheduled task cards show `startDate` → `dueAt` runway chips.
2. **Personal tasks** — tasks without a `projectId` (legacy product tasks and ad-hoc items)

Four columns: IDEATION · BUILD_FILE · TEST_APPROVE · LAUNCH_MONITOR. Task card: title, type-of-work color chip, phase chip, assignee avatar, due-at badge, checklist progress bar. Completed tasks (done=true) sink to a Completed section per column. Drag-and-drop reorders within and across columns; writes `column` + `order` via `mutateBatch()`.

---

### S16 — News (`/app/news`)
**File:** `app/src/routes/News.tsx`
**Auth:** Yes (all roles)
**Description:** Market news feed. Displays news items from the `news` collection ordered by `fetchedAt DESC`. Features:
- News card with hero image (OG/Twitter/inline/generated), source badge, title, summary, 3 PM-takeaway bullets, tag chips
- Related product chips — links to the matching product workspace
- **Pin** action: adds urlHash to `newsPrefs.pinnedHashes` via `setNewsPins`; pinned items float to top
- **Preferences** panel: edit `newsPrefs.instruction` (free text) to personalize the nightly scout's query
- **Manual Refresh** button (ADMIN): calls `refreshNews` callable; triggers haiku web search immediately
- Image error handling: falls back to the dominant-color placeholder tile

---

### S17 — Claims Coverage Copilot (`/app/claims`)
**File:** `app/src/routes/Claims.tsx`
**Auth:** Yes (all roles)
**Description:** Two-pane claims analysis surface:
- **Left pane** (`BaseFormsLibrary`): list of base forms from the `baseForms` collection. EDITOR+ can upload new forms (Storage → `identifyBaseForm` → writes to `baseForms`). Clicking a form loads it into the analysis context.
- **Right pane**: multi-turn SSE chat powered by `analyzeClaim`. Features:
  - Line-aware scenario starters (quick-start buttons derived from `resolveClaimsLineProfile(lob)`) — e.g. "Water damage" for Homeowners, "Rear-end collision" for Personal Auto
  - Composer disabled when no base form is selected (`isFormAnalyzable` gate)
  - `DeterminationCard` — rendered for structured `emit_determination` outputs: verdict badge (COVERED / NOT_COVERED / PARTIAL / NOT_ADDRESSED), summary, coverage/exclusion/limit tables, 3 reasoning bullets, citations, coverage gap note
  - `AssistantContent` — pure component: decision tree over content type (determination → DeterminationCard; text → markdown; thinking → thinking block; else → fallback)
  - RAF-batched token rendering (same pattern as Home chat)
  - `NoticeBanner` for budget/breaker advisories

---

### S18 — Dictionary (`/app/dictionary`)
**File:** `app/src/routes/Dictionary.tsx`
**Auth:** Yes (all roles; EDITOR+ to edit)
**Description:** Data dictionary browser. Searchable list of `DictionaryEntry` records. Filter: type chips (TEXT / CURRENCY / DATE / LIST / PERCENT), tag filter. Each entry shows: refId chip, name, type, description, allowed values, format, **live "used in"** back-references (computed via `computeDictionaryUsage()` against current coverages/rules/forms in context — never persisted). EDITOR+ can create/edit entries via `DictionaryEditDialog`.

---

### S19 — Feedback Board (`/app/feedback`)
**File:** `app/src/routes/Feedback.tsx`
**Auth:** Yes (all roles)
**Description:** Three-lane Kanban feedback board.
- **Lanes**: Inbox (NEW) / In Progress (REVIEWING + PLANNED) / Done (SHIPPED + DECLINED)
- **Archived toggle**: shows/hides DECLINED items
- **Type filter chips**: IDEA / ISSUE / PRAISE
- **Typeahead filter**: instant fuzzy search on title
- Each card shows: type chip, title, votes count (VIEWER can vote once), impact/effort badges, AI-shaped story preview (if available)
- **Drag-and-drop** (dnd-kit): EDITOR+ can move cards between lanes; writes `status` via `mutate()`
- **Status pipeline**: NEW → REVIEWING → PLANNED → SHIPPED; DECLINED as archive
- **Completion note dialog**: shown on SHIPPED transition; requires a one-line note
- **Screenshot lightbox**: full-screen view of attached screenshot
- **ADMIN-only "Copy prompt"**: builds a Claude Code task prompt from the `implementationPrompt` field for the maintainer
- **Capture panel**: floating `+` button (all roles) opens a single-box capture drawer; on submit, calls `shapeFeedback` callable which shapes raw text + optional screenshot/attachments into a structured Feedback record via `emit_determination`-style forced tool

---

### S20 — Admin (`/app/admin`)
**File:** `app/src/routes/Admin.tsx`
**Auth:** Yes (ADMIN only)
**Description:** Platform administration. Two tabs:
1. **Users tab**: list of `users` collection records; ADMIN can invite new users, edit roles (VIEWER / EDITOR / ADMIN), deactivate accounts. Role change calls `setUserRole` callable which sets Firebase custom claim.
2. **AI Cost tab**: displays `aiUsage` collection records showing per-feature cost estimates, token counts, model used, and timestamps. Read-only for the ADMIN.

---

## Design System

**Token file:** `app/src/index.css` — all color, spacing, radius, shadow tokens in a `@theme` block. No hard-coded hex values in component code.

**Primitive components** (`app/src/components/ui/`):
- `Skeleton` — loading placeholder
- `Badge` / `Chip` — colored label chips (lifecycle, LOB, refId, etc.)
- `Button` — variant: primary / secondary / ghost / danger
- `Dialog` / `Sheet` / `Drawer` — modal overlays
- `Input` / `Textarea` / `Select` / `Checkbox` / `Switch` — form controls
- `Table` — sortable data table
- `Tooltip`

**Invariant:** `refId` chips and form-number chips are load-bearing display elements. Never stripped from any view.

---

## Feedback Capture Panel (Global)

**Context:** `app/src/context/CaptureContext.tsx`
**Trigger:** Floating "+" button in AppShell, always visible
**Flow:**
1. User types free-form feedback in a single text box
2. Optional: attach a screenshot (auto-captures current viewport) or upload images/PDFs
3. Submit → calls `shapeFeedback` onCall (Sonnet 5 with vision) → returns shaped `Feedback` with userStory, acceptanceCriteria, likelyFiles, implementationPrompt
4. Result written to `feedback` collection via `mutate()` with `context` set to current route + entity
5. Toast confirmation

---

## Screenshots Directory

`fable-handoff/screenshots/` — intentionally empty. No browser-rendered screenshots were captured during this forensic pass (the stack requires a running emulator + seeded Firestore). Fable should treat all UI descriptions in this document as ground-truth textual specifications, not as screenshots.
