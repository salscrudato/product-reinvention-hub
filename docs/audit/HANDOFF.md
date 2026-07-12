# Insurance Product Hub -- Fable 5 Handoff Brief

**Date:** 2026-07-12  
**Owner:** Sal Scrudato (Accenture)  
**Purpose:** Comprehensive brief for Fable 5 ultrathink to generate a full enhancement prompt  
**Source audit:** docs/audit/AUDIT.md (read that first for verbatim code and line numbers)

---

## 1. What This System Is

The Insurance Product Hub (IPH) is an enterprise SaaS for P&C insurance product lifecycle management. It enables product managers to design, rate-test, govern, file, and export insurance products. The AI layer provides grounded, cited assistance throughout the workflow.

**Live URL:** https://app-prodhub-dev.azurewebsites.net  
**Owned by:** Accenture (Sal Scrudato, creator)

**Five core workflows:**
1. Portfolio management -- create and govern P&C products (HO-3, PA, GL, IM, PR)
2. AI-assisted authoring -- grounded, cited drafting of coverages and rules
3. Filing import -- workbook and PDF ingestion via 6-stage AI brain
4. Carrier export -- DuckCreek Author XML and SERFF filing bundles
5. Consumer risk assessment -- HomeCheck guest surface with real geospatial data

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, TailwindCSS v4, React Router v7, TypeScript 6 strict |
| Backend | Express 4, Node 20, plain CJS (no TypeScript) |
| Database | Azure Cosmos DB NoSQL (2 containers: docs, presence) |
| AI | Azure AI Foundry (Anthropic-native + OpenAI-native surfaces) |
| Storage | Azure Blob |
| Auth | Custom HS256 JWT (12h TTL), 4-tier roles |
| CI/CD | Azure DevOps, trigger on main |
| Monorepo | pnpm workspaces (app, shared, functions); server/ excluded |

---

## 3. Architecture Principles (Binding Invariants)

These rules are enforced by lint, typecheck, and source-audit tests. Any enhancement must respect them.

| Invariant | Rule | Enforcement |
|---|---|---|
| Adapter seam | All app reads/writes go through `app/src/lib/backend/azure.adapter.ts` | oxlint no-restricted-imports; TS2307 |
| Atomic mutations | Every entity write uses `adapter.db.mutate()` | source-audit test (DEF-0044/0047) |
| Role enforcement | VIEWER is read-only; EDITOR+ writes; enforced server-side | requireRole middleware; source-audit test |
| AI server-side | All AI calls live in server/lib/ai.js; browser holds no credentials | oxlint; no SDK in app/src/ |
| AI grounded+cited | Every AI response must cite [refId] or [form number] from context | SYSTEM prompt; source-audit test (DEF-0045) |
| refId chips | refId and form-number chips are load-bearing display elements | never strip them |
| HO-3 canary | evaluator.test.ts must produce exactly $1,528 | CI gate; deploys fail otherwise |
| Model IDs | claude-opus-4-8 (GROUNDED_CITED), claude-haiku-4-5 (BULK_VERIFY); never claude-fable-5 | fleet.ts; fleet unit test |
| Design tokens | No hard-coded hex in browser code; use var(--color-*) | CLAUDE.md; review convention |

---

## 4. AI System -- Current State

### 4.1 Model Fleet (shared/src/ai/fleet.ts)

| Role | Model | Purpose | Cost (in/out per 1M) |
|---|---|---|---|
| GROUNDED_CITED | claude-opus-4-8 | Chat, scaffold, rules, claims | $15/$75 |
| BULK_VERIFY | claude-haiku-4-5 | Summary, import, news | $0.80/$4 |
| VISION | gpt-5.1 | HomeCheck photo inventory | $3/$12 |
| CHEAP_GENERAL | gpt-5-mini | Degraded fallback | $0.30/$1.60 |
| EMBED | text-embedding-3-small | RAG embeddings (512 dims, int8) | $0.02/$0 |

Cost guard: $25/hour per App Service instance. Degrades at $20 (80%), denies at $25.

### 4.2 RAG Pipeline

