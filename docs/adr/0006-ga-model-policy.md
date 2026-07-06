# ADR-0006: GA model policy + the one-line Glasswing swap

- **Status:** Accepted
- **Date:** 2026-07-05

## Context

Model choice is a load-bearing operational lever: it drives answer quality, latency, and
cost, and it must be swappable without hunting through the codebase. It also must not
regress accidentally — and it must never default to a gated model that not every operator
can run. Grounding comes from the tools ([ADR-0004](0004-grounded-ai-functions.md)), not from the model, so the model
can change without weakening correctness.

## Decision

- **The repo default is GA (generally available), set on one line** in
  `functions/src/runtime.ts`:
  - `MODEL = 'claude-sonnet-4-6'` — reasoning: portfolio chat, analysis.
  - `MODEL_FAST = 'claude-haiku-4-5'` — bulk/simple: the market-news scout.
- **Project Glasswing swap:** an operator with access may swap `MODEL` on that one line to
  the gated reasoning model (currently `claude-fable-5`). That model keeps **thinking always
  on** and **rejects sampling params** — so when swapped, drop any `temperature`. This is
  the *only* sanctioned place, and it is never the committed default.
- Grounded calls may pin a low temperature on Sonnet, but grounding is enforced by the
  tools, not by sampling. Prompt caching sits on the shared `SYSTEM_PROMPT`.

## Consequences

- Swapping the reasoning model is a one-line, reversible change with a clear blast radius;
  no other file encodes a model id.
- Cost/behavior are predictable by default (GA models); the gated model is opt-in per
  operator and never leaks into a commit as the default.
- `MODEL_FAST` stays Haiku for high-volume, low-stakes generation regardless of the
  reasoning swap.
- `// AWS-SWAP:` model ids are provider constants; only the SDK client construction moves.
