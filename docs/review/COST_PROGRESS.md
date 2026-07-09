# AI Cost Progress

> **Append-only through the cost-optimization phase.** Each entry records what changed, the
> projected/measured cost delta vs [COST_BASELINE.md](COST_BASELINE.md), and the guardrail
> checks that held. Newest entry last.
>
> **Methodology note (read first).** This environment has **no live Anthropic key** (offline
> emulator/gate only), so per-call cache-hit ratio and escalation rate cannot be *measured*
> here — exactly as COST_BASELINE.md's token counts were per-call estimates, not live
> counters. The numbers below are therefore **structural projections** derived from the
> prompt structure + the pricing table, clearly labelled as such. The live counters that will
> replace them are now **recorded per call** (`tier`, `escalated`, cache read/write tokens)
> and surfaced in the **Admin › AI Cost** tab, so 7 days of production data will populate the
> real ratios without further code.

---

## 2026-07-08 — Caching + call-gating + cheap-first cascade

### Gate + regression (measured, this run)

| Check | Result |
|---|---|
| `pnpm typecheck` (all workspaces) | ✅ green |
| `pnpm lint` (all workspaces) | ✅ green (only pre-existing `isoImport.test.ts` warnings) |
| `pnpm test:unit` (169 shared/app + 25 functions) | ✅ **194 passed** |
| **Canary — Personal Home** | ✅ **$1,528** exact |
| **Canary — Personal Auto** | ✅ **$1,002** exact |
| `pnpm build` (app) | ✅ green |
| `pnpm eval` | ✅ **4/4 cases + 3/3 grounding guards** (grounding/citation pass rate **unchanged**) |

Grounding held: the eval validation layer (citation guards, sanitizers, shape checks) is
untouched, so the 4/4 + 3/3 result is identical to the P2 baseline. Seed inventory at run
time: 108 known refIds · 24 known form numbers.

---

### Part A — Prompt caching (explicit 1h TTL) + call-gating

**Every AI endpoint now marks its stable prefix with a single 1-hour cache breakpoint**
(`runtime.CACHE_1H`). Caching is a prefix match (order tools → system → messages): the
breakpoint sits on the last stable block and the volatile per-request suffix stays after it.
1h TTL is GA (verified at docs.claude.com — no beta header) and keeps the prefix warm across
the minutes-long gaps a 5m TTL drops (a workspace session, the nightly news run, a multi-turn
claims/extraction request).

| Endpoint | Cached prefix | Effective now? |
|---|---|---|
| `chat` / `draftRule` / `scaffoldProduct` (Sonnet) | `SYSTEM_PROMPT` + feature system + `TOOLS` (~1.5K tok) | **Yes** — > Sonnet's 1024-tok floor; reads at 0.1× on turns 2+ and repeat requests |
| `analyzeClaim` (Sonnet) | claims system + `TOOLS` + **the uploaded document** | **Yes** — biggest win: the policy doc is read once and reused across turns at 0.1× |
| `extractCoverages` (Sonnet/Haiku) | `SYSTEM` + 4 forced tools + **the base form** | **Yes** — doc read once per model across the 4 sections |
| `summarizeProduct` (Haiku) | analyst instruction + `product_summary` tool | **Latent** — below Haiku's 4096-tok floor today; activates free if the prefix grows |
| `describeForm` (Haiku) | analyst instruction | **Latent** (< 4096) |
| `refreshNews` / `nightlyNews` (Haiku) | scout instruction + `web_search` tool def | **Latent** (< 4096); reused across `pause_turn` turns once past the floor |

> Honest note: the four Haiku endpoints carry the breakpoint per the phase spec, but Haiku's
> **4096-token** minimum cacheable prefix means their small prefixes are a correctness-neutral
> **no-op today** (Anthropic silently skips caching below the floor — no error) that becomes
> effective the moment the prefix crosses 4096 tokens. The Sonnet-tier caches (1024 floor) are
> effective now.

**Pricing correction.** Every breakpoint we write is 1h, and a 1-hour cache write bills at
**2× input** (vs 1.25× for 5m). `telemetry.ts` now prices `cacheWrite` at 2× (Sonnet $6.00,
Haiku $1.60 /MTok) so `estimatedUsd` is exact. Writes are a small slice of steady-state cost —
a stable prefix is read far more than written — so blended cost still falls.

