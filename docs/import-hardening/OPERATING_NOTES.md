# IH operating notes (advisory; the eval is law; hard cap 40 lines)

Created by IH2, 2026-07-14. Prune stale lines every self-tune.

## Standing (from IH1 + orchestration; each also exists as a fixture or gate)
- Gate the exact sha you push: `node tools/verify-commit.mjs` (shared dirty tree lies).
- Before EVERY commit: `node tools/stowaway-check.mjs <files…>`; commit with `git commit --only -- <files>`.
- Touch server-consumed `shared/src/**` → rebuild + commit `server/lib/*-shared.cjs` (`pnpm build:import-brain` etc.).
- F19/PCM-C are DISPROVEN — version WRITES work; never "fix" the write path. Gap is read-side (PCM-B).
- Detached live runs: PowerShell Start-Process on CRLF/ASCII .cmd (Set-Content -Encoding Ascii); tee to log; never pipe a probe to head.
- Live tests only in isolated tenants (accenture-test); never testco; tear down drafts.
- `--rescore` re-scores the last extraction dump offline in seconds; server-side changes need fresh `--live`.
- brain-routing.test.ts mocks server/lib/fleet — new fleet exports must be added to the mock.
- Node 24 env artifacts: sources.test.ts resolveImageUrl + isoFixture snapshot churn are NOT regressions (verify via clean-tree stash).

## Learned this run (IH2)
- (none yet)