Two-tier hybrid retrieval:
- PORTFOLIO tier: all products for the tenant (complete catalogue awareness)
- DETAIL tier: top-18 chunks by hybrid score (HYBRID_ALPHA=0.72 dense + 0.28 lexical)
- Dense: cosine similarity, int8 quantized 512-dim vectors, DENSE_FLOOR=0.22
- Lexical: TF-IDF with refId 2x boost
- Chunks: FNV-1a content-hashed; built at mutate time (5th envelope op) and at seed time

### 4.3 Current AI Endpoints

All at POST /api/ai/:name (base auth: ANALYST+)

| Handler | Auth | Model | Protocol | Key Behavior |
|---|---|---|---|---|
| chat | ANALYST | opus-4-8 | SSE | Two-tier RAG; grounded+cited; session cost cap |
| summarizeProduct | ANALYST | haiku-4-5 | JSON | Forced tool: product_summary |
| unifiedImport | EDITOR | haiku-4-5 | SSE | 6-stage brain; PDF+workbook; propose_coverages tool |
| scaffoldProduct | EDITOR | opus-4-8 | JSON | RAG-grounded; forced tool: emit_product_scaffold |
| draftRule | EDITOR | opus-4-8 | JSON | RAG-grounded; forced tool: emit_rule_draft |
| analyzeClaim | EDITOR | opus-4-8 | SSE | Base form as primary authority; emit_determination tool |

---

## 5. Enhancement Requirements (from fable_prompt_instructions.md)

These are the owner's 13 requirements for Fable 5 to address. Each item has an assessment of current state and what needs to change.

### REQ-1: Import from Excel and Filing Documents -- Extremely Robust

**Current state:** The Azure-deployed `unifiedImport` handler is a simplified port. It accepts PDF and workbook files, uses haiku-4-5 with a `propose_coverages` forced tool call, and extracts coverage items with citations. The full 6-stage ensemble brain (stage1 through stage6 in `functions/src/import/brain/`) is reference-only in the `functions/` workspace.

**What is missing:**
- The 6-stage ensemble is NOT deployed. Only a simplified 1-stage extraction exists on Azure.
- No adversarial validation (Stage 5 in functions brain uses gpt-5.1 to decorrelate from haiku errors)
- No column mapping confidence scoring (Stage 3)
- No inter-model disagreement heatmap on the deployed handler (exists in functions/ reference)
- Format detection is limited (no FormatFingerprint pipeline on Azure)
- The deployed handler does not exploit the deterministic structural extraction layer (`shared/src/import/structure/`)

**Enhancement target:** Port the full 6-stage brain pipeline from `functions/src/import/brain/` to `server/lib/ai.js`. This is a major undertaking (approximately 800 lines of new server code). Key considerations:
- Stage 1 (classify): haiku prefilter + opus/gpt-5.1 ensemble + adjudication
- Stage 2 (header lock): deterministic scoring from `shared/src/import/structure/headerScore.ts`, AI fallback only
- Stage 3 (column map): opus + gpt-5.1 ensemble with confidence rubric
- Stage 4 (extract): haiku/gpt-5-mini primary + opus escalation on low confidence
- Stage 5 (validate): gpt-5.1 adversarial (different family from stage 4 primary)
- Stage 6 (reconcile): deterministic merge + dedup (already in `shared/src/import/`)
- All citations must carry `{ sheet, cell, verbatim }` BrainCitation
- `needsRefIdSynthesis=true` for blanks; never invent refIds

### REQ-2: Filing Import -- Similarly Robust

**Current state:** `functions/src/filingImport.ts` handles SERFF package and filing PDF classification. Ported incompletely. The Texas SERFF bundle assembler (`shared/src/serff/`) is complete and deployed.

**Enhancement target:** Integrate the CLASSIFY + RATE_ORDER + MANUAL extraction stages from `functions/src/filingImport.ts` into the `unifiedImport` handler. The FormatFingerprint detection in `shared/src/import/types.ts` already defines `DetectedFormat` values for `SERFF_PACKAGE`, `ERC_PACKAGE`, `ACORD`, `COMPANY_FILING_PDF`.

### REQ-3: Model Parameters and Prompts -- Top of Line

