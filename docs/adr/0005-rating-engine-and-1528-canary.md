# ADR-0005: Pure rating engine in `shared/` + the $1,528 canary

- **Status:** Accepted
- **Date:** 2026-07-05

## Context

Pricing math is the correctness core of the product. It runs in three places — the
browser (live Pricing trace), Functions (the `run_rating` tool), and Vitest — and must
produce identical results in all of them. It must also be impossible to change the math
by accident: a silent drift in a factor or rounding rule would mis-price a real product.

## Decision

- **The rating evaluator lives in `shared/` as pure TypeScript.** No `firebase/*`, no
  `firebase-admin`, no React, no I/O. `evaluate(program, inputs, rtGetter, ldGetter)` is
  data-in → data-out; the RT/LD **table getters are injected**, so the engine never
  touches Firestore. Functions inject getters over live tables; tests inject them over the
  seed constants. This purity is what lets `shared/` move to AWS unchanged
  (see [ADR-0001](0001-backend-adapter-seam.md)).
- Steps run in `order` (`op ∈ SET | MUL | ADD | MIN_FLOOR`, optional gating `condition`,
  optional `roundTo`) and the evaluator returns a **full per-step `trace`** — the
  traceability contract the Pricing UI and `run_rating` render.
- **The $1,528 canary is load-bearing.** `shared/src/rating/evaluator.test.ts` asserts the
  `docs/DOMAIN_HO.md` worked example produces **exactly `$1,528`** with the exact per-step
  trace (s1 700 → ×1.05 → ×1.30 → … → 1,528). The seed re-verifies it on every run and
  refuses to call itself healthy otherwise.

## Consequences

- The engine is testable and portable with zero backend; the same code prices in the UI,
  the AI tool, and CI.
- **Any** change to the evaluator, `HO3_RATING_PROGRAM`, the RT/LD seed tables, or
  `HO3_WORKED_EXAMPLE` must keep the canary green. If the math genuinely must change, update
  `docs/DOMAIN_HO.md` and the test **in lockstep**, and say why in the commit.
- All refIds / table refIds in the seed are preserved — they are the traceability backbone
  the canary and the grounded AI both depend on.
