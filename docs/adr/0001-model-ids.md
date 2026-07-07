# ADR 0001 — Standardized Anthropic model IDs

- **Status:** Accepted
- **Date:** 2026-07-07
- **Scope:** `functions/` (server-side AI only — the browser never calls Anthropic)

## Context

All AI runs server-side in Cloud Functions (portfolio chat, claims coverage
analysis, coverage extraction, the market-news scout). The model IDs must be
generally available (GA), pinned in exactly one place, and safe to swap. The
code previously pinned Sonnet 4.6 for the reasoning path.

## Decision

Two GA models, defined once in [`functions/src/runtime.ts`](../../functions/src/runtime.ts)
and imported everywhere else:

| Constant     | Model ID            | Role                                   |
| ------------ | ------------------- | -------------------------------------- |
| `MODEL`      | `claude-sonnet-5`   | reasoning: chat, claims, extraction    |
| `MODEL_FAST` | `claude-haiku-4-5`  | bulk/simple: market-news scout         |

Both aliases are current GA (verified against the model catalog). No date
suffixes — the bare aliases are complete.

### Sampling / thinking consequences of Sonnet 5

`claude-sonnet-5` runs **adaptive thinking by default** and **rejects
non-default sampling parameters** (`temperature` / `top_p` / `top_k` → HTTP 400).
Accordingly the reasoning path passes **no** sampling params; determinism and
grounding come from the tool surface and the system prompt, not from sampling.
(The prior `temperature` plumbing in `ai.ts`/`claims.ts` was removed with this
change.) `claude-haiku-4-5` still accepts sampling, so the news scout keeps
`temperature: 0`.

Forced `tool_choice` (extraction, form-identification) coexists with adaptive
thinking on the first-party Claude API — no `thinking: {type:"disabled"}`
workaround is needed here (that requirement is Amazon Bedrock–only).

## Why Fable / Mythos are excluded

The premium/gated reasoning models are **not** used:

- `claude-mythos-5` — access-restricted to **Project Glasswing**; participation
  is the only way to reach it. This deployment has no Glasswing access.
- **Fable 5** — Anthropic's most capable *widely released* model, but priced
  well above Opus tier ($10/$50 per MTok).

Neither is the GA cost/latency default this app targets, so both are excluded.

> **Divergence note:** earlier code comments framed "fable" as *the* gated
> Glasswing swap. Per the current model catalog the Glasswing-gated model is
> `claude-mythos-5`; Fable 5 is GA-but-premium. This ADR standardizes on
> the accurate names.

## The one-line swap (if Glasswing access is confirmed)

Change the single constant in `functions/src/runtime.ts`:

```ts
export const MODEL = 'claude-mythos-5'   // was 'claude-sonnet-5'
```

No other code changes: `claude-mythos-5` shares Sonnet 5's request surface
(adaptive thinking always on, sampling params rejected), and the code already
passes no sampling params. Mythos additionally requires ≥30-day data retention
and may return `stop_reason: "refusal"` — add refusal handling before reading
`content` if adopted.
