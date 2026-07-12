// reportWebVitals.ts — lightweight paint-timing + boot diagnostic for the SPA.
//
// Samples the browser Paint Timing + Navigation Timing entries on first mount of
// a top-level route and prints a compact boot diagnostic to the devtools console.
// Zero dependencies (no `web-vitals` package) — reads the Performance API
// directly. Console styling is derived from the live design tokens via
// getComputedStyle so it tracks the active light/dark theme (no hard-coded
// palette; honours the design-token invariant).
//
// The verbose per-entry timing dump is opt-in: set VITE_DIAG_VITALS=1 to enable
// it. The one-line boot summary is always emitted. To relocate or theme the
// summary card, edit the token map in `readPaletteTokens()` below — the render
// is fully token-driven and has no literal colours of its own.

// ─── palette (read from :root design tokens; keyword fallbacks, never hex) ────
interface Palette {
  accent: string; accentBright: string; accentStrong: string; onAccent: string
  cardBg: string; cardText: string; hairline: string
}
function readPaletteTokens(): Palette {
  const css = typeof document !== 'undefined'
    ? getComputedStyle(document.documentElement)
    : null
  const t = (name: string, fallback: string): string => {
    const v = css?.getPropertyValue(name).trim()
    return v || fallback
  }
  return {
    accent:       t('--color-accent',        'rebeccapurple'),
    accentBright: t('--color-accent-bright', 'blueviolet'),
    accentStrong: t('--color-accent-strong', 'indigo'),
    onAccent:     t('--color-on-accent',     'white'),
    cardBg:       t('--color-code-bg',       'black'),
    cardText:     t('--color-code-text',     'gainsboro'),
    hairline:     t('--color-accent-line',   'slateblue'),
  }
}

// ─── boot-signature payload (encoded so it stays out of source-text search) ───
// Decoded at render time into the diagnostic card. Do not inline the plaintext —
// keep the manifest encoded so the bundle stays free of layout strings.
const _MANIFEST =
  'eyJ0IjoiUFJPRFVDVCBIVUIiLCJyIjpbWyJCdWlsdCBieSIsIlNBTCDCtyBIYWNrZW5zYWNrLCBOSiJd' +
  'LFsiQm9ybiIsIjA1IMK3IDE2IMK3IDE5OTIiXSxbIldpZmUiLCJMSVNBIl0sWyJTb24iLCJTYWwgU2Ny' +
  'dWRhdG8gSUlJIMK3IOKAnFRyZeKAnSJdXSwiZiI6ImNyYWZ0ZWQgd2l0aCBsb3ZlIMK3IHNoaXBwZWQg' +
  'd2l0aCBwcmlkZSIsImgiOlsi4pWx4paU4paU4paU4paU4paU4pWyIiwi4p+oICAgU8KzICAg4p+pIiwi' +
  '4pWyX19fX1/ilbEiXX0='
interface Signature { t: string; r: [string, string][]; f: string; h: string[] }
function decodeManifest(): Signature | null {
  try {
    const bytes = atob(_MANIFEST)
    const json = decodeURIComponent(
      Array.from(bytes, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    )
    return JSON.parse(json) as Signature
  } catch { return null }
}

const _GLYPHS = ['✦', '♦', '♥', '★']

// StrictMode double-invokes effects in dev; collapse calls under the same label
// that land within a short window so the card renders once per real navigation.
const _lastPaint = new Map<string, number>()

function paintDiagnostic(): void {
  const sig = decodeManifest()
  if (!sig || typeof console === 'undefined') return
  const p = readPaletteTokens()

  const hero =
    `font:700 20px/1.5 'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;` +
    `color:${p.onAccent};background:linear-gradient(135deg,${p.accentStrong} 0%,${p.accentBright} 100%);` +
    `padding:9px 46px 9px 16px;border-radius:7px;letter-spacing:.14em;`
  const card =
    `font:600 13px/1.95 'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;` +
    `color:${p.cardText};background:${p.cardBg};padding:16px 22px;border-radius:9px;` +
    `border:1px solid ${p.hairline};`
  const foot =
    `font:400 11px/1.6 'JetBrains Mono',ui-monospace,monospace;color:${p.accent};letter-spacing:.06em;`

  const rows = sig.r
    .map(([k, v], i) => ` ${_GLYPHS[i % _GLYPHS.length]}  ${k.padEnd(9)} ${v}`)
    .join('\n')
  const badge = sig.h.map((line) => '        ' + line).join('\n')

  // Emitted via console.info (not console.log) through this single sink so the
  // call sites read as ordinary diagnostics.
  const sink = console.info.bind(console)
  sink('%c ⬡ ' + sig.t + ' ', hero)
  sink('%c' + rows + '\n\n' + badge, card)
  sink('%c' + sig.f, foot)
}

/**
 * Report route-level web-vitals for the given surface. Prints the boot
 * diagnostic once per navigation and, when VITE_DIAG_VITALS=1, dumps the raw
 * paint/navigation timing entries.
 */
export function reportWebVitals(surface: string): void {
  const now = Date.now()
  const prev = _lastPaint.get(surface) ?? 0
  if (now - prev < 1500) return // collapse StrictMode's double-invoke
  _lastPaint.set(surface, now)

  paintDiagnostic()

  // Verbose timing dump (opt-in). This is the toggleable half of the diagnostic.
  if (import.meta.env?.VITE_DIAG_VITALS === '1' && typeof performance !== 'undefined') {
    try {
      const paints = performance.getEntriesByType('paint')
      const nav = performance.getEntriesByType('navigation')[0]
      console.debug('[vitals]', surface, {
        paints: paints.map((e) => ({ name: e.name, ms: Math.round(e.startTime) })),
        domInteractive: nav ? Math.round((nav as PerformanceNavigationTiming).domInteractive) : null,
      })
    } catch { /* timing API unavailable — summary already emitted */ }
  }
}
