# External Code-Review Packet — Product Reinvention Hub

A self-contained packet for handing this codebase to an **external AI reviewer**. It captures the
full current-state architecture, visual reference of every screen, and ready-to-paste prompts so a
reviewer with no prior exposure can produce high-signal, targeted findings.

**Prepared:** 2026-07-13 · **Target:** live dev `https://app-prodhub-dev.azurewebsites.net` · **Branch:** `main`

---

## What's in here

```
review-packet/
├── README.md                       ← you are here (start + how-to-use)
├── 00-CONTEXT-DOSSIER.md           ← the master architecture dossier (read this first)
├── diagrams/
│   ├── 01-system-architecture.svg          browser ↔ Express host ↔ Azure services
│   ├── 02-mutate-envelope-audit-chain.svg  the atomic write + tamper-evident audit chain
│   ├── 03-ai-fleet-rag-import.svg           model fleet, RAG+citations, 6-stage import brain
│   └── 04-auth-tenancy-roles.svg            JWT, tenant isolation, two-plane roles, request gate
├── screens/                        46 PNGs — 23 routes × {light,dark}, captured LIVE today
│   ├── SCREEN-INVENTORY.md          every route → component → purpose + capture notes
│   ├── 01-landing … 23-tenant-admin  .{light,dark}.png  (see inventory for the full list)
│   └── capture-manifest.json
├── prompts/
│   ├── 00-README.md                which prompt for which goal
│   ├── 01-security-review.md
│   ├── 02-architecture-review.md
│   ├── 03-ai-pipeline-review.md
│   ├── 04-frontend-review.md
│   ├── 05-data-integrity-review.md
│   ├── 06-insurance-domain-review.md
│   └── 08-feature-refinement-template.md   ← reusable, for refining YOUR features
└── capture-current-state.mjs        one-command fresh screenshot capture (needs your token)
```

---

## How to run a review (3 steps)

1. **Give the reviewer the context.** Attach `00-CONTEXT-DOSSIER.md` and the four SVGs from
   `diagrams/`. This alone lets a model reason about the invariants without reading every file.
2. **Give it the code.** Best: point it at a read-only GitHub mirror. Otherwise paste the specific
   files each prompt names (they list exact paths like `server/lib/auth.js`,
   `app/src/lib/backend/azure.adapter.ts`, `shared/src/rating/evaluator.ts`).
3. **Pick a prompt** from `prompts/` and paste it. Use `prompts/00-README.md`'s "I want to…" table
   to choose. For refining a specific feature of yours, use `08-feature-refinement-template.md`.

The prompts are written to respect this codebase's **binding invariants** (adapter seam, atomic
`mutate` envelope, server-side AI, grounded-and-cited responses, design tokens, the rating canaries,
and the pinned model IDs) so the reviewer's suggestions stay compatible with the deploy gate.

---

## The 60-second orientation (for a human)

- **What it is:** a multi-tenant SaaS for insurance carriers to author and govern insurance
  **Products** (Personal Home, Personal Auto, General Liability, Inland Marine, Commercial Property)
  — coverages, forms, rating algorithms, rules, state footprints — with AI copilots for portfolio
  Q&A, claims coverage analysis, and document import.
- **Shape:** pnpm monorepo. `app/` (React 19 + Vite SPA) talks **only** to a same-origin `/api/*`
  host. `server/` (Express on Azure App Service) is that host — Cosmos DB + Azure AI Foundry
  (Claude + OpenAI) + Blob. `shared/` is a pure TS engine (rating, types, LOB registry, import,
  audit chain) with zero platform imports. `functions/` is retired Firebase code, **reference-only**.
- **The load-bearing idea:** every write is one **atomic Cosmos transactional batch** (entity +
  append-only hash-chained audit event + version + search index + grounding chunk), and every AI
  answer must be **grounded and cited** — free invention is treated as a bug.
- **Deploy gate:** push to `main` → gitleaks scan → typecheck → **rating canaries** (HO-3 $1,528 /
  PA $1,002 / GL $2,635) → build → bundle-budget → deploy. A red canary blocks the deploy.

---

## Things a reviewer should know going in (highest-value areas to probe)

These are the spots most worth an external set of eyes — surfaced here so the reviewer starts warm:

1. **Hand-rolled crypto.** JWT (HS256) and OTP (HMAC) are hand-implemented in `server/lib/auth.js`
   rather than a vetted library. Worth a careful security read.
2. **Single-instance requirement (RISK-005).** The AI cost guard, rate limiters, JWT revocation
   cache, and HomeCheck sessions are all in-process. Scaling out silently breaks them.
3. **Realtime by polling.** Cosmos has no browser push, so the adapter emulates subscriptions with
   smart polling (backoff, tab-hidden pause). Cost/staleness trade-offs are worth scrutiny.
4. **AI anti-fabrication.** Citation verification (server extracts `[refId]`s and checks them against
   retrieved context; unverified → notice) is the guard against hallucinated grounding — is it airtight?
5. **Audit-chain concurrency.** The `chainHead` etag guard (412 → rebuild, 3 attempts) is what
   prevents forked/lost audit links under concurrent writers.
6. **Documentation drift to verify, not trust.** ADR 0004 references a `VITE_ALLOW_GUEST` flag that
   **no longer exists** (guest access is now only `/home-check`); recalled notes may name files that
   have moved. Treat docs as leads, confirm against code.

Full detail for every one of these is in `00-CONTEXT-DOSSIER.md`.
