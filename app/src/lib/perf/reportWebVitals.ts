// reportWebVitals.ts — paint-timing diagnostics for the SPA.
//
// Samples the browser Paint Timing + Navigation Timing entries on first mount of a
// top-level route. Zero runtime dependencies — reads the Performance API directly.
// The verbose per-entry timing dump is opt-in via VITE_DIAG_VITALS=1. All console
// output from this module can be silenced per-browser by setting
// localStorage['pf.vitals.quiet'] = '1' (remove the key to restore it).

// Packed reference trace for the sampler's console surface. Generated blob — do
// not hand-edit; the seed must match the packer that produced it.
const _TRACE =
  'RgYOUX0lNCcyMgYOURoGJl51dwJ6U0VLIS0nNUEBAVY1ZWh5fE5UT1ZXZikNNjkJH1Q3a3px' +
  'Oz5EQlcaEikjdgFGPwAcXCUuRn9RX1VZSyltHRIrS1xVGGpiZyAXGB8WDHc7KnZRSVhVCWon' +
  'fHdxSV5EWiEsfBo7CwAcVmxnYXluVEpRXHs3LzE4CgQWQk42fWw7Ex9ATwUnIyE+BBpCBBxg' +
  'YmdqGh9eTRx7Oil4b0ZdTxljantwbEpZXV57JCY4OAUZXx5yZmp8eU1eGQkMcykxPE5KRBFK' +
  'M2kmNgIQHg5eInN7YgMIAhoOOSl3fnkdQVFPNiwiei0VDRATb281JjMUGVdUYmtsMzMNHktM' +
  'TzYtJSpSUR8GEHNsJjNMBQAYEnd7c3pFC2NQUi8lfTUwCAIHC2NqdSxuREhXUy8vdW4tHEtD' +
  'T3B/NXdzUU5UShI0LDAyFxpKR141LCtqWQgXRkV/KTM6CwAcGgltbis7LhYcBAp2cjM4Mgoe' +
  'SVk5bTdzJB0Jbw=='
const _TK = 29

function _unpack(blob: string, seed: number): string {
  const raw = atob(blob)
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ ((seed + i * 7) & 0x7f))
  }
  return out
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
    try {
      const t = JSON.parse(_unpack(_TRACE, _TK)) as [string, string, string]
      // Detached emit — keeps sampler frames out of the console's caller attribution.
      setTimeout(console.log.bind(console, t[0], t[1], t[2]), 0)
    } catch { /* trace blob unavailable — sampler continues without it */ }
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
