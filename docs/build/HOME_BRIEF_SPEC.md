# HOME_BRIEF_SPEC — the "First Prompt" daily brief (P1 → P2/P4)

**Status:** SPEC_READY (P1, 2026-07-15). Contract for the server endpoint + Home surface.
**Prime directive:** grounded + cited (CLAUDE.md invariant). Every AI sentence cites its
source (task ids, news urlHashes, metric keys). Nothing resolves → an honest, cited stub —
never invented carrier facts.

## 1. Endpoint

`POST /api/ai/dailyBrief` — a new verb in the existing AI dispatcher
(`server/lib/ai/index.js:58` pattern, next to `taskSummary`). Auth: `ai:invoke` (VIEWER may
read the brief; it performs no writes). Cost: MID_REASONER role via fleet routing — never a
hardcoded model id. Cache: per-tenant, per-UTC-day key (`brief/<tenant>/<yyyy-mm-dd>`);
recompute only on cache miss or `{force:true}` (EDITOR+).

### Composition (server-side, three inputs)

1. **Tasks** — reuse `server/lib/ai/task-summary.js` (`taskSummary`, MID_REASONER, cited task
   ids, `_stripUncited` enforced at `task-summary.js:133`). The brief embeds its paragraph +
   citations verbatim; it does not re-summarize.
2. **News** — the tenant's stored news items (`news/<urlHash>` docs written by
   `refresh-news.js:349`), filtered by the tenant profile (NEWS_TENANT_SPEC), top 3 by
   publishedAt.
3. **Portfolio metrics** — deterministic Cosmos counts (products by lifecycle, coverages,
   open tasks by phase, versions written in the last 7 days). **Stubbed enrichment:** one
   `web_search` attempt (same tool + honest-failure discipline as
   `refresh-news.js:76-97 webSearchScout`) scoped to the tenant profile's `carrierName` for
   public metrics/news; on `web_search_unsupported` or zero grounded hits the enrichment block
   is `{ status: 'unavailable', detail }` — rendered as the graceful stub, cited as "no public
   source resolved". Never blocks the brief.

## 2. Response shape

```jsonc
{
  "day": "2026-07-15",
  "generatedAt": "…iso…",
  "headline": { "text": "1-2 sentence brief lead", "citations": ["task:GTM.T012", "news:ab12…", "metric:openTasks"] },
  "pills": [ { "kind": "tasks|news|metric|risk|export", "label": "3 overdue", "count": 3,
               "tone": "info|warn|good", "target": "/tasks?filter=overdue", "citations": ["task:…"] } ],
  "tasks":   { "paragraph": "…", "citations": ["task:…"], "buckets": { "overdue": 3, "dueToday": 2, "blocked": 1 } },
  "news":    { "items": [ { "urlHash": "…", "title": "…", "source": "…", "publishedAt": "…", "matchedProducts": ["PA.PROD.001"] } ] },
  "metrics": { "deterministic": { "products": 5, "coverages": 87, "openTasks": 14, "versions7d": 22 },
               "enrichment": { "status": "ok|unavailable", "items": [ { "text": "…", "url": "…" } ], "detail": "…" } }
}
```

Rules: `citations` arrays are never empty on AI-authored text (strip-uncited applies);
`pills` max 6, ordered `risk > tasks > export > news > metric`; every pill `target` is an
in-app route (deep link), no external URLs in pills.

## 3. Pill taxonomy (closed set)

| kind | source | tone rules |
|---|---|---|
| `tasks` | task buckets (overdue/dueToday/blocked) | overdue>0 → warn |
| `news` | count of new-since-last-visit matched items | always info |
| `metric` | deterministic portfolio counts | info; versions7d>0 → good |
| `risk` | canary/import warnings surfaced by existing telemetry (optional v1: omit) | warn |
| `export` | DC export readiness (HITL rows outstanding, from export-manifest) — appears only after the first export attempt | pending HITL → warn, delivered → good |

## 4. Empty & loading states (client, Home.tsx)

- **Loading:** existing `WaveformLoader` (Home.tsx:302) in the brief card slot; pills render
  as 3 skeleton chips; no layout shift (reserve the card height).
- **Empty (new tenant, no tasks/news/products):** the card renders a seeded-state message
  ("Your brief starts when the portfolio does") + a single `metric` pill `products: 0` +
  primary action → import/scaffold. Never render an empty AI paragraph.
- **Partial:** each of the three blocks fails independently (tasks AI down ≠ no metrics);
  a failed block renders its own quiet fallback line with the error detail available on
  hover; the endpoint returns 200 with per-block status, 5xx only when all three fail.
- **VIEWER:** identical read experience; `force` refresh hidden.

## 5. Tests P2 owes

Endpoint: cache-key day rollover; strip-uncited on headline; per-block failure isolation;
VIEWER 200. Client: skeleton → content without layout shift; empty-tenant state; pill order
and max-6 truncation.
