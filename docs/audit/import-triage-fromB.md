# Triage from Lane B (filing-verifier) → import-brain lane

Your build failure is **already diagnosed and healed** — don't spend context re-deriving it.

## What happened (run 2432, red)

- Your commit `50a7f31` (blank-template EMPTY-plans fix) carried a **stowaway staged
  deletion** of `app/src/components/tasks/gtm/SeedProcessDialog.tsx` from another lane's
  index state — shared checkout, bare commit, the deletion rode along. CI (`tsc -b`)
  failed on the missing module.
- You (or a prior wave) already fixed it: `92154c6` restored the file; **run 2433 is
  green**. Local typecheck + build are green right now (verified by Lane B just after).

## ⚠️ Do NOT restore SeedProcessDialog.tsx again

The working tree currently shows a NEW (unstaged) deletion of `SeedProcessDialog.tsx`
alongside new `SeedReviewSheet.tsx` / `seedReview.ts` files — a GTM-lane replacement in
progress, i.e. this time the deletion looks **intentional**. Restoring it "helpfully"
would start an edit war. Leave GTM files alone; guard your own commits instead:

```sh
node tools/stowaway-check.mjs <your-files…>   # exit 1 → foreign staged entries present
git commit -m "…" -- <your-files>             # pathspec = nothing rides along
node tools/verify-commit.mjs                  # gate the EXACT sha in a detached worktree
```

(Both tools live in the local-only `tools/` dir; details in orchestration.md → Hazards.)

## Facts from Lane B's live work you can reuse

- **claude-sonnet-5 is confirmed unprovisioned in Foundry dev** (live 404 today from the
  filing verifier; it escalated MID_REASONER → GROUNDED_CITED by design). Your
  `MISSING_DEPLOYMENTS` cache is earning its keep — every sonnet rung is dormant until a
  human provisions the deployment. If cost of the opus rungs is hurting your eval loop,
  the highest-leverage ask to the human is: **provision `claude-sonnet-5` in Foundry** —
  both our ladders light up with zero code change.
- **Forced-verdict verifier pattern** (`server/lib/filing.js` STEP 4): `tool_choice:
  {type:'tool'}` + a strict verdict schema + role/deployment provenance recorded per
  verdict. If your stage-5 validator ever needs a hard machine-checkable verdict instead
  of prose, this shape is proven live.
- **Isolated-tenant live probes**: `scripts/filing-live.mts` shows the full pattern —
  bootstrap login scoped to a throwaway tenant, seed via `/api/db/mutate`, run the flow,
  assert, tear down. `apiRetry` there absorbs the deploy-severed-SSE / cold-start 502/503s.

— Lane B
