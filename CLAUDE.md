# CLAUDE.md — Product Factory (Firebase edition)

## What this is
Product Factory: an AI-native product management platform for P&C insurance product
managers. Reference line for the seed: a standard ISO-style **Homeowners HO-3**
product defined in `docs/DOMAIN_HO.md`. Users author, configure, price, govern and
ship insurance products. Read `docs/DATA_MODEL.md` (Firestore model) and
`docs/AWS_SWAP.md` (portability seam) before touching related code.
Repo folder: **"Product Reinvention Hub"** (local git only — no remote yet).
Firebase project: **productreinvention** (Blaze; Firestore, Storage, Auth
email/password + anonymous, Functions and Hosting already enabled).

## Golden rules
- Read this file and the relevant doc in `docs/` before any task. Prefer editing
  existing code. No drive-by refactors.
- **Secrets:** the Anthropic key originates in `apikeys.md` at the repo root
  (user-provided, gitignored). Its canonical homes are `functions/.env.local`
  (local dev, gitignored) and Firebase Secrets (`firebase functions:secrets:set
  ANTHROPIC_API_KEY`, bound via `defineSecret`). Never `VITE_*`, never in the app
  bundle, never committed, never echoed to logs.
- **Adapter seam:** app code never imports `firebase/*` directly — everything goes
  through `app/src/lib/backend` (the `BackendAdapter`). `firebase.adapter.ts` is
  active; `aws.adapter.placeholder.ts` mirrors the interface with commented AWS
  mappings. Tag every portability-relevant decision with a `// AWS-SWAP:` comment.
- **Lean + well-commented:** every module opens with a 1–3 line purpose comment;
  comment the *why*, not the obvious *what*; no dead code, no console noise.
- Every mutation flows through `adapter.db.mutate()` which writes the entity change
  + an AuditEvent + a Version snapshot + searchIndex upkeep in one batch. No silent
  writes anywhere.
- Preserve reference IDs (`refId`) like HO.COV.003.002, HO.RU.006, HO.FORM.RU.003,
  HO.LD.002, HO.RT.003, and form numbers like HO 04 61 — they are the traceability
  backbone.
- AI answers are grounded through tools and cite refIds/form numbers in square
  brackets, e.g. [HO.RU.006] [HO 04 90]. Never invent coverages, forms, rules,
  limits or factors. If a tool returns nothing, say so.
- Roles via Firebase Auth **custom claims** (mirrored on `users/{uid}` for display):
  VIEWER = inquiry-only (no edit affordances; writes rejected by security rules);
  EDITOR = create/update domain content; ADMIN = users, settings, audit explorer.
  Enforce in Firestore rules and in Functions — never UI-only.

## Stack
React + Vite + TypeScript strict + Tailwind (Vite plugin). React Router.
Firebase: Auth (email/password + custom claims), Firestore (data + realtime via
onSnapshot), Cloud Functions v2 (Node 20 — all AI + agents + share snapshot),
Storage (doc uploads), Hosting (deploy), Emulator Suite (local dev).
Anthropic SDK in Functions only — `claude-fable-5` for reasoning,
`claude-haiku-4-5` for bulk/simple generations, prompt caching on the shared
system context, streamed responses (SSE over `onRequest`).
Shared pure logic in `shared/` (types, rating evaluator, rules engine, HO-3 seed
constants) consumed by both app and functions. exceljs (client) for Excel export.
Vitest. pnpm workspaces: `app`, `functions`, `shared`.

## Commands (root)
pnpm dev            # Vite dev server (expects emulators running)
pnpm emulators      # firebase emulators:start (auth, firestore, functions, storage, hosting)
pnpm dev:all        # both, concurrently
pnpm seed           # seed HO-3 into the emulator (or --project <id> for prod, with confirm)
pnpm test           # vitest (shared engines + app units)
pnpm typecheck · pnpm lint · pnpm build
pnpm deploy         # build + firebase deploy

## Layout
app/src
  routes: / (public landing) · /app (auth shell): home, products,
  products/:id/(overview|coverages|forms|pricing|states|rules), builder, explorer,
  tasks, news, claims, dictionary, feedback, admin · /share/:token (public)
  components/ (ui primitives + feature components)
  lib/backend/ (types.ts, firebase.adapter.ts, aws.adapter.placeholder.ts, index.ts,
  firebase.config.ts) · lib/ (export/excel.ts, svg/, utils)
functions/src (ai.ts SSE chat · extract.ts coverage extraction · health.ts ·
  news.ts scheduled · share.ts · admin.ts setUserRole · tools.ts · runtime.ts)
shared/src (types.ts · rating/evaluator.ts · rules/engine.ts · seed/ho3.ts)
docs/ (DATA_MODEL.md · DOMAIN_HO.md · AWS_SWAP.md) · scripts/seed.ts
firebase.json · firestore.rules · firestore.indexes.json · storage.rules

## Design system (light, premium, Apple-inspired)
Backgrounds #F7F7FA page, #FFFFFF surface, #F3F3F8 raised; borders rgba(19,19,26,.08).
Text #131318 / dim #5B5C6B / faint #8E90A0.
Accent gradient **#C026D3 → #EC4899**; accent-soft rgba(192,38,211,.07);
status: good #059669, warn #B45309, danger #DC2626.
Fonts: Inter (UI), JetBrains Mono (refIds, numbers, labels, code).
Radius 14–16px. Card glow: 0 1px 2px rgba(19,19,26,.04), 0 14px 34px rgba(192,38,211,.06).
Motion cubic-bezier(.22,.61,.36,1), 150–300ms; respect prefers-reduced-motion.
Every list gets instant typeahead; ⌘K opens the global palette; ⌘. opens quick
feedback capture. Landing page (public /) is the showpiece: subtle animated aurora,
self-drawing custom SVG hierarchy, glass module cards — no stock images, inline SVG
only, fast LCP. Design loading/empty/error states for every view. Keyboard-first. AA.

## Domain model
Canonical structure, governance metadata, and every collection shape:
`docs/DATA_MODEL.md`. The seeded HO-3 product — coverages A–F, endorsements,
LD/RT tables, the 11-step rating algorithm and the $1,528 worked example — is
specified exactly in `docs/DOMAIN_HO.md`; the seed and tests must match it.

## Definition of done — every task
pnpm typecheck && pnpm lint && pnpm test pass; run it yourself against the
emulators and verify the acceptance criteria before reporting. Loading/empty/error
states shipped. Rules + Functions enforce roles. Audit + Version written on every
mutation. Keyboard and screen-reader friendly. Then review your own work as a
hostile senior reviewer, fix what you find, commit locally with a clear message
(no remote yet), and only then report done with a summary of changes.
