# Architecture Decision Records

Short records of the **load-bearing** decisions in this monorepo — the invariants that
every future session should build on rather than re-litigate. Each ADR is one page:
context, decision, consequences. They are the "why" behind the Golden Rules in the root
`CLAUDE.md`; the scoped `app/`, `functions/` and `shared/` guides are the "how".

| ADR | Decision | Enforced by |
|---|---|---|
| [0001](0001-backend-adapter-seam.md) | Backend adapter seam — app never imports `firebase/*` | Convention + review; `docs/AWS_SWAP.md` |
| [0002](0002-mutation-invariant.md) | Every write is one atomic batch: entity + audit + version + searchIndex + rev | `adapter.db.mutate()`; `firestore.rules` |
| [0003](0003-roles-via-custom-claims.md) | Roles via Auth custom claims, enforced in rules **and** Functions | `firestore.rules` + `authenticate()` |
| [0004](0004-grounded-ai-functions.md) | Grounded AI in Functions only; cite refIds/forms; never invent | `functions/src/tools.ts` |
| [0005](0005-rating-engine-and-1528-canary.md) | Pure rating engine in `shared/`; the $1,528 canary | `shared/src/rating/evaluator.test.ts` |
| [0006](0006-ga-model-policy.md) | GA model policy (Sonnet 4.6 / Haiku); one-line Glasswing swap | `functions/src/runtime.ts` |

## Conventions

- **Immutable once Accepted.** Don't rewrite history — supersede. If a decision changes,
  add a new ADR and mark the old one `Superseded by ADR-NNNN`.
- **Numbered, kebab-case, zero-padded** (`0007-...`). Next number: `0007`.
- Keep each to one page. If it needs more, it's a design doc — put it in `docs/`.