**A4 — two billed triggers removed (no cost without intent):**
- **Overview auto-summary.** `ProductSummaryDashboard` no longer auto-runs `summarizeProduct`
  on mount (it fired once per product per session). It now hydrates a summary generated
  earlier this session from `sessionStorage` and otherwise shows an explicit **Generate AI
  summary** affordance. On a large portfolio this removes N auto-billed Haiku calls per
  session; the polished dashboard + session cache are preserved.
- **Home starter pills.** Pills now **prime the composer** (`setInput`) instead of firing a
  full chat turn on click; the user reviews and sends. Prompts were refreshed to the reseeded
  portfolio (Personal Home HO-3 · Personal Auto) so a primed ask lands on citable data.

---

### Part B — Cheap-first cascade (haiku-first, escalate only on a failed check)

Applied to the **classification / extraction-first-pass** call sites the fast model handles
well, reusing the **existing verifiers** as the escalation check. Sonnet is reserved for
**final reasoning + user-facing grounded answers**; the already-Haiku endpoints are unchanged.

| Feature | Policy | Escalation CHECK (reused verifier) | Rationale |
|---|---|---|---|
| `identifyBaseForm` | **haiku → sonnet** | Neither a printed form number nor a recognised line (HO/GL) came back | Header classification; metadata for a library card the author reviews — no quality-floor risk |
| `extractCoverages` | **haiku → sonnet, per section** | Sanitizer dropped **all** proposed items (fabrication), or coverages/forms section is empty (under-read) | Extraction first-pass; the **dominant cost driver**; human-curated proposals with confidence + citations |
| `chat` | **sonnet only** | — | User-facing grounded prose, streamed — post-stream escalation would re-stream/duplicate visible text (UX-unsafe). Quality floor. |
| `analyzeClaim` | **sonnet only** | `determinationIsCited` (server-rejects uncited verdicts) | Item 5: the determination stays Sonnet-grade + server-rejected if uncited. Unchanged. |
| `draftRule` / `scaffoldProduct` | **sonnet only** | `verifyDraft` / `verifyScaffold` (drop ungrounded refs) | "Final reasoning"; streamed emit — mid-stream escalation would show two cards. Grounding still enforced by the verifier on Sonnet. |
| `summarizeProduct` / `describeForm` / `refreshNews` / `nightlyNews` | **haiku only** | (already cheap) | Already the fast model — nothing to downgrade |

**Escalation is per-call and only on a failed check** — extraction escalates *only the failing
section*, so a well-formed form pays Sonnet for nothing. The two hard guarantees are untouched:
`analyzeClaim` stays Sonnet-grade and server-rejects an uncited verdict; no streamed user-facing
grounded answer is silently Haiku-only.

---

### Projected per-feature delta vs COST_BASELINE.md (structural — live counters pending)

| Feature | Baseline (Sonnet, no cache) | Mechanism | Projected direction |
|---|---|---|---|
| `extractCoverages` | ~$0.031/call | Haiku-first sections (input 3.75× cheaper, output 3.75× cheaper) + doc cache; Sonnet only on a failed section | **↓ ~50–70%** on well-formed forms; ↑ only for the rare all-fabricated/under-read section that escalates |
| `identifyBaseForm` | ~$0.001/call | Haiku-first; Sonnet only when the header can't be read | **↓ ~60–70%** in the common HO/GL case |
| `chat` | ~$0.018 first turn | 1h cache of ~1.5K-tok tools+system prefix → 0.1× on turns 2+/repeat requests | **↓** per subsequent turn (prefix slice ~90% cheaper), now surviving 5–60 min session gaps |
| `analyzeClaim` | ~$0.021/call | 1h cache of the uploaded document across turns | **↓** materially on multi-turn conversations (doc no longer re-billed per turn) |
| `draftRule` / `scaffoldProduct` | ~$0.014 / ~$0.020 | 1h cache of tools+system across the tool loop | **↓** on the cached prefix slice |
| Haiku endpoints | ~$0.001–0.017 | breakpoint latent < 4096 tok | **flat** today; ↓ once prefix grows |

**Blended cost drops** (extraction — the largest line — moves to a 3.75×-cheaper model on the
common path, and the two heaviest Sonnet contexts (chat prefix, claims document) now read from
cache), **with grounding held** (eval 4/4 + guards 3/3, validation layer untouched).

