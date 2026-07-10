# 02_FEATURE_INVENTORY.md — Feature Inventory

## Feature Index

| FEAT-ID | Name | Status |
|---|---|---|
| F01 | Authentication + Role-based access | shipped |
| F02 | Portfolio Chat (AI) | shipped |
| F03 | Product Workspace — Overview | shipped |
| F04 | Product Workspace — Coverages | shipped |
| F05 | Product Workspace — Forms | shipped |
| F06 | Product Workspace — Pricing (Interactive Rating) | shipped |
| F07 | Product Workspace — States (Tile Map) | shipped |
| F08 | Product Workspace — Rules | shipped |
| F09 | Product Builder (New Product + AI Scaffold) | shipped |
| F10 | Coverage Extraction from PDF | shipped |
| F11 | Claims Coverage Copilot | shipped |
| F12 | Market News Scout | shipped |
| F13 | Entity Explorer (Global Search) | shipped |
| F14 | GTM Task Board | shipped |
| F15 | Data Dictionary | shipped |
| F16 | Feedback Capture + Board | shipped |
| F17 | User Administration | shipped |
| F18 | AI Rule Composer | shipped |
| F19 | DuckCreek XML Export | shipped |
| F20 | Semantic Cache (Chat) | shipped |
| F21 | Cost Guard + Circuit Breaker | shipped |
| F22 | Grounding Index (Voyage RAG) | shipped |
| F23 | Portfolio Digest (Chat prefix) | shipped |
| F24 | AI Usage Telemetry (Admin cost tab) | shipped |
| F25 | Product AI Summary (Overview tab) | shipped |
| F26 | Version History + Audit Trail | shipped |
| F27 | Presence Heartbeat (co-editing indicator) | shipped |
| F28 | Import from ISO Excel workbooks | shipped |
| F29 | Form Description Generator (AI, cached) | shipped |
| F30 | Feedback Story Shaper (AI) | shipped |
| F31 | AI Product Scaffold Composer | shipped |
| F32 | Personal Auto line (PAP PP 00 01) | shipped |

---

## Detailed Feature Descriptions

### F01 — Authentication + Role-based access
**What it does:** Firebase Email/Password auth with three roles (VIEWER, EDITOR, ADMIN) enforced via JWT custom claims, mirrored server-side in Firestore security rules and in every Cloud Function. Anonymous sign-in auto-engaged for unauthenticated visitors. `mustChangePassword` flag forces a password change route on first login.
**Files:** `app/src/context/UserContext.tsx`, `app/src/lib/backend/firebase.adapter.ts` (auth section), `functions/src/admin.ts` (setUserRole), `functions/src/runtime.ts` (requireRole, authenticate), `firestore.rules`
**Status:** shipped

### F02 — Portfolio Chat (AI)
**What it does:** Multi-turn SSE conversation grounded in the live product portfolio. The model uses 8 grounding tools (search, product tree, coverage detail, rules, forms, LD tables, rating, dictionary) and must cite every claim by refId or form number. Includes semantic response cache (PART A), budget cap + circuit breaker (PART C), server-side citation verification, and citation-API post-verification.
**Files:** `functions/src/ai.ts` (chat endpoint, runChatAgent, sseCostGate), `functions/src/tools.ts` (TOOLS, SYSTEM_PROMPT, runTool), `functions/src/portfolioDigest.ts`, `functions/src/semanticCache.ts`, `app/src/components/chat/`
**Status:** shipped

### F03 — Product Workspace — Overview
**What it does:** AI-generated product summary (headline, highlights, coverage list, considerations) built from structured metadata using haiku, cached in `productSummaries/{pid}`. Displays lineage/provenance, owner, lifecycle, and the base coverage form. Presence heartbeat shows other viewers.
**Files:** `functions/src/summarize.ts`, `app/src/routes/product/ProductOverview.tsx`
**Status:** shipped

### F04 — Product Workspace — Coverages
**What it does:** Full CRUD for the coverage tree (top-level + sub-coverages). Each coverage has terms (LIMIT/DEDUCTIBLE/OPTION), state scope (tile map), requirement (MANDATORY/OPTIONAL), form numbers, and a typed option matrix (StandardOption). Mutations are atomic via `adapter.db.mutate()`.
**Files:** `app/src/routes/product/ProductCoverages.tsx`, `app/src/components/product/`, `shared/src/types.ts` (Coverage, CoverageTerm)
**Status:** shipped

### F05 — Product Workspace — Forms
**What it does:** Library of forms (BASE_COVERAGE, DECLARATIONS, ENDORSEMENT, EXCLUSION, AMENDATORY, POLICY_NOTICE). Shows attachment conditions, coverage parts, dynamic fields, and state scope. AI form description generator caches a 2-3 sentence plain-English description per form.
**Files:** `app/src/routes/product/ProductForms.tsx`, `functions/src/describeForm.ts`
**Status:** shipped

