# FLEET — model roles, governance, deployment reconciliation, external clients (`d28c8a1`)

> `docs/reveng/` dossier. Single source of truth for roles/pricing is
> `shared/src/ai/fleet.ts`, bundled to `server/lib/fleet-shared.cjs` and consumed by
> `server/lib/fleet.js` (cost guard) — no handler hardcodes a model string (ADR-0001).

## 1. Core role registry (`shared/src/ai/fleet.ts:40-75`)

| Role | Deployment | $/MTok in/out | Used for |
|---|---|---|---|
| `GROUNDED_CITED` | claude-opus-4-8 | 15 / 75 | deep cited reasoning; import-brain spine (stage 1/2/3 reasoner-A, ladder top, adjudicator) |
| `MID_REASONER` | claude-sonnet-5 | 3 / 15 | ladder mid rung, import escalation, claims copilot, concept-linker proposer, filing verifier |
| `BULK_VERIFY` | claude-haiku-4-5 | 0.80 / 4 | bulk extraction votes, prefilters, stage-0 assist, filing classify |
| `VISION` | gpt-5.1 | 3 / 12 | THE cross-family lens: stage-1/3 reasoner-B, stage-4 judge, stage-5 validator |
| `CHEAP_GENERAL` | gpt-5-mini | 0.30 / 1.60 | alt-family prefilter/extract votes, degrade target |
| `EMBED` | text-embedding-3-small | 0.02 / 0 | write-time chunk embeddings (512-dim, int8) |

`ESCALATION_LADDER = [BULK_VERIFY, MID_REASONER, GROUNDED_CITED]` (`fleet.ts:199`,
mirrored in `fleet-shared.cjs:145`); degrade map opus/sonnet -> haiku, gpt-5.1 -> mini
(`fleet.ts:186-193`). `claude-fable-5` appears nowhere in the runtime fleet (binding
invariant; only negative references in tests).

## 2. Extended deployments (`fleet.ts:126-141` `EXTENDED_DEPLOYMENTS`, exposed via `server/lib/external/foundry.js`)

