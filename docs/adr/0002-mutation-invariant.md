# ADR-0002: Mutation invariant — one atomic batch per write

- **Status:** Accepted
- **Date:** 2026-07-05

## Context

This is a governed insurance-authoring tool: every change to domain content must leave
an audit trail, be restorable, keep the ⌘K/Explorer search index fresh, and be safe
under concurrent multi-user editing. If writes could happen ad hoc, the governance
guarantees (who changed what, when, and what it looked like before) would rot the first
time someone wrote "just this once" directly.

## Decision

**Every mutation flows through a single write path: `adapter.db.mutate({ op, path, data,
entityType, productId, actor, expectedRev })`.** That call performs one Firestore
`WriteBatch` that atomically writes, together:

1. the **entity** change (create / update / delete),
2. an **`AuditEvent`** (create-only — who/what/when),
3. a **`Version`** snapshot (+ field-level `diff`) for history and restore,
4. **`searchIndex`** upkeep so the entity stays findable,
5. a **`rev`** increment for optimistic concurrency.

There is no other write path. Optimistic concurrency: a stale `expectedRev` throws
`MutationConflictError`, which the UI catches and surfaces as a friendly
"refresh and try again" toast — never a silent overwrite.

## Consequences

- Audit + version are written on **every** mutation, uniformly, for free at the call
  site. No feature has to remember to log.
- `firestore.rules` makes `auditEvents` and `versions` **create-only** (no update/delete)
  so the trail is append-only; `shareLinks` are Functions-only. The role matrix
  (see [ADR-0003](0003-roles-via-custom-claims.md)) is what those rules primarily encode.
- `// AWS-SWAP:` the batch becomes a Lambda-side transaction; the invariant is unchanged.
- **Verification.** The server-side enforcement (who may write; audit/version create-only)
  is checked by `tests/rules.test.ts` via `pnpm test:rules` (the `/verify-invariant`
  command). The batch *composition* is guaranteed structurally by the single `mutate()`
  path and is exercised by driving a live edit against the emulator.
- **Future, not now:** a **read-only** Firestore/emulator inspector MCP server could speed
  invariant debugging — reading back the entity `rev`, the `Version` snapshot and the
  `AuditEvent` after an edit. It must stay strictly read-only so it never becomes a second
  write channel that bypasses `mutate()`. Not wired today.
