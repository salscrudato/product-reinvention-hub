# Deploy — Azure App Service (source of truth: ADO `main`)

**Status:** Product Hub (Vite SPA monorepo) deploys to Azure App Service via a
push-to-`main` pipeline in Azure DevOps. **ADO `main` is the source of truth and
the deployer.** A GitHub mirror is a later one-liner (see Follow-ups); GitHub /
`gh` are out of scope for the cutover that shipped this.

- **Repo (deploy source):** `https://dev.azure.com/garage-repos/Product%20Hub/_git/Product%20Hub`, branch `main`
- **Pipeline:** [`azure-pipelines.yml`](../azure-pipelines.yml) — triggers on `main` (batched), auto-deploys through the existing green pipeline.
- **App Service:** `app-prodhub-dev` in `rg-prodhub-dev` (sub `BoA-GenerativeAI-Sandbox`, eastus2)
- **App URL:** https://app-prodhub-dev.azurewebsites.net
- **Health contract:** `GET /api/health` → `{"status":"ok"}`

## Data-layer honesty (READ THIS)

This repo's backend is **Firestore + Firebase Auth + Cloud Functions handlers**.
This cutover moves **COMPUTE** onto Azure App Service — a zero-dependency Node
host (`server/server.js`) serving the built Vite SPA and honoring
`GET /api/health`. **Data, auth, and the AI API stay on the existing Firebase
project `productreinvention`.** The built SPA (`app/src/lib/backend/firebase.adapter.ts`)
reaches Firebase **directly** from the browser:

- Firestore + Firebase Auth via the Firebase web SDK (public config in-bundle);
- Cloud Functions AI surface via `httpsCallable` and
  `fetch(https://us-central1-productreinvention.cloudfunctions.net/<name>)`
  (SSE streaming for chat/claims/extract/rules/scaffold/import).

So the Azure host does **not** proxy the AI API today; the browser talks to
Firebase for it. This is the fastest genuinely-working configuration and it is
honest — nothing is stubbed to look alive. `GET /api/health` is real; any other
`/api/*` returns an honest `404` pointing here.

The old CRA app's **Cosmos DB and Blob Storage are abandoned, not migrated.**
Cosmos migration is the next phase.

## What shipped

| Piece | File |
|---|---|
| Azure host (zero deps: static SPA + `/api/health`) | `server/server.js`, `server/package.json` |
| CI/CD pipeline (build → gate → zip → deploy) | `azure-pipelines.yml` |
| This doc | `docs/DEPLOY_AZURE.md` |

The old repo contents (CRA `src/`, `server.js`, `web.config`, Cosmos/Blob docs,
`azure-pipelines.yml`) were **overwritten** by a force-push of local `main` — the
old code was declared disposable.

## Pipeline (exact values, reused from the old CRA pipeline)

Deploy rights come from reusing the previous pipeline's keys verbatim:

| Setting | Value |
|---|---|
| Trigger | `main`, `batch: true` |
| Agent pool | `ubuntu-latest` |
| Node | `20.x` |
| Package manager | `pnpm@9` via `corepack` |
| Service connection (`azureSubscription`) | `producthub-azure` |
| App name | `app-prodhub-dev` |
| Resource group | `rg-prodhub-dev` |
| Runtime stack | `NODE|20-lts` |
| Startup command | `node server.js` |
| Build-time var group | `producthub-build` (linked but mostly irrelevant — the old REACT_APP_*/Cosmos vars don't apply to Vite; the Vite build needs **no** build-time secrets) |

### Gate (the deploy gate)

The pipeline runs, in order: `pnpm -r typecheck` → **`pnpm --filter @pf/shared test`**
(the rating **canaries**) → `pnpm --filter app build` → assemble → zip → deploy.

**A broken canary stops the deploy.** The shared vitest step asserts the worked
examples exactly — **HO-3 $1,528**, **PA $1,002**, **GL $2,635** — read from the
test files (`shared/src/rating/evaluator.test.ts`,
`personalAuto.evaluator.test.ts`, `generalLiability.evaluator.test.ts`). If any
canary regresses, that step fails, and `AzureWebApp@1` never runs.

**Intentionally skipped for build speed** (not run in the pipeline): `pnpm lint`,
and the emulator/integration/e2e suites (`test:rules`, `test:integration`,
`test:e2e`). Run the full `/gate` locally when the clock allows.

## App Service settings (secrets)

The AI functions read secrets by these **exact** names (via `defineSecret` in
`functions/src/runtime.ts`, resolved from env at runtime):

| Name | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API (all AI: chat, claims, extract, rules, scaffold, news, import) |
| `VOYAGE_API_KEY` | Voyage embeddings (grounding retrieval); optional — retrieval degrades gracefully without it |

> **No Foundry / Azure-OpenAI variables are needed** — the codebase has no such
> provider client; only Anthropic (+ Voyage). The old `REACT_APP_OPENAI_API_KEY`
> is dead.

**Where they matter today:** because the AI API currently runs on **Firebase
Cloud Functions**, the live keys must be present in that project's function
secrets (they are, from prior Firebase deploys). Setting them in **App Service**
is forward-looking — it prepares for the "relocate Functions onto this host"
follow-up and is harmless now.

Set them on App Service with:

```sh
az webapp config appsettings set -g rg-prodhub-dev -n app-prodhub-dev \
  --settings ANTHROPIC_API_KEY=<value> VOYAGE_API_KEY=<value>
```

Or in the Portal: portal.azure.com → `rg-prodhub-dev` → `app-prodhub-dev` →
Settings → **Environment variables** → **Add** (name/value) → **Apply**
(restarts the app).

## Follow-ups

1. **Relocate the AI API onto the Azure host.** Mount the v2 `onRequest`/`onCall`
   handlers (`functions/src/*`) as `/api/*` Express routes on `server.js` (they
   carry `// AWS-SWAP` seams; auth+secrets are centralized in `runtime.ts`) and
   repoint the adapter's function base URL to `/api`. Requires Firebase Admin
   service-account credentials in App Service. Not done in the cutover window to
   avoid shipping a half-wired (fake-working) API.
2. **Cosmos migration.** Move any data still expected in the abandoned Cosmos/Blob
   to the target store. Currently data stays on Firestore.
3. **Key Vault wiring.** Source App Service settings from `kv-prodhub-dev-1r99`
   references instead of inline values.
4. **GitHub mirror.** Add a mirror push (one-liner) so GitHub tracks `main`;
   ADO remains the deployer.

## Where a broken canary stops a deploy

The **`Gate: rating CANARIES` step** in `azure-pipelines.yml`
(`pnpm --filter @pf/shared test`). Red canary ⇒ red pipeline ⇒ no
`AzureWebApp@1` deploy.
