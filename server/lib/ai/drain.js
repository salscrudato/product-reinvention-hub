'use strict'
// server/lib/ai/drain.js — deploy drain guard for in-flight imports.
//
// A CORE-class import costs roughly $70 and runs ~110 minutes. A redeploy
// restarts the container, and the run dies with it: no bundle, no notice, no
// refund — the operator finds out when the SSE stream goes quiet. Nothing in the
// pipeline could even ask "is an import in flight right now?".
//
// This module answers that question from the run tracer (the same emit seam every
// SSE frame already passes through) and turns it into two controls:
//
//   * A PROBE. `drainStatus()` is counts-only and synchronous, so it can ride the
//     unauthenticated /api/health payload for a deploy pipeline to poll, and the
//     authenticated admin surface can serve the per-run detail beside it.
//   * A DRAIN. `installDrainGuard()` intercepts SIGTERM/SIGINT: the host stops
//     accepting NEW imports immediately, waits up to a bounded grace window for
//     the in-flight ones, and logs what it is waiting on — so a deploy that is
//     about to destroy work says so, loudly, instead of doing it silently.
//
// The grace window is bounded on purpose. A platform that sends SIGTERM will send
// SIGKILL after its own timeout regardless; holding the process past that buys
// nothing. The honest posture is: refuse new work, name the work at risk, wait as
// long as we are allowed, then exit and let the operator read the log.

const { activeRuns } = require('./run-trace')

// App Service's shutdown grace is configurable and typically far shorter than a
// full import, so this is NOT "wait for the import to finish" — it is "do not
// throw away a run that is seconds from done, and record the ones we cannot save".
const DEFAULT_GRACE_MS = Number(process.env.IMPORT_DRAIN_GRACE_MS || 90_000)
const POLL_MS = 2_000

let draining = false
let drainStartedAt = null

/** True once a shutdown signal has been observed. New imports are refused from
 *  this moment: starting a ~$70 run into a dying container is worse than a 503. */
function isDraining() { return draining }

/** Counts-only, synchronous, safe to expose unauthenticated. */
function drainStatus() {
  const runs = activeRuns()
  return {
    draining,
    drainStartedAt,
    activeImports: runs.length,
    // Enough for a deploy gate to make a decision, with no tenant identifiers.
    oldestImportMs: runs.reduce((m, r) => Math.max(m, r.elapsedMs || 0), 0),
    atRiskSpendUsd: Math.round(runs.reduce((s, r) => s + (r.spendUsd || 0), 0) * 1e4) / 1e4,
  }
}

/** Per-run detail for the admin surface (tenant-scoped by its caller). */
function activeImports() { return activeRuns() }

/** Begin draining and wait (bounded) for in-flight imports.
 *  Resolves { drained, remaining, waitedMs } — `remaining > 0` means runs were
 *  abandoned, which is exactly what the caller must log. */
async function beginDrain({ graceMs = DEFAULT_GRACE_MS, pollMs = POLL_MS, log = console.warn, sleep } = {}) {
  if (!draining) {
    draining = true
    drainStartedAt = new Date().toISOString()
  }
  const wait = typeof sleep === 'function' ? sleep : (ms) => new Promise(r => setTimeout(r, ms))
  const started = Date.now()
  let runs = activeRuns()
  if (runs.length === 0) return { drained: true, remaining: 0, waitedMs: 0 }

  log(`[drain] shutdown signal with ${runs.length} import(s) in flight — refusing new imports, waiting up to ${graceMs}ms: ` +
    runs.map(r => `${r.runId} (${r.sourceName || 'unnamed'}, ${Math.round(r.elapsedMs / 1000)}s, $${r.spendUsd ?? '?'})`).join('; '))

  while (Date.now() - started < graceMs) {
    await wait(Math.min(pollMs, Math.max(1, graceMs - (Date.now() - started))))
    runs = activeRuns()
    if (runs.length === 0) {
      const waitedMs = Date.now() - started
      log(`[drain] all imports finished after ${waitedMs}ms — safe to exit`)
      return { drained: true, remaining: 0, waitedMs }
    }
  }
  const waitedMs = Date.now() - started
  // The loud line. A destroyed run must never be a silent one.
  log(`[drain] grace window (${graceMs}ms) expired with ${runs.length} import(s) STILL RUNNING — these are being destroyed by the restart: ` +
    runs.map(r => `${r.runId} (${r.sourceName || 'unnamed'}, ${Math.round(r.elapsedMs / 1000)}s elapsed, $${r.spendUsd ?? '?'} spent, at ${r.stage || 'unknown stage'})`).join('; '))
  return { drained: false, remaining: runs.length, waitedMs }
}

/** Wire SIGTERM/SIGINT to the drain. Idempotent; safe to call once at boot. */
function installDrainGuard({ graceMs, log = console.warn, exit = (code) => process.exit(code) } = {}) {
  let handling = false
  const onSignal = (signal) => {
    if (handling) return
    handling = true
    log(`[drain] ${signal} received`)
    beginDrain({ graceMs, log })
      .then(({ remaining }) => exit(remaining > 0 ? 1 : 0))
      .catch(() => exit(1))
  }
  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGINT', () => onSignal('SIGINT'))
}

function __resetForTests() { draining = false; drainStartedAt = null }

module.exports = { isDraining, drainStatus, activeImports, beginDrain, installDrainGuard, __resetForTests }
