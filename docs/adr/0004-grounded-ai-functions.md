# ADR-0004: Grounded AI via Functions + tools; cite, never invent

- **Status:** Accepted
- **Date:** 2026-07-05

## Context

The AI surfaces answer questions about a regulated insurance product — coverages,
endorsements, forms, rules, limits, deductibles, rating factors. A fabricated coverage,
form number or factor is worse than "I don't know": it looks authoritative and is wrong.
A product manager must be able to trace every claim back to a real source.

## Decision

- **All Anthropic usage lives in Functions** (`functions/src/`) — never in the app bundle.
  The API key is a `defineSecret('ANTHROPIC_API_KEY')`, read inside the handler, bound on
  every AI function; never `VITE_*`, never logged (see [ADR-0006](0006-ga-model-policy.md) and the Secrets
  golden rule).
- **The model answers only from tool results and cites its sources.** Every specific claim
  carries the `refId` / form number in square brackets — e.g. `[HO.RU.006] [HO 04 90]`.
- `functions/src/tools.ts` is the grounding contract: `TOOLS` (schemas like
  `search_entities`, `get_coverage`, `get_rules`, `get_forms`, `run_rating`, …), `runTool`
  dispatch, and a cacheable `SYSTEM_PROMPT` holding the house rules (assert only tool
  output; cite every claim; don't invent).
- **Tool errors are returned, not thrown**, so the model can recover; missing data returns
  `{ found:false }` / `[]` and the model must say so plainly rather than guess.
- Adding a tool = add its schema to `TOOLS` **and** a `case` in `runTool` **and** an
  executor. `run_rating` merges partial inputs over the worked example and runs the shared
  `evaluate()` — keeping the $1,528 result intact (see [ADR-0005](0005-rating-engine-and-1528-canary.md)).

## Consequences

- Answers are auditable: a reader can follow every bracketed refId to the seeded source.
- Chat streams as SSE over `onRequest` (`{t:'token'|'tool'|'json'|'error'|'done'}`); the
  adapter's `fns.stream` parses it. Prompt caching sits on the shared `SYSTEM_PROMPT`.
- The grounding lives in the tools, not in sampling — so the reasoning model can be swapped
  without weakening correctness ([ADR-0006](0006-ga-model-policy.md)).
- `// AWS-SWAP:` secret → Secrets Manager; SSE ports to Lambda URLs unchanged.