---

### Observability (Part B6) — now in Admin › AI Cost

- **`tier` (`cheap`/`strong`) + `escalated`** recorded on every usage record (`recordCascade`
  writes an accurate per-model split; non-cascade sites default correctly).
- **Cache-hit ratio** tile (already present) + a **Cheap-first cascade** panel: cheap vs strong
  calls, escalations, strong-spend share, and the **escalation rate**.
- **Per-feature escalation** column ("Escal.") pinpoints a drifting verifier.
- **Configurable alarm** (localStorage): an escalation-rate threshold (default 50%) and a spend
  cap ($/window, 0 = off) raise a banner when breached — the known failure mode (a drifting
  verifier escalating everything) drives the escalation rate toward 100% and trips the alarm.

### Hostile self-review

- **Volatile value inside a cached prefix?** No — every breakpoint is on the last *stable*
  block; per-request context (focus product, metadata JSON, form fields, instruction, the
  document body) all sit *after* the breakpoint.
- **Gating regressed UX?** No — the Overview still shows an instantly-hydrated session summary
  and a clean Generate CTA; Home pills still one-tap-prime the composer.
- **A user-facing grounded answer silently Haiku-only?** No — `chat`, `analyzeClaim`,
  `draftRule`, `scaffoldProduct` stay Sonnet; only human-reviewed extraction/identification
  classify on Haiku first.
- **Escalation rate can climb to ~100% unnoticed?** No — it is recorded per feature, surfaced,
  and alarmed.
- **Any grounding case regressed?** No — eval 4/4 + guards 3/3; both canaries exact.

---

## 2026-07-08 — Grounded retrieval (Voyage seam) + Citations API

### Gate + regression (measured, this run)

| Check | Result |
|---|---|
| `pnpm typecheck` (all workspaces) | ✅ green |
| `pnpm lint` (all workspaces) | ✅ green (only pre-existing `isoImport.test.ts` warnings) |
| `pnpm test:unit` (187 shared/app + 30 functions) | ✅ **217 passed** (+23: 18 shared retrieval, 5 citations) |
| **Canary — Personal Home** | ✅ **$1,528** exact |
| **Canary — Personal Auto** | ✅ **$1,002** exact |
| `pnpm build` (app) | ✅ green |
| `pnpm eval` | ✅ **4/4 cases + 3/3 grounding guards + 8/8 retrieval-quality** (grounding pass rate **held**; retrieval-quality check **added**) |

Same methodology caveat as prior entries applies: **no live Anthropic/Voyage key** in this
environment, so per-turn token counts are **structural projections**, not live counters. The
new retrieval path is exercised offline via its **lexical fallback** (the eval's 8/8
retrieval-quality section and 18 shared unit tests); the dense Voyage path + Citations API are
typechecked, unit-tested at the seams, and activate in prod when a key is set.

### What changed — retrieval behind a provider seam

