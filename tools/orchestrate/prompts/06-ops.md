================================ HARNESS RECONCILIATION (read first) ================================
This prompt runs UNATTENDED via the local orchestration harness (claude -p, --effort xhigh,
--permission-mode dontAsk). Investigate the REAL repo first and reconcile any stale text OUT LOUD,
then proceed. Known reconciliations for THIS repo (code wins over the prompt text below):
- CANARIES: the live canaries are HO-3 = $1,528 and GL = $2,635. Any stale figure below is wrong.
  Keep both exact; never move a canary.
- STACK: the app is on Azure (Cosmos DB + Entra + App Service + Key Vault), not Firebase.
- PRIOR WORK: Prompts 1-5 (tenancy, identity, RBAC, filing, portal) are already committed on master.
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


Ultrathink. Maximum effort, highest reasoning (xhigh). Set /model to claude-opus-4-8.

PROMPT 6 of 7. The product surfaces exist. This prompt builds the CONFIGURABLE OPERATIONS PLANE needed to run the SaaS: tenant lifecycle, per-tenant configuration and entitlements, usage metering with cost attribution, per-tenant quotas, telemetry dashboards, and a grounded AI operations copilot that advises and proposes but never acts autonomously. Configurable as much as possible, but safely. Do ONLY this. Solo `master`, no branches, commit locally only. Do NOT push or deploy.

READ FIRST, then real code:
- CLAUDE.md, docs/, 00-CURRENT_CODEBASE.md.
- The Organization type + resolveTenantStore seam (Prompt 1); the SUPER_ADMIN/platform gate + platform console (Prompt 3); the Prompt-1 partition strategy so export and delete are partition-scoped.
- The existing AI cost-guard and circuit breaker in functions/ (these STAY IN PLACE regardless of cost, per house policy).
- The metering/telemetry surfaces that already exist, if any; the audit trail shape.

MODELS: the ops copilot uses claude-sonnet-5 for grounded answers; never claude-fable-5. Verify current strings at docs.claude.com.

GUARDRAILS (unchanged) plus: every configuration or lifecycle change is schema-VALIDATED (no arbitrary values), authority-gated to the platform plane, and AUDITED (append-only AuditEvent); the copilot NEVER writes autonomously, every mutating action it proposes requires explicit human confirmation and runs through the same audited, gated path.

GOAL: everything an operator needs to run the platform, configurable and safe.
1. TENANT LIFECYCLE (platform-gated). Provision: create a new tenant + its first TENANT_ADMIN + either a starter workspace or a blank one; new writes must be correctly partitioned. Suspend: reversible; blocks login (integrate with the Prompt-2 session mint). Offboard: produce a complete tenant EXPORT bundle, then a partition-scoped HARD DELETE, confirmation-gated; deletion touches only that tenant's partition.
2. PER-TENANT CONFIGURATION (validated + audited). Branding, feature flags, model selection (only from approved GA strings), and plan ENTITLEMENTS (max seats, max products, monthly AI token budget). Every config change is schema-checked and writes an AuditEvent. Config drives both the app and the AI layer at runtime.
3. METERING + COST ATTRIBUTION. Meter every AI call and attribute token usage + cost PER TENANT. Enforce a per-tenant budget throttle layered ON TOP of the existing global cost-guard/circuit-breaker (which remains intact regardless of cost).
4. QUOTAS + RATE LIMITS. Per-tenant quotas (seats, products) and per-tenant rate limits, enforced server-side.
5. TELEMETRY DASHBOARDS. Per-tenant usage + health: seats used vs entitlement, products, AI tokens + attributed cost vs budget, error/latency signals, and login/audit activity. Read from real data only.
6. AI OPERATIONS COPILOT (the innovation here). A grounded operator assistant that answers natural-language questions ("which tenants are near their token budget?", "show failed logins for org X this week") STRICTLY from real telemetry/audit data, citing the underlying data and never fabricating a number. It may PROPOSE a configuration or lifecycle action (e.g. "raise org X's seat cap to 50"), rendering it as a confirmable action, but it NEVER executes; the human confirms and the action runs through the normal validated, gated, audited path. Read/advise/propose only.

DONE-WHEN:
- Provision creates a tenant + first admin + starter/blank workspace with correct partitioning. Suspend blocks login. Offboard exports a complete bundle then deletes only that tenant's partition, confirmation-gated.
- Per-tenant branding, flags, model selection, and entitlements drive the app + AI layer; every config change is schema-validated and audited.
- AI usage is metered and cost-attributed per tenant; the per-tenant budget throttle works; the global breaker is intact. Per-tenant quotas + rate limits enforced server-side.
- Telemetry dashboards read real data. The ops copilot answers only from real data, cites it, and cannot mutate anything without explicit human confirmation through the audited path.
- Both canaries exact. Quality gate green.

FINISH: hostile self-review (Is delete truly partition-scoped, touching no other tenant? Can any config change bypass validation, gating, or audit? Can the copilot mutate state without human confirmation, or cite a number it did not read from real data? Is model selection restricted to approved strings? Is the global cost-guard still intact? Canaries?). Re-run the gate. Commit: git add -A && git commit -m "feat(ops): configurable operations plane, tenant lifecycle + entitlements + metering + telemetry + advise-only AI copilot". Do not push or deploy. End with a SELF-REVIEW LEDGER: provisioning, config validation, metering, delete scope, and copilot boundaries, each proven safe and tenant-bounded.
