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
| `src/lib/backend/index.ts` | Adapter export — the app's only backend entry point (Azure `/api` adapter) |
| `src/lib/backend/types.ts` | `BackendAdapter` contract + `MutationPayload` |
| `src/context/ProductContext.tsx` | Product workspace state shared across tabs |
| `src/routes/` | Route components; product tabs under `routes/product/` |

## Patterns

**Reads / writes** — always through `adapter` from `src/lib/backend/`. Never import a platform SDK directly in a component or hook.

**Mutations** — `adapter.db.mutate({ op, path, data, entityType, actor, expectedRev? })`. One call = one atomic batch (entity + audit + version + searchIndex). Optimistic concurrency: pass `expectedRev`; catch `MutationConflictError` and show a conflict toast.

**Colors** — use `var(--color-*)` CSS custom properties or the Tailwind utility classes that resolve to them (`bg-accent`, `text-dim`, `bg-raised`, …). No raw hex in components. The only exception is SVG/canvas content serialised to a file or raster image for download (e.g. the `ProductPricing.tsx` SVG export and the `FeedbackProvider.tsx` screenshot-annotation canvas) — those must hard-code the hex values because CSS vars don't survive serialisation.

**Icons** — import from `src/components/ui/icons.tsx`. Every export is `(props: IconProps) => JSX` on a 24px grid. There is no `lucide-react` dependency; do not add it.

**Tailwind** — v4 (`@tailwindcss/vite`). The `@theme` block in `index.css` owns all design tokens; Tailwind reads them automatically.

## Gotchas

- Sign-in is credentialed + tenant-scoped (username/email + password + tenant) through the `/api/auth` host; there is no anonymous/guest or dev-bypass session. The JWT carries `{ sub, email, name, role, tenantId }`; the adapter decodes it client-side for display only — every read/write is re-authorized server-side.
- `StateTileMap.tsx` is the single component behind all three state-scope surfaces (product footprint, per-coverage scope, per-option applicability). It is fully token-driven — the out-of-scope tile fill and peril badge are the `--color-tile-oos` / `--color-peril` tokens. Peril badges come from the passed `peril` (the LOB registry's `perilModel`); never hard-code coastal facts. `footprint` is the required count denominator, so a scope count can never exceed 100%.
- Adding a new collection or mutating a new entity type? Update the server-side role checks in `server/lib/data.js` (and check `shared/src/types.ts`) first.
