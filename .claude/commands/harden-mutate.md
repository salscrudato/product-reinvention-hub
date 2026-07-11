---
description: Apply a single fault-injection mutation from hardening/mutations.md, confirm the gate turns red, then revert.
allowed-tools: Bash(node hardening/*), Bash(pnpm *), Bash(git *), Read, Grep, Glob, Edit
---

Apply a fault-injection mutation from `hardening/mutations.md`, verify the test suite
turns red, then REVERT.  The mutation must NOT survive beyond this session.

## Steps

1. Read `hardening/mutations.md` and locate the requested FAULT-XXX entry.
2. Read the target file at the exact location described.
3. Apply the ONE-LINE mutation described.  Nothing else.
4. Run the gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
5. Assert:
   - The specific test named in "Test that must fail" is RED.
   - No OTHER tests failed as a collateral side-effect (if collateral failures occur, note them).
   - The gate exits non-zero.
6. Run `node hardening/smoke.mjs` (if server is running) and confirm the smoke also fails.
7. **REVERT the mutation immediately:** `git restore <file>` or re-apply the original value.
8. Run the gate again to confirm it is green after revert.
9. Report:

```
FAULT-XXX inject: CONFIRMED (gate red, test <name> failed)
Reverted: gate green
```

## Guardrails

- NEVER commit the mutation.
- If the gate was already red before the mutation (pre-condition failure), stop and report — do not apply the mutation on a broken base.
- Only one mutation at a time.
