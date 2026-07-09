---
description: Verify server-side enforcement of the mutation invariant + role matrix.
allowed-tools: Bash(pnpm test:rules:*), Bash(pnpm run test:rules:*)
---

Verify the server-side half of the mutation invariant and the role matrix
(ADR-0002 + ADR-0003).

Run: `pnpm test:rules`

This starts its **own** Firestore emulator via `firebase emulators:exec --only firestore`
(port 8080) and runs `tests/rules.test.ts`: VIEWER read-only, VIEWER feedback + one-vote
path, EDITOR domain writes, ADMIN user writes, unauthenticated rejected, and create-only
`auditEvents` / `versions`.

**Port note:** it needs `8080` free — do **not** run it while `pnpm spinup` / `pnpm
emulators` is holding that port. Run it standalone.

Report ✅ / ❌ per assertion; on failure, name the rule in `firestore.rules` and the case
that broke. Scope: this command covers the **rules-enforcement** layer. The atomic batch
composition (entity + audit + version + searchIndex + rev) is guaranteed by the single
`adapter.db.mutate()` write path (ADR-0002) and is exercised by driving a live edit.
