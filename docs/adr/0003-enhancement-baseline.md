# ADR 0003 — Enhancement Baseline and Session Protocol

**Status:** Accepted  
**Date:** 2026-07-09

## Context

This repository entered an active enhancement phase on 2026-07-09. A ground-truth session was
run to establish a verified baseline before any feature work begins. The session ran the full
gate, answered 14 verification questions by reading code (V1–V14), and produced the documents
referenced below.

The intent document (fable-handoff/) and code disagreed on several points; code is the authority.

## Decisions

### 1. Build-then-migrate sequencing

All enhancement work follows this sequence:
1. Gate must be green before any feature branch is opened.
2. The ground-truth ledger (`docs/reviews/GROUND_TRUTH.md`) is the canonical description of
   what the codebase does today. It supersedes the fable-handoff documents where they disagree.
3. Feature work targets the existing Firebase stack (Firestore + Cloud Functions). Migration to
   any other platform is a separate, subsequent effort and must not be interleaved.

### 2. Canary discipline

The two rating canaries are **regression locks**, not aspirational assertions:

| Canary | File | Expected value |
|---|---|---|
| HO-3 | `shared/src/rating/evaluator.test.ts` | `$1,528` |
| PA | `shared/src/rating/personalAuto.evaluator.test.ts` | `$1,002` |

Rules:
- Canaries must pass on every gate run. A canary miss is a **build-blocking failure**.
- **Deliberate rating changes** (adjusting factors, adding steps, updating tables) must
  re-derive the expected premium and update the test assertion in the same commit. Include a
  derivation comment showing the step-by-step arithmetic that yields the new expected value.
- **Never** update a canary assertion without re-deriving it. Changing the expected value to
  match a wrong output defeats the lock.
- The seed also verifies canaries at seed time (`scripts/seed.ts`); a seed that produces a
  wrong premium exits non-zero and fails any CI pipeline that runs the seed.

### 3. Model constant discipline

All Anthropic model IDs live in `functions/src/runtime.ts` as `MODEL` and `MODEL_FAST`.
Every other file must import from there. Hardcoded model string literals anywhere else are a
violation of this invariant (except in comments, documentation, and fable-handoff/).

`claude-fable-5` is never used in this codebase (see ADR 0001).

### 4. Adapter seam and atomic mutation

All Firestore writes go through `adapter.db.mutate()` (entity + auditEvent + version + searchIndex
atomically). Direct `setDoc` / `updateDoc` / `deleteDoc` calls in app components are a seam
violation. The only permitted exception is the `aiUsage` telemetry collection (append-only,
non-domain, documented in `functions/src/telemetry.ts`).

### 5. Ground truth document maintenance

`docs/reviews/GROUND_TRUTH.md` should be updated whenever a V-item finding changes:
- A new LOB is registered or seeded (V1)
- Model constants change (V2)
- share.ts is implemented (V3)
- A new major surface is added (V9, V14)

## Consequences

- Engineers joining the project read `docs/reviews/GROUND_TRUTH.md` before the fable-handoff docs.
- Any discrepancy between GROUND_TRUTH.md and the current code means the document is stale — 
  update the document, not the code.
- The gate command (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`) must be green
  before merging to main. The gate includes `pnpm test:rules` which requires port 8080 free.

## Related

- [ADR 0001 — Model IDs](0001-model-ids.md)
- [ADR 0002 — Agent workflow](0002-agent-workflow.md)
- [BASELINE.md](../reviews/BASELINE.md)
- [GROUND_TRUTH.md](../reviews/GROUND_TRUTH.md)
