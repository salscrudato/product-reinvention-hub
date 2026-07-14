# Screen Inventory — every UI surface, mapped to code

This catalogs every screen an external reviewer should understand, with the route, the
entry component, and what the screen does. Use it alongside the screenshots in this folder.

## What screenshots are in this packet

**46 PNGs — 23 routes × {light, dark} — all captured live today (2026-07-13)** against the
deployed host `app-prodhub-dev` as an authenticated SUPER_ADMIN on the **Test Company** (`testco`)
tenant, using `review-packet/capture-current-state.mjs`. Both themes for every surface.

This is a true current-state set: real deployed UI, real seeded data. Two things a reviewer
should read as *genuine current-state facts about the `testco` tenant*, not capture artifacts:

> - **`GL.PROD.001` is fully seeded** — `13-gl-pricing-2635` shows the complete 7-step rating
>   algorithm with per-step `refId` chips resolving to the **$2,635** canary premium. This is the
>   showcase shot for the rating engine.
> - **`PH.PROD.001` (HO-3) is only partially seeded in `testco`** — it has the product shell but
>   **0 coverages and no rating program**, so `08-ho-pricing` shows the "No rating program found"
>   empty state rather than the $1,528 trace. The $1,528 value is still enforced by the
>   `evaluator.test.ts` canary in code; it just isn't populated in this tenant's data. Worth a
>   reseed if you want the HO screens populated (see `scripts/migrate-to-cosmos.ts`).

### Re-capturing / capturing another tenant (one command)

`review-packet/capture-current-state.mjs` walks all 23 routes in light + dark against the live
host. It authenticates by injecting a bearer token into `localStorage['pf.azure.token']`:

```powershell
# Get a token: bootstrap login (returns { token }), or copy pf.azure.token from a signed-in browser.
cd review-packet
npm i playwright@1.61.1
$env:PF_JWT = "<token>"
$env:PF_HO  = "PH.PROD.001"     # home product id in your tenant
$env:PF_GL  = "GL.PROD.001"     # GL product id
node capture-current-state.mjs  # → review-packet/screens/*.png
```

With no `PF_JWT` it captures only the two public screens (Landing + HomeCheck) and skips the rest
with a clear note. `PF_THEMES=light` limits to one theme; `PF_BASE_URL` points at another host.

---

## Route → component → purpose

### Public (outside the auth shell)

| Route | Component | Purpose |
|---|---|---|
| `/` | `app/src/routes/Landing.tsx` | Marketing showpiece + sign-in. OTP-by-email (primary) and bootstrap-password flows; bespoke insight-graph SVG ("everything flows to the Product Manager"). |
| `/home-check` | `app/src/routes/HomeCheck.tsx` | **Guest, no auth.** Consumer home-risk check; AI via `/api/homecheck/v1`; zero portfolio access. |
| `/must-change-password` | `app/src/routes/MustChangePassword.tsx` | Forced password-reset interstitial when `mustChangePassword=true`. |
| `*` | — | Redirect to `/`. |

### Authenticated shell `/app` (`AppShell.tsx` — requires `user.email`)

| Route | Component | Purpose |
|---|---|---|
| `/app` | `routes/Home.tsx` | Portfolio cockpit: priority task rail, metrics, and the grounded portfolio-assistant chat (RAG + `[refId]` citations, SSE). |
| `/app/products` | `routes/Products.tsx` | Published portfolio (LAUNCHED products); Cards ⇄ Hierarchy views. |
| `/app/products/:id` | `routes/product/ProductWorkspace.tsx` | Loads `ProductProvider` (10 live subscriptions) + hero header + nested tab outlet. |
| `…/:id/overview` | `routes/product/ProductOverview.tsx` | Vital-signs strip + AI product summary (Haiku `summarizeProduct`) + editable details. |
| `…/:id/coverages` | `routes/product/ProductCoverages.tsx` | Coverages as cards/list/tree; sub-coverage nesting via `parentId`; `refId` chips; drill into term editors. |
| `…/:id/forms` | `routes/product/ProductForms.tsx` | Master-detail forms repository; form-number chips; "where used" back-refs. |
| `…/:id/pricing` | `routes/product/ProductPricing.tsx` | Rating algorithm (drag-reorder steps, dnd-kit) + scenario inputs + premium trace. **HO-3 → $1,528**. |
| `…/:id/states` | `routes/product/ProductStates.tsx` | SVG choropleth footprint + toggle-grid editor + peril badges (COASTAL wind/hail, TERRITORY). |
| `…/:id/rules` | `routes/product/ProductRules.tsx` | IF→THEN rule cards + live Simulate panel (shared rules engine) + AI rule composer. Simulate only for PH/PA/GL. |
| `/app/builder` | `routes/Builder.tsx` | Drafts workbench: New / Import (unified importer) / Clone / Scaffold-with-AI. |
| `/app/explorer` | `routes/Explorer.tsx` | Miller-column cascade (Products → Coverages → Sub-coverages → peek panel). |
| `/app/tasks` | `routes/Tasks.tsx` | Insurance GTM launch tracker: projects, back-scheduled 65-task process, launch runway (kanban, dnd-kit). |
| `/app/news` | `routes/News.tsx` | Portfolio-relevance-ranked market intelligence feed (nightly AI-curated). |
| `/app/claims` | `routes/Claims.tsx` | Grounded claims "coverage copilot" (SSE, `analyzeClaim`); base-forms library; verdict downgrades to NOT_ADDRESSED without cited reasoning. |
| `/app/dictionary` | `routes/Dictionary.tsx` | Governed catalogue of canonical fields/terms with citable `refId`s and live used-in back-refs. |
| `/app/feedback` | `routes/Feedback.tsx` | 3-lane PM feedback board (Inbox / Backlog / Shipped); global ⌘. quick-capture drawer. |
| `/app/admin` | `routes/Admin.tsx` | Platform console (SUPER_ADMIN/SUPPORT): tenants, users, break-glass, audit search, AI-cost monitor; doubles as Settings for others. |
| `/app/tenant-admin` | `routes/TenantAdmin.tsx` | Org self-service admin (TENANT_ADMIN, own tenant): members CRUD, roles, disable, audit. |

### Global overlays (not routes)

| Surface | Component | Purpose |
|---|---|---|
| ⌘K command palette | `components/palette/CommandPalette.tsx` | Fuzzy search (fuse.js) over the `searchIndex`. |
| Feedback drawer | `components/feedback/FeedbackProvider.tsx` | ⌘. quick-capture with screenshot/annotate; maintainer-only implementation-prompt panel. |
| Conflict dialog | `components/product/ConflictDiffDialog.tsx` | Surfaces optimistic-concurrency conflicts (409 → `MutationConflictError`). |
| History drawer | `components/product/HistoryDrawer.tsx` | Version timeline from the audit/version writes. |
| Unified import wizard | `import/UnifiedImportModal.tsx` | EDITOR+ entry for all formats; streams the 6-stage import brain; disagreement heatmap. |
