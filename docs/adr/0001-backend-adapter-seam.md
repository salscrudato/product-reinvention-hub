# ADR-0001: Backend adapter seam

- **Status:** Accepted
- **Date:** 2026-07-05

## Context

Firebase is the active backend, but the product must be portable to AWS (Cognito,
DynamoDB/Aurora, Lambda, S3) without an application rewrite. If app code imported
`firebase/*` directly, the coupling would scatter across dozens of files and a swap
would touch the whole tree. We need one narrow seam that isolates every platform
touchpoint — auth, database, realtime, storage, functions, presence.

## Decision

All backend access goes through a single typed interface, `BackendAdapter`, living in
`app/src/lib/backend/`:

- `types.ts` — the contract (`auth`, `db`, `storage`, `fns`, `presence`).
- `firebase.adapter.ts` — the active implementation (modular SDK; connects to the
  Emulator Suite when `VITE_USE_EMULATORS=true`).
- `aws.adapter.placeholder.ts` — mirrors the interface; every method throws
  `NotImplemented` with a comment mapping it to its AWS service.
- `index.ts` — a one-line `export { adapter } from "./firebase.adapter"` switch.

Rules that keep the seam intact:
- **App code never imports `firebase/*`** — only `import { adapter } from '.../lib/backend'`.
- **`shared/` stays 100% pure TypeScript** (see [ADR-0005](0005-rating-engine-and-1528-canary.md)) so engines, types
  and seed constants move as-is.
- Documents are addressed by string `path`; the AWS adapter maps paths → keys/tables.
- Every portability-relevant choice is tagged `// AWS-SWAP:` so `grep AWS-SWAP:` finds
  the full swap surface.

## Consequences

- A backend swap is an adapter implementation + infra work, **not** an app rewrite; the
  procedure and service mapping live in `docs/AWS_SWAP.md`.
- The rule is enforced by convention + review: `grep firebase/ app/src` outside
  `lib/backend` must return nothing (functions are the server-side exception).
- New backend capabilities must be added to the interface first, then both adapters, so
  the AWS placeholder never silently falls behind.
- Streaming AI uses plain SSE over HTTPS, an identical pattern on Lambda URLs.
