# AI Functionality Tuning — Change Handoff

**Author:** AI-tuning agent (autonomous `/loop` session, 2026-07-16→17)
**Scope:** ALL AI functionality — prompts, model params, prompt techniques, embeddings, RAG,
streaming, AI content display, cost guard. **Import-brain deliberately NOT touched** (certified/
frozen — see "Deferred: import"). Companion working ledger: `AI_TUNING_LEDGER.md`.

**Method:** 6-area adversarial review (56 verified findings) → one live Foundry capability probe →
gated implementation in batches, `pnpm typecheck && lint && test && build` after each; canaries
exact; nothing pushed. Each change verified in isolation before moving on.

> **Boundary note:** `server/lib/auth.js` is owned by ANOTHER agent and was in flux during this
> session (its JWT hardening / bare-write invariants failed 4 tests unrelated to this work). Per the
> user's instruction I did NOT touch it. If the gate shows exactly those 4 auth.js invariant failures
> (`server-invariants` AUTH_JWT_SECRET, `no-bare-writes` lib/auth.js count, `server-security` jti +
> revokedToken), they are external to everything documented here.

---

## Foundry capability ground truth (probed live 2026-07-16/17)

The Azure AI Foundry `/anthropic` passthrough (anthropic-version `2023-06-01`) **enforces the same
model rules as the first-party API.** Verified against `claude-opus-4-8` / `claude-haiku-4-5`:

| Parameter | Result | Consequence for this codebase |
|---|---|---|
| `thinking:{type:'enabled',budget_tokens}` (opus) | **400** | scaffold-product was hard-failing — removed |
| `thinking:{type:'adaptive'}` (opus, non-forced) | 200 | available; not yet used (latency tradeoff) |
| `output_config:{effort:'low..max'}` (opus) | 200 | **used** — xhigh on claims/form-risk |
| `output_config.effort` + forced `tool_choice` (opus) | 200 | effort works with forced tools |
| `output_config.effort` (haiku) | **400** "does not support" | effort must be opus/sonnet-only → deployment-aware guard |
| `temperature` (opus) | **400** "deprecated" | confirms existing omission is correct |
| `<4096`-token system + `cache_control` (opus) | 200, `cache_creation=0` | sub-min prefix caching is a silent no-op |
| `thinking:{type:'enabled',budget_tokens}` (haiku) | 200, thinking engaged | haiku keeps the legacy form |

Probe scripts: `scratchpad/foundry-probe.mjs`, `foundry-probe2.mjs` (read keys.md via fs, print only
pass/fail — never the secret).

---

## Changes made (all verified green in isolation)

### 1. `server/lib/ai/scaffold-product.js` — critical live bug
- **What:** Removed the `{ thinking: {type:'enabled', budget_tokens:2048} }` arg from the
  `_forcedToolCall`.
- **Reason:** `GROUNDED_CITED` = `claude-opus-4-8`; that thinking form **400s** on Opus 4.8 (probe-
  confirmed), AND extended thinking is incompatible with forced `tool_choice`. The handler was
  returning "Scaffold error: Foundry 400…" on **every** call.
- **Hypothesis:** scaffoldProduct was entirely non-functional in production. Now it runs.

### 2. `server/lib/ai/_shared.js` — shared forced-tool helper (`_forcedToolCall`)
- **What:** (a) Removed the broken thinking plumbing (`interleaved-thinking` beta header + `body.thinking`)
  and the stale doc comment. (b) Added honest failure surfacing: throw `ai_refusal` /`ai_truncated`
  when `stop_reason` is `refusal`/`max_tokens` and no `tool_use` block came back. (c) Added a
  deployment-aware `opts.effort` → `output_config:{effort}`, applied ONLY when the resolved deployment
  is opus/sonnet (auto-skips when a role degraded to haiku, which 400s on effort).
- **Reason:** The thinking path was a latent 400 trap for every sibling handler; a safety refusal or
  output-cap truncation was silently masquerading as an empty extraction. Effort is the primary
  intelligence lever and is now verified safe on Foundry.
- **Hypothesis:** Sibling handlers (analyze-claim, draft-rule, propose-mapping, etc.) are now
  protected from the trap and can opt into effort per-call without risking a haiku 400.

