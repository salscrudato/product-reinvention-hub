# `server/lib/external/` — external data-source inventory

Parameterized, reusable clients for every external API this app consumes. One module per
source, re-exported by [index.js](index.js). Server-side only (CJS, Node 20+ `fetch`, zero
new dependencies). **No secrets in code** — keyed sources read `process.env` and throw
`{ status: 503 }` when unconfigured so callers degrade instead of crash.

> **Secrets/keys**: gitignored `keys.md` at the repo root (single source for humans).
> **AI model IDs**: `shared/src/ai/fleet.ts` → bundled to `server/lib/fleet-shared.cjs`
> (`pnpm build:fleet`). Never hardcode a deployment name outside fleet.

## Quick reference

| Namespace | Function | Purpose | Auth | Verified |
|---|---|---|---|---|
| `foundry` | `deepReason(input, {maxOutputTokens})` | gpt-5.4-pro deep escalation (`/responses` API — chat/completions 400s) | `AZURE_FOUNDRY_KEY` | ✅ live |
| `foundry` | `verifyJudge(lineage, messages, {maxTokens})` | cross-vendor judge: `'xai'`→grok-4.3, `'deepseek'`→DeepSeek-V4-Pro | 〃 | ✅ live |
| `foundry` | `embedQuality(inputs[])` | text-embedding-3-large (query-time; bulk stays on EMBED role) | 〃 | ✅ live |
| `foundry` | `rerank(query, docs[], {topN})` | Cohere v4-pro cross-encoder rerank → `[{index, score, document}]` | 〃 | ✅ live |
| `foundry` | `documentOcr({documentUrl \| imageDataUrl})` | Mistral OCR → per-page markdown with native `<table>`s (0-char-PDF fix) | 〃 | ✅ live |
| `edgar` | `lossRatio(tickerOrCik)` | latest-annual loss ratio for a public carrier (e.g. `'PGR'` → 66.1%) | none (UA header) | ✅ live |
| `edgar` | `lookupCik(ticker)` / `companyFacts(cik)` | ticker→CIK; full XBRL facts | 〃 | ✅ live |
| `txFilings` | `latestFilings({company, line, limit, dataset})` | a company's latest TX SERFF filings (serffId, %change, dates, status) | none (`SOCRATA_APP_TOKEN` optional) | ✅ live |
| `txFilings` | `rateChanges({company, limit})` | only non-zero rate moves (competitor monitoring) | 〃 | ✅ live |
| `vpic` | `decodeVin(vin, {modelYear})` | VIN → normalized vehicle attributes (PA line) | none | ✅ live |
| `azureMaps` | `geocode(address, {minScore})` | geocode fallback when Census misses | `AZURE_MAPS_KEY` | ✅ live |
| `hazards` | `censusGeocode(address)` | address → lat/lon + census tract GEOID | none | ✅ prod |
| `hazards` | `nriByTract(geoid)` | FEMA National Risk Index ratings per peril | none | ✅ prod |
| `hazards` | `floodZone(lat, lon)` | FEMA NFHL flood zone at a point | none | ✅ prod |
| `hazards` | `disasterDeclarations({state, county, limit})` | OpenFEMA declarations | none | ✅ prod |
| `hazards` | `nfipClaims({state, countyCode, limit})` | NFIP flood claims incl. paid-loss amounts | none | new |
| `hazards` | `quakes({lat, lon, radiusKm, sinceYears, minMagnitude})` | USGS quake history | none | ✅ prod |
| `hazards` | `nwsAlerts(lat, lon)` | active NWS alerts | none | ✅ prod |
| `newsdata` | `latest({q, size, country})` | industry news articles | `NEWSDATA_API_KEY` | ✅ live |

## Environment variables

| Var | Used by | Where the value lives |
|---|---|---|
| `AZURE_FOUNDRY_ENDPOINT` / `AZURE_FOUNDRY_KEY` | `foundry` (via `../fleet`) | App Service settings / keys.md |
| `AZURE_MAPS_KEY` | `azureMaps` | `az maps account keys list -n maps-prodhub-dev -g rg-prodhub-dev` / keys.md |
| `NEWSDATA_API_KEY` | `newsdata` | Key Vault `newsdata-key` / keys.md |
| `SOCRATA_APP_TOKEN` (optional) | `txFilings` | free signup; lifts anonymous throttle |
| `EDGAR_USER_AGENT` (optional) | `edgar` | defaults to a descriptive UA (SEC requires one) |

## Rules for agents extending this layer

1. **One module per source**, normalized return shapes (never leak raw upstream JSON to callers
   except via an explicit `raw` field), errors as `Error` with `.status`.
2. **Keyed sources** expose `isConfigured()` and throw `{ status: 503 }` when unset.
3. **AI surfaces** must dispatch through the fleet cost guard (`guard → fetch → record`) —
   see [foundry.js](foundry.js); never call the Foundry endpoint directly from a feature module.
4. **Escape injected query values** (SoQL quotes double `''`; ArcGIS/OData strip quotes).
5. **homecheck.js isolation**: never import this layer from `server/lib/homecheck.js` —
   its zero-portfolio-access invariant requires its own inline copies (see its header).
6. Add every new function to: this README table, `tests/server/external.test.ts` (mocked),
   and `scripts/external-live.mts` (live probe).

## Testing

```sh
pnpm vitest run tests/server/external.test.ts   # mocked unit tests (shape, params, escaping)
pnpm exec tsx scripts/external-live.mts          # live probes (keyless always; keyed when env set)
```

## Not covered here (by design)

- **Core AI chat/embed roles** → `server/lib/fleet.js` (cost guard + role router).
- **Cosmos / Blob / ACS email** → `server/lib/{cosmos,storage,email}.js` (platform seams, not data sources).
- **SERFF bundle generation** → `server/lib/serff.js` *generates* Texas filing bundles from
  product diffs; retrieval of existing filings is `txFilings` above. SERFF has no public API.
