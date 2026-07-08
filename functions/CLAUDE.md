# functions/ — Cloud Functions (Firebase v2 / Node 20)

See [../CLAUDE.md](../CLAUDE.md) for the binding invariants that apply across every workspace.

**Build:** `pnpm --filter functions build` (tsup → `lib/`). The emulator picks up the built output.

## Key files

| File | Purpose |
|---|---|
| `src/index.ts` | Re-exports every callable / HTTPS function |
| `src/runtime.ts` | Anthropic client, model constants, ID-token verify, role guard, SSE helpers |
| `src/ai.ts` | Portfolio chat (SSE, grounded tool-surface) |
| `src/claims.ts` | Coverage copilot — `analyzeClaim` + `identifyBaseForm` |
| `src/extract.ts` | Structured coverage extraction (forced `tool_choice`) |
| `src/news.ts` | Market-news scout (haiku, scheduled `nightlyNews`) |
| `src/admin.ts` | `setUserRole` — writes the JWT custom claim; ADMIN only |

## Model constants (single source: `runtime.ts`)

```ts
MODEL      = 'claude-sonnet-5'   // reasoning: chat, claims, extraction
MODEL_FAST = 'claude-haiku-4-5'  // bulk/simple: news scout
```

Always import `MODEL` / `MODEL_FAST` from `runtime.ts`. Never hardcode a model string elsewhere.

**Sonnet 5 constraint:** the model runs adaptive thinking by default and **rejects** `temperature`, `top_p`, and `top_k` with HTTP 400. Pass no sampling params on the reasoning path. Grounding comes from the tool surface and system prompt.

## Patterns

**Auth first:** every endpoint calls `authenticate(req)` → `{ uid, role, name }`. Throw before doing any work if the token is invalid.

**Role guard:** VIEWER is read-only. Check `caller.role !== 'VIEWER'` before any write (or the exact role the Firestore rule requires — EDITOR|ADMIN for `canEdit()` surfaces, ADMIN for `isAdmin()` surfaces). There is no `canEdit()` server helper; inline the check. This mirrors the Firestore rules — both sides must agree.

**AI grounded:** the model must use tool results, not free-generate facts. Every determination / analysis response must cite the source clause or document.

**SSE flow:** `openSse(res)` → repeated `send(res, { t: 'token', v })` → `send(res, { t: 'done' })`. All event shapes are typed in `StreamEvent`.

**Secrets:** the Anthropic key is in `functions/.env.local` (emulator) and Firebase Secrets (prod). Never log it, never embed it in code.

## Gotchas

- Forced `tool_choice` (extraction) works with adaptive thinking on the first-party Claude API — no workaround needed (only Amazon Bedrock requires the `thinking: {type:"disabled"}` hack).
- `nightlyNews` is a scheduled function — it doesn't accept HTTP requests. Test it by calling `refreshNews` (the on-demand HTTP version) instead.
- The `setUserRole` callable sets a Firebase custom claim. It takes effect on the **next** ID token refresh (~1 h) unless the client forces a refresh with `getIdToken(true)`.
