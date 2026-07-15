// scripts/lib/run-recovery.mts — F23 client half: recover a finished import bundle
// after a severed stream, instead of paying for the run again.
//
// The server persists the completed bundle keyed by the client-supplied run id
// (server/lib/ai/run-results.js) and serves it at POST /api/ai/unifiedImportResult.
// On stream loss the client POLLS that endpoint: the server may still be computing
// (a dead socket no longer kills the pipeline), so 404 means "not finished yet —
// keep waiting", while 4xx structural answers and storage-unconfigured stop the
// poll immediately. Network errors during the poll are EXPECTED (an App Service
// restart is one of the failure modes being recovered from) and keep polling.
//
// Retry economics (ledger F23): a full-run retry is a ~$70 bill, not a recovery —
// so full re-runs are OPT-IN via IMPORT_EVAL_MAX_ATTEMPTS (default 1).
import { randomUUID } from 'node:crypto'

export interface RetryPolicy { maxAttempts: number }

/** Full-run attempts are opt-in: default 1 (no automatic re-runs), clamped to [1, 3]. */
export function resolveRetryPolicy(env: Record<string, string | undefined>): RetryPolicy {
  const n = Number(env.IMPORT_EVAL_MAX_ATTEMPTS)
  const maxAttempts = Number.isFinite(n) && n >= 1 ? Math.min(Math.trunc(n), 3) : 1
  return { maxAttempts }
}

/** Mint a run id the server-side sanitizer accepts ([A-Za-z0-9._-]{8,64}). */
export function mintRunId(prefix = 'eval'): string {
  return `${prefix}-${randomUUID()}`
}

export interface RecoverOptions {
  baseUrl: string
  token: string
  runId: string
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
  pollIntervalMs?: number
  maxWaitMs?: number
  log?: (msg: string) => void
}

export interface RecoveredResult { bundle: unknown; finishedAt?: string }

/** Poll the durable-result endpoint until the bundle appears, the wait budget is
 *  spent, or the server answers something unrecoverable. Returns null on give-up. */
export async function recoverRunResult(opts: RecoverOptions): Promise<RecoveredResult | null> {
  const {
    baseUrl, token, runId,
    fetchImpl = fetch,
    pollIntervalMs = 60_000,
    maxWaitMs = 2_700_000,
    log = () => {},
  } = opts
  const deadline = Date.now() + maxWaitMs
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
  let polls = 0
  for (;;) {
    polls++
    try {
      const res = await fetchImpl(`${baseUrl}/api/ai/unifiedImportResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ runId }),
      })
      if (res.ok) {
        const body = await res.json() as { bundle?: unknown; finishedAt?: string }
        if (body && body.bundle) {
          log(`    run ${runId}: persisted bundle recovered after ${polls} poll(s)`)
          return { bundle: body.bundle, finishedAt: body.finishedAt }
        }
        log(`    run ${runId}: result endpoint answered 200 without a bundle — giving up`)
        return null
      }
      if (res.status === 404) {
        // Not finished yet (or the run died server-side) — keep waiting.
        log(`    run ${runId}: no persisted result yet (poll ${polls}) — server may still be computing`)
      } else {
        // 400/403/503: structural — polling cannot change the answer.
        log(`    run ${runId}: result endpoint answered HTTP ${res.status} — stopping recovery`)
        return null
      }
    } catch (e) {
      // Network error mid-poll: expected during an App Service restart — keep going.
      log(`    run ${runId}: poll ${polls} network error (${(e as Error).message}) — will retry`)
    }
    if (Date.now() + pollIntervalMs > deadline) {
      log(`    run ${runId}: recovery window exhausted after ${polls} poll(s) — no persisted result`)
      return null
    }
    await sleep(pollIntervalMs)
  }
}
