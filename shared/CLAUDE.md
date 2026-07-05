# shared/CLAUDE.md — pure domain logic (`@pf/shared`)

Read the root `CLAUDE.md` first. This file covers only what a task inside `shared/`
needs. `@pf/shared` is consumed by **both** `app` and `functions`.

## Purity rule (hard)
`shared/` is **pure TypeScript**: no `firebase/*`, no `firebase-admin`, no React, no
Node-only or browser-only APIs, no I/O. Everything is data-in → data-out so it runs
identically in the browser, in Functions and in Vitest. Platform data (Firestore docs)
is passed *in* as plain objects; getters are *injected* (see below). If you reach for a
platform import here, it belongs in `app` or `functions` instead.

Files: `types.ts` (all domain types) · `rating/evaluator.ts` · `rules/engine.ts` ·
`search/rank.ts` (TF-IDF) · `insurance/terms.ts` · `seed/ho3.ts` (HO-3 constants +
table getters) · `index.ts` (barrel — export new public symbols here).

## Rating evaluator contract (`rating/evaluator.ts`)
`evaluate(program: RatingProgram, inputs: RatingInputs, rtGetter: RtGetter,
ldGetter: LdGetter): EvaluatorResult`.
- Steps run in `order`; `op` ∈ `SET | MUL | ADD | MIN_FLOOR`; a step's `condition` is an
  input key that gates it (falsy → skipped, running total unchanged); `roundTo` rounds
  the running total after the op.
- Table lookups are **injected** (`RtGetter`, `LdGetter`) so the engine never touches
  Firestore — Functions passes `makeHO3RtGetter/ldGetter` over live tables; tests pass
  them over the seed constants.
- Returns `{ finalPremium, trace: TraceEntry[] }`; every step is traced
  (`stepId, label, op, sourceRef, factorOrAmount, rounded, runningTotal`) — the trace is
  the traceability contract the Pricing UI and `run_rating` render.

## The $1,528 canary (do not break)
`rating/evaluator.test.ts` asserts the DOMAIN_HO worked example produces **exactly
`$1,528`** with the exact per-step trace (s1 700 → ×1.05 735 → ×1.30 956 → … → 1,528).
Any change to the evaluator, `HO3_RATING_PROGRAM`, the RT/LD seed tables or
`HO3_WORKED_EXAMPLE` must keep this test green. It is the correctness canary for the
whole product; if you must change the math, update `docs/DOMAIN_HO.md` and the test in
lockstep and explain why. Preserve every refId / table refId in the seed.

## Types + refIds
`types.ts` is the shared vocabulary (Product, Coverage, Rule, Form, RatingProgram,
RTTable, LDTable, RatingInputs, SearchIndexEntry, Role, audit/version shapes, …). Keep
refId formats stable (`HO.COV.003.002`, `HO.RU.006`, `HO.LD.002`, `HO.RT.003`, form
numbers like `HO 04 61`) — they are the traceability backbone across app, functions and
the seed.

## Gate
From repo root: `pnpm typecheck` and `pnpm test` (Vitest runs the shared engines —
evaluator, rules engine, rank, types). The $1,528 test must pass.
