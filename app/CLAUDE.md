# app/ — React + Vite frontend

See [../CLAUDE.md](../CLAUDE.md) for the binding invariants that apply across every workspace.

**Dev:** `pnpm dev:seed` from root (full local stack) or `pnpm --filter app dev` (Vite only).

## Key files

| File | Purpose |
|---|---|
| `src/App.tsx` | Root router — lazy routes, UserProvider, Suspense |
| `src/index.css` | Design-token definitions (`@theme` block) — every color, shadow, radius |
| `src/components/ui/icons.tsx` | In-house SVG icon family (24px grid, `currentColor`) |
| `src/components/ui/index.ts` | Barrel for shared primitives (Button, Card, Dialog, …) |
| `src/lib/backend/index.ts` | Adapter export — the only Firebase SDK entry point in the frontend |
| `src/lib/backend/types.ts` | `BackendAdapter` contract + `MutationPayload` |
| `src/context/ProductContext.tsx` | Product workspace state shared across tabs |
| `src/routes/` | Route components; product tabs under `routes/product/` |

## Patterns

**Reads / writes** — always through `adapter` from `src/lib/backend/`. Never import `firebase/*` directly in a component or hook.

**Mutations** — `adapter.db.mutate({ op, path, data, entityType, actor, expectedRev? })`. One call = one atomic batch (entity + audit + version + searchIndex). Optimistic concurrency: pass `expectedRev`; catch `MutationConflictError` and show a conflict toast.

**Colors** — use `var(--color-*)` CSS custom properties or the Tailwind utility classes that resolve to them (`bg-accent`, `text-dim`, `bg-raised`, …). No raw hex in components. The only exception is SVG content that is serialised to a file for download (e.g. `ratingFlow.tsx`, `ProductPricing.tsx` export) — those must hard-code the hex values because CSS vars don't survive serialisation.

**Icons** — import from `src/components/ui/icons.tsx`. Every export is `(props: IconProps) => JSX` on a 24px grid. There is no `lucide-react` dependency; do not add it.

**Tailwind** — v4 (`@tailwindcss/vite`). The `@theme` block in `index.css` owns all design tokens; Tailwind reads them automatically.

## Gotchas

- `signInAsDevAdmin()` in the adapter is dev-only (`import.meta.env.DEV` guard). Remove before production.
- `StateTileMap.tsx` has two hex values with no token equivalent (`#E4E4EB` inactive-state fill, `#F59E0B` coastal badge amber). Leave them; no token covers that exact shade.
- Adding a new collection or mutating a new entity type? Update `firestore.rules` (and check `shared/src/types.ts`) first.
