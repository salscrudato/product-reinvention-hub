# Code-Review Prompt Pack — Product Reinvention Hub

This folder contains ready-to-paste prompts for an **external AI reviewer** (Claude, GPT, Gemini, etc.).
Each prompt is self-contained, references the real architecture, and tells the reviewer exactly what to
look for and what output to produce. Pick the prompt that matches your goal, attach the supporting
material, and paste.

---

## What to attach with every prompt

Give the reviewer the same three things every time, then the prompt itself:

1. **`00-CONTEXT-DOSSIER.md`** — the architecture/context dossier (in `review-packet/`). This is the
   single most important attachment; it lets the AI reason about invariants without seeing every file.
2. **The SVG diagrams** — the system, data-flow, and AI-pipeline diagrams (in `review-packet/diagrams/`).
   Paste them as images or as raw SVG text; most models read the labels either way.
3. **Relevant screenshots** — only for the frontend/UX prompt (`04`), attach screenshots of the screens
   you want critiqued (product workspace, import wizard, conflict dialog, dark mode, etc.).

Then paste the body of the specific prompt file you chose.

### Giving the reviewer the actual code

The prompts ask for `file:line` findings, so the reviewer needs to see source. Three options, best first:

- **GitHub mirror (best):** point the AI at a read-only mirror of the repo (or the specific paths the
  prompt names). Tools with repo access can then cite real line numbers.
- **Paste the files the prompt names:** every prompt lists the exact paths it cares about
  (e.g. `server/lib/auth.js`, `app/src/lib/backend/azure.adapter.ts`,
  `shared/src/rating/evaluator.ts`). Paste those files' contents.
- **Whole-repo upload:** if the tool accepts a zip/folder, upload the `app/`, `server/`, and `shared/`
  workspaces. Skip `functions/` (Firebase reference-only, NOT deployed) and `node_modules/`.

If the reviewer cannot see line numbers, tell it to cite `file` + function/symbol name instead.

---

## "I want to…" → which prompt

| I want to… | Use |
|---|---|
| Find auth / tenant-isolation / injection vulnerabilities | `01-security-review.md` |
| Know what breaks when we scale past one instance; get a modernization roadmap | `02-architecture-review.md` |
| Improve RAG grounding, citation fidelity, import accuracy, AI cost/latency | `03-ai-pipeline-review.md` |
| Get React refactors, a11y gaps, bundle/perf and UX polish | `04-frontend-review.md` |
| Stress-test the atomic mutate + audit hash chain for races / tamper gaps | `05-data-integrity-review.md` |
| Have an insurance expert check rating, canaries, LOB modeling, filings | `06-insurance-domain-review.md` |
| Refine one specific feature I'm working on | `08-feature-refinement-template.md` (fill-in-the-blank) |

**Rule of thumb:** for a broad audit, run `01`–`06` as separate sessions (each is deep; don't merge them).
For day-to-day feature work, use `08` — it's a reusable template you complete per feature.

---

## The product in three sentences (so the reviewer has orientation)

A pnpm monorepo insurance product-management SaaS. `app/` is a React 19 + Vite 8 SPA that talks **only**
to a same-origin `/api/*` host; `server/` is an Azure App Service Express host (Cosmos DB + Azure Foundry
Claude/OpenAI + Blob); `shared/` is a pure-TypeScript engine (rating evaluator, types, 5-line LOB registry
PH/PA/GL/IM/PR, import canonical map, audit hash-chain). `functions/` is Firebase and is **reference-only,
NOT deployed** — reviewers should ignore it.

## Binding invariants the reviewer must respect (never suggest breaking these)

- **Adapter seam** — all app reads/writes go through one `BackendAdapter`
  (`app/src/lib/backend/azure.adapter.ts`). No platform SDK in components.
- **Atomic mutations** — every write is one Cosmos transactional batch
  (entity + append-only hash-chained `auditEvent` + `version` + `searchIndex` + `groundingChunk`) via
  `/api/db/mutate`. No bare data-store writes.
- **Role enforcement** — `VIEWER` is read-only, enforced **server-side**.
- **AI is server-side** — the browser never calls the model API; all AI runs through the `/api/ai` host.
- **AI grounded + cited** — responses must cite source docs (`[refId]`); free invention is a bug.
- **`refId` / form chips** are load-bearing display; never strip them.
- **Rating canaries** — HO-3 **$1,528**, PA **$1,002**, GL **$2,635** gate every deploy.
- **Model IDs** — `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`. Never `claude-fable-5`.
- **Design tokens** — no hard-coded hex in browser code; use `var(--color-*)`.
- **Single-instance constraint (RISK-005)** — cost guard, rate limiters, JWT revocation cache and
  HomeCheck sessions are in-memory; the app currently assumes one App Service instance.

A good review sharpens these constraints; it never quietly discards them.
