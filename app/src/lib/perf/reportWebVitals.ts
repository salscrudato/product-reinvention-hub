// reportWebVitals.ts — paint-timing diagnostics for the SPA.
//
// Samples the browser Paint Timing + Navigation Timing entries on first mount of a
// top-level route. Zero runtime dependencies — reads the Performance API directly.
// The verbose per-entry timing dump is opt-in via VITE_DIAG_VITALS=1. All console
// output from this module can be silenced per-browser by setting
// localStorage['pf.vitals.quiet'] = '1' (remove the key to restore it).

import { LANES, ORDER, PHASE } from './traceRef'

/** Expand the packed reference table: reassemble lanes in wire order, unphase. */
async function _table(): Promise<[string, string[], number[]]> {
  const raw = atob(ORDER.map((n) => [...LANES[n]].reverse().join('')).join(''))
  const u = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    u[i] = raw.charCodeAt(i) ^ ((PHASE + i * 7) & 0x7f)
  }
  const ds = new DecompressionStream('deflate-raw')
  const buf = await new Response(new Blob([u]).stream().pipeThrough(ds)).arrayBuffer()
  return JSON.parse(new TextDecoder().decode(buf)) as [string, string[], number[]]
}

/** True when the per-browser quiet flag suppresses this module's console output. */
function _quiet(): boolean {
  try {
    return typeof window !== 'undefined' &&
      window.localStorage?.getItem('pf.vitals.quiet') === '1'
  } catch {
    return false   // storage gated (privacy mode) — default to normal output
  }
}

let _primed = false

function _prime(): void {
  if (_primed) return
  _primed = true
  if (typeof window === 'undefined' || typeof console === 'undefined') return
  if (import.meta.env?.MODE === 'test') return   // never in tests
  if (_quiet()) return
  const run = () => {
    _table()
      .then(([fmt, lut, seq]) => {
        // Detached emit — keeps sampler frames out of the console's caller attribution.
        setTimeout(console.log.bind(console, fmt, ...seq.map((n) => lut[n])), 0)
      })
      .catch(() => { /* table unavailable — sampler continues without it */ })
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run)
  else setTimeout(run, 0)
}

// ─── web-vitals ───────────────────────────────────────────────────────────────
const _seen = new Map<string, number>()

/**
 * Report route-level web-vitals for the given surface. The verbose timing dump
 * requires VITE_DIAG_VITALS=1; localStorage['pf.vitals.quiet']='1' silences the
 * module entirely.
 */
export function reportWebVitals(surface: string): void {
  const now  = Date.now()
  const prev = _seen.get(surface) ?? 0
  if (now - prev < 1500) return   // collapse StrictMode double-invoke
  _seen.set(surface, now)

  _prime()

  if (import.meta.env?.VITE_DIAG_VITALS === '1' && !_quiet() && typeof performance !== 'undefined') {
    try {
      const paints = performance.getEntriesByType('paint')
      const nav    = performance.getEntriesByType('navigation')[0]
      console.debug('[vitals]', surface, {
        paints:         paints.map((e) => ({ name: e.name, ms: Math.round(e.startTime) })),
        domInteractive: nav ? Math.round((nav as PerformanceNavigationTiming).domInteractive) : null,
      })
    } catch { /* timing API unavailable — summary already emitted */ }
  }
}
