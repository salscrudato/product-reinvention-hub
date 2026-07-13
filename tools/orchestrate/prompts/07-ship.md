================================ HARNESS RECONCILIATION (read first) ================================
This prompt runs UNATTENDED via the local orchestration harness (claude -p, --effort xhigh,
--permission-mode dontAsk). Investigate the REAL repo first and reconcile any stale text OUT LOUD,
then proceed. Known reconciliations for THIS repo (code wins over the prompt text below):
- CANARIES: the live canaries are HO-3 = $1,528 and GL = $2,635. Any stale figure below is wrong.
  Keep both exact; never move a canary.
- STACK: the app is on Azure (Cosmos DB + Entra + App Service + Key Vault), not Firebase.
- PRIOR WORK: Prompts 1-6 are already committed on master.
- MODELS: select models by ROLE through the fleet (shared/src/ai/fleet.ts, server/lib/fleet.js); do
  NOT hardcode model strings. Approved IDs are claude-opus-4-8 and claude-haiku-4-5; never
  claude-fable-5. No web lookup is needed (WebFetch is not permitted in this run).
- SECRETS: the local dev credentials file is tmp_keys.md (gitignored). There may be NO
  tmp_acn_secrets.md in this repo; investigate what actually holds secrets and reconcile out loud.
  There is also a CI gitleaks gate that scans the current tree only.
- PERMISSIONS: you MAY read/edit/write files and run pnpm/node and NON-pushing git (add, commit,
  status, diff, log, tag, checkout, restore, merge). You may NOT push, add remotes, or run gh / az /
  WebFetch (denied). Azure Key Vault migration via managed identity cannot run here (az denied), so
  IMPLEMENT AND DOCUMENT that migration as a wired seam in code plus docs rather than executing it.
  Commit locally only. Do NOT push or deploy; hand back to the human for review and deploy.
=====================================================================================================


Ultrathink. Maximum effort, highest reasoning (xhigh). Set /model to claude-opus-4-8. THIS PROMPT IS A RECURSIVE CONVERGENCE LOOP, not a one-shot. Iterate until the ledger computes zero open defects, or write an honest gap report.

PROMPT 7 of 7. The platform is built (Prompts 1 through 6). This prompt hardens secrets, produces compliance evidence, and PROVES isolation with an adversarial suite that must fail closed on every cross-tenant and cross-persona attempt. It is the gate that certifies the platform is safe to sell. Do ONLY this. Solo `master`, no branches, commit locally only. Do NOT push or deploy.

READ FIRST, then real code:
- CLAUDE.md, docs/, 00-CURRENT_CODEBASE.md.
- Secrets today: tmp_acn_secrets.md (live Foundry + Anthropic keys), any ANTHROPIC_API_KEY / Foundry / email-provider references, and how functions/ read them.
- Every seam built in Prompts 1 to 6: tenant partitioning + mutate scoping, email-OTP identity + login audit, capability enforcement + impersonation, filing generation + immutable record, the policyholder portal, and the ops plane.
- The audit trail (auditEvents, versions), its tenant stamping, and the CMK/silo seam left in Prompt 1.

GUARDRAILS (unchanged) plus: do NOT weaken a check or loosen a test to make a run pass. Fix the CODE, not the test. Never touch a canary. "Zero defects" is a COMPUTED condition read from the ledger, never a reviewer's assertion.

GOAL: prove the whole platform holds under adversarial pressure, with machine-checkable evidence.
1. SECRETS. Migrate all live secrets (Foundry key, Anthropic key, email-provider credentials, signing keys) to Azure Key Vault via managed identity. Retire tmp_acn_secrets.md and PROVE it was never committed to git history (inspect git log and history; if it ever was, say so plainly and treat rotation as required). No secret in the client bundle, ever.
2. EXTERNALIZED DEFECT LEDGER. Create docs/isolation_ledger.json that PERSISTS across Claude Code sessions. Each entry: { id, seam, attack, severity, expected: "DENIED", actual, status: "open" | "fixed", rootCauseWave }. The loop's exit condition is computed from this file.
3. ADVERSARIAL SUITE. Stand up two live tenants A and B and a policyholder in A. Every one of these attempts must FAIL CLOSED (assert DENIED): cross-tenant read, write, list, and search; AI grounding leakage (a tenant-A prompt must never cite tenant B's catalog, in the portal advisor, the filing verifier, or the ops copilot); filing generation across tenants; policyholder A reaching B's data or another policyholder's policy; share-link crossing; admin action across tenants; impersonation escape; capability escalation (a tenant user acquiring a platform role); OTP tenant-crossing (a code issued for one org cannot authenticate into another); and config/metering/telemetry leakage across tenants. Any leak is a release blocker logged to the ledger. The suite runs inside the quality gate.
4. RECURSIVE LOOP. Repeat until the bar is met: (a) run the suite and refresh the ledger; (b) group open defects by ROOT CAUSE into waves; (c) fix ONE wave in the code (never the test); (d) re-run. Continue until the ledger computes zero open defects, or stop and write an honest gap report listing what remains and why.
5. INDEPENDENT JUDGE (the certification innovation). Before the go/no-go, make a final independent claude-opus-4-8 call that reviews the diff, the ledger, and the test coverage against an attack rubric and must attest that coverage is adequate and every seam above is exercised. Record its verdict. The generator built the tests; an independent judge certifies them.
6. EVIDENCE. Per-tenant, tamper-evident audit export (SOC 2-style): auditEvents proven append-only + tenant-stamped; export a reviewer-ready, hash-chained bundle. Wire the real CMK seam for enterprise (silo) tenants; pooled tenants unaffected. Write docs/ISOLATION_PROOF.md with the full attack matrix, iteration history, and final ledger state.

DONE-WHEN:
- All secrets in Key Vault via managed identity; tmp_acn_secrets.md retired and proven never-tracked (or rotation flagged if it was).
- docs/isolation_ledger.json computes zero open defects, OR an honest gap report is written. The adversarial suite covers every seam above, fails closed on every attempt, and runs in the gate.
- The independent judge has attested coverage; its verdict is recorded. Per-tenant tamper-evident audit export works; CMK seam wired for enterprise tenants. docs/ISOLATION_PROOF.md holds the matrix + iteration history.
- Full quality gate green. Both canaries exact. NOTHING pushed or deployed.

FINISH: final hostile self-review across the whole platform (isolation, capability enforcement, no silent writes, immutable + tamper-evident filing audit, portal persona isolation, copilot cannot mutate, dev bypass gone, secrets in Key Vault, canaries). Re-run the gate. Commit: git add -A && git commit -m "test(isolation): adversarial cross-tenant + cross-persona proof to production bar via convergence loop + independent judge + compliance evidence". Do not push or deploy. Hand back to the human for review and deploy. End with a SELF-REVIEW LEDGER: every isolation attack, its result (must be DENIED), the final ledger count, and a clear GO or NO-GO recommendation for production.
