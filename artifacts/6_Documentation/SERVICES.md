# Services & Integrations — agent wiring guide

Every external service this app can use, and how an AI coding agent wires one in **fast**.

- **Secrets live in `keys.md`** (repo root, gitignored) — env var → value, per service. This doc names the vars; it never contains a value.
- **AI model IDs live in `shared/src/ai/fleet.ts`** — never hardcode a deployment name.
- **Ready-to-use clients live in `server/lib/external/`** — one module per source, already tested. See [server/lib/external/README.md](../server/lib/external/README.md).

Everything runs **server-side only** (Express host in `server/`). The browser never holds a credential — it calls the same-origin `/api/*` host (CLAUDE.md invariant).

---

## The 30-second path

```js
// 1. In any server/lib module or route handler:
const external = require('./external')            // or '../external' from server/lib/ai/

// 2. Call a source — every function is async, normalized, throws Error.status on failure:
const filings = await external.txFilings.latestFilings({ company: 'State Farm', limit: 5 })
const ratio   = await external.edgar.lossRatio('PGR')          // { lossRatioPct: 64.5, ... }
const vehicle = await external.vpic.decodeVin('2HGFC2F69LH500001')
const hits    = await external.foundry.rerank(query, candidateChunks, { topN: 5 })
```

That's it for keyless sources. Keyed sources need one env var set (see each row) and expose
`isConfigured()`; they throw `{ status: 503 }` when unset so a handler degrades instead of crashing.

---

## AI services — Azure AI Foundry (`foundry-prodhub-dev`)

One account key (`AZURE_FOUNDRY_KEY`) serves **all 16 deployments** — keys are account-level, never
per-model. Core chat/embed roles route through `server/lib/fleet.js`; specialty surfaces through
`server/lib/external/foundry.js`. Both enforce the in-process **cost guard** (`guard → dispatch → record`).

### Core roles — `server/lib/fleet.js` → `resolveModel(ROLE)`

| Role | Deployment | Use for |
|---|---|---|
| `GROUNDED_CITED` | claude-opus-4-8 | grounded + cited reasoning, import-brain spine |
| `MID_REASONER` | claude-sonnet-5 | structured mapping, import escalation, claims copilot |
| `BULK_VERIFY` | claude-haiku-4-5 | high-volume row/field verification |
| `VISION` / `CHEAP_GENERAL` | gpt-5.1 / gpt-5-mini | vision, cheap general (legacy — see FAST_GENERAL) |
| `EMBED` | text-embedding-3-small | write-time chunk embeddings |

### Specialty surfaces — `external.foundry.*`

Each rides a **different route** on the same resource + key (all probe-verified live):

| Function | Deployment | Route | Use for |
|---|---|---|---|
| `deepReason(input, {maxOutputTokens})` | gpt-5.4-pro | `/openai/v1/responses` ⚠️ | hardest import disambiguation (quality ≫ latency) |
| `verifyJudge('xai'\|'deepseek', messages)` | grok-4.3 / DeepSeek-V4-Pro | `/openai/v1/chat/completions` | cross-vendor verify panel (decorrelated errors) |
| `embedQuality(inputs[])` | text-embedding-3-large | `/openai/v1/embeddings` | query-time high-fidelity retrieval |
| `rerank(query, docs[], {topN})` | Cohere-rerank-v4.0-pro | `/providers/cohere/v2/rerank` ⚠️ | cross-encoder rerank → citation precision |
| `documentOcr({documentUrl\|imageDataUrl})` | mistral-document-ai-2512 | `/providers/mistral/azure/ocr` ⚠️ | PDF/scan → markdown with native tables (0-char-PDF fix) |

⚠️ = non-obvious route. `gpt-5.4-pro` **rejects** `/chat/completions` (400); rerank + OCR live on
provider-scoped paths. All three are already wired in `external/foundry.js` — just call them.

**Voice:** `gpt-realtime-2.1` deployed, parked (claims-CX roadmap).

---

## Functional / data APIs

All wrapped in `server/lib/external/`. **Keyless** unless a var is named.

