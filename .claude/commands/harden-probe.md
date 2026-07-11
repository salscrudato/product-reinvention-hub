---
description: Run a targeted hardening probe against a specific DEF-XXXX entry in the ledger.
allowed-tools: Bash(node hardening/*), Bash(pnpm *), Bash(grep *), Read, Grep, Glob
---

Run a hardening probe against a specific defect in `hardening/ledger.md`.

## Steps

1. Read `hardening/ledger.md` and locate the requested DEF-XXXX block.
2. Read its `surface` and `evidence` lines to understand exactly where in the codebase the defect manifests.
3. Run the exact `repro` command listed in the defect block.  Observe the output.
4. Determine whether the defect is still present (status should remain OPEN), has been accidentally fixed (update evidence), or turns out to be a false positive.
5. Report findings:
   - If still OPEN: confirm with the exact observed evidence.
   - If fixed unexpectedly: note the commit and ask the user before changing ledger status.
   - If false positive: explain why and ask before marking FALSE-POSITIVE.
6. Do NOT change any product code.  Do NOT change the ledger status without user approval.

Report format:
```
DEF-XXXX probe result: CONFIRMED OPEN | FIXED | FALSE-POSITIVE
Evidence: <exact command output or file lines>
```