### 3. `server/lib/ai/shape-feedback.js`
- **What:** (a) Reworded the screenshot line — it now tells the model the screenshot is NOT included
  and not to infer visual detail (the image was never actually sent). (b) Added `IMPL_SYSTEM`, a
  dedicated staff-engineer system prompt for the maintainer implementation-brief call (was reusing the
  PM story-shaping prompt).
- **Reason:** flag-not-invent — telling the model to "factor in" an image it can't see invites
  fabrication. The impl-brief needs an engineering voice, not a PM voice.

### 4. `server/lib/ai/chat.js` — portfolio chat streaming (the user-facing "premium streaming" surface)
- **What:**
  - Streaming timeout rewrite (S07): a 45s `AbortController` bounds ONLY connect/time-to-first-token;
    once the body flows, each `reader.read()` runs under a 90s inactivity watchdog (`Promise.race`).
    On a stall it **salvages** the partial (cancels the reader, falls through to the normal
    metering/citation/card path + a truncation notice) instead of throwing the whole answer away.
    Replaced `fetchWithRetry` (retrying a stream is wrong) with a plain guarded `fetch`.
  - Refusal/stop-reason handling (S09): captures `message_delta.stop_reason`; emits an honest
    `refusal` or `truncated` notice after the stream.
  - Honest-status notices (S10, partial): the budget-deny branch now emits the canonical `deny`
    notice and the degrade path emits the `degrade` notice — activating the previously-dead
    `notices.ts` UX (client already handled these `kind`s).
  - Prompt quality (S33): removed the "briefly reason… then respond" visible chain-of-thought
    instruction from SYSTEM — reasoning stays internal, the cited answer is direct.
  - Citation hardening (S18/S37): citation extraction now excludes markdown links `[text](url)` (via
    lookahead on the char after `]`); verification requires a WHOLE-token match (word-boundary regex)
    instead of a loose substring, so short/fabricated refs can't be "verified" by coincidence.
- **Reason:** long Opus answers over a large portfolio could exceed the old 120s whole-request abort
  and be discarded mid-stream; refusals/truncations showed as silent empty answers; the honest-status
  UX in notices.ts was inert; markdown link text was mis-counted as citations.
- **Hypothesis:** near-complete long answers are preserved; users see honest budget/refusal/truncation
  status; citation chips are precise.
- **Client compatibility:** verified against `app/src/routes/Home.tsx` SSE consumer + `notices.ts` —
  event shapes (`token`/`notice`/`json chatCard`/`done`) unchanged; partial text is NOT re-emitted
  (client appends tokens live).

### 5. `server/lib/embed.js` — query-time embeddings robustness (S22)
- **What:** Added `_postEmbedWithRetry` (exp backoff + jitter on 408/429/5xx + network errors);
  `embedBatch` now posts through it.
- **Reason:** every other AI path retries transient Foundry hiccups; embeddings had none, so one 429
  silently collapsed a chat turn to lexical-only retrieval. Still best-effort (null → lexical
  fallback), just with a retry first.

### 6. `server/lib/ai/reindex-product.js` — N+1 embedding fix (S16/S23)
- **What:** Refactored to build all grounding chunks first (no embedding), embed them in ONE batched
  `embedBatch` call, then upsert with bounded concurrency (12) — was one embed HTTP round-trip per
  chunk in a sequential loop.
- **Reason:** efficiency; a product with many coverages/rules/tables paid N sequential embed calls.
- **Note:** the write mechanism (`docs.items.upsert`) is unchanged — no new bare-write site, so the
  DEF-0047 allowlist invariant is unaffected.

### 7. `server/lib/ai/refresh-news.js` — news scout grounding + truncation (S17/S30)
- **What:** (a) `max_tokens` 2048→4096 + a truncation warn (8 rich items overran 2048 and the JSON
  array truncated to silent `[]`). (b) Harvest the URLs the `web_search` tool actually returned
  (`web_search_tool_result` blocks) and keep only emitted items whose (normalized host+path) URL
  matches one — with a fallback to the existing liveness probe if no result blocks are harvestable.
- **Reason:** liveness ≠ grounding — a hallucinated-but-live URL passed the HEAD check. Now emitted
  URLs must be grounded in real search results.

### 8. `server/lib/ai/analyze-claim.js` + `server/lib/ai/form-risk-report.js` — effort tuning
- **What:** Pass `{ effort: 'xhigh' }` to `_forcedToolCall` (deployment-aware — auto-skips on haiku
  degrade).