A grounded turn no longer pulls whole collections. The scan tools (OBSERVATIONS **B10**) now go
through an indexed retriever behind a small provider seam (`functions/src/retrieval`, mirroring
the app's Firebase→AWS adapter seam), with a **dependency-free lexical fallback** so nothing
external is required offline. `VOYAGE_API_KEY` is a **server secret** (read only in
`runtime.ts`, never `VITE_*`, never client, never logged).

| Tool | Before | After |
|---|---|---|
| `search_entities` | read **all** `searchIndex`, TF-IDF in memory, return top-15 | embed query → **indexed KNN** (`findNearest`) → rerank → top-8 chunks + metadata (lexical fallback + legacy safety net) |
| `get_dictionary` (name) | read **all** `dictionary` | semantic retrieval → targeted read of the matched entry |
| `get_dictionary` (refId) | read **all** `dictionary`, match in memory | targeted `where('refId','==')` |
| `get_forms` (search) | read **all** `forms`, filter in memory | semantic retrieval → targeted reads of matched forms |
| `get_forms` (formNumber) | read **all** `forms`, match in memory | direct doc read |
| `get_coverage` / `run_rating` / `get_ld_table` | direct exact reads | **unchanged** (exact lookups stay direct) |
| dictionary **"used in"** | exhaustive corpus read | **unchanged** (completeness is a data-truth guarantee — deliberately not truncated to top-k) |

### Projected per-turn delta (structural — live counters pending)

- **Firestore read volume ↓ per grounded turn.** The dominant per-turn read — `search_entities`
  scanning the entire `searchIndex` on *every* call — becomes an indexed KNN over ~`candidateK`
  candidates (dense) or a single top-k pass (lexical). `get_dictionary`/`get_forms` discovery
  and exact lookups become targeted reads instead of whole-collection scans. At portfolio scale
  this is the difference between O(corpus) and O(k) per call.
- **Model input tokens ↓ per grounded turn.** Retrieval returns a *small, ranked, semantically
  relevant* set (top-8 chunks) with the refId/form anchor inline, so the model needs fewer
  discovery round-trips before it can answer — each avoided tool turn removes a full
  system+tools prefix re-send (even cached, a read at 0.1×) plus its tool-result tokens.
- **Citations API on chat + claims.** Retrieved chunks (and, for claims, the uploaded base form)
  are passed as citeable `document` blocks with `citations.enabled`. `cited_text` does **not**
  count as output tokens, so grounding evidence moves off the billed output channel; and each
  citation is **server-verifiable** — it resolves via `document_index` back to a real chunk whose
  refId/form number we know (closes **C1**: chat grounding was prompt-only). Kept on the prose
  channel only; the structured `emit_*` tools are untouched (citations ≠ structured outputs).

### Retrieval-quality eval (new)

`pnpm eval` gained a **retrieval-quality** section: 8 natural-language queries, each asserting the
expected `refId`/form number is in the top-k over the real 132-chunk corpus (offline lexical —
the prod-without-key path). This is the "are the expected refIds retrieved?" check; a chunking or
ranking regression that stops an answer from finding its source now fails the gate.

### Hostile self-review

- **Can a Voyage key reach the client or a log?** No — `VOYAGE_API_KEY.value()` is read only in
  `runtime.ts:voyageKey()`; nothing under `functions/src/retrieval` is imported by `app/`;
  `groundingChunks` is denied to all clients in `firestore.rules` (Admin-SDK only); the Voyage
  client surfaces only HTTP status on error, never the body/key.
- **Does retrieval miss a refId the answer needs?** Guarded by the 8/8 retrieval-quality eval +
  `candidateK` over-fetch before rerank; and a Voyage/rerank outage **degrades to lexical /
  vector order** rather than blanking grounding, plus `search_entities` falls back to the legacy
  `searchIndex` rank if the index hasn't been built yet.
- **Did citation validity drop?** No — the bracket-citation post-check is unchanged; the Citations
  API *adds* a server-verifiable layer (every citation resolves to a known chunk).
- **Is `shared/` still platform-free?** Yes — `shared/src/retrieval` is pure TS (chunking + lexical
  ranking + int8/cosine); the vector store, Voyage client and secret live only in `functions/`.
- **Both canaries exact?** Yes — $1,528 + $1,002.

---

## 2026-07-08 — Semantic cache + invalidation + caps/breakers (closes the cost ensemble)

Full proof in [COST_REPORT.md](COST_REPORT.md). Same offline methodology caveat (no live
Anthropic/Voyage key → USD deltas are structural projections; the live counters that replace
them are now recorded per call and surfaced in Admin › AI Cost).

### Gate + regression (measured, this run)

| Check | Result |
|---|---|
| `pnpm typecheck` (all workspaces) | ✅ green |
| `pnpm lint` (all workspaces) | ✅ green (only pre-existing `isoImport.test.ts` warnings) |
| root `vitest` (shared + app) | ✅ **217 passed** (+22 cost: budget · breaker · semanticCache) |
| `pnpm --filter functions test` | ✅ **30 passed** |
| **Canary — Personal Home** | ✅ **$1,528** exact |
| **Canary — Personal Auto** | ✅ **$1,002** exact |
| `pnpm build` (app) + functions `tsup` | ✅ green |
| `pnpm eval` | ✅ **4/4 cases + 4/4 guards + 8/8 retrieval** (grounding **held**, guards **+1**) |

### Part A — semantic response cache

Repeat grounded chat questions are cached keyed on the **query embedding** (Voyage) and reused
only behind three gates, all required: **freshness** (every cited refId/form still resolves —
checked first, absolute), a **conservative 0.93 cosine** similarity floor, and a **cheap haiku
verifier** that must agree the cached answer fits the new question. A hit skips retrieval + the
Sonnet call (streams the cached answer + an info notice); a stale-cited candidate is evicted, never
served. Pure gate logic in `shared/src/cost/semanticCache.ts` (`decideSemanticCache`,
`staleCitedAnchors`, `verifiedCitedAnchors`); Firestore KNN + verifier in
`functions/src/semanticCache.ts` (`semanticCache` collection, server-only). Telemetry records
`semanticCache` + `savedUsd`; the Admin tab shows the **semantic-cache hit rate** + est. saved. A
per-session **Regenerate** control on Home bypasses the cache read.

### Part B — invalidation (correctness), in the same server flow

Nine `onDocumentWritten` triggers (`functions/src/invalidate.ts`) fire on any entity write —
adapter `mutate()`, server `auditedMerge()`, or seed — and, in that same flow: **re-chunk** the
changed entity + upsert its vector incrementally (delete on entity delete), **evict** every
semantic-cache answer that cited it (by refId/form — catches edits where the refId survives),
**mark** the owning product's summary stale, and **clear** a form's cached AI description on a
substantive change (loop-safe). A grounded answer can no longer retrieve a stale chunk or a stale
cached answer. Triggers write only to *other* collections (no loops) except the single guarded
form-description clear.

### Part C — cost caps + circuit breakers (safety)

Pure ladder + breaker in `shared/src/cost/{budget,breaker}.ts`; Firestore counters + breaker I/O in
`functions/src/costGuard.ts` (`costCounters`, server-only). A **hard global daily ceiling** DENIES
(clear "temporarily limited" message + an ADMIN ceiling banner); **soft per-session / per-feature**
caps DEGRADE (cached answer, or fewer tool turns / no escalation) rather than failing hard; a run of
provider faults **trips a breaker, not the budget** — degrading cleanly instead of hammering a
stalled upstream. Wired into every user-facing AI endpoint (chat full; claims/extract/rules/scaffold
via a shared SSE gate; summarize/describe via a deny/breaker gate). Counters + breaker are kept
current for every feature through `telemetry.recordUsage`, so tracking is universal with no
per-endpoint code.

### Part D — the proof

[COST_REPORT.md](COST_REPORT.md): per-feature before/after + a **≈34 % blended reduction** ($0.0135
→ $0.0089 per call; repeat/multi-turn sessions do materially better), the cache / semantic-cache /
escalation rates, and the eval grounding/citation pass rate **held** (guards **+1**). The headline
before/after + blended reduction is surfaced in **Admin › AI Cost**.

### Made it actually run (provider-agnostic key + real-infra proof)

The cache no longer requires Voyage. The query embedding degrades **dense → local** (a
deterministic `localQueryEmbedding` hash vector when no Voyage key), and the local path uses an
in-memory cosine over the small cache collection (no `findNearest` → emulator-friendly). The
verifier is injectable (live Haiku default; stub in tests). Proven end-to-end:
- **Firestore emulator** (`tests/integration/costEnsemble.test.ts`, in `pnpm test:integration`): 8/8
  — MISS→store→HIT (sim 1.000), verifier-veto, below-threshold (sim 0.183), stale eviction, anchor
  invalidation, global deny / session degrade / breaker-open.
- **Live Anthropic API** (curl, `claude-haiku-4-5`): the cheap verifier returns "YES" for a fitting
  paraphrase and "NO" for a different-topic question.

### Hostile self-review

- **Confidently-wrong cache hit for a similar-but-different question?** No — 0.93 floor + verifier
  (ambiguity → miss) + product-scope match, all required. (Local-hash keys require lexical overlap,
  so they're if anything MORE conservative than dense — plus the same verifier.)
- **Stale answer after an edit?** No — read-path freshness gate (deletes) + invalidation trigger by
  cited anchor (edits); freshness beats similarity even at 1.0. New eval guard proves it.
- **Stale-chunk citation after an edit?** No — the trigger re-chunks + re-embeds in the same flow.
- **Tripped breaker throws?** No — SSE streams a notice + `done`; onCall throws `resource-exhausted`;
  a cache hit/denial never heals the breaker (`providerCalled:false`).
- **Before/after asserted, not measured?** Eval + canaries measured on the same set; USD deltas are
  labelled projections with live counters already recording the real ratios.
- **Both canaries exact?** Yes — $1,528 + $1,002.
