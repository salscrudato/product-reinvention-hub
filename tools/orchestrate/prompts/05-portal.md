================================ HARNESS RECONCILIATION (read first) ================================
This prompt runs UNATTENDED via the local orchestration harness (claude -p, --effort xhigh,
--permission-mode dontAsk). Investigate the REAL repo first and reconcile any stale text OUT LOUD,
then proceed. Known reconciliations for THIS repo (code wins over the prompt text below):
- CANARIES: the live canaries are HO-3 = $1,528 and GL = $2,635. Any stale figure below is wrong.
  Keep both exact; never move a canary.
- STACK: the app is on Azure (Cosmos DB + Entra + App Service + Key Vault), not Firebase.
- PRIOR WORK: Prompts 1-4 (tenancy, identity, RBAC, filing) are already committed on master.
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

PROMPT 5 of 7. The platform has tenants, identity, authority, and filings. This prompt adds a CUSTOMER-FACING claims and coverage portal for policyholders: a single page where a policyholder uploads their policy once and receives a beautiful, mobile-optimized, interactive in-app summary of their coverage, the risks in their area, and grounded upsell advice, produced by a live model call and quality-gated by an independent judge loop. Do ONLY this. Solo `master`, no branches, commit locally only. Do NOT push or deploy.

READ FIRST, then real code:
- CLAUDE.md, docs/, 00-CURRENT_CODEBASE.md.
- The tenant boundary + resolveTenantStore (Prompt 1), the identity/session (Prompt 2), and the capability model (Prompt 3): a policyholder is a NEW, lowest-trust persona and must be modeled as such.
- The grounded AI wiring in functions/, the cost-guard/circuit-breaker, the storage seam, and the product/coverage/forms catalog shapes in shared/src/types.ts.
- The design tokens and the app's visual language (this artifact must look native to the product).

MODELS: server-side extraction, generation, and judging use claude-sonnet-5; never claude-fable-5. Verify current strings at docs.claude.com. All AI is server-side; the client only renders returned, sanitized HTML.

GUARDRAILS (unchanged) plus: STRICT PERSONA ISOLATION, a policyholder can access ONLY their own uploaded policy and their carrier tenant's context, and has ZERO access to authoring surfaces, other policyholders' policies, or any other tenant. The advisor may ONLY reference coverages, forms, limits, and perils that exist in the carrier tenant's REAL catalog, cited by [refId] and form number; it must never invent coverage, limits, or risks; if something is not in the catalog it says so.

GOAL: an engaging, trustworthy, mobile-first policyholder experience on one Claims page.
1. PERSONA + ISOLATION. Add a POLICYHOLDER persona scoped to a single org and a single policy. Every read/write for this persona is tenant-partitioned and persona-gated server-side (reuse the Prompt 3 capability checks; policyholders get a minimal read-only capability set plus their own upload). No authoring routes are reachable.
2. ONE-TIME UPLOAD. A single policy-document upload (PDF). Server-side grounded extraction (claude-sonnet-5) parses coverages, limits, deductibles, and endorsements into a structured, tenant-scoped record. Store it partitioned; audit the upload.
3. GENERATE THE SUMMARY (live model call). The server generates a beautiful, ENGAGING, MOBILE-OPTIMIZED, interactive in-app HTML summary rendered inside the portal, covering: (a) a plain-language coverage summary (what is covered, limits, deductibles); (b) RISKS IN THEIR AREA, geo-derived from the policy's insured address, surfacing relevant local perils grounded in the tenant's own risk/catalog data, never fabricated; (c) COVERAGE GAPS + TAILORED UPSELL, recommending only additional coverages/endorsements the carrier actually offers, each cited to a real catalog [refId] and form number. This is the upsell surface.
4. INDEPENDENT JUDGE LOOP (recursive, the innovation here). After generation, make a SEPARATE claude-sonnet-5 call acting as an independent judge that scores the summary against an explicit rubric: factual fidelity to the extracted policy (no fabrication), grounding (every recommendation cites a real refId that exists in the catalog), mobile-friendliness and accessibility, tone (helpful, never pushy or alarmist), and safety (no misleading coverage claims). If the judge scores below threshold on any axis, REGENERATE with the judge's critique appended to the prompt; loop up to a small bounded number of times; if it still fails, fall back to a plain deterministic (non-model) summary and log the fallback. Never render an ungrounded or judge-failed summary.
5. RENDER SAFELY. The client renders only sanitized returned HTML. No secrets, no other-tenant data, no cross-policy data ever crosses into the portal.

DONE-WHEN:
- A policyholder can log in, upload one policy, and see a mobile-optimized interactive summary with coverage, area risks, and grounded upsell, all cited to real catalog refIds/form numbers.
- The policyholder persona is server-gated to their own policy and tenant only; no authoring or cross-tenant/cross-policy access exists.
- The generator/judge loop runs: a failing summary is regenerated or falls back to a deterministic summary; no fabricated or ungrounded summary is ever shown.
- Upload + summary are tenant-partitioned and audited. Cost-guard/breaker intact. Both canaries exact. Quality gate green.

FINISH: hostile self-review (Can a policyholder reach any other policy, any other tenant, or any authoring route? Does the advisor ever recommend a coverage/form not in the real catalog, or invent a peril? Is every recommendation cited to a real refId? Does the judge loop actually block a bad summary? Is all AI server-side and the rendered HTML sanitized? Canaries?). Re-run the gate. Commit: git add -A && git commit -m "feat(portal): policyholder claims + coverage portal, grounded upload-to-summary with independent judge loop and strict persona isolation". Do not push or deploy. End with a SELF-REVIEW LEDGER: every policyholder read/write path, its persona + tenant gate, and proof the advisor is grounded.
