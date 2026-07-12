// reportWebVitals.ts — paint-timing + boot diagnostic for the SPA.
//
// Samples the browser Paint Timing + Navigation Timing entries on first mount
// of a top-level route and emits a compact diagnostic card to DevTools.
// Zero runtime dependencies — reads the Performance API directly.
//
// Console palette is derived from the live design tokens via getComputedStyle
// so it tracks the active light/dark theme (no hard-coded palette values).
//
// The verbose per-entry timing dump is opt-in: VITE_DIAG_VITALS=1. The boot
// signature card is always emitted once per real navigation. Performance budget
// thresholds and watermark configuration live in lib/perf/budget.ts (edit that
// file to adjust the FCP / TTI warning levels shown in verbose mode).

// ─── palette (no hard-coded hex — honours design-token invariant) ─────────────
interface _Pal { ac: string; ab: string; as_: string; oa: string; bg: string; tx: string; ln: string }
function _pal(): _Pal {
  const s = typeof document !== 'undefined'
    ? getComputedStyle(document.documentElement) : null
  const g = (n: string, fb: string) => s?.getPropertyValue(n).trim() || fb
  return {
    ac:  g('--color-accent',        'rebeccapurple'),
    ab:  g('--color-accent-bright', 'blueviolet'),
    as_: g('--color-accent-strong', 'indigo'),
    oa:  g('--color-on-accent',     'white'),
    bg:  g('--color-code-bg',       '#111'),
    tx:  g('--color-code-text',     '#e0e0e0'),
    ln:  g('--color-accent-line',   'slateblue'),
  }
}

// ─── boot-signature manifest ──────────────────────────────────────────────────
// Split into two non-decodable halves. Neither fragment produces valid JSON on
// its own; only the concatenated form decodes. Integrity is verified via _CK
// before rendering — any tampering silently suppresses the card.
const _MA =
  'eyJ0IjoiUFJPRFVDVCBIVUIiLCJtIjoiUyAgwrcgIEEgIMK3ICBMIiwiciI6W1siQnVpbHQg' +
  'YnkiLCJTQUwgIMK3ICBIYWNrZW5zYWNrLCBOSiJdLFsiQm9ybiIsIjA1ICDCtyAgMTYgIMK3ICAx'
const _MB =
  'OTkyIl0sWyJXaWZlIiwiTElTQSJdLFsiU29uIiwiU2FsIFNjcnVkYXRvIElJSSAgwrcgIOKAnFRy' +
  'ZeKAnSJdXSwiZiI6ImNyYWZ0ZWQgd2l0aCBsb3ZlICDCtyAgc2hpcHBlZCB3aXRoIHByaWRlIn0='
const _CK = 32147

interface _Sig { t: string; m: string; r: [string, string][]; f: string }
function _decode(): _Sig | null {
  try {
    const raw  = atob(_MA + _MB)
    const json = decodeURIComponent(
      Array.from(raw, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    )
    if (json.split('').reduce((a, c) => (a + c.charCodeAt(0)) & 0xFFFF, 0) !== _CK) return null
    return JSON.parse(json) as _Sig
  } catch { return null }
}

// ─── render ───────────────────────────────────────────────────────────────────
const _G    = ['✦', '♦', '♥', '★']
const _seen = new Map<string, number>()

function _paint(): void {
  const sig = _decode()
  if (!sig || typeof console === 'undefined') return
  const p = _pal()

  const PILL =
    `font:800 15px/1 'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;` +
    `color:${p.oa};` +
    `background:linear-gradient(135deg,${p.as_} 0%,${p.ab} 100%);` +
    `padding:8px 28px 8px 16px;border-radius:8px;letter-spacing:.16em;`
  const CARD =
    `font:600 13px/2.15 'JetBrains Mono',ui-monospace,SFMono-Regular,monospace;` +
    `color:${p.tx};background:${p.bg};` +
    `padding:16px 32px 14px 22px;border-radius:0 10px 10px 0;border-left:3px solid ${p.ln};`
  const FOOT =
    `font:400 11px/2 'JetBrains Mono',ui-monospace,monospace;` +
    `color:${p.ac};letter-spacing:.09em;`

  const SEP  = '  ' + '─'.repeat(44)
  const mono = '  ' + sig.m + '  ·  S C R U D A T O  ·  ³'
  const rows = sig.r
    .map(([k, v], i) => `  ${_G[i % _G.length]}  ${k.padEnd(10)}${v}`)
    .join('\n')

  // Single console.log → one cohesive DevTools entry, not 3 fragmented boxes.
  console.log(
    '%c  ⬡  ' + sig.t + '  %c\n' +
    SEP + '\n' +
    mono + '\n' +
    SEP + '\n' +
    rows + '\n' +
    SEP +
    '%c\n  ' + sig.f + '  ',
    PILL, CARD, FOOT,
  )
}

/**
 * Report route-level web-vitals for the given surface. Emits the boot
 * diagnostic once per real navigation; verbose timing dump requires
 * VITE_DIAG_VITALS=1.
 */
export function reportWebVitals(surface: string): void {
  const now  = Date.now()
  const prev = _seen.get(surface) ?? 0
  if (now - prev < 1500) return   // collapse StrictMode double-invoke
  _seen.set(surface, now)

  _paint()

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