### F06 — Product Workspace — Pricing (Interactive Rating)
**What it does:** Live interactive rating engine. Reads the product's RatingProgram steps (SET/MUL/ADD/MIN_FLOOR) + RT/LD tables from Firestore, evaluates them client-side via the shared `evaluate()` function, and shows a step-by-step trace with the final premium. HO-3 canary = $1,528. Also renders a worked-example rating flow SVG for export.
**Files:** `app/src/routes/product/ProductPricing.tsx`, `shared/src/rating/evaluator.ts`, `shared/src/rating/kits.ts`, `shared/src/rating/rtGrid.ts`, `shared/src/rating/ldGetter.ts`
**Status:** shipped

### F07 — Product Workspace — States (Tile Map)
**What it does:** Token-driven 50-state tile map showing the product's geographic footprint (admitted / not admitted). Also used at coverage level (per-coverage scope) and option level (per-option applicability). Peril badges driven by LOB registry `perilModel`; never coastal hard-coded.
**Files:** `app/src/routes/product/ProductStates.tsx`, `app/src/components/product/StateTileMap.tsx`
**Status:** shipped

### F08 — Product Workspace — Rules
**What it does:** Displays PRODUCT/RATING/FORMS rules with condition/outcome, refIds, form numbers, ldTableRefs. Includes the AI Rule Composer (draftRule SSE endpoint) that grounds a new or refined rule in the live product data, verifies all references server-side, and returns an editable draft card.
**Files:** `app/src/routes/product/ProductRules.tsx`, `functions/src/rules.ts`
**Status:** shipped

### F09 — Product Builder
**What it does:** Multi-step modal for creating a new product. Options: BLANK (empty shell), IMPORT (from ISO Excel workbook), CLONE (copy an existing product), or AI_SCAFFOLD (AI-proposed starting structure). Lineage/provenance is recorded on the Product document.
**Files:** `app/src/routes/Builder.tsx`, `functions/src/scaffoldProduct.ts`, `shared/src/insurance/scaffold.ts`, `shared/src/insurance/isoImport.ts`
**Status:** shipped

### F10 — Coverage Extraction from PDF
**What it does:** EDITOR/ADMIN uploads a base coverage form PDF. The `extractCoverages` SSE endpoint runs 4 parallel forced-tool sections (coverages, forms, rules, rating) using a cheap-first (haiku) + escalation (sonnet-5) cascade. All proposals require citations; server-side sanitizers drop uncited or form-number-unverified items. The user reviews and saves the proposals.
**Files:** `functions/src/extract.ts`, `shared/src/insurance/extraction.ts`
**Status:** shipped

### F11 — Claims Coverage Copilot
**What it does:** Claims professional uploads a P&C base coverage form (any line), describes a loss scenario, and receives a structured determination card (COVERED/NOT_COVERED/PARTIAL/NOT_ADDRESSED) with cited coverages, exclusions, limits, reasoning bullets, open items, and a product-QA coverage gap note. Multi-turn SSE. Form-driven and line-agnostic. Prompt-injection hardened: the uploaded document is explicitly sandboxed as DATA, not instructions.
**Files:** `functions/src/claims.ts` (analyzeClaim + identifyBaseForm), `app/src/routes/Claims.tsx`, `shared/src/claims/lineProfiles.ts`
**Status:** shipped

### F12 — Market News Scout
**What it does:** ADMIN-only manual refresh or nightly schedule (06:00 ET) via `nightlyNews`. Uses haiku + Anthropic web_search tool to find P&C insurance news matching each user's custom instruction. Deduplicates by URL hash, resolves OG/Twitter/inline hero images, runs a HEAD liveness probe, and stores in `news/{urlHash}`. Portfolio context is injected for relevance. Supports per-user news preferences (`newsPrefs/{uid}`).
**Files:** `functions/src/news.ts`, `app/src/routes/News.tsx`
**Status:** shipped

### F13 — Entity Explorer (Global Search)
**What it does:** Command-palette-style (⌘K) global search over all products, coverages, rules, forms, LD/RT tables, dictionary terms, and tasks. Uses the `searchIndex` Firestore collection (maintained by the atomic `mutate()` envelope) and the `interpretSearch` function for NL-to-structured-query.
**Files:** `app/src/routes/Explorer.tsx`, `app/src/components/explorer/`, `functions/src/interpretSearch.ts`, `shared/src/search/rank.ts`
**Status:** shipped

