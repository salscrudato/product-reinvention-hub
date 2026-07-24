---
description: Wipe Cosmos to a clean slate, then repopulate by uploading a workbook (.xlsx).
allowed-tools: Bash(node scripts/ops/nuke-cosmos.mjs:*), Bash(pnpm tsx scripts/create-tenant.ts:*)
---

Reset Cosmos to a clean slate, then repopulate by uploading a product workbook (.xlsx)
through the app's Import modal — **the uploaded workbook is the source of truth for product
data.**

There is no repo-seeded product data: the old `migrate-to-cosmos` seeding path was removed.
The `shared/src/seed/*.ts` products remain only as fixtures for the rating canary tests
(HO-3 $1,528 in `shared/src/rating/evaluator.test.ts`, PA $1,002, GL $2,635) — they are not
loaded into any live database.

**Prerequisite:** `COSMOS_ENDPOINT` / `COSMOS_KEY` set and `COSMOS_DB` pointing at the
database you intend to wipe. NEVER wipe the live database by reflex — confirm the target
first. The `--confirm` flag must exactly match the target `COSMOS_DB` name.

Steps:

1. Preview what would be deleted (no changes made):
   `node scripts/ops/nuke-cosmos.mjs --confirm <COSMOS_DB> --dry-run`
2. Wipe everything — entities, audits, versions, search index, chainHeads, grounding chunks,
   tenants, users, presence (containers + indexing policy are preserved):
   `node scripts/ops/nuke-cosmos.mjs --confirm <COSMOS_DB>`
   (add `--tenant <tid>` to scope the wipe to a single tenant.)
3. Recreate a tenant + admin login (see the script header for env vars):
   `pnpm tsx scripts/create-tenant.ts`
4. Log in and upload a product workbook (.xlsx) via the Import modal to populate products.

To verify the rating engine itself is intact (not live data), run the canary tests:
`pnpm test` — the HO-3 $1,528 / PA $1,002 / GL $2,635 canaries must stay exact. If any drift,
**stop and report** — the seed fixtures or the evaluator has changed (see ADR-0005).
