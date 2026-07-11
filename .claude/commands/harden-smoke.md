---
description: Run the hardening smoke harness against the local or live server and report results.
allowed-tools: Bash(node hardening/*), Bash(pnpm *), Bash(curl *), Read
---

Run `hardening/smoke.mjs` against the target server and report the result.

## Steps

1. Determine the target:
   - **Local** (default): `BASE_URL=http://localhost:3000` — requires `node server/server.js` running.
   - **Live**: user must specify `BASE_URL=https://<your-host>`.
2. Check that the server is reachable: `curl -sf $BASE_URL/api/health || echo "UNREACHABLE"`.
   If unreachable in LOCAL mode, remind the user to start the server: `node server/server.js`.
3. Run: `node hardening/smoke.mjs`
   (Set `MODE=LIVE BASE_URL=<url>` for the live target.)
4. Report the result verbatim — do not interpret or soften failures.
5. If the smoke exits 1, identify the first `SMOKE FAIL:` line and link it to the relevant
   DEF-XXXX entry in `hardening/ledger.md` if one exists.

## Known current state

`POST /api/ai/unifiedImport` returns 501 (not ported to Azure host).  The HO path will
`SMOKE FAIL` with "HO filing import not ported to Azure host" — this is expected until
DEF-0006 (unifiedImport) is fixed.  The GL path runs only after the HO path passes.