| Namespace.function | Source | Auth | Gives you |
|---|---|---|---|
| `edgar.lossRatio(ticker\|cik)` | SEC EDGAR XBRL | none¹ | public carrier loss ratio + premiums/losses (PGR, ALL, TRV, CB…) |
| `edgar.companyFacts(cik)` | SEC EDGAR | none¹ | full XBRL financial facts |
| `txFilings.latestFilings({company, line})` | TX DOI (Socrata) | none² | a company's latest **SERFF filings** — serffId, %change, dates, status |
| `txFilings.rateChanges({company})` | TX DOI | none² | only non-zero rate moves (competitor monitoring) |
| `vpic.decodeVin(vin)` | NHTSA vPIC | none | VIN → make/model/body/engine (PA line) |
| `hazards.censusGeocode(addr)` | US Census | none | address → lat/lon + census tract GEOID |
| `hazards.nriByTract(geoid)` | FEMA NRI | none | composite + per-peril risk ratings |
| `hazards.floodZone(lat, lon)` | FEMA NFHL | none | flood zone at a point |
| `hazards.disasterDeclarations({state})` | OpenFEMA | none | federal disaster history |
| `hazards.nfipClaims({state, countyCode})` | OpenFEMA | none | real flood **loss** data (paid amounts) |
| `hazards.quakes({lat, lon})` | USGS | none | earthquake history |
| `hazards.nwsAlerts(lat, lon)` | NOAA/NWS | none | active weather alerts |
| `azureMaps.geocode(addr)` | Azure Maps | `AZURE_MAPS_KEY` | geocode fallback when Census misses |
| `newsdata.latest({q, size})` | NewsData.io | `NEWSDATA_API_KEY` | industry news articles |

¹ EDGAR needs only a User-Agent header (auto-set; `EDGAR_USER_AGENT` overrides). Public filers only —
mutuals (State Farm) and Schedule P detail require paid NAIC data.
² `SOCRATA_APP_TOKEN` optional — lifts the anonymous rate limit.

**On SERFF:** SERFF has no public API. `server/lib/serff.js` *generates* Texas filing bundles from
product diffs; `external.txFilings` *retrieves* existing filings. Use together: watch competitors'
filings → generate your own bundle.

---

## Platform services (provisioned, wiring optional)

Not data sources — platform seams. Live in `rg-prodhub-dev`.

| Service | Resource | Seam | Wire-in |
|---|---|---|---|
| Cosmos DB | `cosmos-prodhub-dev-1r99` | `server/lib/cosmos.js` + `data.js` | live (atomic `adapter.db.mutate`) |
| Blob Storage | `stprodhubdev1r99` | `server/lib/storage.js` | live (`AZURE_BLOB_CONNECTION`) |
| ACS Email | `acs-prodhub-dev` | `server/lib/email.js` (`EMAIL_PROVIDER=acs`) | set `AZURE_ACS_CONNECTION_STRING` + `EMAIL_FROM`, add `@azure/communication-email` |
| Azure Maps | `maps-prodhub-dev` | `external/azureMaps.js` | set `AZURE_MAPS_KEY` |

---

## How to wire in a NEW service (checklist)

1. **Provision** (if Azure): `az … create` in `rg-prodhub-dev`; capture the key.
2. **Store the secret**: add the env var → value row to `keys.md`; set it in App Service
   (`az webapp config appsettings set -n app-prodhub-dev -g rg-prodhub-dev --settings VAR=…`).
   Never inline a value in code.
3. **Add a client**: new `server/lib/external/<source>.js` — normalized returns, `Error.status`
   on failure, `isConfigured()` + 503 throw if keyed, escape any injected query values.
4. **Register it**: one line in `external/index.js`.
5. **Document it**: a row in `external/README.md` and this file.
6. **Test it**: mocked case in `tests/server/external.test.ts` + a live probe in
   `scripts/external-live.mts`.
7. **Consume it**: call `external.<source>.<fn>()` from a route handler or AI pipeline.
8. **Gate**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## Verify everything works

```sh
pnpm vitest run tests/server/external.test.ts   # mocked: URLs, escaping, shapes, 503 degradation
pnpm exec tsx scripts/external-live.mts          # live probes — keyless always; keyed when env set
```

The live probe self-skips keyed sources whose env isn't set (skip ≠ failure), so it's safe to run
anywhere. Last full run: **13/13 green**.

---

## Not yet available (needs a human)

| Want | Path |
|---|---|
| Climate-adjusted property risk | First Street — signup; `homecheck.js` stub already exists |
| Live market-news grounding | Tavily — signup (NewsData free tier lacks full article text) |
| Mutual carriers' financials, Schedule P triangles | NAIC statutory data — **paid** |
| ISO circulars / loss costs, multi-state filing intel | Verisk/ISO ERC, S&P MI — **paid** (import mechanism is the substitute strategy) |
| Free next-adds | NOAA Storm Events, FEMA NFIP policies, FRED (rate/inflation), Census ACS |
