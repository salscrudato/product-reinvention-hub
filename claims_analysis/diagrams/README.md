# Claims Analysis — Architecture Diagrams

This directory holds the Mermaid source (`.mmd`) for seven diagrams that together let another engineer or AI **review and recreate** the Claims Analysis feature of the P&C insurance platform. Each diagram was reverse-engineered directly from the code (paths cited below) and every claim was re-verified against the source — where the code disagrees with prior notes, the code wins and the discrepancy is called out under "Honest findings." The feature is a grounded, multi-turn *coverage copilot*: a left `BaseFormsLibrary` (upload/select a base coverage form) and a right conversation, disabled until an analyzable form is selected, that streams a cited `DeterminationCard` over SSE. The browser never calls Anthropic — everything crosses the `adapter` seam to the same-origin `/api/*` host.

## Diagram index

| File | Type | What it shows |
|------|------|---------------|
| [`01-system-architecture.mmd`](01-system-architecture.mmd) | flowchart | The 4 layers — Browser SPA → adapter seam → `/api` Express host → fleet → Foundry/Cosmos/Blob — for both `analyzeClaim` (SSE) and `identifyBaseForm` (JSON). |
| [`02-analyze-claim-sequence.mmd`](02-analyze-claim-sequence.mmd) | sequenceDiagram | One determination turn end to end, incl. the SSE events: tool `fetch:form`, tool `load:context`, forced tool call, `json` determination, `notice`, `done`. |
| [`03-form-lifecycle.mmd`](03-form-lifecycle.mmd) | stateDiagram-v2 | A base form: `PROCESSING` → (`READY` \| `READY`+Unverified \| `NEEDS_REVIEW`), with the `isFormAnalyzable` composer gate. |
| [`04-rag-grounding.mmd`](04-rag-grounding.mmd) | flowchart | `grounding()`: query → embed → Cosmos candidates → dense+lexical hybrid → baseline(portfolio)+detail → context blocks. |
| [`05-determination-guard.mmd`](05-determination-guard.mmd) | flowchart | The citation guard: model output → cited? → downgrade to `NOT_ADDRESSED` / unverified notice / render card — server + client mirror. |
| [`06-fleet-routing.mmd`](06-fleet-routing.mmd) | flowchart | `resolveModel(role, degrade)` + the cost `guard()` (allow / degrade / deny). |
| [`07-module-map.mmd`](07-module-map.mmd) | graph | Key files and their imports across `app/`, `shared/`, and `server/`, incl. the two build-time bundles. |

## Rendering

The `.mmd` files are plain Mermaid source (no Markdown fences). Render any of them by:

- **mermaid.live** — paste the file contents into <https://mermaid.live> for an instant preview / PNG/SVG export.
- **Mermaid CLI** — `npm i -g @mermaid-js/mermaid-cli`, then per file: `mmdc -i 01-system-architecture.mmd -o 01-system-architecture.svg` (repeat, or loop over `*.mmd`).
- **VS Code** — the *Markdown Preview Mermaid Support* / *Mermaid Preview* extensions render `.mmd` in-editor.

## Source of truth (files read to build these)

`server/lib/ai/analyze-claim.js` · `server/lib/ai/_shared.js` · `server/lib/ai/identify-base-form.js` · `server/lib/ai/index.js` · `server/lib/fleet.js` · `server/server.js` · `shared/src/ai/fleet.ts` · `shared/src/claims/lineProfiles.ts` · `app/src/routes/Claims.tsx` · `app/src/lib/backend/azure.adapter.ts` · `app/src/lib/claims/{determination,bubble,baseForm,gapFeedback}.ts` · `app/src/components/claims/BaseFormsLibrary.tsx`.

## Honest findings (anchor vs. code — code wins)

1. **No token events on the claims path.** `analyze-claim.js` uses `_forcedToolCall`, a *non-streaming* `fetch` that awaits the full Foundry response, then emits the whole determination as one `{t:'json'}` event. It emits **no `{t:'token'}` events** — so the RAF token-batching in `Claims.tsx` is shared infrastructure that stays dormant here; the user sees the "Reading the policy…" spinner until the card arrives (diagram 02).
2. **Per-line briefing is not wired into the server prompt.** The payload sends `lob` and the client uses `lineProfiles.ts` for scenario starters + chip tooltips, but `analyze-claim.js` **never reads `body.lob`** nor injects the profile `briefing`. `CLAIMS_SYSTEM` is line-agnostic ("Determine the line FROM THE FORM"). The briefing is client/UX-only today — an opportunity, flagged in diagrams 01 and 07.
3. **Unverified citations are a `notice`, not a determination field.** The server emits `{t:'notice', kind:'unverified'}` as a *separate* event and never sets `determination.unverifiedCitations`. So the client's `shouldRenderDetermination` `unverifiedCitations` branch is effectively dormant for the deployed handler; the real guard is the server citation-downgrade (`/[/` in reasoning → `NOT_ADDRESSED`) plus the client `isDeterminationCited` (diagram 05). The `determination.ts` mirror still references the *legacy* `functions/src/claims.ts`.
4. **Baseline vs. candidate caps differ.** The portfolio baseline query fetches `maxItemCount: 200` product chunks; the candidate query is `TOP 400` (`GROUNDING_CAP`), narrowed to `DETAIL_CAP=18`. The server's unverified scan only inspects `citations[]` + bracketed reasoning tokens — not coverage/exclusion refIds (diagram 04/05).
5. **Degrade target.** Under budget pressure claims routes `GROUNDED_CITED` (opus-4-8) → `degradedRole` → `BULK_VERIFY` (haiku-4-5), same Anthropic family; `bypassDegrade` is import-only and claims never sets it (diagram 06).

## Related documents

- [`../README.md`](../README.md) — dossier index
- [`../01-OVERVIEW.md`](../01-OVERVIEW.md) — feature overview
- [`../02-ARCHITECTURE.md`](../02-ARCHITECTURE.md) — architecture narrative
- [`../03-BACKEND-PIPELINE.md`](../03-BACKEND-PIPELINE.md) — server pipeline
- [`../04-MULTI-MODEL-ORCHESTRATION.md`](../04-MULTI-MODEL-ORCHESTRATION.md) — fleet + cost guard
- [`../05-EMBEDDINGS-AND-RAG.md`](../05-EMBEDDINGS-AND-RAG.md) — grounding + embeddings
- [`../06-FRONTEND.md`](../06-FRONTEND.md) — React/SSE consumption
- [`../07-DATA-MODEL-AND-CONTRACTS.md`](../07-DATA-MODEL-AND-CONTRACTS.md) — entities + SSE protocol
- [`../08-DESIGN-PATTERNS.md`](../08-DESIGN-PATTERNS.md) — patterns + invariants
- [`../09-RECREATE-FROM-SCRATCH.md`](../09-RECREATE-FROM-SCRATCH.md) — rebuild guide
- [`../10-INVARIANTS-AND-TESTS.md`](../10-INVARIANTS-AND-TESTS.md) — invariants + test coverage
- [`../code-inventory.md`](../code-inventory.md) — file-by-file inventory
