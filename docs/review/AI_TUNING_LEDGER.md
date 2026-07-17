# AI Tuning Loop — Ledger

**Mission:** iterate/test/refine ALL AI functionality until premium + robust — prompts, model
selection & parameters, prompt techniques, embeddings, retrieval/RAG, streaming, AI content
display, cost guard, architecture. Every AI call perfectly tuned.

**Discipline (never violate):**
- Gate green after each change: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- Canaries byte/penny-exact: PH $1,528, PA $1,002, GL $2,635, filing-import $1,281.
- Citations-or-discarded; flag-not-invent; refIds byte-for-byte; envelope for writes.
- Model IDs only from fleet registry; always metered; never hardcode a model string.
- **Verify-first**: any change to a Foundry call PARAMETER (thinking/effort/output_config/headers)
  must be proven against the live Foundry endpoint (probe) before shipping. Prompt/ordering/retry/
  parsing/batching/model-role changes are safe to make + gate-verify without a live probe.
- Do NOT push. Local commits only if explicitly authorized.

**Status legend:** `TODO` → `PROBING` (needs live verify) → `IN-PROGRESS` → `GATED` (gate green) → `DONE`. `REJECTED` = verified non-issue. `BLOCKED` = needs live probe/creds.

---

## Foundry capability ground-truth (probe results)

_Populated by the consolidated Foundry probe (reads keys.md via fs, emits only pass/fail).
Until filled, all `foundryDependent` items stay BLOCKED/PROBING._

**PROBED LIVE 2026-07-16** (foundry-prodhub-dev, anthropic-version 2023-06-01) — the passthrough
enforces first-party model rules. Definitive:

| Capability (claude-opus-4-8 via Foundry `/anthropic`) | Result | Evidence |
|---|---|---|
| baseline messages call | ✅ 200 | current pattern works |
| `thinking:{type:'enabled',budget_tokens}` | ❌ **400** | *"not supported… Use thinking.type.adaptive and output_config.effort"* — scaffold-product WAS 400ing |
| `thinking:{type:'adaptive'}` | ✅ 200 | available (non-forced calls) |
| `output_config:{effort:'high'}` | ✅ 200 | available + honored (Foundry's own 400 text points here) |
| `temperature` | ❌ **400** | *"deprecated for this model"* — omission is correct |
| `<4096`-tok system + `cache_control` | ⚠️ 200 but `cache_creation=0` | sub-min prefix = silent no-op (S08) |
| Haiku `enabled+budget` thinking | ✅ 200, thinking engaged | haiku keeps legacy form |
| forced `tool_choice` + `adaptive` | ✅ 200 tool_use | accepted; thinking doesn't engage under forced tools |
| forced `tool_choice` + `effort:'xhigh'` | ✅ 200 tool_use | effort works WITH forced tools (probe 2) |
| `effort:'max'` / `'low'` | ✅ 200 | full effort range accepted on opus |
| Haiku + `effort` | ❌ **400** | *"does not support the effort parameter"* — effort must be opus/sonnet-only |

**Tuning rules derived:** effort default is 'high'; bump intelligence-critical calls (grounded/cited
chat, claims determination, import disambiguation) to `effort:'xhigh'`; drop bulk/cheap calls
(summaries, prefilter, news headline) to `effort:'low'|'medium'` to cut latency+cost. Adaptive
thinking only on NON-forced, latency-tolerant calls. Never send temperature. For real caching, the
cached prefix must exceed 4096 tokens.

---

## Verified catalogue — 56 findings (42 safe / 14 foundry-dependent)

Full detail in scratchpad `ai-worklist.md` (W01–W56, prioritized). Areas: chat-streaming 10,
rag-retrieval 11, fleet-cost 8, forced-tool 9, import-brain 10, news-vision-misc 8. Categories:
correctness 11, robustness 10, model-feature 13, efficiency 9, accuracy 9, prompt-quality 4.

**Foundry-dependent (14)** — BLOCKED until the consolidated live probe above is filled. Includes:
adaptive-thinking + effort on chat/handlers/import ladder, output_config, cache-min behavior.

### Active / resolved items (safe set)

| ID | Finding | Sev | Status |
|----|---------|-----|--------|
| S01 | scaffold-product 400 (thinking on opus + forced tool_choice) → removed thinking arg | critical | **DONE (batch A, gate green)** |
| A2/S25 | `_forcedToolCall` broken thinking plumbing removed + honest refusal/truncation surfacing | med | **DONE (batch A)** |
| S02 | shape-feedback claimed screenshot it never sends → flag-not-invent reword | low | **DONE (batch A)** |
| S04 | shape-feedback impl-brief used PM system prompt → dedicated IMPL_SYSTEM | low | **DONE (batch A)** |
| S07 | chat streaming: 120s abort killed long gen → TTFT-only abort + idle watchdog that salvages partial | high | **DONE (batch B, gate green)** |
| S09 | chat stream ignored refusal/stop_reason → honest refusal/truncation notices | high | **DONE (batch B)** |
| S10(part) | degrade/deny honest-status notices were dead server-side → chat emits canonical degrade/deny notices | high | **DONE (batch B)** — semantic-cache half still TODO |
| S33 | chat SYSTEM instructed visible chain-of-thought → reworded to silent internal selection | low | **DONE (batch B)** |
| S22 | query-time embeddings had no retry → `_postEmbedWithRetry` (backoff+jitter on 408/429/5xx/net) | med | **DONE (batch C, gate green)** |
| S16/S23 | reindexProduct N+1 embeds → build all chunks, embed in ONE batched call, bounded-concurrency upsert | high/med | **DONE (batch C)** |
| S17 | news scout emitted uncited URLs → grounding gate: keep only URLs the web_search tool returned (liveness-fallback if none) | med | **DONE (batch D, gate green)** |
| S30 | news scout max_tokens 2048 truncated 8 items to silent [] → raised to 4096 + truncation warn | med | **DONE (batch D)** |
| S18/S37 | chat citation verify: markdown-link text mis-counted + loose substring "verified" → exclude `[](...)`, whole-token match | med | **DONE (batch E)** |
| EFFORT | `_forcedToolCall` deployment-aware `output_config.effort` (opus/sonnet only; auto-skip on haiku degrade) + analyze-claim & form-risk → **xhigh** | high | **DONE (batch F, gate green)** |
| S13 | Opus mispriced $15/$75→**$5/$25**, Haiku $0.80/$4→**$1/$5** (Sonnet $3/$15 already right); fleet.test.ts assertions updated; fleet bridge rebuilt | high | **GATING (batch G)** ⚠ operational: makes the spend-guard ceiling count real dollars (Opus now ~3× cheaper vs guard → ~3× more Opus headroom before the ceiling) + accurate tenant costUsd. Local-only until deploy. |
| S29 | news scout on haiku for a grounding task | med | **DEFERRED** — model swap = web_search tool-support per deployment is Foundry-dependent; needs probe |
| S31 | form-risk accepts any [bracket] as citation | med | **DEFERRED** — fuzzy resolver risks false-dropping legit findings→422; needs careful design (improved grounding via xhigh instead) |
| S06 | import o-series votes starved by tiny max_completion_tokens | high | **TRACK G** — certified import; needs `pnpm import:eval` re-cert, not gate-only |
| S03/S05 | import refusal stop_reason unhandled | low | **TRACK G** (import re-cert) |
| S13 | Opus mispriced $15/$75 (also in fleet.test.ts lock) | high | **DEFERRED** — re-verify current pricing from claude-api ref; ceiling-semantics + test-lock decision |
| **FD cluster (14)** | adaptive-thinking + `output_config.effort` + cache | — | **UNBLOCKED** by live probe: effort ✅, adaptive ✅ (non-forced), temp ✗, cache needs >4096-tok prefix |
| S03/S05 | import-brain refusal stop_reason unhandled | low | TODO (batch C) |
| S06 | reasoning-model votes starved by tiny max_completion_tokens (gpt reasoning needs room) | high | TODO (batch C) |
| S08/S20 | chat prompt-cache no-op (needs >4096 prefix) + cache-token accounting | high/med | TODO (batch C) |
| S11/S12/S19 | grounding TOP 400 no ORDER BY; RERANK surface unused; DETAIL cap | high/med | TODO (batch C: RAG) |
| S16/S23 | reindex N+1 embed (batch it) | high/med | TODO (batch C) |
| S22/S34 | embed no retry; all-or-nothing batch | med | TODO (batch C) |
| S17/S29/S30 | news scout: uncited URLs, wrong role, truncation | med | TODO (batch D) |
| … | remaining W-items | — | TODO (see worklist) |

_Batch A = 5 edits across scaffold-product.js, _shared.js, shape-feedback.js. Gate running._

---

## Iteration log

- **Iter 1** (2026-07-16): Loaded claude-api ground truth; read fleet/cost/embed/chat/_shared/
  ai-call/StreamRenderer/scaffold. Confirmed A1–A5. keys.md present (probe possible). Launched +
  resumed the 6-area verified AI-surface review workflow. Stood up this ledger.
- **Iter 2**: Ingested 56-finding catalogue. Batch A (scaffold 400 fix, `_forcedToolCall` refusal
  surfacing, 2 shape-feedback prompt fixes) → gate GREEN (1869 tests). Deferred S13 pricing.
- **Iter 3**: Live Foundry probe → capability matrix (effort ✅, adaptive ✅ non-forced, temp ✗,
  <4096 cache no-op). Batch B (chat streaming salvage + refusal/degrade/deny notices + no-visible-CoT)
  → gate GREEN. FD cluster unblocked.
- **Iter 4** (2026-07-17): Batch C (embed retry S22 + reindex batched-embed S16/S23) → gate GREEN.
  Import-brain items reclassified TRACK G (needs import:eval re-cert, not gate-only).
- **Iter 5**: Batch D (news grounding gate S17 + truncation S30) + Batch E (chat citation hardening
  S18/S37) → gate GREEN. Deferred S29 (news model swap = Foundry-tool-dependent).
- **Iter 6**: Probe 2 confirmed forced-tool+effort works, haiku rejects effort. Batch F (deployment-
  aware effort + analyze-claim/form-risk xhigh) → gate GREEN. Deferred S31 (fuzzy citation resolver).
- **Iter 7**: Re-verified authoritative pricing from claude-api ref (Opus $5/$25, Sonnet $3/$15,
  Haiku $1/$5; cache read 0.1×, write 1.25×/2×). Batch G (S13 pricing fix + bridge rebuild) → gate
  running. Remaining safe items thinning out; approaching the point where the leftover items are
  deferred/decision-gated (import re-cert, semantic-cache rebuild, rerank cost/latency, >4096 cache).
