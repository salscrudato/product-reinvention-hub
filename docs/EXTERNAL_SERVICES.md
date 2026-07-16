# External Services — inventory & agent wiring guide

Every service available to the Product Reinvention Hub, and how an AI coding agent wires one
in within minutes. All clients are **already built and tested** — this guide is about *using*
them, not building them.

> **Secrets**: gitignored `keys.md` at the repo root (never commit; never echo values into a
> transcript). **Clients**: `server/lib/external/` ([README](../server/lib/external/README.md)).
> **Model IDs**: `shared/src/ai/fleet.ts` only — never hardcode a deployment name.

---

## 0 · Sixty-second quick start

```js
// Any server-side module:
const external = require('./external')            // from server/lib/*
// or: require('../external') from server/lib/ai/*

const ratio   = await external.edgar.lossRatio('PGR')                         // carrier financials
const filings = await external.txFilings.latestFilings({ company: 'State Farm' }) // SERFF filings
const vehicle = await external.vpic.decodeVin('2HGFC2F69LH500001')            // VIN decode
const ranked  = await external.foundry.rerank(query, candidateTexts, { topN: 5 }) // RAG rerank
const ocr     = await external.foundry.documentOcr({ documentUrl })           // PDF → md tables
```

Verify everything still works (run before and after wiring):

```sh
pnpm vitest run tests/server/external.test.ts   # mocked unit tests (14)
pnpm exec tsx scripts/external-live.mts          # live probes (13; keyed ones skip w/o env)
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # the gate — must stay green
```

---

## 1 · AI services (Azure AI Foundry — `foundry-prodhub-dev`)

One resource, one account key (`AZURE_FOUNDRY_ENDPOINT` + `AZURE_FOUNDRY_KEY`), **16
deployments** across 6 vendors. Keys are account-level — every deployment shares them.

### Core chat/embed roles → `server/lib/fleet.js`

Resolve by ROLE, never by name. The cost guard (`guard → dispatch → record`) is mandatory.

| Role | Deployment | Use for |
|---|---|---|
| `GROUNDED_CITED` | claude-opus-4-8 | grounded + cited generation, import-brain anchor |
| `MID_REASONER` | claude-sonnet-5 | import escalation, claims copilot |
| `BULK_VERIFY` | claude-haiku-4-5 | bulk verification, cheap cascade passes |
| `VISION` | gpt-5.1 | vision-heavy extraction *(legacy — migrating to gpt-5.4-mini)* |
| `CHEAP_GENERAL` | gpt-5-mini | degrade target *(legacy — migrating to gpt-5.4-mini)* |
| `EMBED` | text-embedding-3-small | write-time chunk embeddings |

### Extended specialty surfaces → `external.foundry`

Deployment names resolve through `EXTENDED_DEPLOYMENTS` (fleet.ts). Each rides a
**different route** on the same resource — using the wrong route is the #1 wiring bug:

| Function | Deployment | Route (why it matters) |
|---|---|---|
| `deepReason(input, {maxOutputTokens})` | gpt-5.4-pro | `/openai/v1/responses` — **rejects chat/completions with 400** |
| `verifyJudge('xai'\|'deepseek', messages)` | grok-4.3 / DeepSeek-V4-Pro | `/openai/v1/chat/completions` |
| `embedQuality(inputs[])` | text-embedding-3-large | `/openai/v1/embeddings` (query-time; 3072-dim) |
| `rerank(query, docs[], {topN})` | Cohere-rerank-v4.0-pro | `/providers/cohere/v2/rerank` — not /v1 or /v2 alone |
| `documentOcr({documentUrl\|imageDataUrl})` | mistral-document-ai-2512 | `/providers/mistral/azure/ocr` → markdown w/ native `<table>`s |

Also deployed: `gpt-5.6-sol` (heavy judge, standard chat), `gpt-realtime-2.1` (voice, parked).
The account's catalog holds **129 more models** deployable in one command:
`az cognitiveservices account deployment create -n foundry-prodhub-dev -g rg-prodhub-dev …`

### Orchestration pattern (how the tiers compose)

```
extract:   BULK_VERIFY → MID_REASONER → GROUNDED_CITED   (ESCALATION_LADDER)
           └─ hardest ambiguity → foundry.deepReason()    (deliberate, slow, best)
verify:    foundry.verifyJudge('xai') + verifyJudge('deepseek')  (cross-vendor panel)
retrieve:  EMBED (write) → hybrid search → foundry.rerank() → cite
documents: foundry.documentOcr() → deterministic table parser    (0-char-PDF fix)
```

---

## 2 · Insurance & market data (keyless — live now, no setup)

| Client | Call | Returns | Notes |
|---|---|---|---|
| `external.edgar` | `lossRatio('PGR')` | `{ company, fiscalYearEnd, premiumsE