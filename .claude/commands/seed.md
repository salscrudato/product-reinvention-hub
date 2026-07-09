---
description: Reset + re-seed the running emulator to a known-good HO-3 state.
allowed-tools: Bash(pnpm seed:*), Bash(pnpm run seed:*)
---

Re-seed the Firebase emulator to a known-good HO-3 state.

**Prerequisite:** the emulator suite is already running (`pnpm spinup` or `pnpm emulators`).
If nothing is on Firestore `127.0.0.1:8080`, tell the user to run `pnpm spinup` first.

Run: `pnpm seed`

The seed is **idempotent** — it wipes the seeded collections, re-seeds HO-3, then verifies
the worked example. Confirm the tail prints `✓ $1,528 confirmed`. If it prints any
`CRITICAL` warning or a premium other than $1,528, **stop and report** — the seed data or
the rating evaluator has drifted (see ADR-0005).

Never target production from this command: do **not** pass `--project productreinvention`.
