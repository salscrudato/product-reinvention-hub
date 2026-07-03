# Product Reinvention Hub

An AI-native product-management platform for P&C insurance product managers. Author
coverages, price with confidence, govern with traceability, and ship — from first
draft to state filing. The reference product is an ISO-style **Homeowners HO-3**
(`docs/DOMAIN_HO.md`).

## Stack

- **App** — React + Vite + TypeScript (strict) + Tailwind v4, React Router. All
  backend access goes through the adapter seam (`app/src/lib/backend`) — app code
  never imports `firebase/*` directly (`docs/AWS_SWAP.md`).
- **Functions** — Cloud Functions v2 (Node 20). All Anthropic usage lives here
  (`claude-sonnet-4-6`): tool-grounded chat (SSE), claims, gap, builder, form
  descriptions, health, and the nightly news agent. Secrets via `defineSecret`.
- **Data** — Firestore (realtime via `onSnapshot`), Storage, Auth (email/password +
  custom-claim roles). Pure domain logic (types, rating evaluator, rules engine,
  HO-3 seed) lives in `shared/` and is consumed by both.
- **Monorepo** — pnpm workspaces: `app`, `functions`, `shared`.

## Prerequisites

- Node 20+ and **pnpm**
- **Java 21+** (for the Firestore emulator)
- **Firebase CLI** (`npm i -g firebase-tools`)
- An Anthropic API key for the AI features (see Secrets)

```bash
pnpm install
```

## Secrets

The Anthropic key originates in `apikeys.md` (repo root, gitignored). Its canonical
homes:

- **Local/emulator** — `functions/.env.local` → `ANTHROPIC_API_KEY=sk-ant-...`
- **Production** — `firebase functions:secrets:set ANTHROPIC_API_KEY`

Never expose it as `VITE_*`, never commit it, never log it.

## Run it locally

```bash
pnpm emulators     # Auth, Firestore, Functions, Storage, Hosting (needs Java)
pnpm seed          # seed the HO-3 product into the emulator (prints $1,528)
pnpm dev           # Vite dev server (expects emulators running)
# or both at once:
pnpm dev:all
```

Open the app, then sign in with a seeded account (or use **Continue as admin** on
the sign-in page):

| Role   | Email                       | Password    |
| ------ | --------------------------- | ----------- |
| ADMIN  | admin@productfactory.app    | `admin123`  |
| EDITOR | editor@productfactory.app   | `editor123` |
| VIEWER | viewer@productfactory.app   | `viewer123` |

The seeded admin keeps a "temporary password" banner until it's changed.

## Quality gates

```bash
pnpm typecheck     # tsc across all workspaces
pnpm lint          # oxlint (app)
pnpm test          # vitest — shared engines + units
```

## Deploy

```bash
pnpm build         # build the app
pnpm deploy        # build + firebase deploy (hosting + functions + rules + indexes)
```

Set the production secret first (`firebase functions:secrets:set ANTHROPIC_API_KEY`).
Shared links are served by the `share` Function via the `/share/**` hosting rewrite
(per-product social card + read-only summary).

## Where things live

```
app/src
  routes/            home (portfolio chat), products, product/* tabs, tasks, news,
                     dictionary, feedback, admin, explorer, share view, landing, sign-in
  components/        ui primitives, shell, palette, product, feedback, dictionary
  lib/backend/       the BackendAdapter seam (firebase.adapter.ts is active)
  lib/export/        exceljs workbook (four DOMAIN_HO sheets)
  lib/integrations/  duckcreek.ts (coming soon) · accenture.ts (env-driven client)
functions/src        runtime · tools · ai · admin · news · share · health
shared/src           types · rating/evaluator · rules/engine · seed/ho3
docs/                DATA_MODEL.md · DOMAIN_HO.md · AWS_SWAP.md
```

## Portability

Every platform touchpoint sits behind `BackendAdapter`. To move off Firebase,
implement `aws.adapter.ts` against the same interface and flip the export in
`app/src/lib/backend/index.ts`. Grep `AWS-SWAP:` for every seam decision.
