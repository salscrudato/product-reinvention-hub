================================ HARNESS RECONCILIATION (read first) ================================
This prompt runs UNATTENDED via the local orchestration harness (claude -p, --effort xhigh,
--permission-mode dontAsk). Investigate the REAL repo first and reconcile any stale text OUT LOUD,
then proceed. Known reconciliations for THIS repo (code wins over the prompt text below):
- CANARIES: the live canaries are HO-3 = $1,528 and GL = $2,635. The "$2,789" figure below is STALE.
  Keep both exact; never move a canary.
- STACK: the app is on Azure (Cosmos DB + Entra + App Service + Key Vault), not Firebase.
- PRIOR WORK: Prompts 1 (tenancy) and 2 (email-OTP identity) are already committed on master.
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

PROMPT 3 of 7. Identity is now email-OTP and tenant-scoped (Prompt 2). This prompt moves authorization off role-string comparison onto a CAPABILITY model across two planes, enforces it server-side everywhere, makes member administration fully audited, bounds the currently-unbounded admin reads, and ships a self-service Tenant Admin console plus a platform console. Do ONLY this. Solo `master`, no branches, commit locally only. Do NOT push or deploy.

READ FIRST, then real code:
- CLAUDE.md, docs/, 00-CURRENT_CODEBASE.md.
- The current role model (VIEWER / EDITOR / ADMIN): where it is set (the setUserRole path) and every place a role string is compared. Grep for 'ADMIN', 'EDITOR', 'VIEWER', role !==, role ===.
- The Prompt-2 Session { uid, tenantId, role } and JIT provisioning.
- app/src/routes/Admin.tsx and its tabs; every db.list it makes (users + audit reads are currently UNBOUNDED, a known issue).
- The mutate() contract and the design tokens (no hard-coded hex; roles + refIds render as monospaced chips).

GUARDRAILS (unchanged) plus: authorization is server-side and authoritative; UI gating is supplementary only, the server is always the guard and the UI merely hides what the server would reject; every role/authority change is an append-only Version + AuditEvent, never a silent claim write.

GOAL: capability-based authority across a platform plane and a tenant plane.
1. Two planes. PLATFORM plane (operates the SaaS across tenants, tightly gated): SUPER_ADMIN, SUPPORT. TENANT plane (scoped to one org): TENANT_ADMIN, EDITOR, VIEWER, plus inquiry-only persona scopes UNDERWRITING, COMPLIANCE, CLAIMS, ACTUARIAL mapped from the prior app's viewer to compliance to underwriter to actuary to product_manager to admin hierarchy. Inquiry-only personas can read but never write.
2. Capabilities, not magic strings. Define an explicit capability set: product:read, product:write, filing:generate, changeset:approve (authority reserved for a future approval workflow, wired but the workflow itself deferred), member:manage, role:assign, and platform:* capabilities for the platform plane. A role is a NAMED BUNDLE of capabilities. Write the full role to capability matrix to docs/AUTHORITIES.md.
3. Enforcement. Authority = (plane, role, tenantId, capability). Every privileged action checks a CAPABILITY plus SAME-TENANT, server-side. Replace every surviving role-string comparison with a capability check. filing:generate sits only with the tenant product_manager-equivalent and TENANT_ADMIN.
4. Audited member administration. invite / change-role / remove all go through mutate() producing an append-only Version + AuditEvent. No claim is ever written silently.
5. Bound the admin reads. Org-scope AND paginate every db.list on users and audit. No unbounded list survives.
6. Consoles. A self-service TENANT ADMIN console: manage only the caller's own org (members, roles, org settings), within-tenant only. A PLATFORM console (the old global Admin, repurposed): cross-tenant operations, gated strictly to platform roles.
7. Impersonation. Platform SUPPORT may impersonate a user WITHIN a tenant for support: dual-attributed (both the real actor and the impersonated subject appear in every audit row), time-boxed, fully audited. No path may ever grant a platform role to a tenant user, or let a tenant user act outside their org.
8. Migrate the old flat roles carefully: map EDITOR to the tenant editor/product_manager bundle and ADMIN to TENANT_ADMIN without accidentally WIDENING anyone's access.

DONE-WHEN:
- Enforcement is capability-based and server-side; every write is gated on a capability plus same-tenant. docs/AUTHORITIES.md holds the full matrix.
- Member admin (invite/change-role/remove) is append-only audited; no silent claim writes. No unbounded db.list remains.
- Tenant Admin console is within-tenant only; platform console is platform-gated. Impersonation is dual-attributed, audited, time-boxed.
- No path grants a platform role to a tenant user. Both canaries exact. Quality gate green.

FINISH: hostile self-review (Any surviving role-string comparison that should be a capability check? Any client-asserted role/capability trusted? Did the EDITOR to product_manager map widen access anywhere? Can a tenant admin touch another org's members or audit? Any db.list still unbounded? Does every role change write an append-only version? Any hard-coded hex? Canaries?). Re-run the gate. Commit: git add -A && git commit -m "feat(authz): two-plane capability model + audited member admin + bounded reads + tenant/platform consoles + scoped impersonation". Do not push or deploy. End with a SELF-REVIEW LEDGER: every action, its required (plane, role, tenant, capability) check, and proof it is enforced server-side.