| Ext role | Deployment | Surface (the #1 wiring trap) | Function |
|---|---|---|---|
| `DEEP_REASONER` | gpt-5.4-pro ($20/$150) | `/openai/v1/responses` — REJECTS chat/completions with 400 | `external.foundry.deepReason()` (`foundry.js:36-46`) |
| `VERIFY_XAI` | grok-4.3 ($3/$15) | `/openai/v1/chat/completions` | `verifyJudge('xai', ...)` — 3rd model lineage (`foundry.js:54-60`) |
| `VERIFY_DEEPSEEK` | DeepSeek-V4-Pro ($1.50/$6) | 〃 | `verifyJudge('deepseek', ...)` — 4th lineage |
| `FAST_GENERAL` | gpt-5.4-mini ($0.30/$1.60) | 〃 | registered, labeled "fast multimodal tier" — **not yet called by any import stage** (migration path from VISION) |
| `EMBED_QUALITY` | text-embedding-3-large ($0.13) | `/openai/v1/embeddings` | `embedQuality()` — query-time 3072-dim retrieval |
| `RERANK` | Cohere-rerank-v4.0-pro ($2 nominal) | `/providers/cohere/v2/rerank` | `rerank()` — cross-encoder citation precision |
| `DOC_OCR` | mistral-document-ai-2512 ($3 nominal) | `/providers/mistral/azure/ocr` | `documentOcr()` — PDF/scan -> markdown with native tables (the 0-char-PDF fix) |

Non-token surfaces (rerank per-search, OCR per-page) are metered as NOMINAL token counts
(~1k) so the spend window keeps moving (`foundry.js:82-83,98-99`) — per-deployment billing
for those two is an estimate, not exact.

## 3. THE DEPLOYMENT-COUNT RECONCILIATION (review says 9, SERVICES.md says 16)

Both numbers were true at their timestamps; the tree resolves them exactly:

| Source | Count | What it counted |
|---|---|---|
| `artifacts/6_Documentation/Platform_Review.md` sec 7 | **9** | live `az` query of foundry-prodhub-dev on 2026-07-15 BEFORE the fleet expansion: the 6 core roles + 3 deployed-but-unused (`gpt-5.6-sol`, `grok-4-20-reasoning`, `gpt-realtime-2.1`) |
| fleet expansion (same day; `docs/EXTERNAL_SERVICES.md:55-70`) | **+7** | gpt-5.4-pro, grok-4.3, DeepSeek-V4-Pro, gpt-5.4-mini, text-embedding-3-large, Cohere-rerank-v4.0-pro, mistral-document-ai-2512 — all probe-verified live |
| `docs/SERVICES.md:33` ("all 16 deployments") | **16** | 9 + 7, post-expansion |
| code at `d28c8a1` (`fleet.ts`) | **13 registered** | 6 core (`FLEET_REGISTRY`) + 7 extended (`EXTENDED_DEPLOYMENTS`) |
| deployed but UNREGISTERED in code | **3** | `gpt-5.6-sol` + `gpt-realtime-2.1` (named in `docs/EXTERNAL_SERVICES.md:68` / `docs/SERVICES.md:62` as deployed/parked) + `grok-4-20-reasoning` (zero references anywhere in this tree — grep verified; exists only in the review's live query) |

So: **16 = 13 registered + 3 unregistered**, and 9 was the pre-expansion snapshot.
Of the 13 registered, 12 have live call sites; `FAST_GENERAL` (gpt-5.4-mini) is
registered-but-unwired. (The live account was NOT re-queried for this dossier — counts
are code + committed docs; re-verify with
`az cognitiveservices account deployment list -n foundry-prodhub-dev -g rg-prodhub-dev`.)

### The 3 deployed-but-unused models — what each could do

- `grok-4-20-reasoning` (xAI): a THIRD decorrelation family for the stage-4 judge when
  opus and gpt-5.1 disagree (Platform_Review E6) — though `grok-4.3` now covers the
  cross-vendor-verify niche via `VERIFY_XAI`; likely deprovision candidate.
- `gpt-5.6-sol`: docs label it "heavy judge, standard chat" — an eval-judge or
  second-opinion tier; wire or deprovision.
- `gpt-realtime-2.1`: voice/realtime — the parked claims-CX voice workstream's target
  (`docs/SERVICES.md:62`).

## 4. Per-stage model usage (verified call sites)

| Stage | Deployments (via roles) | Site |
|---|---|---|
| 0 router assist | haiku -> opus (<0.6 conf) | `stage0-router.js:16-19` |
| 1 classify | haiku + gpt-5-mini prefilter; opus + gpt-5.1 reasoners; opus adjudicates | `stage1-classify.js:100-101` |
| 2 header lock | deterministic; opus fallback | `stage2-header-lock.js:22,68` |
| 3 column map | opus + gpt-5.1 parallel | `stage3-column-map.js:186` |
| 4 extract | haiku + gpt-5-mini votes; sonnet/opus ladder; gpt-5.1 judge | `stage4-extract.js:740-741` |
| 5 validate | gpt-5.1 (cross-family from stage-4's haiku) | `stage5-validate.js:221` |
| 6 reconcile / 7 plan | NO model calls (pure) | `index.js:14`, `stage7-plan.js` |
| filing | haiku classify; haiku+opus parallel vision; sonnet last resort | `stage-filing.js:16-18,237-258` |

## 5. Cost guard + telemetry (three layers)

1. **Global window** (`server/lib/fleet.js:80-105`): 1h rolling; ceiling
   `AI_SPEND_CEILING_USD` default $25 (LIVE OVERRIDE: 250 on app-prodhub-dev; in-memory,
   resets on restart -> effective cap is "since last recycle"); soft-degrade at 80%;
   `guard(IMPORT_CONTEXT)` returns allow/no-degrade BEFORE the ceiling check
   (`fleet.js:77,101`) — the named no-cap exemption. `fleet.record()` runs after EVERY
   call — telemetry is never bypassed.
2. **Per-tenant monthly metering** (`server/lib/metering.js`): AsyncLocalStorage threads
   the tenant into every `fleet.record` site (`metering.js:89-98`); buckets
   `{period, inTok, outTok, costUsd, calls, byDeployment}` persist to Cosmos `tenantMeter`
   docs (restart-durable, `:42-63`); budget exhaustion -> 429 for every AI name except
   `unifiedImport`/`unifiedImportResult` (`server/lib/ai/index.js:36-41`).
3. **Per-run SSE spend**: `brain:spend {spendUsd, calls, noCap, byDeployment}` +
   `brain:escalation` drive the live AgentVisualizer (`import-brain/index.js:131-138`,
   `ai-call.js:76-89,229-237`).

Known accounting nuances: Anthropic usage fields differ from OpenAI's
(`ai-call.js:140,182`); guard blocks AT the ceiling, no pre-reservation (max overspend
~one opus call); o-series rejects `temperature`/`max_tokens` -> `max_completion_tokens`
(`fleet.js:39-41`); Sonnet-5 no-custom-sampling constraint honored (temperature omitted,
ADR-0001).

## 6. `server/lib/external/` — the carrier-data client inventory

One module per source, normalized returns, `Error.status` on failure, keyed sources
expose `isConfigured()` and throw `{status:503}` when unset; registry in
`external/index.js`; per-source rows + wiring checklist in `external/README.md`;
mocked tests `tests/server/external.test.ts` + live probes `scripts/external-live.mts`
(last full run 13/13 green per `docs/SERVICES.md:135`).

| Client | Upstream | Auth | Key functions |
|---|---|---|---|
| `edgar.js` | SEC EDGAR XBRL | none (User-Agent; `EDGAR_USER_AGENT` opt) | `lossRatio(ticker\|cik)` (live-verified PGR FY2025 66.1%), `companyFacts(cik)`, `lookupCik` — public filers only |
| `txFilings.js` | TX DOI Socrata | `SOCRATA_APP_TOKEN` optional | `latestFilings({company, line})` -> serffId/%change/status; `rateChanges()` — the "pull latest competitor filings" answer |
| `vpic.js` | NHTSA vPIC | none | `decodeVin(vin)` -> make/model/body/engine (PA line) |
| `hazards.js` | Census geocoder, FEMA NRI/NFHL/OpenFEMA, USGS, NOAA/NWS | none | `censusGeocode`, `nriByTract`, `floodZone`, `disasterDeclarations`, `nfipClaims` (real flood LOSS data), `quakes`, `nwsAlerts` — powers HomeCheck |
| `azureMaps.js` | Azure Maps | `AZURE_MAPS_KEY` | `geocode()` fallback when Census misses |
| `newsdata.js` | NewsData.io | `NEWSDATA_API_KEY` | `latest({q, size})` industry news |
| `foundry.js` | Azure Foundry specialty routes | account `AZURE_FOUNDRY_KEY` | section 2 above — all through guard->dispatch->record |

SERFF note: SERFF has no public API — `server/lib/serff.js` GENERATES Texas bundles from
product diffs; `external.txFilings` RETRIEVES existing filings; use together for
watch-competitors -> file-your-own. Not-yet-available upstreams (need a human/paid):
First Street, Tavily, NAIC statutory, Verisk/ISO (`docs/SERVICES.md:139-147`).

## 7. Governance rules a zero-context agent must keep

1. Model IDs pinned in `fleet.ts` — never hardcode a deployment in a handler; never
   `claude-fable-5`.
2. Any new upstream call goes in `server/lib/external/<source>.js` per the README
   checklist (normalize, `isConfigured`, escape injected query values, register, test).
3. The import no-cap exemption is IMPORT-ONLY; every other role keeps the guard. The
   telemetry path (`fleet.record` + metering + `brain:spend`) is never optional.
4. Keys are account-level (`AZURE_FOUNDRY_KEY` serves all deployments) and live in
   App Service config / gitignored `keys.md` — never in code.
