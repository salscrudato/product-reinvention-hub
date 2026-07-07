# shared/ — @pf/shared (pure TypeScript)

See [../CLAUDE.md](../CLAUDE.md) for the binding invariants that apply across every workspace.

Zero platform imports. Consumed by both `app/` and `functions/`. Any change here is a cross-workspace breaking change — run the full gate after editing.

## Key files

| File | Purpose |
|---|---|
| `src/types.ts` | Canonical domain types — Product, Coverage, Form, Rule, TraceEntry, … |
| `src/rating/evaluator.ts` | HO-3 + GL rating evaluator |
| `src/rating/evaluator.test.ts` | **Load-bearing canary — must produce $1,528 for HO-3 on every run** |
| `src/rating/rtGrid.ts` | Rate-table / grid lookups |
| `src/rating/kits.ts` | Per-coverage premium kits |
| `src/rules/engine.ts` | Condition / outcome rules engine |
| `src/seed/ho3.ts` | HO-3 canonical seed (the product at the centre of every worked example) |
| `src/seed/gl.ts` | GL (General Liability) seed |
| `src/search/rank.ts` | Retrieval ranker for cross-entity search |
| `src/insurance/` | LOB registry, ISO import helpers, insurance terms |

## Invariants

- `evaluator.test.ts` must pass at **$1,528** (HO-3 worked example). This is the regression canary for the entire rating stack. Any change to evaluator, kits, or rtGrid must confirm the canary still holds.
- `types.ts` is the shared contract. Renaming or removing a field is a breaking change across both workspaces.
- No `firebase`, no `window`, no `process.env` — pure TypeScript only.

## Running tests

```sh
pnpm --filter @pf/shared test   # shared tests only
pnpm test                       # all unit tests from root (includes shared + app)
```
