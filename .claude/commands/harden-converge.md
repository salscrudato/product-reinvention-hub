---
description: Recompute the ledger SUMMARY line and report open defect counts. Exits non-zero if any are open.
allowed-tools: Bash(node hardening/convergence.mjs), Read
---

Run the convergence checker against `hardening/ledger.md`.

```
node hardening/convergence.mjs
```

This script:
1. Parses every `### DEF-XXXX` block in `hardening/ledger.md`.
2. WONTFIX entries without a `Sal-acknowledged: yes` line are counted as OPEN.
3. Rewrites the `SUMMARY:` line (line 1) in place.
4. Prints the counts and per-defect breakdown.
5. Exits 0 only if OPEN == 0; exits 1 otherwise.

Report the raw output and the exit code.  If OPEN > 0, list which defects are still open.
Do not change ledger content — this command is read-and-report only (convergence.mjs rewrites
only the SUMMARY line as designed).
