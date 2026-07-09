# AI Cost Report — before vs after

> **The proof for the cost ensemble.** Per-feature tokens + USD **BEFORE**
> ([COST_BASELINE.md](COST_BASELINE.md)) vs **AFTER** the full cost program (prompt caching +
> cheap-first cascade + semantic response cache + invalidation + caps/breakers), the blended
> reduction, the cache / semantic-cache / escalation rates, and the `pnpm eval` grounding +
> citation pass rate before vs after.
>
> **Methodology (read first — same caveat as [COST_PROGRESS.md](COST_PROGRESS.md)).** This
> environment has **no live Anthropic/Voyage key** (offline emulator + gate only), so per-call
> cache-hit ratio, semantic-cache-hit ratio and escalation rate cannot be *measured* here — just
> as COST_BASELINE.md's token counts were per-call **estimates**, not live counters. The AFTER
> figures below are therefore **structural projections** from the prompt structure + the
> [pricing table](COST_BASELINE.md) + the mechanisms now in code, clearly labelled. The **live
> counters that replace them are already recorded per call** (`semanticCache`, `savedUsd`,
> `degraded`, `denied`, `tier`, `escalated`, cache read/write tokens) and surfaced in **Admin ›
> AI Cost**, so 7 days of production data populate the real ratios with no further code. What IS
> measured here, on the same eval set, is the **grounding/citation pass rate** (held) and the
> two rating **canaries** ($1,528 / $1,002, exact).

**Recorded:** 2026-07-08 · **Models:** `claude-sonnet-5` (reasoning), `claude-haiku-4-5` (bulk).

---

## 1. Per-feature — BEFORE vs AFTER (representative cost per call)

BEFORE = COST_BASELINE.md first-call, no cache. AFTER = the blended representative cost/call with
every mechanism now in code. "Mechanism" names the dominant lever for that feature.

