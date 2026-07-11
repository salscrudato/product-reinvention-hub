# ADR 0001 — Standardized Anthropic model IDs

- **Status:** Accepted (amended 2026-07-11 — Azure cutover; see Amendment below)
- **Date:** 2026-07-07
- **Scope:** `shared/src/ai/fleet.ts` + `server/lib/fleet.js` (deployed Azure AI path)

## Context

All AI runs server-side on the Azure host (`server/lib/ai.js`, Foundry Claude). The
model IDs must be generally available (GA), pinned in exactly one place, and safe to
swap. The code previously pinned Sonnet 4.6 for the reasoning path.

## Decision (Amended — deployed fleet, post-Azure cutover)

Models are defined in [`shared/src/ai/fleet.ts`](../../shared/src/ai/fleet.ts) and
compiled into `server/lib/fleet-shared.cjs` via the `build:fleet` step. `server/lib/fleet.js`
imports the compiled bridge. The browser never calls any model API.

| Deployment constant | Model ID           | Role                                              |
| ------------------- | ------------------ | ------------------------------------------------- |
| `GROUNDED_CITED`    | `claude-opus-4-8`  | reasoning: portfolio chat, grounded + cited       |
| `BULK_VERIFY`       | `claude-haiku-4-5` | bulk/simple: product summaries, news scout        |
| `VISION`            | `gpt-5.1`          | vision: HomeCheck photo inventory (OpenAI/Foundry)|
| `CHEAP_GENERAL`     | `gpt-5-mini`       | cost-degrade fallback                             |

Never `claude-fable-5`.

### Original decision (functions/ reference — NOT deployed)

`functions/src/runtime.ts` defines `MODEL = 'claude-sonnet-5'` and
`MODEL_FAST = 'claude-haiku-4-5'`. This workspace is **retained as reference only**
and is not deployed; all AI handlers except `chat` and `summarizeProduct` returned
501 before WAVE-01/02 ported them to the Azure host. Do not use `functions/runtime.ts`
as the governance source for deployed model IDs.

## Amendment (2026-07-11 — WAVE-09, DEF-0002)

CLAUDE.md binding invariant and Feedback.tsx were incorrectly binding to
`claude-sonnet-5` / `functions/src/runtime.ts`. Both updated to reflect the
deployed fleet (`claude-opus-4-8` / `shared/src/ai/fleet.ts`).

## Why Fable is excluded

`claude-fable-5` is Anthropic's most capable widely released model but is priced
well above Opus tier. The deployed fleet uses `claude-opus-4-8` for the reasoning
path. Never substitute `claude-fable-5`.