**Current state:** Model parameters are well-chosen. Prompts are grounded and cited. Areas to improve:
- Temperature is not explicitly set (defaults to model default); for structured extraction, `temperature: 0` is best practice
- Prompt caching (`ephemeral` cache) is used in functions/ but not consistently in server/lib/ai.js
- The chat SYSTEM prompt does not include chain-of-thought instruction (beneficial for complex reasoning)
- No streaming interleaved citations (the model generates citations inline but they are not highlighted until the stream ends)
- Retry logic in server/lib/ai.js is minimal compared to functions/src/ai.ts (max 3 attempts vs. 0 retry on server)
- Extended thinking is not used (beneficial for scaffoldProduct and analyzeClaim -- GROUNDED_CITED role)

**Enhancement target:**
- Add `temperature: 0` to all structured extraction calls (unifiedImport, summarizeProduct, scaffoldProduct, draftRule, analyzeClaim)
- Add prompt caching cache blocks to the stable portions of all server AI calls
- Add retry with exponential backoff (408/429/5xx) to all `fetch()` AI calls in server/lib/ai.js
- Consider extended thinking (`thinking: { type: 'enabled', budget_tokens: 2048 }`) for opus-4-8 calls

### REQ-4: Console Log Easter Egg -- Clean, Hidden, Accenture-Owned

**Current state:** `server/lib/sys-diag.js` emits a base64 ANSI banner on cold start. It contains personal names. This is server-side and invisible to browser users.

**Enhancement target:** Add a browser-side console art easter egg in `app/src/main.tsx` or a dedicated module. Requirements from owner:
- Accenture-owned application statement
- Creator: Sal Scrudato
- Shout-out to wife Lisa and son Sal
- Clean, small, beautiful, simple
- Obfuscated so a coding agent would not find and remove it -- hide in a non-obvious location (e.g., inside a utility function that is called for a different purpose, with the console.log triggered by a timing pattern or a specific sequence of events)
- Must not appear in app bundle analysis or in obvious `console.log` search results

**Implementation suggestion:** Base64-encode the message and decode at runtime inside a module that is legitimately imported for a different purpose. Trigger it via `setTimeout(..., 0)` in main.tsx so it fires after first render but is not at the top level.

### REQ-5: Lean, Organized, Robust Code

**Current findings:**
- `server/lib/ai.js` is 1069 lines. Could be split into named handler modules.
- `server/lib/homecheck.js` is 1109 lines. The 7 external API integrations could be extracted.
- `functions/` reference workspace adds cognitive load without deployment value.
- Dead exports in `shared/src/` (tree-shaken by Vite but add reading noise): `Combobox`, `Table`, `SkeletonCard`, `IconUser`, `PH_DEFAULT_TASK_TEMPLATES`

**Enhancement target:** No structural refactors that break the gate. Focus on new code being lean. When porting the brain pipeline, factor it into named stage modules rather than one long file.

### REQ-6: Enterprise Performance

**Current state:** Bundle budgets enforced (175kB/25kB/25kB gzipped). RAF token batching. Spring animations. SWR caching. Smart polling. Int8 quantized embeddings.

**Gaps:**
- No HTTP/2 push or preloading of critical route chunks
- No service worker pre-caching of the Foundry token (each AI call re-authenticates)
- No request coalescing on the adapter (multiple subscribers to same path make separate HTTP requests)
- No Cosmos index optimization documentation (which fields are indexed on the docs container)
- HomeCheck external API calls are sequential for some sources -- could be parallelized

**Enhancement target:** Ensure all external API calls in `homecheck.js` use `Promise.all()` parallelization. Add request coalescing to `adapter.db.subscribe` when multiple callers subscribe to the same path simultaneously. Document recommended Cosmos composite indexes.

### REQ-7: SaaS Security -- Prepare for Audit

**Critical actions (P0):**
- RISK-001: Rotate the compromised Azure Foundry API key and rewrite git history (DEF-0036)
- RISK-002: Explicitly disable bootstrap accounts in production (BOOTSTRAP_USERS_ENABLED=false)

