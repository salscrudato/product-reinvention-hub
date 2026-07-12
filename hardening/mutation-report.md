# Mutation Sweep Report — Phase 3

**Date:** 2026-07-11  
**Runner:** Claude Sonnet 4.6 (mutation-sweep session)  
**Gate baseline:** 187 tests, 17 files — all green at session start  
**Precondition:** `pnpm harden:check` exited 0 (OPEN: 0) before sweep began  
**Canaries confirmed clean post-sweep:** HO-3 = $1,528 · GL = $2,635 · PA = $1,002  
**Tree state:** clean (`git status` — nothing to commit) after all reverts

---

## Setup: FAULT-003 Probe Endpoint

Before beginning fault injection, `GET /api/db/audit` was wired in `server/lib/data.js`
behind `requireRole('ADMIN')` + `PROBE_MODE=1` env guard exactly as `mutations.md` specifies.
Committed as `8d9cb27` — this endpoint is only active when `PROBE_MODE=1` is set; it is
not reachable in production.

---

## Results

| Fault | Target | Mutation | Result | Test(s) that caught it | Theater DEF |
|---|---|---|---|---|---|
| FAULT-001 | `shared/src/seed/personalHome.ts:122` | RT PH.RT.001 territory rate 700 → 701 | **RED** | `evaluator.test.ts` (HO-3 canary: $1,528.00 ≠ $1,530.00), `generalLiability.evaluator.test.ts` | — |
| FAULT-002 | `shared/src/seed/generalLiability.ts:142` | RT GL.RT.002 ILF factor 1.820 → 1.830 | **RED** | `generalLiability.evaluator.test.ts` (GL canary: $2,635 ≠ $2,649), `evaluator.test.ts` | — |
| FAULT-003 | `server/lib/data.js:141` | Drop audit op from envelope | **GREEN** | *(none — smoke.mjs only, requires live server)* | DEF-0043 HIGH |
| FAULT-004 | `server/lib/data.js:153` | `requireRole('EDITOR')` → `requireRole('VIEWER')` on /mutate | **GREEN** | *(none — roleGuard.test.ts tests helper in isolation, not route)* | DEF-0044 HIGH |
| FAULT-005 | `server/lib/ai.js:44` | Remove citation instruction from SYSTEM prompt | **GREEN** | *(none — ai.test.ts does not assert SYSTEM content)* | DEF-0045 HIGH |
| FAULT-A | `app/src/lib/backend/azure.adapter.ts` | Add `import type { CosmosClient } from '@azure/cosmos'` | **GREEN (test) / RED (typecheck)** | `pnpm typecheck` → TS2307 (package not in app/package.json); `pnpm test` alone: GREEN | DEF-0050 MEDIUM |
| FAULT-B | `server/lib/data.js:142` | Drop version op from envelope | **GREEN** | *(none — no envelope unit test)* | DEF-0046 HIGH |
| FAULT-C | `server/lib/data.js:168` | `requireRole('EDITOR')` → `requireRole('VIEWER')` on /mutateBatch | **GREEN** | *(none — no /mutateBatch route test)* | DEF-0047 HIGH |
| FAULT-D | `app/vite.config.ts:29` | Add `AZURE_FOUNDRY_KEY` to Vite `define` block | **GREEN** | *(none — no bundle-config audit test)* | DEF-0048 HIGH |
| FAULT-E | `shared/src/retrieval/chunk.ts:64` | Strip `[${refId}]` bracket from `chunkCoverage` | **GREEN** | *(none — chunk.test.ts checks `toContain('PH.COV.001.001')` but not bracket format)* | DEF-0049 HIGH |
| FAULT-F | `shared/src/ai/fleet.ts:40` | `deploymentName: 'claude-opus-4-8'` → `'claude-fable-5'` | **RED** | `fleet.test.ts:22` (`allDeployments().every(d => d.deploymentName !== 'claude-fable-5')`), `fleet.test.ts:27` (`DEPLOY_OPUS.toBe('claude-opus-4-8')`) | — |
| FAULT-G | `shared/src/retrieval/chunk.ts:80` | Strip `[${refId}]` bracket from `chunkRule` | **RED** | `chunk.test.ts:66` (`expect(ch.text).toContain(`[${rule.refId}]`)`) | — |

---

## Summary

**12 faults tested total** (5 from mutations.md + 7 additional):

- **4 RED (caught):** FAULT-001, FAULT-002, FAULT-F, FAULT-G
- **8 GREEN (theater):** FAULT-003, FAULT-004, FAULT-005, FAULT-A (test-only), FAULT-B, FAULT-C, FAULT-D, FAULT-E

All 8 theater gaps logged as OPEN DEFs in `hardening/ledger.md` (DEF-0043 through DEF-0050).

---

## What the suite defends well

| Invariant | Guard |
|---|---|
| Rating canary values (HO-3 $1,528 / GL $2,635) | `evaluator.test.ts`, `generalLiability.evaluator.test.ts` — `.toBe()` exact match |
| Forbidden model ID (claude-fable-5) | `fleet.test.ts:22` — iterates all deployments |
| Model ID name constants | `fleet.test.ts:27` — `DEPLOY_OPUS.toBe('claude-opus-4-8')` |
| Rule chunk bracket format | `chunk.test.ts:66` — `toContain([${rule.refId}])` |
| Adapter seam (at gate level) | `pnpm typecheck` via TypeScript dependency graph (TS2307) |

## What the suite does not defend (theater gaps)

| Invariant | Gap |
|---|---|
| Atomic envelope: audit op present | No unit test inspects `ops[]` before Cosmos batch |
| Atomic envelope: version op present | No unit test inspects `ops[]` before Cosmos batch |
| Role guard on /mutate | `requireRole` tested in isolation; no route-level test |
| Role guard on /mutateBatch | Same — no route-level test |
| Citation instruction in SYSTEM prompt | ai.test.ts does not assert SYSTEM content |
| Secret-free Vite define block | No config audit test |
| Coverage chunk bracket format | `chunk.test.ts` checks refId presence, not bracket syntax |
| Adapter seam (test-suite level) | Typecheck only; no lint rule or test enforces it |

---

## Next steps (for Wave-Runner)

Close DEF-0043–0050 by writing the missing tests:

1. **DEF-0043 + DEF-0046** — envelope unit test: mock Cosmos batch, assert `ops.some(o => o.resourceBody?.kind === 'audit')` and `ops.some(o => o.resourceBody?.kind === 'version')`.
2. **DEF-0044 + DEF-0047** — supertest route test: VIEWER JWT → POST /db/mutate and /db/mutateBatch → assert HTTP 403.
3. **DEF-0045** — snapshot or string assertion on the SYSTEM constant in ai.js: must contain `'MUST cite its source'`.
4. **DEF-0048** — vite.config unit test or CI script: assert `define` keys match no secret-name pattern.
5. **DEF-0049** — add `expect(ch.text).toContain(`[${cov.refId}]`)` to the coverage chunk test.
6. **DEF-0050** — add ESLint `no-restricted-imports` rule forbidding `@azure/cosmos` (etc.) in `app/src/`.
