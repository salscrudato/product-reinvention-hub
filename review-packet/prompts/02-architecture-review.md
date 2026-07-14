# Prompt 02 — Architecture & Scalability Review

> Paste everything below into the external AI. Attach `00-CONTEXT-DOSSIER.md` and the system +
> data-flow SVG diagrams. Give the reviewer access to `server/`, `app/src/lib/backend/`, and the
> build config (`esbuild`/`vite` scripts).

---

## Role & goal

You are a principal engineer / cloud architect reviewing an insurance SaaS ("Product Reinvention Hub")
for scalability, resilience, and long-term maintainability. Stack: React 19 + Vite 8 SPA (`app/`) →
same-origin Express host on **Azure App Service** (`server/`) → Cosmos DB + Azure Foundry (Claude/OpenAI)
+ Blob. A pure-TS engine lives in `shared/`. The system currently assumes a **single App Service
instance** (documented as RISK-005). Your job is to find what breaks under growth and multi-instance
scale-out, and to produce a prioritized modernization roadmap that respects the product's invariants.

## What to focus on

1. **RISK-005 — single-instance state.** These are in-memory and per-instance today:
   - the AI **cost guard** (spend budgets),
   - the **rate limiters**,
   - the **JWT `jti` revocation cache**,
   - **HomeCheck / long-running session** state,
   - SSE / polling subscriber bookkeeping.
   Enumerate exactly what corrupts, double-counts, or silently fails when App Service scales to 2+
   instances or recycles a worker. For each, propose a shared-state fix (Azure Cache for Redis, Cosmos
   TTL container, App Configuration, etc.), with the trade-offs (latency, cost, added failure mode) and a
   migration path that can ship incrementally.
2. **Realtime via smart-polling instead of push.** The SPA polls (adaptive interval) rather than holding
   sockets. A product workspace has ~10 live subscriptions. Assess: staleness/UX, Cosmos **RU burn** and
   cost at N concurrent users, thundering-herd on interval alignment, and whether a push mechanism
   (SignalR, WebSocket, SSE fan-out) is worth it — or whether polling is the right call with tuning
   (backoff, ETag/`If-None-Match`, change-feed, jitter). Quantify where you can.
3. **The adapter seam** (`app/src/lib/backend/azure.adapter.ts`). One `BackendAdapter` mediates all
   reads/writes. Evaluate it as a swap point and a bottleneck: batching, caching, request coalescing,
   error/retry policy, and whether the seam leaks Cosmos concepts into the app.
4. **`shared` bundling via esbuild (`shared.cjs`).** The pure-TS engine is bundled to a CJS artifact the
   server consumes. Review this for correctness, tree-shaking, dual-package hazards, source-map/debug
   fidelity, and drift risk between the ESM the app imports and the CJS the server runs.
5. **Cosmos partition-key design.** Keys are `${tenantId}|${base}`. Identify **hot-partition** risk (a
   large tenant, a high-write entity type, the append-only audit chain concentrating writes), the 20GB
   logical-partition ceiling, and cross-partition query cost. Recommend partitioning/sharding strategies
   and where a synthetic key or per-entity container helps.
6. **SSE + Azure's 230s idle timeout.** Long import streams must survive the App Service front-end idle
   kill. Review the heartbeat/keep-alive and batch-progress approach for import SSE — correctness on
   reconnect, resumability, and whether work is lost if the socket dies mid-stream.
7. **General scale posture** — connection pooling to Cosmos/Foundry, cold-start, graceful shutdown/drain,
   idempotency of retried mutations, backpressure on the AI paths, and observability (are the cost guard,
   limiters, and audit chain emitting metrics you could alarm on?).

## Constraints you must respect

- Keep the **adapter seam**: the SPA must not gain a direct data-store/AI SDK dependency.
- Keep **atomic mutations**: entity + audit + version + searchIndex + groundingChunk stay one Cosmos
  transactional batch through `/api/db/mutate`. A scale fix must not fracture atomicity or the hash-chain.
- Keep **AI server-side** and **grounded + cited**.
- Preserve the rating **canaries** (HO-3 $1,528 / PA $1,002 / GL $2,635) and model IDs.
- Prefer Azure-native services (the app is already on App Service + Cosmos + Foundry + Blob) unless a
  cross-cloud choice is clearly better; justify it.

## Output format

1. **Scale-out breakage matrix** — a table of every single-instance assumption:

   | Component | What breaks at 2+ instances | Blast radius | Fix (service + pattern) | Effort | Priority |
   |---|---|---|---|---|---|

2. **Prioritized modernization roadmap** — grouped **Now / Next / Later**. Each item: problem, proposed
   change, expected benefit (with rough numbers where possible), risk, and rollback. Order by
   risk-adjusted value, not difficulty.
3. **RU / cost notes** — where polling, cross-partition queries, or the audit chain drive Cosmos RU, with
   concrete tuning levers.
4. **Two-sentence executive summary** at the very top: the single biggest architectural risk and the one
   change you'd make first.

Call out anything you couldn't assess without seeing a specific file, and name it.
