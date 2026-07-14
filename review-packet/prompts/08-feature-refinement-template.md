# Prompt 08 — Feature Refinement Template (reusable, fill-in-the-blank)

> This is a **reusable template**. Copy it, fill in the `[BRACKETED]` sections for the one feature you
> want refined, delete the guidance notes in _italics_, and paste the result into the external AI.
> Attach `00-CONTEXT-DOSSIER.md`, any relevant SVG diagram, and screenshots if the feature has UI.
> Give the reviewer the files you list under **Files involved**.

---

## Role & goal

You are a senior engineer helping refine a single feature of the "Product Reinvention Hub" — a React 19 +
Vite 8 SPA (`app/`) that talks only to a same-origin Express host (`server/`) on Azure App Service, backed
by Cosmos DB, Azure Foundry (Claude/OpenAI), and Blob; the rating/domain engine is a pure-TS package
(`shared/`). I will describe one feature, its current behavior, and what I want to change. Produce a
**concrete, diff-level plan** to get there that respects the project's binding invariants (listed at the
bottom — treat them as hard requirements, not suggestions).

---

## The feature

### [FEATURE NAME]
_e.g. "Coverage sub-limit editor in the product workspace" or "Import-brain header detection for GL filings"._

### Files involved
_List the real paths you know touch this feature. The reviewer needs these to cite `file:line`._
- `app/src/...`
- `server/lib/...`
- `shared/src/...`
- _(Adapter is always in the loop for data: `app/src/lib/backend/azure.adapter.ts`.)_

### Current behavior
_Describe precisely what happens today — the flow, the data written, the AI calls made, the UI states.
Include what's correct so the reviewer doesn't "fix" it._

### Desired outcome / pain point
_What's wrong or missing, and what "done" looks like. Be concrete about the user-visible result and any
edge cases (empty, error, concurrent edit, large data, VIEWER role, dark mode, offline)._

### Constraints or context specific to this feature (optional)
_e.g. "must not change the HO-3 canary", "this write also produces grounding chunks", "must work while a
poll tick is in flight", "GL-only for now"._

---

## What I want from you (fixed — do not edit)

1. **Restate the feature and the target behavior** in one paragraph to confirm you understand it. If
   anything is ambiguous, ask up to 3 clarifying questions **before** planning.
2. **Trace the current flow** end-to-end across `app → adapter → /api → server → Cosmos/Foundry/Blob`,
   naming the functions and files, and pinpoint exactly where the change lands.
3. **Propose a diff-level plan**: for each file, the specific edits (function signatures, new
   props/params, new endpoints, migration/backfill if data shape changes), in dependency order. Show
   small code sketches where the exact text matters.
4. **Call out invariant impact** explicitly: does the change touch the mutate envelope, the audit chain,
   role checks, AI grounding/citations, tokens, or a canary? Say how you keep each one intact.
5. **List risks, edge cases, and test/eval additions** — the exact tests to add (unit, canary, a11y,
   grounding/citation eval as applicable) and any new canary if premium math is affected.
6. **Give a rollout note** — feature-flag, backfill, and rollback if the change is stateful.

## Constraints you must respect (fixed — these are the project's binding invariants)

- **Adapter seam** — all app reads/writes go through the single `BackendAdapter`
  (`app/src/lib/backend/azure.adapter.ts`). Never import a Cosmos/Firebase SDK (or call a model) from a
  component.
- **Atomic mutations** — every write is one Cosmos transactional batch (entity + append-only
  hash-chained `auditEvent` + `version` + `searchIndex` + `groundingChunk`) via `/api/db/mutate`. No bare
  data-store writes; don't split a write across two calls.
- **Role enforcement** — `VIEWER` is read-only, enforced **server-side**; every write path is EDITOR+.
- **AI is server-side** — the browser never calls the model; all AI is on the `/api/ai` host.
- **AI grounded + cited** — any AI output must cite source docs (`[refId]`); free invention is a bug.
- **`refId` / form-number chips** are load-bearing display elements; never strip them.
- **Design tokens** — no hard-coded hex in browser code; use `var(--color-*)`. Respect dark mode +
  `prefers-reduced-motion`.
- **Rating canaries** — HO-3 **$1,528** / PA **$1,002** / GL **$2,635** must stay exact. If your change
  moves a canary, flag it as a breaking change and justify the new value.
- **Model IDs** — `claude-opus-4-8` / `claude-sonnet-5` / `claude-haiku-4-5`; never `claude-fable-5`.
- **Single-instance assumption (RISK-005)** — cost guard, rate limiters, JWT revocation, and long-running
  sessions are in-memory; don't add new per-instance state without noting the scale-out impact.

## Output format

1. **Understanding** — 1 paragraph + any clarifying questions.
2. **Current-flow trace** — bullet path with files/functions.
3. **Change plan** — per-file, in order:

   | File | Change | Why | Invariant touched |
   |---|---|---|---|

   followed by code sketches for the non-obvious edits.
4. **Tests / evals to add** — explicit list.
5. **Risks & rollback** — bullets.
6. **Effort estimate** — S / M / L with the main driver.

Keep the plan tight and buildable — I want to implement it, not admire it.
