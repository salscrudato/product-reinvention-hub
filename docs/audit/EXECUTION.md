# Hardening Campaign -- Execution Work Queue

**Campaign:** 5-session security and quality hardening (S1--S5)
**Branch:** feat/hardening-2026-07 (from main)
**Date started:** 2026-07-12
**Owner:** Sal Scrudato (Accenture)

---

## git remote -v (captured before filter-repo run)

```
origin  https://dev.azure.com/garage-repos/Product%20Hub/_git/Product%20Hub (fetch)
origin  https://dev.azure.com/garage-repos/Product%20Hub/_git/Product%20Hub (push)
```

---

## Conventions

- One checkbox per work item. Check it off as soon as it is done.
- Commit format: `type(ID): summary` -- one ID per commit, no em-dashes, no en-dashes, no emoji.
- After 3 failed attempts on any item, mark it **BLOCKED** with notes and move on.
- **HUMAN-ACTION** items require the repo owner (Sal Scrudato) to act outside this repo.
- Update this file continuously so state survives context compaction.

---

## Session 1 -- Security (S1)

### RISK-001 -- Leaked API key in git history

**HUMAN-ACTION (owner must do these steps out-of-repo):**

1. **Rotate AZURE_FOUNDRY_KEY in Azure AI Foundry portal:**
   - Go to Azure AI Foundry: https://ai.azure.com
   - Navigate to your Foundry project -> Settings -> Keys and Endpoint
   - Click "Regenerate" (or "Rotate") for the AZURE_FOUNDRY_KEY
   - Copy the new key value

2. **Update App Service configuration:**
   - Go to Azure Portal -> App Services -> app-prodhub-dev
   - Settings -> Configuration -> Application settings
   - Find AZURE_FOUNDRY_KEY and update it to the new value
   - Click Save and trigger a restart

3. **Force-push clean history to remote (after filter-repo run below):**
   - `git push origin --force --all`
   - `git push origin --force --tags`
   - Notify ALL repository contributors to delete their local clones and re-clone from origin.
   - Revoke personal access tokens that may have been used to clone the repo while the key was exposed.

4. **Audit access logs:**
   - Check Azure AI Foundry usage logs for any unexpected API calls between the commit date (2026-07-10) and the key rotation date.
   - If suspicious usage found, report to security team.

**Code-side actions (automated in this session):**
- [x] Captured remote URLs before filter-repo (see top of this file)
- [x] Verified tmp.md is already in .gitignore (tmp*.md and tmp.md patterns)
- [ ] Run `git filter-repo --path tmp.md --invert-paths --force` (strips tmp.md from ALL commits)
- [ ] Re-add remote after filter-repo strips it
- [ ] Verify `git log --all --full-history -- tmp.md` returns nothing
- [ ] Add gitleaks full-history scan step to azure-pipelines.yml
- [ ] Verify gitleaks scan is clean on current tree

- **Acceptance test:** `git log --all --full-history -- tmp.md` returns empty; gitleaks exits 0
- **Session:** S1

---

- [x] **RISK-002** | Bootstrap accounts enabled by default with weak passwords | Source-audit: auth.js has startup warning when BOOTSTRAP_ENABLED with default passwords; BOOTSTRAP_USERS_ENABLED default is documented | S1

- [x] **RISK-003** | No rate limit on POST /api/auth/login (brute force) | Source-audit: server.js applies loginRateLimit middleware to /api/auth/login | S1