**High priority security enhancements:**
- RISK-003: Rate limit /api/auth/login (brute force protection)
- RISK-004: Sanitize blob upload path (path traversal)
- RISK-005: Document single-instance requirement or migrate state to Cosmos for scale-out
- RISK-006: Implement JWT revocation (kind:'revokedToken' in Cosmos __system__ pk)
- RISK-007: Rate limit /api/auth/tenants
- RISK-008: Validate ORDER BY direction explicitly to ASC|DESC
- RISK-009: Add session secret to HomeCheck inventory (beyond UUID)
- RISK-011: Raise password minimum from 3 to 12 characters
- RISK-012: Add global Express error handler

**Compliance considerations:**
- The admin.js GET /users strips passwords before returning -- correct
- Tenant data is partition-isolated -- correct
- No PII in client bundle -- verified by CI bundle audit
- CORS wildcard is intentional on HomeCheck only -- acceptable for guest surface

### REQ-8: Zero Bugs -- Loop Until Finished

**Known functional gaps (all previously fixed per hardening ledger, but worth re-verifying):**
- DEF-0033/0034: Seed corpus and mutate grounding chain -- both fixed; verify by checking migrate-to-cosmos.ts has tenantId field and data.js envelope has 5th chunk op
- DEF-0039: changePassword Cosmos persistence -- fixed; verify auth.js:118-130
- DEF-0040: unifiedImport returns 501 -- fixed; verify ai.js has the handler
- DEF-0041: AUTH_JWT_SECRET fail-closed -- verify auth.js throws if secret unset

**Fable 5 should run the full gate after every change:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

### REQ-9: Beautiful AI Responses -- Formatted, Interactive

**Current state:** The portfolio copilot chat renders raw markdown via a simple component. Citations appear as `[refId]` chips that navigate to the entity in the app.

**Enhancement opportunities:**
- Stream-rendered markdown with syntax highlighting for form numbers and coverage terms
- Interactive citation chips that show a hover card with entity summary on hover, not just navigate on click
- Collapsible reasoning sections in claims analysis (3 reasoning points + 3 considerations as expandable cards)
- Progress indicators during multi-stage import (already partially implemented via SSE `tool` events)
- Animated entry for each streaming response chunk (already uses RAF batching; add fade-in per paragraph)
- Coverage comparison tables when the model lists multiple alternatives
- Mini sparkline charts when the model discusses premium impacts

**Implementation note:** The `StreamEvent` union in the adapter already has `token`, `tool`, `json`, `notice`, `error`, `done` types. The rendering component (in Home.tsx and Claims.tsx) can be extended to handle these richer types without changing the server protocol.

### REQ-10: All Endpoints Tested, Hardened, Secured

**Current coverage:**
- Source-audit invariant tests cover: audit write, version write, EDITOR role on mutate/mutateBatch, citation instruction in SYSTEM prompt, Vite define block secret check
- Fleet unit test covers: model IDs, forbidden claude-fable-5
- No integration tests against a live Express server in the CI gate (only unit tests)
- Smoke harness (`hardening/smoke.mjs`) requires a live server; not in CI

**Enhancement target:**
- Add supertest-based integration tests for at least: /api/auth/login (401 on bad creds, 200 on valid), /api/db/mutate (403 on VIEWER, 200 on EDITOR), /api/ai/chat (503 on unconfigured fleet)
- Add test for rate limiting on /api/auth/login once rate limiting is implemented

### REQ-11: Efficient Fable Prompting

This document IS the comprehensive Fable prompt brief. To generate the Fable 5 ultrathink code prompt, use AUDIT.md + HANDOFF.md together. The key prompt structure for Fable should be:

```
ROLE: You are implementing enhancements to an enterprise insurance SaaS platform.
GROUND RULES: [from AUDIT.md section 2]
INVARIANTS: [from HANDOFF.md section 3]
CURRENT STATE: [from AUDIT.md sections 6-14]
AI SYSTEM: [from AUDIT.md sections 9-10]
ENHANCEMENTS: [from HANDOFF.md section 5]
GATE: pnpm typecheck && pnpm lint && pnpm test && pnpm build must stay green.
```

