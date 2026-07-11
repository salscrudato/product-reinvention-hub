---
description: Apply a fix for a specific DEF-XXXX entry, then re-run the probe and convergence to confirm green.
allowed-tools: Bash(node hardening/*), Bash(pnpm *), Bash(grep *), Read, Grep, Glob, Edit, Write
---

Fix a specific defect from `hardening/ledger.md` and close it.

## Steps

1. Read `hardening/ledger.md` and locate the target DEF-XXXX block.
2. Read the `surface`, `evidence`, and `repro` lines to understand the exact flaw.
3. Read ALL files named in `surface` before making any change.
4. Apply the minimal fix — no collateral cleanup, no refactoring beyond what the defect requires.
5. After the fix, run the gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
   - If the gate breaks, revert and report — do not leave the gate red.
6. Re-run the `repro` command from the defect block and confirm the defect no longer manifests.
7. Update `hardening/ledger.md` for the fixed DEF-XXXX:
   - Set `status: FIXED`
   - Fill `fix:` with a one-line description of the change
   - Fill `verified-by:` with the exact command that now returns green
   - Fill `commit:` with the local commit sha after committing
8. Run `node hardening/convergence.mjs` — it will rewrite the SUMMARY line.

## Guardrails

- No product behavior changes beyond the minimum required to close the defect.
- The adapter seam (`app/src/lib/backend/`) is untouched unless the defect explicitly lives there.
- `shared/` stays platform-free.
- No secret values in any changed file.
- No hard-coded hex colors.
