# 08_ENV_AND_CONFIG.md — Environment Variables, Secrets, and Configuration

## Principle
All runtime secrets live server-side only. The browser never receives an Anthropic or Voyage key. Firebase public config (apiKey, projectId, etc.) is by Firebase design safe in the client bundle and is NOT a secret.

---

## Server-Side Secrets (Firebase Cloud Functions)

These are Firebase Secrets in production (managed via `firebase deploy --only functions`). In local dev, they live in `functions/.env.local` (gitignored; template at `functions/.env.local.example`).

Every function that calls the AI must declare the secret in its `secrets` array:
```ts
// Example from runtime.ts pattern
export const myFn = onRequest({ secrets: [ANTHROPIC_API_KEY, VOYAGE_API_KEY] }, handler)
```

| Secret name | Required | Consumer | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **REQUIRED** | All AI Cloud Functions | Authenticates calls to the Anthropic Claude API (claude-sonnet-5, claude-haiku-4-5). Value format: `sk-ant-...`. Set via Firebase Secret Manager: `firebase functions:secrets:set ANTHROPIC_API_KEY`. |
| `VOYAGE_API_KEY` | OPTIONAL | `retrieval/` module, `reindexGrounding` | Voyage AI embeddings (voyage-3.5-lite) and reranking (rerank-2.5-lite). Without this key the retrieval layer degrades gracefully to the built-in lexical TF-IDF ranker. Set via Firebase Secret Manager: `firebase functions:secrets:set VOYAGE_API_KEY`. |

**Local dev example** (`functions/.env.local` — never committed, gitignored):
```
ANTHROPIC_API_KEY=<REDACTED:ANTHROPIC_API_KEY>
VOYAGE_API_KEY=<REDACTED:VOYAGE_API_KEY>
```

---

## Optional Voyage Model Overrides (functions/.env.local)

These environment variables are optional. Defaults are used when not set. Not Firebase Secrets — they contain no key material.

| Variable | Default | Purpose |
|---|---|---|
| `VOYAGE_EMBED_MODEL` | `voyage-3.5-lite` | Embedding model name |
| `VOYAGE_RERANK_MODEL` | `rerank-2.5-lite` | Reranking model name |
| `VOYAGE_EMBED_DIM` | `1024` | Embedding vector dimension (must match Firestore KNN index dimension) |

---

## Client-Side Environment Variables (Vite, `app/`)

Vite reads variables prefixed with `VITE_`. These are embedded into the client JavaScript bundle at build time. They contain NO secrets — only public configuration.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_USE_EMULATORS` | Dev only | `false` | When `true`, wires all Firebase SDK clients to the local emulator suite (auth:9099, firestore:8080, functions:5001, storage:9199). Must NOT be `true` in production builds. |

**Note:** No `.env` file for `app/` is present in the repo. `VITE_USE_EMULATORS` is set by the `pnpm dev:seed` root script inline (ASSUMPTION: via the `firebase emulators:exec` wrapper or `scripts/wait-and-seed.mjs`).

---

## Firebase Public Configuration (`app/src/lib/backend/firebase.config.ts`)

These values are embedded in the client bundle by design (Firebase client SDKs require them). They identify the project; security is enforced by Firestore rules and Function auth JWT verification, not by keeping these values secret.

| Field | Value |
|---|---|
| `apiKey` | `<REDACTED:FIREBASE_API_KEY>` (safe to embed; not a secret) |
| `authDomain` | `productreinvention.firebaseapp.com` |
| `projectId` | `productreinvention` |
| `storageBucket` | `productreinvention.firebasestorage.app` |
| `messagingSenderId` | `621888798672` |
| `appId` | `<REDACTED:FIREBASE_APP_ID>` |
| `measurementId` | `G-82E4D44Q56` |
| `FUNCTIONS_REGION` | `us-central1` |

---

## Firebase Project Configuration (`firebase.json`)

```json
{
  "functions": {
    "source": "functions",
    "runtime": "nodejs20",
    "ignore": ["node_modules", "lib"]
  },
  "hosting": {
    "public": "app/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "emulators": {
    "auth":      { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "storage":   { "port": 9199 },
    "hosting":   { "port": 5000 },
    "ui":        { "enabled": true, "port": 4000 }
  }
}
```

---

## Firebase Project Alias (`.firebaserc`)

```json
{ "projects": { "default": "productreinvention" } }
```

Production project ID: `productreinvention`

---

## Model Constants (single source of truth: `functions/src/runtime.ts:45-46`)

These are hard-coded TypeScript constants, not environment variables. Changing a model requires a code change and redeploy — this is intentional (per ADR 0001: model IDs must be explicit and reviewable, never runtime-configurable).

```ts
export const MODEL      = 'claude-sonnet-5'   // reasoning path
export const MODEL_FAST = 'claude-haiku-4-5'  // bulk/simple path
```

---

## Emulator Ports (local dev only)

| Emulator | Port |
|---|---|
| Firebase Auth | 9099 |
| Firestore | 8080 |
| Cloud Functions | 5001 |
| Firebase Storage | 9199 |
| Firebase Hosting | 5000 |
| Firebase Emulator UI | 4000 |

E2E test server uses Vite dev server on port `5178` (from `playwright.config.ts`).

---

## Build-Time Configuration

| Setting | Value | Source |
|---|---|---|
| Node version (Functions) | Node 20 | `firebase.json` + `functions/package.json` engines |
| TypeScript version | ~6.0.2 | `package.json` |
| Vite | ^8.1.1 | `app/package.json` |
| Bundler (Functions) | tsup (esbuild) | `functions/package.json` |
| Monorepo manager | pnpm workspaces | `pnpm-workspace.yaml` |

---

## Deployment Commands

```sh
# Full deploy (build + deploy all)
pnpm build && firebase deploy

# Functions only
firebase deploy --only functions

# Hosting only
pnpm --filter app build && firebase deploy --only hosting

# Set a production secret
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set VOYAGE_API_KEY

# Rebuild Voyage vector index after changing VOYAGE_API_KEY
# (calls the reindexGrounding Admin callable — ADMIN role required)
```

---

## Secret Rotation Procedure

1. `firebase functions:secrets:set ANTHROPIC_API_KEY` → enter new key
2. `firebase deploy --only functions` to redeploy with the new secret binding
3. Verify `hello` health function returns 200
4. Revoke the old key in the Anthropic console

For `VOYAGE_API_KEY`: follow the same pattern; after rotation, call `reindexGrounding` to rebuild the dense index with the new key.
