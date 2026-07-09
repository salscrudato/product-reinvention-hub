# AI Cost Baseline

**Recorded:** 2026-07-07  
**Models:** `claude-sonnet-5` (reasoning), `claude-haiku-4-5` (bulk/simple)  
**Purpose:** "Before" numbers for P1 telemetry + eval harness (ENHANCEMENT_BACKLOG items C1–C3).  
Token counts are per-call estimates based on prompt/tool structure; live counters will replace these once `aiUsage` accumulates production data. Eval pass rates are from the `pnpm eval` golden-fixture run (4 cases, no live API calls).

---

## Pricing reference (single source: `functions/src/telemetry.ts`)

| Model | Input | Output | Cache-read | Cache-write |
|---|---|---|---|---|
| claude-sonnet-5 | $3.00/MTok | $15.00/MTok | $0.30/MTok | $3.75/MTok |
| claude-haiku-4-5 | $0.80/MTok | $4.00/MTok | $0.08/MTok | $1.00/MTok |

Cache-read = 0.1× input price; cache-write = 1.25× input price (Anthropic standard).

---

## Per-feature estimates (first-call, no cache)

| Feature | Model | Est. input tok | Est. output tok | Est. cost/call | Notes |
|---|---|---|---|---|---|
| chat | sonnet-5 | ~2,500 | ~700 | ~$0.018 | Multi-turn; caches system prompt after turn 1 |
| draftRule | sonnet-5 | ~2,000 | ~500 | ~$0.014 | Portfolio context + rules toolset |
| scaffoldProduct | sonnet-5 | ~2,500 | ~800 | ~$0.020 | Coverage catalogue tool surface |
| extractCoverages | sonnet-5 | ~3,000 | ~1,500 | ~$0.031 | Forced `tool_choice`; multi-section accumulation |
| analyzeClaim | sonnet-5 | ~3,000 | ~800 | ~$0.021 | Policy doc retrieval + multi-turn grounding |
| identifyBaseForm | haiku-4-5 | ~400 | ~150 | ~$0.001 | Single-turn classification |
| summarizeProduct | haiku-4-5 | ~800 | ~300 | ~$0.002 | Metadata only; no doc retrieval |
| refreshNews | haiku-4-5 | ~4,000 | ~600 | ~$0.006 | Includes web-search tool result tokens |
| nightlyNews | haiku-4-5 | ~12,000 | ~1,800 | ~$0.017 | ~3 unique instructions × refreshNews cost |
| describeForm | haiku-4-5 | ~300 | ~150 | ~$0.001 | Cache-first; 2nd+ calls cost $0 |

**Dominant cost driver:** `extractCoverages` (sonnet-5, long-form structured extraction). A full 12-form extraction run costs ~$0.37 vs. ~$0.15 for equivalent haiku output — justified by extraction accuracy.

### Cache impact on chat

After the first turn the system prompt (~800 tok) is a cache hit. At $0.30/MTok vs. $3.00/MTok that's a 10× saving on that slice — ~$0.0024 saved per subsequent turn (non-trivial in a multi-session product workspace).

---

## Eval harness results (2026-07-07)

Run: `pnpm eval` — 4 golden cases, offline fixtures, no live API calls.

| Case ID | Feature | Grounding | Citation valid | Shape | PASS |
|---|---|---|---|---|---|
| claims-pipe-burst | analyzeClaim | PASS | PASS | PASS | **PASS** |
| extract-ho3-coverages | extractCoverages | SKIP (n/a) | PASS | PASS | **PASS** |
| summarize-ho3-product | summarizeProduct | SKIP (n/a) | PASS | PASS | **PASS** |
| draft-rule-cov-f | draftRule | PASS | PASS | PASS | **PASS** |

**4/4 cases passed**

Seed inventory at run time: 99 known refIds · 26 known form numbers

### What each dimension checks

| Dimension | What it verifies |
|---|---|
| Grounding | Every refId listed in `expectedRefIds` appears somewhere in the response (subset check — model cited what it was required to cite) |
| Citation valid | Every refId/form-number extracted from the response exists in seed data (hostile check — no hallucinated `HO.COV.999` or `HO 99 99` slips through) |
| Shape | All required top-level fields present in the response (structural contract not broken) |

---

## Known gaps (to close as production data accumulates)

| Gap | What's needed |
|---|---|
| Live token actuals | 7 days of production `aiUsage` data; Admin AI Cost tab will surface them |
| Cache hit ratio | Baseline assumes 0% cache; real ratio should be ~30-60% for chat heavy sessions |
| Latency p50/p95 | `latencyMs` is recorded per call; aggregate once data is present |
| Extended eval cases | Add `refreshNews` and `describeForm` golden fixtures; currently 4/10 features covered |
| Nightly-news multi-run cost | Single `recordUsage` per nightly run aggregates all instructions; drill down requires per-instruction records |
