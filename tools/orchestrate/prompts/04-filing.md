================================ HARNESS RECONCILIATION (read first) ================================
This prompt runs UNATTENDED via the local orchestration harness (claude -p, --effort xhigh,
--permission-mode dontAsk). Investigate the REAL repo first and reconcile any stale text OUT LOUD,
then proceed. Known reconciliations for THIS repo (code wins over the prompt text below):
- CANARIES: the live canaries are HO-3 = $1,528 and GL = $2,635. The "$2,789" figure below is STALE.
  Keep both exact; never move a canary.
- STACK: the app is on Azure (Cosmos DB + Entra + App Service + Key Vault), not Firebase.
- PRIOR WORK: Prompts 1 (tenancy), 2 (email-OTP identity), 3 (capability RBAC) are committed on master.
- MODELS: select models by ROLE through the fleet (shared/src/ai/fleet.ts, server/lib/fleet.js); do
  NOT hardcode model strings. Approved IDs are claude-opus-4-8 and claude-haiku-4-5; never
  claude-fable-5. Any "claude-sonnet-5" mention below is indicative of the reasoning tier: use the
  fleet role. No web lookup is needed (WebFetch is not permitted in this run).
- SECRETS: the local dev credentials file is tmp_keys.md (gitignored), not tmp_acn_secrets.md.
- PERMISSIONS: you MAY read/edit/write files and run pnpm/node and NON-pushing git (add, commit,
  status, diff, log, tag, checkout, restore, merge). You may NOT push, add remotes, or run gh / az /
  WebFetch (denied). Commit locally only. If a step needs a denied tool, implement and document the
  seam in code plus docs and proceed. Do NOT push or deploy.
=====================================================================================================


Ultrathink. Maximum effort, highest reasoning (xhigh). Set /model to claude-opus-4-8. THIS IS A CORE PROMPT.

PROMPT 4 of 7. Authorization is capability-based and audited (Prompt 3). This prompt adds grounded, server-side regulatory FILING GENERATION with an IMMUTABLE, field-level audit record, verified by an independent extraction-checking model pass so nothing filed is ever fabricated. Do ONLY this. Solo `master`, no branches, commit locally only. Do NOT push or deploy.

READ FIRST, then real code:
- CLAUDE.md, docs/, 00-CURRENT_CODEBASE.md.
- The audit lineage: auditEvents (append-only { actor, action, entityType, entityPath, productId?, tenantId, at }) and versions (append-only { snapshot, diff[{field,before,after}], actor, tenantId, at }).
- The storage seam (Azure Storage) and how the app already writes/reads blobs; the export path (search app/src/lib for excel.ts / the workbook exporter); the rating evaluator under shared/src/rating.
- Grep for any existing filing primitive (filing, filingPackage, buildFilingPackage) and reconcile with what the code actually has today.
- The grounded AI wiring in functions/ and the approved model strings.

MODELS: server-side grounded/verification calls use claude-sonnet-5; bulk/cheap calls may use claude-haiku-4-5. Never use claude-fable-5. Verify exact current model strings at docs.claude.com before hard-coding them.

GUARDRAILS (unchanged) plus: the model NEVER invents coverages, forms, rules, limits, or factors; every filed field traces to a REAL version; refIds and form numbers are reproduced VERBATIM; the filing record is CREATE-ONLY and never updated after creation.

GOAL: a five-step filing flow, gated at the front and frozen at the back, whose record answers "what exactly did you file for this state on this date?" from itself, with no live re-query.
1. SCOPE. Inputs: org + product/line + stateCode + as-of. Authority-gated on filing:generate (server-side capability check from Prompt 3). Reject a viewer server-side, not just in the UI.
2. RESOLVE. The server pulls the EXACT in-scope entities at the as-of instant from real versions. Real only; no fabrication; no live model guessing of values.
3. BUILD. Assemble a DETERMINISTIC package from those resolved entities into a blob in storage (storagePath). Deterministic means the same inputs produce byte-identical output.
4. VERIFY (independent extraction check, the innovation here). After BUILD, make a SEPARATE server-side call to claude-sonnet-5 acting purely as an independent verifier: give it the built package plus the resolved source entities and require it to confirm that every field value in the package is present in a cited source version, that refIds and form numbers are verbatim, and that nothing was invented. This is a generator/verifier ensemble scoped to extraction verification. If the verifier flags ANY unsupported or altered field, the filing is REJECTED (not frozen), the discrepancy is logged, and the run stops. Record the verifier's verdict in the audit.
5. FREEZE + AUDIT. On a clean verdict, write an IMMUTABLE filings record: per-item fieldValues + versionId + contentHash per item + a packageHash over the whole package. Then write an append-only auditEvents 'filing.generate' carrying the packageHash and the verifier verdict. Create-only; never updated anywhere in the code.

DONE-WHEN:
- The five steps work end to end; a viewer is blocked server-side at SCOPE.
- Every filed field is read from a real version; refIds/form numbers verbatim; the independent verifier rejects any fabricated or altered field before freeze.
- The filings record is immutable (prove no code path updates it); item contentHashes + packageHash cover the filed content (tamper-evidence).
- A product that feeds a filing still rates $1,528 / $2,789. Quality gate green.

FINISH: hostile self-review (Is any filed field invented rather than read from a real version? Can the filings record be updated after creation anywhere? Is the actor server-derived? Does the independent verifier actually block a fabricated field, and is its verdict recorded? Do the item and package hashes cover the filed content? Are refIds/form numbers verbatim? Canaries?). Re-run the gate. Commit: git add -A && git commit -m "feat(filing): grounded server-side filing generation + independent extraction verification + immutable field-level audit record". Do not push or deploy. End with a SELF-REVIEW LEDGER: every filed field's provenance path and proof the record is create-only.
