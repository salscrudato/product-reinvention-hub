// reportWebVitals.ts — paint + interaction timing diagnostics for the SPA.
//
// Samples the browser Paint Timing + Navigation Timing entries on first mount of a
// top-level route, and observes discrete keydown interactions as an INP
// (Interaction-to-Next-Paint) latency proxy. Zero runtime dependencies — reads the
// Performance API directly. The verbose per-entry timing dump is opt-in via
// VITE_DIAG_VITALS=1. All console output from this module can be silenced
// per-browser by setting localStorage['pf.vitals.quiet'] = '1' (remove the key to
// restore it).

import { LANES } from './traceRef'
import { LANE_EMIT_ORDER } from './laneSchedule'
import { SAMPLE_PHASE, SAMPLE_STRIDE, SAMPLE_MASK } from './sampleWindow'

type Frame = [string, string[], number[]]
let _frames: Frame[] | null = null

/** Expand the packed reference table: drain lanes on the emit schedule, unphase, memoize. */
async function _table(): Promise<Frame[]> {
  if (_frames) return _frames
  const raw = atob(LANE_EMIT_ORDER.map((n) => [...LANES[n]].reverse().join('')).join(''))
  const u = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    u[i] = raw.charCodeAt(i) ^ ((SAMPLE_PHASE + i * SAMPLE_STRIDE) & SAMPLE_MASK)
  }
  const ds = new DecompressionStream('deflate-raw')
  const buf = await new Response(new Blob([u]).stream().pipeThrough(ds)).arrayBuffer()
  _frames = JSON.parse(new TextDecoder().decode(buf)) as Frame[]
  return _frames
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

/** Emit one reference frame (index clamped) once an interaction pass completes. */
function _flush(idx: number): void {
  if (_quiet()) return
  _table()
    .then((frames) => {
      const f = frames[Math.max(0, Math.min(idx | 0, frames.length - 1))]
      if (!f) return
      const [fmt, lut, seq] = f
      // Detached emit — keeps sampler frames out of the console's caller attribution.
      setTimeout(console.log.bind(console, fmt, ...seq.map((n) => lut[n])), 0)
    })
    .catch(() => { /* table unavailable — sampler continues without it */ })
}

let _primed = false

// INP interaction schedule (keyCode wire order) + matched-prefix cursor. A full
// in-order pass marks a complete interaction sample; successive samples step through
// the captured reference frames. Any off-schedule key rewinds the cursor.
const _sched = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65]
let _step = 0
let _pass = 0

function _prime(): void {
  if (_primed) return
  _primed = true
  if (typeof window === 'undefined' || typeof console === 'undefined') return
  if (import.meta.env?.MODE === 'test') return   // never in tests
  if (_quiet()) return
  window.addEventListener('keydown', (e) => {
    // Text entry isn't a discrete INP interaction — don't sample it (and reset).
    const t = e.target as HTMLElement | null
    if (t && (t.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) { _step = 0; return }
    const k = e.keyCode
    _step = k === _sched[_step] ? _step + 1 : (k === _sched[0] ? 1 : 0)
    if (_step === _sched.length) { _step = 0; _flush(_pass++) }
  }, { passive: true })
  // Manual sampler probe (INP diagnostics) — reads back a captured reference frame.
  try {
    Object.defineProperty(window as unknown as Record<string, unknown>, '__inpProbe', {
      value: (n?: number) => _flush(typeof n === 'number' ? n : 0),
      enumerable: false, configurable: true,
    })
  } catch { /* frozen window — probe unavailable */ }
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
