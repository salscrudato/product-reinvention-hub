'use strict'
// verify-lineage.js — isConfigured-style probe guarding for the cross-vendor verify
// panel (CE3 step 0).
//
// Operator statement 2026-07-16: Grok (VERIFY_XAI / grok-4.3) is deprovisioned from
// foundry-prodhub-dev. The registry-driven degrade map (fleet-shared EXTENDED_DEGRADE)
// routes xai -> deepseek; this module adds the runtime guard so a future re-provision
// works without a code change:
//   - env opt-in: FOUNDRY_ENABLE_XAI=1 declares the deployment live again
//   - probe cache: if an enabled xai call 404s/400s (model_not_found class), the
//     lineage is marked dead for the rest of the process and degrades permanently
// No deployment id is hardcoded here — names resolve through the fleet registry, and
// every actual call flows through external/foundry.js verifyJudge (guard -> record).

const bridge = require('../fleet-shared.cjs')
const foundry = require('../external/foundry')

// Process-lifetime probe cache: null = unprobed, true = confirmed live, false = dead.
let xaiProbeResult = null

/** Is the xai lineage declared available? (env switch, default OFF per the 2026-07-16
 *  operator statement; flip FOUNDRY_ENABLE_XAI=1 after a re-provision). */
function xaiConfigured() {
  return process.env.FOUNDRY_ENABLE_XAI === '1'
}

/** Resolve the effective verify lineage for a requested one. 'xai' degrades to the
 *  registry target ('deepseek') when unconfigured or probe-dead. Returns
 *  { lineage, degraded, reason }. */
function resolveVerifyLineage(requested) {
  if (requested !== 'xai') return { lineage: requested, degraded: false, reason: 'ok' }
  if (!xaiConfigured()) {
    return { lineage: degradeTarget(), degraded: true, reason: 'xai_not_configured' }
  }
  if (xaiProbeResult === false) {
    return { lineage: degradeTarget(), degraded: true, reason: 'xai_probe_dead' }
  }
  return { lineage: 'xai', degraded: false, reason: 'ok' }
}

function degradeTarget() {
  // EXTENDED_DEGRADE maps role names; the verifyJudge lineage strings are 'xai'/'deepseek'.
  const to = (bridge.EXTENDED_DEGRADE && bridge.EXTENDED_DEGRADE.VERIFY_XAI) || 'VERIFY_DEEPSEEK'
  return to === 'VERIFY_DEEPSEEK' ? 'deepseek' : 'xai'
}

/** Probe-guarded verify call. Resolves the lineage, dispatches through
 *  external/foundry.verifyJudge (cost guard + telemetry ride along), and on a
 *  model-unavailable class error from a live xai attempt, caches the death and
 *  retries once on the degrade target.
 *  `judge` is an injection seam (tests); production callers omit it. */
async function verifyWithLineage(requested, messages, opts = {}, judge = foundry.verifyJudge) {
  const r = resolveVerifyLineage(requested)
  try {
    const out = await judge(r.lineage, messages, opts)
    if (r.lineage === 'xai') xaiProbeResult = true
    return { ...out, lineage: r.lineage, degraded: r.degraded, degradeReason: r.degraded ? r.reason : undefined }
  } catch (e) {
    const status = e && e.status
    if (r.lineage === 'xai' && (status === 404 || status === 400)) {
      xaiProbeResult = false
      const out = await judge('deepseek', messages, opts)
      return { ...out, lineage: 'deepseek', degraded: true, degradeReason: 'xai_probe_dead' }
    }
    throw e
  }
}

/** Test seam: reset the probe cache. */
function _resetProbeCache() { xaiProbeResult = null }

module.exports = { resolveVerifyLineage, verifyWithLineage, xaiConfigured, _resetProbeCache }
