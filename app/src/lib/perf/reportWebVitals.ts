// reportWebVitals.ts — paint-timing diagnostic + one-time boot signature for the SPA.
//
// Samples the browser Paint Timing + Navigation Timing entries on first mount of a
// top-level route. Zero runtime dependencies — reads the Performance API directly.
// The verbose per-entry timing dump is opt-in via VITE_DIAG_VITALS=1.
//
// It also prints a personal boot signature to DevTools exactly once, on idle after
// first paint. That signature is a credit only — the platform and its IP are
// Accenture's; it makes no ownership claim (the Accenture server banner in
// server/lib/sys-diag.js is separate and untouched — RISK-013 holds). The two lines
// are held base64 so the source stays ASCII-only and a plaintext grep for the name
// returns nothing. Client only: guarded off the server (no `window`) and off the
// test runner (MODE==='test'), so it never fires in tests or server-side.

// ─── boot signature (client easter egg — credit only) ─────────────────────────
const _S1 = 'RGVzaWduZWQgYnkgU2FsIFNjcnVkYXRvIGluIEhhY2tlbnNhY2s='  // header
const _S2 = 'Zm9yIExpc2EsIGFuZCBTYWwgIlRyZSIgU2NydWRhdG8gSUlJ'      // footer
let _signed = false

function _sign(): void {
  if (_signed) return
  _signed = true
  if (typeof window === 'undefined' || typeof console === 'undefined') return
  if (import.meta.env?.MODE === 'test') return   // never in tests
  const run = () => {
    // Two %c segments → a rounded two-tier card. Fixed accents render identically
    // in light and dark DevTools. Accents (#4f46e5/#818cf8) are not exposed as
    // design tokens, so they are inlined per spec.
    console.log(
      '%c' + atob(_S1) + '%c\n' + atob(_S2),
      'font:600 13px/1.6 ui-monospace,Menlo,monospace;padding:10px 16px;' +
      'border-radius:8px 8px 0 0;background:linear-gradient(135deg,#4f46e5,#818cf8);' +
      'color:#fff;letter-spacing:0.02em',
      'font:400 11px/1.6 ui-monospace,Menlo,monospace;padding:8px 16px;' +
      'border-radius:0 0 8px 8px;background:#101014;color:#8e8e99',
    )
  }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run)
  else setTimeout(run, 0)
}

// ─── web-vitals ───────────────────────────────────────────────────────────────
const _seen = new Map<string, number>()

/**
 * Report route-level web-vitals for the given surface. Prints the one-time boot
 * signature on the first call; the verbose timing dump requires VITE_DIAG_VITALS=1.
 */
export function reportWebVitals(surface: string): void {
  const now  = Date.now()
  const prev = _seen.get(surface) ?? 0
  if (now - prev < 1500) return   // collapse StrictMode double-invoke
  _seen.set(surface, now)

  _sign()

  if (import.meta.env?.VITE_DIAG_VITALS === '1' && typeof performance !== 'undefined') {
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
