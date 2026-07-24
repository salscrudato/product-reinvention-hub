---
description: Verify server-side enforcement of the mutation invariant + role matrix.
allowed-tools: Bash(pnpm test:*), Bash(pnpm run test:*)
---

Verify the server-side half of the mutation invariant and the role matrix
(ADR-0002 + ADR-0003).

Run: `pnpm test`

This runs the full shared + app unit suite via Vitest, including:
- Role-gated write checks (VIEWER, EDITOR, ADMIN, SUPER_ADMIN)
- Audit hash-chain integrity (`/api/db/audit/verify`)
- Atomic mutation envelope (entity + auditEvent + version + searchIndex in one batch)
- Rating canaries: PH $1,528, PA $1,002, GL $2,635, filing-import $1,281

Report ✅ / ❌ per test suite; on failure, name the file and the failing assertion.
The atomic batch composition is exercised by driving a live edit against the running
server (`node server/server.js` with `COSMOS_DB=prodhub-sal`).
