# ADR-0003: Roles via custom claims, enforced in rules AND Functions

- **Status:** Accepted
- **Date:** 2026-07-05

## Context

Three roles gate the app: **VIEWER** (inquiry-only — read domain data, submit/vote
feedback, comment), **EDITOR** (author domain content), **ADMIN** (users, settings,
audit). UI-only gating is not security: a hidden button is still a reachable Firestore
write. Authorization must be enforced where the data and the compute actually live.

## Decision

- **Role lives in a Firebase Auth custom claim**, which is authoritative. It is mirrored
  onto `users/{uid}.role` for display only.
- The **only** writer of custom claims is the `setUserRole` callable
  (`functions/src/admin.ts`), which is itself ADMIN-gated. The seed bootstraps the first
  admin.
- Enforcement happens in **two** layers, both server-side:
  - **Firestore rules** (`firestore.rules`) read the role from `request.auth.token` and
    encode the matrix — e.g. domain collections are `read: isAuthed()`, `write: canEdit()`;
    `users` is ADMIN-write; feedback allows a VIEWER a single vote via a constrained diff.
  - **Functions** call `authenticate(req)` (`functions/src/runtime.ts`), which verifies the
    Bearer ID token and returns `{ uid, role, name }`, then check the role before acting.
- The app reads `profile.role` from `useUser()` to **hide** edit affordances for VIEWER —
  but that is UX convenience only; the server is the source of truth.

## Consequences

- A forged or missing claim fails at the rules layer *and* the Functions layer; neither
  trusts the client.
- The role matrix is regression-tested by `tests/rules.test.ts` (`pnpm test:rules`):
  VIEWER read-only, VIEWER feedback + one-vote path, EDITOR domain writes, ADMIN user
  writes, unauthenticated rejected.
- `// AWS-SWAP:` claims → Cognito groups/JWT claims; `verifyIdToken` → Cognito JWT verify;
  rules translate to IAM / API-Gateway authorizer logic — the two-layer principle holds.
