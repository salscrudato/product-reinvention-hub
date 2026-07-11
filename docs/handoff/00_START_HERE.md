# 00_START_HERE.md — Handoff Package Index

> **⚠ HISTORICAL DOCUMENT — Firebase era (pre-Azure cutover, ~V18)**
> This package was compiled before the Azure cutover. The stack described here
> (Firebase Firestore + Cloud Functions + Auth) is no longer the live backend.
> The current stack is Azure App Service (Express + Cosmos DB + Foundry AI + Blob
> Storage) — see `docs/DEPLOY_AZURE.md` and `hardening/BACKEND.md` for the
> authoritative current picture. Use this package as historical context only.

## Purpose
This package was produced by a forensic read-only reverse-engineering pass on the **Product Reinvention Hub** repository. It is the complete information source for Claude Fable to generate an end-to-end production-readiness and enhancement build plan. Fable will not see the codebase directly — this package is the source of truth.

**Compiled:** 2026-07-09
**Compiler:** Claude Sonnet 4.6 (forensic pass; read-only on source files)
**Target:** Claude Fable (production-readiness + enhancement build plan generation)

---

## What This Product Is

**Product Reinvention Hub** — an AI-native P&C insurance product management platform. Insurance product managers use it to:
1. Browse and manage a structured portfolio of P&C insurance products (coverages, forms, rules, rating programs)
2. Receive AI-grounded analysis: coverage gap analysis for claims scenarios, AI-drafted rules, AI-scaffolded new products, AI-extracted coverage structures from PDF forms
3. Run interactive rating with a full step-trace
4. Track market news via a nightly AI scout
5. Manage GTM launch projects on a Kanban board
6. Submit and track product feedback with AI-shaped user stories

**Backend:** Firebase (Firestore + Cloud Functions v2 + Storage + Auth)
**AI provider:** Anthropic Claude (claude-sonnet-5 for reasoning, claude-haiku-4-5 for bulk)
**Seeded portfolio:** ISO-style HO-3 Homeowners + Personal Auto Policy (PP 00 01)

---

## Package Contents

| File | What it contains | Confidence |
|---|---|---|
| `01_ARCHITECTURE.md` | Tech stack, repo structure, data flow, entry points, routing map | HIGH |
| `02_FEATURE_INVENTORY.md` | 32 features (F01–F32) with files, completeness status, and notes | HIGH |
| `03_CODE_BUNDLE.md` | Key algorithms, patterns, and implementation choices across all 3 workspaces | HIGH |
| `04_AI_AND_PROMPTS.md` | ALL verbatim system prompts, tool schemas, model config, SSE patterns, safety measures | HIGH |
| `05_DATA_MODEL.md` | Complete Firestore schema, TypeScript types, role matrix, mutation envelope | HIGH |
| `06_UI_SURFACES.md` | All 20 screens with route, auth, and textual UI description | MEDIUM-HIGH |
| `07_PRODUCTION_READINESS.md` | Security bugs (2 critical), test gaps, performance issues, unknowns | HIGH |
| `08_ENV_AND_CONFIG.md` | All environment variables (secrets redacted), Firebase config, deploy commands | HIGH |
| `manifest.json` | Machine-readable index of this package | HIGH |
| `screenshots/` | Empty — emulator not running during this pass; no rendered screenshots | N/A |

---

## Confidence Assessment

| Domain | Confidence | Notes |
|---|---|---|
| AI system prompts and tool schemas | HIGH | All prompts read verbatim from source |
| Firestore schema and rules | HIGH | All types from `shared/src/types.ts`; rules from `firestore.rules` |
| Architecture and data flow | HIGH | Verified via `App.tsx`, `runtime.ts`, `firebase.adapter.ts`, `index.ts` |
| Rating engine | HIGH | Verified via `evaluator.ts` + canary test ($1,528 HO-3, $1,002 PA) |
| Security findings | HIGH | Code read directly; SEC-01/SEC-02 are confirmed |
| UI surface descriptions | MEDIUM | Based on code reading; no live rendering; UI details are inferences from component structure |
| Feature completeness status | MEDIUM | Inferred from code structure, test existence, and comment markers |
| LOB registry internals | MEDIUM | File path confirmed; exact second LOB contents read partially |
| Pricing panel routing | LOW (ASSUMPTION flagged) | The exact path from pricing UI → rating endpoint is an assumption |

Lines prefixed with **ASSUMPTION:** in the documents are inferences — Fable should verify these before acting on them. Lines prefixed with **UNKNOWN:** identify gaps that require further investigation.

---

## Critical Production Blockers (summary — see `07_PRODUCTION_READINESS.md` for full detail)

1. **SEC-01 (HIGH):** Hardcoded demo-admin credentials (`DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`) compiled into the production client bundle. Any visitor can extract and use them.
2. **SEC-04 (MEDIUM):** Anonymous auto sign-in grants read access to the full product portfolio to any unauthenticated visitor. May be intentional — requires a product decision.
3. **TEST-01/TEST-02 (MEDIUM):** No E2E or unit tests covering any AI feature path; only the rating engine and smoke tests are tested.

---

## Key Invariants Fable Must Respect in Any Enhancement Plan

| Invariant | Rule |
|---|---|
| Adapter seam | All app reads/writes go through `adapter` (`app/src/lib/backend/`). Never recommend direct Firebase SDK use in components. |
| Atomic mutations | Every entity write must use `adapter.db.mutate()`. No bare Firestore writes. |
| AI server-side | All Anthropic calls must stay in `functions/`. Never add Anthropic calls to the browser. |
| Grounded + cited | AI responses must cite source documents. Free invention is a bug. |
| Model IDs | Use `MODEL = 'claude-sonnet-5'` and `MODEL_FAST = 'claude-haiku-4-5'` from `functions/src/runtime.ts`. Never use `claude-fable-5`. Sonnet 5 rejects sampling params. |
| HO-3 canary | `shared/src/rating/evaluator.test.ts` must produce exactly $1,528. Any rating-engine change must keep this passing. |
| Design tokens | No hard-coded hex outside `app/src/index.css`. Use `var(--color-*)`. |
| refId chips | `refId` and form-number chips are load-bearing. Never omit or replace with plain text. |
| Role enforcement | VIEWER is read-only. Must be enforced in BOTH Firestore rules AND Cloud Functions. |

---

## Navigation Guide for Fable

**To understand the AI system:** start with `04_AI_AND_PROMPTS.md` (verbatim prompts and tool schemas), then `03_CODE_BUNDLE.md` §A (AI backend patterns).

**To understand the data model:** start with `05_DATA_MODEL.md` (Firestore schema and TypeScript types).

**To understand the UI:** start with `06_UI_SURFACES.md` (screen-by-screen descriptions) and `01_ARCHITECTURE.md` (routing map).

**To plan production remediation:** start with `07_PRODUCTION_READINESS.md` (security bugs, test gaps, unknowns).

**To understand the feature set:** start with `02_FEATURE_INVENTORY.md` (all 32 features with completeness status).