### REQ-12: Review and Add to This List

**Additional items Fable should consider (not in original wishlist):**

- **Presence indicators:** The presence system (join/watch) exists but no UI shows who else is editing a product. Add real-time collaborator avatars to ProductWorkspace.
- **Conflict resolution UI:** `MutationConflictError` (409) results in a toast. Consider a diff UI showing the conflicting changes.
- **Cosmos query optimization:** Add a composite index on `(c.coll, c.tenantId, c.data.updatedAt)` for paginated list queries. Document recommended Cosmos indexes.
- **Mobile responsiveness:** The sidebar and product workspace grid are desktop-only. Consider a mobile-first responsive layout.
- **SERFF reviewer integration:** The `checkTexasBundle` reviewer exists in shared/ but it is unclear if its results are surfaced in the UI.
- **Accessibility audit:** The `a11y.axe.test.tsx` exists but tests only a subset of components. Expand to cover all modal dialogs and the command palette.
- **OpenTelemetry:** Replace console.log/warn with structured OpenTelemetry spans that integrate with Azure Application Insights.
- **News personalization:** The news preferences (pinned hashes) are per-user but topic weights are not persisted. Add LOB-specific topic interest tracking.
- **DuckCreek mapping flexibility:** The DEFAULT_DUCKCREEK_MAPPING is hardcoded for PCG carrier. Support per-tenant mapping overrides stored in Cosmos.

---

## 6. Key Files to Modify (by Enhancement)

| Enhancement | Primary Files |
|---|---|
| Full 6-stage import brain | server/lib/ai.js (unifiedImport handler), shared/src/import/brain/* |
| Rate limiting on auth | server/server.js or server/lib/auth.js |
| Blob path sanitization | server/lib/storage.js:upload |
| JWT revocation | server/lib/auth.js:attachUser + new revokedToken query |
| Password minimum | server/lib/auth.js:changePassword |
| Global error handler | server/server.js |
| Console easter egg | app/src/main.tsx or new app/src/lib/identity.ts |
| Interactive AI responses | app/src/routes/Home.tsx, app/src/routes/Claims.tsx, new StreamRenderer component |
| Retry logic in AI calls | server/lib/ai.js (each fetch() call) |
| Prompt caching | server/lib/ai.js (add cache_control blocks to system prompts) |
| Integration tests | new server/src/__tests__/*.test.ts or app/src/__integration__/*.test.ts |
| ORDER BY validation | server/lib/data.js:list handler |

---

## 7. Gate Verification Checklist

Before any PR is merged, Fable must confirm:

- [ ] `pnpm typecheck` -- green (zero TS errors)
- [ ] `pnpm lint` -- green (zero oxlint violations, including no-restricted-imports)
- [ ] `pnpm test` -- 707+ tests green (or more if new tests added)
- [ ] `pnpm build` -- green (Vite build succeeds, bundle budget passes)
- [ ] HO-3 canary = $1,528 (evaluator.test.ts per-step trace)
- [ ] PA canary = $1,002 (personalAuto.evaluator.test.ts)
- [ ] GL canary = $2,635 (generalLiability.evaluator.test.ts)
- [ ] No new secrets in Vite define block (vite-define.test.ts)
- [ ] Mutation envelope still has audit + version + groundingChunk writes (server-invariants.test.ts)
- [ ] EDITOR role still required on /mutate and /mutateBatch (server-invariants.test.ts)
- [ ] Citation instruction still in SYSTEM prompt (server-invariants.test.ts)

---

## 8. What NOT to Change

- `shared/src/rating/evaluator.ts` canary behavior (unless fixing a documented bug with a new canary value)
- `app/src/lib/backend/azure.adapter.ts` interface surface (extending is fine; renaming public methods breaks all callers)
- `server/lib/auth.js` RANK ordering or JWT format (changing either breaks all existing tokens)
- `azure-pipelines.yml` gate steps (adding steps is fine; removing the canary or budget check is not)
- The DuckCreek golden XML fixtures (`shared/src/duckcreek/__golden__/*.xml`) unless the serializer semantics change intentionally

---

*End of Handoff Brief -- 2026-07-12*
