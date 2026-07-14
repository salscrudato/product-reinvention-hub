# Prompt 04 — Frontend / UX / Accessibility / Performance Review

> Paste everything below into the external AI. Attach `00-CONTEXT-DOSSIER.md`, the data-flow SVG
> diagram, **and screenshots** of the screens you want critiqued (product workspace, import wizard,
> conflict dialog, dark mode). Give the reviewer access to `app/src/` (components, the backend adapter,
> `index.css` token definitions).

---

## Role & goal

You are a staff frontend engineer and accessibility specialist reviewing the SPA of an insurance
product-management SaaS ("Product Reinvention Hub"). Stack: **React 19 + Vite 8**, no Redux — state is
**React Context + smart-polling** against a single `BackendAdapter`
(`app/src/lib/backend/azure.adapter.ts`) that talks only to `/api/*`. Design uses a **CSS custom-property
token system** (`app/src/index.css`) with dark mode and reduced-motion support. Your job is to recommend
concrete component-level refactors, catch a11y and performance problems, and propose UX polish — without
breaking the app's invariants.

## What to focus on

1. **State model: Context + polling, no Redux.** A product workspace holds ~**10 live subscriptions**.
   Analyze re-render cost: context value identity/memoization, provider nesting, whether one poll tick
   re-renders the whole tree, and subscription teardown/leak on unmount and route change. Recommend
   splitting contexts, selector patterns, `useSyncExternalStore`, or a lightweight store (Zustand/Jotai)
   **only if** it earns its keep — justify against the current approach.
2. **Bundle & performance.** Critical-path budget is **175 KB gzipped**; `exceljs` is code-split out.
   Check for budget risks: heavy imports on the critical path, missing lazy-loading of routes/dialogs,
   barrel-file bloat, duplicate deps, and un-split large libraries. Suggest a code-splitting map and
   what to defer/prefetch. Note React-19-specific wins (compiler, `use`, transitions, Suspense).
3. **Design-token system + theming.** Tokens live in `index.css`; **no hard-coded hex is allowed in
   browser code** — flag any literal color/spacing that should be a `var(--color-*)` / token. Verify dark
   mode covers all states (focus, disabled, error, overlays) and that `prefers-reduced-motion` actually
   suppresses non-essential motion. Check contrast pairs in both themes.
4. **Accessibility (WCAG 2.1 AA).** The repo uses `vitest-axe`. Go beyond axe: keyboard navigation and
   focus order, focus trap + restore in dialogs, visible focus rings, ARIA on the import wizard and data
   grids, live-region announcements for polling updates / async results, form labeling and error
   association, target sizes, and screen-reader flow. Name specific components and the WCAG criterion.
5. **Optimistic concurrency UX.** A stale write returns **409 → `MutationConflictError` →
   `ConflictDiffDialog`**. Review the UX: is the diff understandable, is data loss prevented, can the user
   merge/retry cleanly, is the optimistic state rolled back correctly, and are error/loading/empty states
   consistent across the app?
6. **PWA service worker.** Review correctness: cache versioning by build id, fail-closed on `/api` (don't
   serve stale API responses), cache invalidation on logout, and update/refresh prompting when a new SW
   is available. Flag any way the SW could serve stale JS/CSS or leak one user's cached data to another.
7. **Component health, generally** — prop-drilling vs composition, oversized components, effect
   correctness (deps, cleanup, race conditions on async in effects), list virtualization for large
   product/coverage tables, error boundaries, and Suspense usage.

## Constraints you must respect

- The SPA reads/writes **only through the `BackendAdapter`** — never suggest importing a Cosmos/Firebase
  SDK (or calling a model) from a component.
- **No hard-coded hex** in browser-rendered code; use `var(--color-*)` tokens (SVG files exported to disk
  are the only exception).
- **`refId` and form-number chips are load-bearing** display elements — never strip or hide them; polish
  is fine, removal is a bug.
- Keep all writes flowing to `/api/db/mutate` (atomic batch); UX changes must not bypass the adapter.
- Prefer improving the existing token + Context architecture over swapping frameworks unless the win is
  large and clearly argued.

## Output format

1. **Top issues** — a ranked table:

   | # | Area (state/perf/a11y/UX/PWA) | Severity | Component / file | WCAG or metric | Fix summary |
   |---|---|---|---|---|---|

2. **Detailed recommendations** — for each: the problem (with `file` + component), a **concrete refactor**
   (code sketch or diff-level steps), the expected benefit (fewer renders, KB saved, criterion satisfied),
   and effort (S/M/L).
3. **A11y checklist result** — pass/fail per WCAG AA area you examined, with the specific fix for each fail.
4. **UX polish list** — smaller, high-delight improvements (empty states, loading skeletons, motion,
   microcopy) that respect the token system and reduced-motion.

If a screenshot or file would change your assessment, say which one you need.
