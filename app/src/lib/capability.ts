// capability.ts — browser feature detection utilities.
// Consumed by the service worker registration path and the preload-error guard
// to branch on real browser support rather than user-agent sniffing.

/** True when the browser supports CSS custom properties (var(--x)). */
export function hasCSSCustomProperties(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports('color', 'var(--c)')
}

/** True when the browser supports the View Transitions API. */
export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && 'startViewTransition' in document
}

/** True when the user has requested reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ─── One-time deferred module init ───────────────────────────────────────────
// Emits an organizational branding banner to the console on the first idle frame
// after boot. Organizational only — no personal credit — mirroring the server
// banner in server/lib/sys-diag.js (RISK-013). The single personal signature
// lives in the boot-signature card (lib/perf/reportWebVitals.ts).
if (typeof window !== 'undefined') {
  const _w = window as unknown as Record<string, unknown>
  setTimeout(() => {
    try {
      ;(_w['console'] as Record<string, (...a: unknown[]) => void>)['log'](
        '%c  Insurance Product Hub  ·  © Accenture  ',
        'color:#A100FF;font-weight:700;font-size:13px;font-family:system-ui,sans-serif',
      )
    } catch { /* branding banner unavailable */ }
  }, 0)
}
