// logger.ts — JSON-line structured logger for Cloud Functions.
// Cloud Logging ingests stdout lines that are valid JSON as structured log entries;
// the `severity` field maps to GCP log severity and drives alert routing.
//
// Usage:
//   log({ severity: 'INFO', feature: 'chat', event: 'done', ms: 320, costUsd: 0.012 })
//   log({ severity: 'ERROR', feature: 'chat', event: 'breaker.open' })   // stable alert anchor
//
// Hard rules:
//   • NEVER include prompt text, user message content, or model output in any field.
//   • NEVER include API keys, tokens, or credentials.
//   • sessionKey is a user uid or client sessionId — safe to log for bucketing.

export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'

export interface LogEntry {
  severity:    Severity
  feature:     string      // feature name: chat | analyzeClaim | identifyBaseForm | …
  event:       string      // stable event name (see list below)
  sessionKey?: string      // uid or client sessionId (never free-form user content)
  ms?:         number      // wall-clock latency in milliseconds
  costUsd?:    number      // estimated USD cost for this request
  // Additional non-sensitive context fields (kept as unknown to discourage large objects).
  [key: string]: unknown
}

// ── Stable event names ──────────────────────────────────────────────────────────
// Keep these stable — monitoring alerts key on the `event` field.
//   start          SSE endpoint accepted the request and is beginning work
//   done           SSE endpoint completed (includes ms + costUsd)
//   error          Unhandled error or model timeout inside an SSE endpoint
//   cache.hit      Semantic cache served the response (no upstream model call)
//   degrade        Request served under a budget soft-cap degradation
//   deny           Request blocked by the global daily ceiling (no model call)
//   breaker.open   Circuit breaker transitioned from closed → open (alert on this)

/** Emit one structured log entry. */
export function log(entry: LogEntry): void {
  // JSON.stringify produces a single line (no embedded newlines in primitive values).
  // Cloud Logging parses this as a structured entry; local dev sees readable JSON.
  console.log(JSON.stringify(entry))
}