### F14 — GTM Task Board
**What it does:** Kanban-style GTM launch tracker with 4 columns (IDEATION / BUILD_FILE / TEST_APPROVE / LAUNCH_MONITOR). Tasks are seeded from a process template backscheduled against the product's target launch date. Supports drag-and-drop reordering (dnd-kit), checklists, assignees, work-type chips, and SLA dates. Projects link to a Product.
**Files:** `app/src/routes/Tasks.tsx`, `app/src/components/tasks/`, `shared/src/gtm/`, `shared/src/seed/gtmProcess.ts`, `shared/src/types.ts` (Project, Task)
**Status:** shipped

### F15 — Data Dictionary
**What it does:** Governed data dictionary of field definitions (name, type, description, allowed values, format, tags, aliases). Live "used in" back-references computed from the current corpus. Citable by refId (e.g. HO.DEF.003) by the AI. EDITOR/ADMIN manages entries; VIEWER reads.
**Files:** `app/src/routes/Dictionary.tsx`, `shared/src/dictionary/usage.ts`, `shared/src/types.ts` (DictionaryEntry)
**Status:** shipped

### F16 — Feedback Capture + Board
**What it does:** Any user (VIEWER included) may submit feedback with a title, detail, type (IDEA/ISSUE/PRAISE), optional screenshot (annotated), and optional attachments. The `shapeFeedback` callable (sonnet-5, vision-capable) turns raw input into a structured user story with acceptance criteria, repro steps, and a deploy-ready implementation brief. EDITOR/ADMIN manages status, impact, effort, priority score. Near-duplicate detection runs read-only. Voting: any user may upvote once.
**Files:** `app/src/routes/Feedback.tsx`, `app/src/components/feedback/`, `functions/src/shapeFeedback.ts`, `shared/src/feedback/priority.ts`
**Status:** shipped

### F17 — User Administration
**What it does:** ADMIN-only screen. Create users (email/password/role), change roles, deactivate/reactivate. Sets Firebase custom claim + mirrors to `users/{uid}` doc. Includes an AI Cost tab showing per-feature daily spend from `aiUsage` collection.
**Files:** `app/src/routes/Admin.tsx`, `functions/src/admin.ts`
**Status:** shipped

### F18 — AI Rule Composer
**What it does:** EDITOR/ADMIN describes a rule in plain English. `draftRule` (SSE) grounds the request in the live product data via the grounding tools, emits a structured `emit_rule_draft` tool call (with verifyDraft server-side verification), and returns an editable condition/outcome card. A force-draft fallback ensures the composer never dead-ends.
**Files:** `functions/src/rules.ts`, `app/src/routes/product/ProductRules.tsx`
**Status:** shipped

### F19 — DuckCreek XML Export
**What it does:** Any authenticated user can export a product to DuckCreek XML (a standard P&C policy-management system format). XML is built client-side from shared pure functions (PDM builder + DuckCreek serializer). The `exportDuckCreek` callable writes an append-only audit event with the manuScriptID.
**Files:** `functions/src/exportDuckCreek.ts`, `shared/src/duckcreek/`, `shared/src/pdm/`
**Status:** shipped

### F20 — Semantic Cache (Chat)
**What it does:** Caches chat answers keyed on query embedding (Voyage dense vector in prod; deterministic local hash in offline/test). Three gates: freshness (every cited anchor still resolves in Firestore), similarity (cosine distance), cheap verifier (haiku). A cache hit skips the Sonnet call entirely. Cache invalidation is trigger-based via `invalidate.ts`.
**Files:** `functions/src/semanticCache.ts`, `functions/src/ai.ts` (PART A), `functions/src/invalidate.ts`, `shared/src/cost/semanticCache.ts`
**Status:** shipped

### F21 — Cost Guard + Circuit Breaker
**What it does:** Server-side budget caps and circuit breaker for all AI features. Pure decision logic in `@pf/shared/cost`; Firestore I/O in `functions/src/costGuard.ts`. Three counters: global day, per-feature day, per-session day. Three actions: allow / degrade (soft cap, fewer tool turns) / deny (hard ceiling). Circuit breaker tracks consecutive provider failures; degrades to cache/notice when open.
**Files:** `functions/src/costGuard.ts`, `shared/src/cost/budget.ts`, `shared/src/cost/breaker.ts`, `functions/src/telemetry.ts`
**Status:** shipped

### F22 — Grounding Index (Voyage RAG)
**What it does:** Dense vector index of all product entities (coverages, rules, forms, dictionary, etc.) stored in `groundingChunks` Firestore collection. Built by `reindexGrounding` callable (ADMIN). Retrieval uses Voyage embeddings + reranker when key is configured; falls back to lexical TF-IDF otherwise. Used by all grounding tools and the semantic cache.
**Files:** `functions/src/retrieval/`, `shared/src/retrieval/`
**Status:** shipped