- **Reason:** these are the two highest-stakes legal-reasoning calls (claims coverage determination;
  insured-facing form-risk over untrusted form text), both opus, non-streaming, non-import, cached/
  low-volume — deeper reasoning directly reduces missed coverage/exclusions. effort default is 'high';
  xhigh raises it where accuracy > latency/cost.

### 9. `shared/src/ai/fleet.ts` (+ `fleet.test.ts`, + rebuilt `server/lib/fleet-shared.cjs`) — pricing (S13)
- **What:** Corrected `FLEET_PRICING`: Opus `$15/$75 → $5/$25`, Haiku `$0.80/$4 → $1/$5` (Sonnet
  `$3/$15` was already correct). Updated the two `fleet.test.ts` assertions to the current values.
  Non-Anthropic extended-fleet estimates left as-is. Rebuilt the fleet bridge.
- **Reason:** the coded prices were ~3× stale for the flagship model → per-tenant `costUsd`
  over-attributed ~3× and the spend guard tripped ~3× early for Opus. Verified current list prices
  from the authoritative claude-api reference (not memory).
- **⚠ OPERATIONAL:** this makes the spend-guard ceiling and tenant billing count real dollars — Opus
  is now ~3× cheaper against the guard, so ~3× more Opus headroom before the ceiling. **Local-only
  until deploy; review before shipping.** If you want the old effective-ceiling behavior, lower
  `AI_SPEND_CEILING_USD` proportionally.

---

## Deferred (with reasons) — for the next agent

**Import-brain (DO NOT gate-only — needs re-certification):** S06 (o-series votes gpt-5.1/gpt-5-mini
starved by tiny `max_completion_tokens` 128/256/400 — reasoning models spend the budget on internal
reasoning → truncated/empty votes → the dual-model consensus silently degrades to single-model),
S03/S05 (refusal `stop_reason` unhandled in `ai-call.js`/`constants.js`), S36 (stage-5 validator told
to check GROUNDING but never given the source cells). **These change certified-import behavior; run
`pnpm import:eval` (+ `scripts/phaseg-holdout.mts --check`) to re-certify BEFORE shipping.** The user
explicitly requires import to only improve — I left it untouched.

**Foundry-verified but not yet applied (safe to do next):** adaptive thinking on non-streaming deep
calls; effort tuning on the other opus/sonnet handlers (draft-rule, propose-mapping[import-adjacent],
task-summary, daily-brief). Reuse the deployment-aware `opts.effort` pattern in `_forcedToolCall`.

**Real prompt caching (S08/S20):** sub-4096-token prefixes are a no-op on Opus (probe-confirmed). To
actually cache, restructure so `SYSTEM + tenant-stable PORTFOLIO` forms one cached block >4096 tokens
with the volatile DETAIL after the breakpoint; verify with `usage.cache_read_input_tokens`. Then
extend `estimateCostUsd` to price `cache_read` (0.1×) / `cache_creation` (1.25×) tokens for accurate
metering.

**Larger architectural (scope separately):** S12/S19 wire the RERANK (Cohere) surface into
`grounding()` for citation precision (adds latency/cost per chat; rerank not yet probed); S21 rebuild
the dead semantic response cache (KNN+verifier lived in the deleted `functions/`); S27/S32/S40 wire
DOC_OCR (Mistral) + VISION routing for scanned/image PDFs.

**Other:** S11 (grounding `SELECT TOP 400` has no ORDER BY → arbitrary truncation above the cap),
S29 (news scout on haiku — model swap is Foundry web_search-tool-support-dependent, needs a probe),
S31 (form-risk accepts any `[bracket]` as a citation — a fuzzy resolver risks false-dropping legit
findings into a 422; improved via xhigh instead), and low-value robustness nits S24/S26/S35/S38/S39/
S41 (see ledger).

---

## How to verify this work
`pnpm typecheck && pnpm lint && pnpm test && pnpm build` — expect green EXCEPT any external auth.js
invariant failures (not this work). Canaries (PH $1,528 / PA $1,002 / GL $2,635 / filing-import
$1,281) and all import-brain tests are unaffected (no import files touched). Full prioritized finding
list + per-iteration log in `AI_TUNING_LEDGER.md`.
