# app/CLAUDE.md — the React front-end

Read the root `CLAUDE.md` first. This file covers only what a task inside `app/`
needs. React + Vite + TypeScript (strict) + Tailwind v4 (`@tailwindcss/vite`).

## The adapter seam (hard rule)
App code **never** imports `firebase/*`. Everything backend goes through
`app/src/lib/backend` — `import { adapter } from '../lib/backend'`. `firebase.adapter.ts`
is the active implementation; `aws.adapter.placeholder.ts` mirrors the interface with
commented AWS mappings. Tag any portability-relevant decision `// AWS-SWAP:`.
- **Reads:** `adapter.db.subscribe(pathOrQuery, cb)` (realtime; returns an unsub).
- **Writes:** always `adapter.db.mutate({ op, path, data, entityType, productId, actor,
  expectedRev })` — one batch writes the entity + AuditEvent + Version + searchIndex.
  There is no other write path. `adapter.db.vote(path, uid)` for one-vote-per-user.
- **Functions:** `adapter.fns.call(name, payload)` (callables) and the SSE chat client.
- Conflict handling: `mutate` throws `MutationConflictError` on a stale `expectedRev` —
  catch it and toast "refresh and try again."

## Design tokens (single source of truth: `src/index.css`)
Never hard-code colour. Use the Tailwind token utilities (`bg-surface`, `text-dim`,
`border-border`, `text-accent`, `bg-accent-soft`, `text-good/warn/danger/info`) or the
CSS vars in inline `style={{}}` (`var(--gradient-accent)`, `var(--color-border-strong)`,
`var(--shadow-card)`, `var(--color-accent-line)`).
- **Brand is Accenture-inspired violet:** `--color-accent #8B1FE0` (AA on white),
  `--color-accent-bright #A100FF` (gradient start / glow), `--color-accent-strong #7A00E6`
  (deep end). Gradient token `--gradient-accent` (135°); for horizontal bars use
  `linear-gradient(90deg, var(--color-accent-bright), var(--color-accent-strong))`.
  Gradient **text** → add the `gradient-text` utility (don't inline the clip CSS).
- Surfaces `page / surface / raised / hover`; borders `border` / `border-strong`.
- **The only place literal hex is allowed** is bespoke inline-SVG that gets *serialised
  for download* (`lib/svg/ratingFlow.tsx`, `StateTileMap.tsx`, `Logo.tsx`, the Landing
  constellation, the Pricing SVG export) — `var()` does not resolve in an exported SVG.
- Motion: `--ease-spring`, the `rise-in` / `flow-step` / aurora / constellation classes;
  every animation is neutralised under `prefers-reduced-motion`.

## Icons
Use the in-house family only: `import { IconFoo } from '../components/ui/icons'` (path
depth varies). No third-party icon packs (`lucide-react` was purged). Glyphs are on a
24px grid, `currentColor` stroke, rounded joins — they inherit colour/size from context
(`size`, `className`). Need a new glyph? Add it to `icons.tsx` in the matching section
with a one-line purpose comment; keep the weight consistent and crisp at 16px. `IconType`
is the shared prop type (use it where a component takes an icon).

## Component conventions
- Every module opens with a 1–3 line purpose comment. Comment the *why*.
- Ship loading / empty / error states for every view (`Skeleton`, `EmptyState`, and the
  `ErrorBoundary` for render crashes). Keyboard-first, AA contrast, labelled controls.
- Roles come from `useUser()` (`profile.role`): gate edit affordances on `EDITOR`/`ADMIN`.
  This is UX only — the real enforcement is Firestore rules + Functions.
- refIds and form numbers render as mono chips (`RefChip`, `.font-mono` tabular numerals).
- Instant typeahead on every list; ⌘K global palette; ⌘. quick feedback capture.

## Routes (`src/App.tsx`)
Public: `/` (Landing showpiece), `/sign-in`, `/must-change-password`, `/share/:token`.
Auth shell `/app`: `index` (Home portfolio chat), `products`, `products/:id`
(`overview | coverages | forms | pricing | states | rules`), `builder` + `claims`
(StubRoute), `explorer`, `tasks`, `news`, `dictionary`, `feedback`, `admin`. Routes are
lazy; the product workspace shares context via `useProductCtx()`.

## Gate
From repo root: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. `pnpm lint`
is oxlint over `app/src`.