### F23 — Portfolio Digest (Chat prefix)
**What it does:** A server-side, in-memory-cached (5 min TTL) summary of the entire portfolio — product names, coverage refIds, form numbers, rule counts, worked-example premiums — assembled by a pure function and injected into the chat system prompt's stable prefix (inside the Anthropic prompt-cache breakpoint). Digest-covered questions answer without a tool round-trip.
**Files:** `functions/src/portfolioDigest.ts`, `shared/src/grounding/portfolioDigest.ts`
**Status:** shipped

### F24 — AI Usage Telemetry (Admin cost tab)
**What it does:** Every AI call records input/output/cache tokens, latency, model, feature, session key, and cost estimate into `aiUsage` collection. The Admin AI Cost tab shows per-feature spend, cache savings, degradation events, and breaker trips. Written server-side via Admin SDK.
**Files:** `functions/src/telemetry.ts`, `app/src/routes/Admin.tsx` (cost tab section)
**Status:** shipped

### F25 — Product AI Summary (Overview tab)
**What it does:** haiku-generated executive summary (headline, highlights, coverage highlights, considerations) from structured metadata only. Persisted to `productSummaries/{pid}` after generation so subsequent loads are instant. A `metaHash` detects when the product changed and a fresh summary is needed.
**Files:** `functions/src/summarize.ts`, `app/src/routes/product/ProductOverview.tsx`
**Status:** shipped

### F26 — Version History + Audit Trail
**What it does:** Every `mutate()` writes an `auditEvent` (actor, action, timestamp, entityType/Path) and a `version` (field-level diff snapshot) atomically. Admin can browse history; editors can restore from a version snapshot.
**Files:** `app/src/lib/backend/firebase.adapter.ts` (applyEnvelope), `app/src/lib/backend/envelope.ts`, `shared/src/types.ts` (Version, AuditEvent)
**Status:** shipped

### F27 — Presence Heartbeat
**What it does:** When a user opens a product workspace, they write a heartbeat doc to `presence/{pid}/viewers/{uid}` every 30 seconds. Other viewers subscribe and show a small avatar strip. Cleaned up on unmount.
**Files:** `app/src/lib/backend/firebase.adapter.ts` (presence section)
**Status:** shipped

### F28 — Import from ISO Excel Workbooks
**What it does:** EDITOR/ADMIN can upload ISO Excel workbooks (Framework, Pricing, Forms, Rules sheets). The import pipeline parses them client-side via exceljs and creates/updates product entities through the atomic `mutate()` envelope.
**Files:** `shared/src/insurance/isoImport.ts`, `app/src/lib/import/`
**Status:** shipped

### F29 — Form Description Generator
**What it does:** Cache-first AI-generated 2-3 sentence plain-English description for a form in the library. Cache hit (non-empty `description` field) skips the AI call. Cache miss calls haiku, writes back through the audited `auditedMerge()` so the change has a full audit trail.
**Files:** `functions/src/describeForm.ts`
**Status:** shipped

### F30 — Feedback Story Shaper (AI)
**What it does:** sonnet-5 (vision-capable) turns raw feedback text + optional annotated screenshot + attachments into a structured user story: title, type, userStory, acceptanceCriteria, impact/effort scores, reproSteps (ISSUE), likelyFiles (grounded against a real allowlist), and a deploy-ready implementation brief for maintainers. Near-duplicate scan runs in parallel.
**Files:** `functions/src/shapeFeedback.ts`
**Status:** shipped

### F31 — AI Product Scaffold Composer
**What it does:** EDITOR/ADMIN describes a new product in plain English. `scaffoldProduct` (SSE) reads the portfolio via grounding tools, proposes a starting structure (product shell + coverages + forms + rules) modelled on real entities with citations, verifies all form numbers and LOBs server-side, and returns an editable plan that the user can accept and persist.
**Files:** `functions/src/scaffoldProduct.ts`
**Status:** shipped

### F32 — Personal Auto Line (PAP PP 00 01)
**What it does:** Full Personal Auto rating program (Parts A-D: liability, med pay, UM/UIM, physical damage; endorsements PP 04 46, PP 03 01). Seed, evaluator, rules engine, rating tables, and line profile registered in the LOB registry. Canary: PA.RAT.1 worked example = $1,002.
**Files:** `shared/src/seed/personalAuto.ts`, `shared/src/rating/kits.ts`, `shared/src/insurance/lobRegistry.ts`, `shared/src/rating/personalAuto.evaluator.test.ts`
**Status:** shipped
