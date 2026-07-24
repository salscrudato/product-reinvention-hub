---
description: Reset + re-seed Cosmos to a known-good HO-3 state.
allowed-tools: Bash(pnpm seed:*), Bash(pnpm run seed:*)
---

Re-seed Cosmos to a known-good HO-3 state.

**Prerequisite:** the API server (`node server/server.js`) is running and `COSMOS_DB`
points to the isolated non-production database (`prodhub-sal`). Never target `prodhub`
(live) from this command.

Run: `pnpm seed`

The seed is **idempotent** — it wipes the seeded collections, re-seeds HO-3, then verifies
the worked example. Confirm the tail prints `✓ $1,528 confirmed`. If it prints any
`CRITICAL` warning or a premium other than $1,528, **stop and report** — the seed data or
the rating evaluator has drifted (see ADR-0005).
