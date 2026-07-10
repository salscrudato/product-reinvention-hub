# Observability runbook

Cloud Logging receives structured JSON-line entries from every Cloud Function.
Each entry has at minimum: `severity`, `feature`, `event`.
Optional fields: `sessionKey`, `ms` (wall-clock latency in ms), `costUsd`.

## Stable event names

| Event | Severity | Source | Meaning |
|---|---|---|---|
| `start` | INFO | `ai.ts`, `claims.ts` | SSE endpoint accepted request and began work |
| `done` | INFO | `telemetry.ts` | Feature invocation completed successfully |
| `error` | WARNING | `telemetry.ts` | Feature invocation ended in an unhandled error |
| `cache.hit` | INFO | `semanticCache.ts` | Semantic cache served the response; no upstream model call |
| `degrade` | INFO | `costGuard.ts` | Request served under a budget soft-cap degradation |
| `deny` | WARNING | `costGuard.ts` | Request blocked by the global daily ceiling |
| `breaker.open` | ERROR | `costGuard.ts` | Circuit breaker transitioned from closed → open |

## HUMAN ACTIONS required

Two event patterns should trigger a human response.
Both can be surfaced as Cloud Logging alerts using the log-based metric filter
`jsonPayload.event = "<event>"`.

### 1. `breaker.open` — provider circuit breaker tripped

**Filter:** `jsonPayload.event = "breaker.open" AND severity = "ERROR"`

**What it means:** The Anthropic provider recorded enough consecutive failures
(default: 5) to open the breaker. New chat and analyzeClaim calls will
degrade to a "service temporarily unavailable" message until the breaker
resets or is manually cleared.

**Actions:**
1. Check Anthropic status page for an ongoing incident.
2. Review recent `error` events in Cloud Logging for the failing feature.
3. If the outage has resolved, you can accelerate recovery by resetting the
   `costCounters/breaker-anthropic` Firestore document
   (`consecutiveFailures: 0, openUntil: 0`) — the breaker is stateless
   server-side and will re-close on the next successful call.
4. If the failure rate is caused by a code regression (model reject, bad
   prompt), roll back the relevant Functions deployment.

### 2. p95 latency spike on `chat` or `analyzeClaim`

**Filter:** `jsonPayload.feature = "chat" AND jsonPayload.event = "done"`
Alarm threshold: p95 of `jsonPayload.ms` > 30 000 ms.

**What it means:** The SSE endpoint is spending more than 30 s serving a
response. Possible causes: retrieval latency (Voyage), long tool-loop (more
than 3 turns), or Anthropic model slowdown.

**Actions:**
1. Check `ms` distribution in Cloud Logging over the last 1 h.
2. Cross-reference with Anthropic status; if their latency is elevated, the
   issue is upstream — monitor and alert users if needed.
3. If retrieval is the bottleneck (Voyage latency), check the Voyage API
   status or reduce `topK` in `functions/src/retrieval/index.ts`.
4. If the tool loop is spinning (3+ `tool_use` turns), review recent system
   prompt changes or form data that might be confusing grounding.

## Log query examples (Cloud Logging)

```
-- All ERROR events in the last hour
resource.type="cloud_run_revision"
severity=ERROR
timestamp>="2025-01-01T00:00:00Z"

-- breaker transitions only
jsonPayload.event="breaker.open"

-- Slow chat completions (ms > 20000)
jsonPayload.feature="chat"
jsonPayload.event="done"
jsonPayload.ms>20000

-- Denied calls (global ceiling hit)
jsonPayload.event="deny"
```

## Admin UI quick-reference

The **AI Cost** tab in `/app/admin` shows:
- Today's spend vs the hard global ceiling (with a danger banner when breached).
- Degraded / denied call counts for the selected window.
- Escalation rate per feature (rising rate = drifting cheap-first verifier).
- Semantic cache hit rate and estimated saved spend.

These figures are derived from the `aiUsage` Firestore collection and are
bounded to 500 records per page (use "Load more" for older history).
