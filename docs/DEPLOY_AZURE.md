# Deploy — Azure App Service (source of truth: ADO `main`)

**Status:** Product Hub (Vite SPA monorepo) deploys to Azure App Service via a
push-to-`main` pipeline in Azure DevOps. **ADO `main` is the source of truth and
the deployer.**

- **Repo (deploy source):** `https://dev.azure.com/garage-repos/Product%20Hub/_git/Product%20Hub`, branch `main`
- **Pipeline:** [`azure-pipelines.yml`](../azure-pipelines.yml) — triggers on `main` (batched), auto-deploys through the existing green pipeline.
- **App Service:** `app-prodhub-dev` in `rg-prodhub-dev` (sub `BoA-GenerativeAI-Sandbox`, eastus2)
- **App URL:** https://app-prodhub-dev.azurewebsites.net
- **Health contract:** `GET /api/health` → `{"status":"ok"}`

## Stack (current — fully Azure-native)

| Layer | Technology | Implementation |
|---|---|---|
| Auth | Custom HS256 JWT (12 h TTL) | `server/lib/auth.js` — Cosmos user store + env-gated bootstrap |
| Data | Azure Cosmos DB (NoSQL) | `server/lib/data.js` — transactional batches, tenant-partitioned |
| AI reasoning | Azure Foundry → `claude-opus-4-8` | `server/lib/ai.js` + `server/lib/fleet.js` |
| AI bulk | Azure Foundry → `claude-haiku-4-5` | same fleet routing |
| Vision | `gpt-5.1` (OpenAI via Foundry) | fleet VISION role; HomeCheck only |
| Storage | Azure Blob | `server/lib/storage.js` |

No Firebase, no Firestore, no Cloud Functions. All data/auth/AI live on the Azure stack.

## Pipeline (exact values)

| Setting | Value |
|---|---|
| Trigger | `main`, `batch: true` |
| Agent pool | `ubuntu-latest` |
| Node | `20.x` |
| Package manager | `pnpm@9` via `corepack` |
| Service connection (`azureSubscription`) | `producthub-azure` |
| App name | `app-prodhub-dev` |
| Resource group | `rg-prodhub-dev` |

### Gate (the deploy gate)

The pipeline runs, in order: `pnpm -r typecheck` → **`pnpm --filter @pf/shared test`**
(the rating **canaries**) → `pnpm --filter app build` → assemble → zip → deploy.

**A broken canary stops the deploy.** The shared vitest step asserts the worked
examples exactly — **HO-3 $1,528**, **PA $1,002**, **GL $2,635** — read from the
test files (`shared/src/rating/evaluator.test.ts`,
`personalAuto.evaluator.test.ts`, `generalLiability.evaluator.test.ts`). If any
canary regresses, the step fails and `AzureWebApp@1` never runs.

## App Service settings (required env vars)

The server reads these **exact** names at startup. Missing any of the first four
crashes the server with a clear error message.

| Name | Purpose | Hard-crash if absent |
|---|---|---|
| `COSMOS_ENDPOINT` | Cosmos DB account endpoint URL | ✅ yes |
| `COSMOS_KEY` | Cosmos DB primary key | ✅ yes |
| `AZURE_FOUNDRY_ENDPOINT` | Azure AI Foundry endpoint URL | no (AI returns 503) |
| `AZURE_FOUNDRY_KEY` | Azure AI Foundry API key | no (AI returns 503) |
| `AZURE_BLOB_CONNECTION` | Azure Blob Storage connection string | no (storage returns 503) |
| `AUTH_JWT_SECRET` | HS256 JWT signing secret (min 32 chars) | ✅ yes |

> **Bootstrap users (local/smoke only):** set `BOOTSTRAP_USERS_ENABLED=true` to enable the
> `admin`/`admin` and `sal.scrudato` bootstrap accounts for local dev and smoke harness runs.
> Default is OFF in production — do not set this on the live App Service.

Set them with the az CLI:

```sh
az webapp config appsettings set -g rg-prodhub-dev -n app-prodhub-dev \
  --settings \
  COSMOS_ENDPOINT=<value> \
  COSMOS_KEY=<value> \
  AZURE_FOUNDRY_ENDPOINT=<value> \
  AZURE_FOUNDRY_KEY=<value> \
  AZURE_BLOB_CONNECTION=<value> \
  AUTH_JWT_SECRET=<value>
```

Or in the Portal: `rg-prodhub-dev` → `app-prodhub-dev` → Settings → **Environment variables** → Add → Apply (restarts the app).

## Local dev

```sh
# 1. Create server/.env.local (gitignored) with the six vars above + optional bootstrap flag:
#    COSMOS_ENDPOINT=...
#    COSMOS_KEY=...
#    AZURE_FOUNDRY_ENDPOINT=...
#    AZURE_FOUNDRY_KEY=...
#    AZURE_BLOB_CONNECTION=...
#    AUTH_JWT_SECRET=dev-local-secret-change-me
#    BOOTSTRAP_USERS_ENABLED=true

# 2. Start the Express host:
node server/server.js

# 3. Start the Vite SPA (in a second terminal):
VITE_API_BASE=http://localhost:3000 pnpm --filter app dev
```

Seed Cosmos with the canonical PH/PA/GL dataset:

```sh
COSMOS_ENDPOINT=<value> COSMOS_KEY=<value> \
  npx tsx scripts/migrate-to-cosmos.ts
```

## Follow-ups

1. **Key Vault wiring.** Source App Service settings from `kv-prodhub-dev-1r99`
   Key Vault references instead of inline values.
2. **GitHub mirror.** Add a mirror push (one-liner) so GitHub tracks `main`;
   ADO remains the deployer.
3. **Node 20 constraint.** `azure-pipelines.yml` pins `node: 20.x`; the functions/
   workspace `engines.node` also requires 20. Upgrading the App Service runtime
   to Node 22+ requires bumping both.

## Where a broken canary stops a deploy

The **`Gate: rating CANARIES` step** in `azure-pipelines.yml`
(`pnpm --filter @pf/shared test`). Red canary ⇒ red pipeline ⇒ no
`AzureWebApp@1` deploy.
