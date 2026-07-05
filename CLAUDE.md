# CLAUDE.md — Product Factory (Firebase edition)

## What this is
An AI-native product-management platform for P&C insurance product managers (one
persona: the PM). Users author, configure, price, govern and ship insurance
products. The seed reference product is an ISO-style **Homeowners HO-3** specified
exactly in `docs/DOMAIN_HO.md` — coverages A–F, endorsements, LD/RT tables, the
11-step rating algorithm and the **$1,528 worked example**, which is the correctness
canary (`shared/src/rating/evaluator.test.ts` must keep producing $1,528).
Repo folder **"Product Reinvention Hub"** (local git only — no remote yet). Firebase
project **productreinvention** (Blaze; Firestore, Storage, Auth email/password +
anonymous, Functions, Hosting).

## Read before you touch code
- This file plus the relevant `docs/`: `DATA_MODEL.md` (Firestore model),
  `DOMAIN_HO.md` (the HO-3 domain + $1,528 trace), `AWS_SWAP.md` (portability seam),
  `BASELINE_AUDIT.md` (scored per-route critique).
- The scoped guide for the workspace you're in — load only what your task needs:
  - `app/CLAUDE.md` — design tokens, component conventions, adapter seam, routes.
  - `functions/CLAUDE.md` — SSE + tool-grounding + secret + auth patterns.
  - `shared/CLAUDE.md` — purity rule, rating evaluator + types, the $1,528 canary.

## Golden rules (never violate)
- Prefer editing existing code. **No drive-by refactors.** Lean + well-commented:
  every module opens with a 1–3 line purpose comment; comment the *why*, not the
  obvious *what*; no dead code, no console noise, **no hard-coded hex** — colours
  come from the tokens in `app/src/index.css` (see `app/CLAUDE.md`).
- **Adapter seam:** app code never imports `firebase/*` — everything goes through
  `app/src/lib/backend` (the `BackendAdapter`). `firebase.adapter.ts` is active;
  `aws.adapter.placeholder.ts` mirrors it. Tag portability decisions `// AWS-SWAP:`.
  `shared/` stays pure TS (no platform imports).
- **Every mutation** flows through `adapter.db.mutate()` — it writes the entity
  change + an AuditEvent + a Version snapshot + searchIndex upkeep in one batch.
  No silent writes anywhere.
- **Roles** via Firebase Auth custom claims (mirrored on `users/{uid}` for display):
  VIEWER = inquiry-only (no edit affordances; writes rejected by rules); EDITOR =
  create/update domain content; ADMIN = users, settings, audit. Enforce in Firestore
  rules **and** Functions — never UI-only.
- **Grounded AI, Functions-only.** Answers are grounded through tools and cite
  refIds / form numbers in square brackets — e.g. [HO.RU.006] [HO 04 90]. Never
  invent coverages, forms, rules, limits or factors; if a tool returns nothing, say so.
- **Secrets:** the Anthropic key originates in `apikeys.md` (repo root, gitignored);
  canonical homes are `functions/.env.local` and Firebase Secrets (bound via
  `defineSecret`). Never `VITE_*`, never in the app bundle, never committed or logged.
- **Preserve reference IDs** (`HO.COV.003.002`, `HO.RU.006`, `HO.FORM.RU.003`,
  `HO.LD.002`, `HO.RT.003`) and form numbers (`HO 04 61`) — the traceability backbone.
- **Models** (Anthropic SDK in Functions only): `claude-sonnet-4-6` for reasoning,
  `claude-haiku-4-5` for bulk/simple generations. Model IDs live on one line in
  `functions/src/runtime.ts`; a Project Glasswing operator can swap the reasoning
  model there. See `functions/CLAUDE.md`.

## Stack
React + Vite + TypeScript (strict) + Tailwind v4. React Router. Firebase: Auth
(email/password + custom claims), Firestore (data + realtime via `onSnapshot`),
Cloud Functions v2 (Node 20 — all AI + agents + share snapshot), Storage, Hosting,
Emulator Suite. Anthropic SDK in Functions only, prompt caching on the shared system
context, streamed SSE over `onRequest`. Pure logic in `shared/` (types, rating
evaluator, rules engine, HO-3 seed) consumed by app + functions. exceljs (client)
for Excel export. Vitest. pnpm workspaces: `app`, `functions`, `shared`.

## Commands (root)
```
pnpm dev            # Vite dev server (expects emulators running)
pnpm emulators      # firebase emulators:start (auth, firestore, functions, storage, hosting)
pnpm dev:all        # both, concurrently
pnpm seed           # seed HO-3 into the emulator (--project <id> for prod, with confirm)
pnpm test           # vitest (shared engines + app units)
pnpm typecheck · pnpm lint · pnpm build
pnpm deploy         # build + firebase deploy
```

## Definition of done — every task
`pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; the $1,528 canary
still passes. Loading/empty/error states shipped; roles enforced in rules +
Functions; Audit + Version written on every mutation; keyboard + screen-reader
friendly (AA). Then review your own work as a hostile senior reviewer, fix what you
find, and commit locally with a clear message (no remote yet).