| Feature | Model(s) | Before $/call | Mechanism (cumulative) | After $/call | Δ |
|---|---|--:|---|--:|--:|
| `chat` | sonnet-5 | $0.0180 | 1h prompt-cache on turns 2+ · **semantic cache** (~35% hit) · call-gating | **$0.0120** | **−33%** |
| `analyzeClaim` | sonnet-5 | $0.0210 | 1h prompt-cache of the uploaded doc across turns | **$0.0150** | **−29%** |
| `extractCoverages` | haiku→sonnet | $0.0310 | **cheap-first cascade** (escalate only a failed section) + doc cache | **$0.0120** | **−61%** |
| `scaffoldProduct` | sonnet-5 | $0.0200 | 1h prompt-cache of tools+system across the tool loop | **$0.0170** | **−15%** |
| `draftRule` | sonnet-5 | $0.0140 | 1h prompt-cache of tools+system | **$0.0120** | **−14%** |
| `identifyBaseForm` | haiku→sonnet | $0.0010 | cheap-first (escalate only when the header can't be read) | **$0.0004** | **−60%** |
| `summarizeProduct` | haiku | $0.0020 | already cheap; **persisted cache** (productSummaries) + A4 removed the auto-fire | **$0.0020** | flat/call, **↓ volume** |
| `describeForm` | haiku | $0.0010 | cache-first (2nd+ call $0) | **$0.0010** | flat/call, **↓ volume** |
| `refreshNews` / `nightlyNews` | haiku | $0.006 / $0.017 | unchanged (haiku + web-search) | same | flat |

**Blended (the 8 interactive features):** Σ before = **$0.108/call**, Σ after = **$0.0714/call**
→ **≈ 34 % blended reduction** (Σ after ÷ Σ before). Per-call blended: **$0.0135 → $0.0089**.
This is the headline surfaced in Admin › AI Cost.

> The blended figure counts **first-call** economics. Repeat-heavy and multi-turn sessions do
> materially better: a semantic-cache hit collapses a `chat` answer to a haiku verifier (~$0.0007)
> — a **~96 % saving on that answer** — and prompt-cache reads (0.1× input) compound across a
> workspace session. The `savedUsd` counter accumulates the avoided spend live.

---

## 2. Where the new spend went (the cost of the caches)

Honest accounting — the ensemble adds small costs to remove large ones:

- **Semantic-cache probe:** one Voyage query embed (~$0.00002) + a **haiku verifier** (~$0.0006)
  per candidate that clears the freshness + similarity gates. A *miss* after the verifier is the
  only case that costs more than no-cache — bounded by the **conservative 0.93 similarity
  threshold** (near-duplicate questions only), so it is rare. Net expected value is strongly
  positive at any hit rate above ~4 %.
- **Invalidation trigger:** on an entity write, one incremental re-embed of that entity's single
  chunk (or a lexical null-vector write offline) + targeted cache/summary evictions. O(1) per
  edit, not O(corpus) — the full reindex is unchanged.
- **Cap/breaker guard:** 3–5 counter reads per gated call (degrade to allow on any error). Cheap
  relative to a model call, and it is what makes the global ceiling a real backstop.

---

## 3. Rates (projected — live counters pending 7 days of data)

| Rate | Definition | Projected | Where it's live |
|---|---|--:|---|
| Prompt-cache hit ratio | cache-read tokens ÷ total tokens | ~40 % (chat-heavy) | "Cache-hit ratio" tile |
| **Semantic-cache hit rate** | cache hits ÷ (hits + misses), chat | **~35 %** on repeat portfolio Q&A | "Semantic response cache" panel |
| Escalation rate | cheap→strong escalations ÷ cheap calls | < 15 % on well-formed forms | "Cheap-first cascade" panel + per-feature "Escal." |
| Degraded / denied | calls served reduced / blocked by a cap | 0 until a cap bites | "Cost controls" panel |

A drifting verifier (the known failure mode) drives the escalation rate toward 100 %, which trips
the configurable alarm; a runaway blended spend trips the global-ceiling banner.

---

## 4. Grounding + citation pass rate — BEFORE vs AFTER (measured, same eval set)

`pnpm eval` (offline golden fixtures + adversarial guards + retrieval-quality, no live API):

| Section | Before (prior phase) | After (this prompt) | Verdict |
|---|--:|--:|---|
| Golden cases (grounding · citation · shape) | 4/4 | **4/4** | **held** |
| Grounding guards (adversarial — must reject) | 3/3 | **4/4** | **improved** (+`semantic-cache-stale-citation`) |
| Retrieval quality (expected anchor in top-k) | 8/8 | **8/8** | **held** |

The new guard proves the semantic cache **never serves an answer whose cited refId no longer
resolves** — at similarity 1.0, a stale-cited candidate still returns `stale-citation` (miss +
evict). Grounding/citation validity is **held**; the validation layer is untouched.

Seed inventory at run time: **108 known refIds · 24 known form numbers** (corpus: 132 chunks).

---

## 5. Gate + canaries (measured, this run)

| Check | Result |
|---|---|
| `pnpm typecheck` (all workspaces) | ✅ green |
| `pnpm lint` (all workspaces) | ✅ green (only pre-existing `isoImport.test.ts` warnings) |
| root `vitest` (shared + app) | ✅ **217 passed** (+22 cost: budget · breaker · semanticCache) |
| `pnpm --filter functions test` | ✅ **30 passed** |
| **Canary — Personal Home** | ✅ **$1,528** exact |
| **Canary — Personal Auto** | ✅ **$1,002** exact |
| `pnpm build` (app) + `functions build` (tsup) | ✅ green |
| `pnpm eval` | ✅ **4/4 + 4/4 guards + 8/8 retrieval** |

> Gate note: `pnpm test` also chains `test:rules` / `test:integration` / `test:e2e`, which require
> the Firestore/Storage emulators + a Playwright browser and are not runnable in this offline
> environment; the offline-runnable stages above are green (the same set prior COST_PROGRESS
> entries reported).

---

## 5b. Made to actually run — provider-agnostic key + end-to-end proof on real infra

The cache is no longer prod-with-Voyage-only. The query embedding now degrades **dense → local**
(mirroring retrieval): a Voyage vector when a key is configured, else a deterministic
dependency-free **local hash embedding** (`localQueryEmbedding`, unit-tested). So the semantic
cache activates **with or without Voyage** — the local path uses an in-memory cosine over the
small cache collection (no Firestore `findNearest`, so it runs in the emulator too). The cheap
verifier is now **injectable** (a live Haiku by default; a stub in tests; a near-exact-similarity
fallback when no verifier is available).

Proven end-to-end on real infrastructure (not mocks):

| What | How | Result |
|---|---|---|
| Gates 1–2, eviction, invalidation, budget ladder, breaker | `tests/integration/costEnsemble.test.ts` vs the **live Firestore emulator** (`pnpm test:integration`) | **8/8** — MISS→store→HIT (sim 1.000); verifier-veto → `verifier-declined`; unrelated → `below-threshold` (sim 0.183); stale-cited → evicted; edit → `invalidateSemanticCacheByAnchors` evicts; global→`deny`, session→`degrade`, 4 faults→breaker open |
| Gate 3 — the cheap verifier | **live Anthropic Messages API** (curl, `claude-haiku-4-5` → resolves `claude-haiku-4-5-20251001`) | fitting paraphrase → **"YES"**; different-topic question → **"NO"** (matches `startsWith('YES')`) |

This is the "measured on real infra, not asserted" evidence for Parts A–C; the USD deltas in §1
remain projections (no live counters without production traffic).

## 6. Hostile self-review (does it actually hold?)

- **Can the semantic cache return a confidently-wrong answer for a similar-but-different question?**
  No. Three gates, all required: a **conservative 0.93 cosine** floor (near-duplicate only), a
  **cheap verifier** that must say YES (any ambiguity → NO), and product-scope must match. The
  gate logic is unit-tested (`shared/src/cost/semanticCache.test.ts`).
- **Can it serve a stale answer after an edit?** No, two independent defences: the **read-path
  freshness gate** rejects + evicts any candidate whose cited anchors no longer resolve (catches
  deletes), and the **invalidation trigger** evicts by cited anchor on every entity write (catches
  edits where the refId survives but the content changed). Freshness is checked **before**
  similarity, so it wins even at similarity 1.0. Proven by the new eval guard.
- **After an edit, can any grounded feature still cite a stale chunk?** No — the trigger re-chunks
  the changed entity and upserts its vector in the same server flow, so `chat`/`claims` retrieval
  reads the current chunk; a delete removes it.
- **Does a tripped breaker degrade cleanly or throw?** Cleanly — SSE endpoints stream a terminal
  notice + `done` (no provider call); onCall endpoints throw `resource-exhausted` (a client toast).
  A cache hit / denial never "heals" the breaker (`providerCalled: false`).
- **Is the before/after measured on the same eval set, not asserted?** The **eval + canaries are
  measured** on the same fixtures before/after (§4–5). The **USD deltas are projections** (no live
  key), labelled as such, with the live counters already recorded to replace them.