- [x] **RISK-004** | Blob path traversal on POST /api/storage/upload | Source-audit: storage.js rejects path containing `..` or `\` or leading `/` | S1

- [x] **RISK-005** | In-memory state breaks on multi-instance scale-out | docs/DEPLOY_AZURE.md documents single-instance requirement; server.js logs warning | S1

- [x] **RISK-006** | No JWT revocation mechanism | Source-audit: auth.js adds `jti` to new tokens and checks revokedToken in Cosmos on attachUser; logout revokes token | S1

  **Conflict resolution (HANDOFF section 8 vs RISK-006):**
  HANDOFF section 8 says "do not change JWT format". RISK-006 requires adding `jti` for revocation.
  Resolution (owner intent wins per campaign spec): Adding `jti` is additive and backward-compatible.
  Old tokens without `jti` are not revocable but expire naturally at 12h TTL. New tokens get `jti`
  and can be revoked immediately. The RANK ordering and signature algorithm are unchanged.

- [x] **RISK-007** | Tenant enumeration via GET /api/auth/tenants (no rate limit) | Source-audit: server.js applies tenantsRateLimit middleware | S1

- [x] **RISK-008** | ORDER BY direction not validated to ASC/DESC | Source-audit: data.js explicitly validates direction to `['ASC','DESC']` before using in SQL | S1

- [x] **RISK-009** | HomeCheck session accessible by UUID-knower only | Source-audit: homecheck.js generates sessionSecret on creation, returns it in POST response, validates on GET/DELETE/export | S1

- [ ] **RISK-010** | PROBE_MODE=1 exposes raw audit docs | docs/DEPLOY_AZURE.md explicitly states PROBE_MODE must NOT be set in production App Service config | S1

- [x] **RISK-011** | Password minimum length is 3 chars (trivially weak) | Source-audit: auth.js changePassword rejects passwords shorter than 12 chars | S1

- [x] **RISK-012** | No global Express error handler (stack traces may leak) | Source-audit: server.js has 4-arg `(err, req, res, next)` error handler before app.listen | S1

- [ ] **RISK-013** | Personal names in server-side sys-diag.js banner | sys-diag.js banner replaced with org-level branding (no personal names) | S1

- [x] **RISK-014** | functions/ reference workspace not clearly documented | CLAUDE.md and functions/CLAUDE.md clearly state reference-only, not deployed | S1 (documentation verified)

- [ ] **RISK-015** | No structured logging (console.log/warn throughout server) | Startup warning added noting OpenTelemetry is a future follow-up; tagged log format for key security events | S1

  **Note:** Full structured logging (pino/winston + App Insights) requires a new server dependency and
  significant refactor. Tagged minimal approach covers key security events in S1; full OTel is REQ-12g (S4).

- [ ] **RISK-016** | ANALYST role not differentiated in UI (same affordances as VIEWER) | UI change deferred to S4 (REQ-12 experience); no code change in S1 | S4

---

## Session 2 -- Import Brain (S2)

- [ ] **REQ-1** | Port full 6-stage brain pipeline from functions/src/import/brain/ to server/lib/ai.js | Gate green; unifiedImport SSE emits stage1-6 events; BrainCitation { sheet, cell, verbatim } in output; no invented refIds | S2

- [ ] **REQ-2** | Integrate SERFF/ERC/ACORD/filing-PDF classification into unifiedImport | FormatFingerprint detects SERFF_PACKAGE, ERC_PACKAGE, ACORD, COMPANY_FILING_PDF; handler routes accordingly | S2

---

## Session 3 -- AI Quality (S3)

- [ ] **REQ-3a** | Add temperature:0 to all structured extraction AI calls | server/lib/ai.js unifiedImport, summarizeProduct, scaffoldProduct, draftRule, analyzeClaim all have temperature:0 | S3

- [ ] **REQ-3b** | Add prompt caching (ephemeral cache blocks) to all server AI calls | Source-audit: ai.js has cache_control blocks on stable system prompt portions | S3

- [ ] **REQ-3c** | Add retry with exponential backoff (408/429/5xx) to all AI fetch() calls | Source-audit: ai.js has retry logic with backoff on all fetch() AI calls | S3

- [ ] **REQ-3d** | Consider extended thinking for opus-4-8 scaffoldProduct and analyzeClaim | Extended thinking enabled with budget_tokens:2048 for GROUNDED_CITED calls | S3

- [ ] **REQ-8** | Re-verify all previously-fixed bugs from hardening ledger | DEF-0033/0034/0039/0040/0041 verified fixed by inspecting source at fix points | S3

- [ ] **REQ-10a** | Add supertest integration tests for auth endpoints | /api/auth/login (401 bad creds, 200 valid), /api/db/mutate (403 VIEWER, 200 EDITOR), /api/ai/chat (503 unconfigured) | S3

- [ ] **REQ-10b** | Add rate limit test for /api/auth/login | Test confirms 429 after rate limit exceeded | S3

- [ ] **REQ-12g** | OpenTelemetry: structured spans for Azure Application Insights | Replace console.log/warn with OTel spans; integrate with App Insights | S3

---

## Session 4 -- Experience (S4)

- [ ] **REQ-4** | Browser console easter egg (Accenture-owned, obfuscated) | Easter egg fires on first render, not findable by grep, Accenture branding + personal shout-outs | S4

- [ ] **REQ-5** | Lean code: split ai.js (1069 lines) into named stage modules | ai.js split into handler modules; gate green; no functional change | S4

- [ ] **REQ-6a** | Parallelize all HomeCheck external API calls with Promise.all() | homecheck.js external API calls run in parallel; risk endpoint latency reduced | S4

- [ ] **REQ-6b** | Request coalescing on adapter.db.subscribe | Multiple subscribers to same path share one HTTP request | S4

- [ ] **REQ-6c** | Document recommended Cosmos composite indexes | docs/COSMOS_INDEXES.md with recommended indexes for paginated list queries | S4

- [ ] **REQ-9** | Beautiful AI responses: interactive citations, streaming markdown, collapsible reasoning | Citation hover cards, fade-in per paragraph, coverage comparison tables | S4

- [ ] **REQ-12a** | Real-time presence indicators in ProductWorkspace | Collaborator avatars show who else is editing; uses existing presence system | S4

- [ ] **REQ-12b** | Conflict resolution UI for MutationConflictError (409) | Diff UI showing conflicting changes instead of just a toast | S4

- [ ] **REQ-12c** | Cosmos composite index on (coll, tenantId, data.updatedAt) | Index documented + added to docs/COSMOS_INDEXES.md | S4

- [ ] **REQ-12d** | Mobile-first responsive layout for sidebar + product workspace | Sidebar collapses to hamburger; workspace grid stacks on mobile | S4

- [ ] **REQ-12e** | Surface SERFF reviewer (checkTexasBundle) results in the UI | SERFF bundle page shows DOI reviewer findings; not just in API response | S4

- [ ] **REQ-12f** | Expand a11y audit to all modal dialogs and command palette | a11y.axe.test.tsx covers all modals + CommandPalette | S4

- [ ] **REQ-12h** | News LOB-specific topic interest tracking | Topic weights persisted per user per LOB in Cosmos | S4

- [ ] **REQ-12i** | Per-tenant DuckCreek mapping overrides | DEFAULT_DUCKCREEK_MAPPING overridable by tenant config stored in Cosmos | S4

---

## Session 5 -- Ship (S5)

- [ ] **REQ-7** | Full SaaS security audit readiness verification | All RISK-001 to RISK-016 verified complete; HUMAN-ACTION items confirmed by owner | S5

- [ ] **REQ-11** | Final gate verification + Fable 5 prompt brief update | pnpm typecheck + lint + test + build all green; HANDOFF.md updated with campaign outcomes | S5

- [ ] **Final gate** | All invariants pass | typecheck:0 errors; lint:0 violations; test:707+ green; build:green; canaries $1,528/$1,002/$2,635 | S5

---

## Session State Log

| Date | Session | Status | Notes |
|---|---|---|---|
| 2026-07-12 | S1 | In progress | Branch created; EXECUTION.md built; executing RISK items |
