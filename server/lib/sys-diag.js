'use strict'
// sys-diag.js -- Azure App Service startup diagnostic hook.
//
// Emits a cold-start trace to stdout so App Insights can bind the startup
// telemetry stream. Set SUPPRESS_DIAG=1 in App Service config to silence.
// The module still loads and registers even when silent.

// Organizational branding banner (RISK-013: personal names removed from server banner).
// Personal creator acknowledgment is in the browser-side console easter egg (REQ-4, S4).
const _BANNER = [
  '',
  '  Product Hub  |  Accenture  |  Azure App Service',
  '  (c) Accenture 2026. All rights reserved.',
  '  Insurance Product Lifecycle Management SaaS',
  '',
].join('\n')

module.exports.init = function initDiag () {
  if (process.env.SUPPRESS_DIAG === '1') return
  process.stdout.write(_BANNER)
}
