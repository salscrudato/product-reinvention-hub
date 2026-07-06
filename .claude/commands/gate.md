---
description: Run the full gate (typecheck · lint · test · build) and report failures crisply.
allowed-tools: Bash(pnpm typecheck:*), Bash(pnpm lint:*), Bash(pnpm test:*), Bash(pnpm build:*)
---

Run the repo gate from the root, in order, stopping at the first failure:

`pnpm typecheck && pnpm lint && pnpm test && pnpm build`

No emulator is required — root `vitest` is scoped to `shared/` + `app/` units. (The
Firestore rules test runs separately; use `/verify-invariant`.)

Report crisply — nothing more:
- ✅ / ❌ for each of the four stages.
- Confirm the **$1,528 canary** passed (`shared/src/rating/evaluator.test.ts`). If it
  failed, that is the headline.
- On any failure: the failing package, the first error with `file:line`, and the shortest
  fix. Do not fix anything unless the user asks — this command reports the gate.
