# functions/CLAUDE.md — Cloud Functions (all AI + agents)

Read the root `CLAUDE.md` first. This file covers only what a task inside `functions/`
needs. Cloud Functions v2, Node 20. **All Anthropic usage lives here** — never in the app
bundle. Files: `runtime.ts` (shared plumbing) · `tools.ts` (grounding tools + system
prompt) · `ai.ts` (SSE chat) · `extract.ts` (coverage extraction) · `news.ts` (scheduled
scout) · `share.ts` · `admin.ts` (`setUserRole`) · `health.ts`.

## Secrets
The Anthropic key is `ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')` in
`runtime.ts`. Bind it on **every** AI function (`secrets: [ANTHROPIC_API_KEY]`) and read
it *inside* the handler via `anthropic()` (constructs the client with `maxRetries: 4`).
Canonical homes: `functions/.env.local` (emulator) + Firebase Secrets (prod). Never
`VITE_*`, never in the app bundle, never logged.

## Models (`runtime.ts`, one line)
`MODEL = 'claude-sonnet-4-6'` (reasoning: chat/analysis) and
`MODEL_FAST = 'claude-haiku-4-5'` (bulk/simple: the news scout). Both GA. Sonnet accepts
the sampling params, so grounded calls may pin a low temperature — but grounding comes
from the tools, not sampling. A Project Glasswing operator can swap `MODEL` on that line
to the gated reasoning model (thinking always on; rejects sampling params — drop any
temperature then). Use prompt caching on the shared `SYSTEM_PROMPT`.

## Auth + roles (`runtime.ts`)
`authenticate(req)` verifies the `Bearer` Firebase ID token and returns
`Caller { uid, role, name }` (role from the custom claim); it throws `AuthError` if
missing. Enforce roles here **and** in Firestore rules — never UI-only. `setUserRole`
(admin.ts) is the only writer of custom claims and is itself ADMIN-gated.

## SSE streaming (`runtime.ts` → `ai.ts`)
Chat is an `onRequest` SSE stream, not a callable. `openSse(res)` sets the headers;
`send(res, event)` writes one `data: <json>\n\n` record. `StreamEvent` is the closed
union the client parses: `{t:'token'}` (text delta), `{t:'tool',phase:'start'|'end'}`,
`{t:'json'}` (structured payload), `{t:'error'}`, `{t:'done'}`. Always end with `done`.
`SseResponse` is a minimal structural type so Express types don't leak into the surface.

## Tool-grounding contract (`tools.ts`)
The model **never answers from memory** — every specific claim comes from a tool result
and cites its refId / form number in brackets (`[HO.RU.006] [HO 04 90]`).
- `TOOLS: Anthropic.Tool[]` — the schemas: `search_entities`, `get_product_tree`,
  `get_coverage`, `get_rules`, `get_forms`, `get_ld_table`, `run_rating`, `get_dictionary`.
- `runTool(name, input): Promise<ToolOutput>` dispatches by name. `ToolOutput` =
  `{ content: string /* compact JSON for the model */, summary: string /* UI chip */ }`.
  **Errors are returned, not thrown** (so the model can recover); missing data returns
  `{ found:false }` / `[]` and the model must say so plainly.
- `SYSTEM_PROMPT` holds the house rules (assert only tool output, cite every claim, don't
  invent). Keep it cacheable — edit in one place.
- Adding a tool = add its schema to `TOOLS` **and** a `case` in `runTool` **and** an
  executor. Executors read Firestore via `getFirestore()`; `run_rating` merges partial
  inputs over `HO3_WORKED_EXAMPLE` and runs the shared `evaluate()` — keep $1,528 intact.

## Gate
From repo root: `pnpm typecheck` (tsc), `pnpm test`. Run against the emulators with
`pnpm emulators`. AWS portability: secret → Secrets Manager, `verifyIdToken` → Cognito
JWT verify, SSE ports to Lambda URLs unchanged (`// AWS-SWAP:` in `runtime.ts`).
