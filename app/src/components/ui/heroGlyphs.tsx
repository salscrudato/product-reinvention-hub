// heroGlyphs — the page-hero "app icon" family. Each surface (Products + every product
// tab) gets a bespoke, unique line-art symbol on an Apple-style accent squircle with a
// soft pulsing glow, a top sheen, and one tasteful micro-motion. Colour is token-only
// (the tile is the accent gradient; the symbol is white via currentColor); every
// animation is neutralised under prefers-reduced-motion by the global rule in index.css.
import type { ReactNode } from 'react'

export type HeroGlyphName = 'products' | 'overview' | 'coverages' | 'forms' | 'pricing' | 'states' | 'rules'

// Each glyph is drawn on a 24×24 grid, stroked in currentColor (white on the tile).
const GLYPHS: Record<HeroGlyphName, ReactNode> = {
  // Portfolio — a product "sheet" that gently lifts off a stack behind it.
  products: (
    <>
      <rect x="4" y="9" width="12" height="11" rx="2.4" opacity=".4" />
      <g className="hero-bob">
        <rect x="8" y="4" width="12" height="12" rx="2.6" />
        <path d="M11 8.5h6M11 11.5h4" opacity=".85" />
      </g>
    </>
  ),
  // Overview — a summary gauge with two hands and a slow pinging ring.
  overview: (
    <>
      <circle cx="12" cy="12" r="7.4" opacity=".55" />
      <path d="M12 12V6" />
      <path d="M12 12l4.3 2.6" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9.4" className="ring-glow" opacity=".5" />
    </>
  ),
  // Coverages — a protective shield with a pulsing check.
  coverages: (
    <>
      <path d="M12 3.5l6.5 2.4v5.3c0 4-2.8 6.8-6.5 8-3.7-1.2-6.5-4-6.5-8V5.9z" />
      <path className="shield-pulse" d="M9 12.2l2.1 2.1 4-4.4" />
    </>
  ),
  // Forms — a document with a folded corner; the third line keeps drawing in.
  forms: (
    <>
      <path d="M6.5 3.5h7L18 8v11.7a.8.8 0 0 1-.8.8H6.5a.8.8 0 0 1-.8-.8V4.3a.8.8 0 0 1 .8-.8z" />
      <path d="M13 3.7V8h4.5" opacity=".7" />
      <path d="M9 12h6" />
      <path className="hero-dash" d="M9 15.2h6" />
      <path d="M9 18.3h3.6" opacity=".7" />
    </>
  ),
  // Pricing — a coin; the currency mark rises and settles.
  pricing: (
    <>
      <circle cx="12" cy="12" r="8" />
      <g className="hero-rise">
        <path d="M12 7v10" />
        <path d="M14.4 9.1c-.6-.7-1.5-1.1-2.4-1.1-1.3 0-2.4.8-2.4 2 0 2.6 4.9 1.5 4.9 4.1 0 1.2-1.1 2-2.5 2-1 0-1.9-.4-2.5-1.1" />
      </g>
    </>
  ),
  // States — a location pin with an expanding ping ring.
  states: (
    <>
      <path d="M12 21c4-4.5 6.5-7.6 6.5-11A6.5 6.5 0 1 0 5.5 10c0 3.4 2.5 6.5 6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
      <circle cx="12" cy="10" r="4.6" className="ring-glow" opacity=".5" />
    </>
  ),
  // Rules — a decision node branching to two outcomes; the connectors flow.
  rules: (
    <>
      <circle cx="12" cy="5.6" r="2.3" />
      <circle cx="6.4" cy="17.6" r="2.3" />
      <circle cx="17.6" cy="17.6" r="2.3" />
      <path className="hero-dash" d="M11 7.6C8.6 10 7 12.4 6.6 15.2M13 7.6c2.4 2.4 4 4.8 4.4 7.6" />
    </>
  ),
}

export function HeroGlyph({ name, size = 56, className = '' }: { name: HeroGlyphName; size?: number; className?: string }) {
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      {/* Soft, slowly-pulsing glow behind the tile. */}
      <div className="absolute inset-0 rounded-[30%] hero-glow" style={{ background: 'var(--gradient-accent)', filter: 'blur(12px)' }} />
      {/* The app-icon tile: accent squircle + top sheen + white symbol. */}
      <div
        className="relative w-full h-full rounded-[30%] flex items-center justify-center overflow-hidden text-white ring-1 ring-inset ring-white/20"
        style={{ background: 'var(--gradient-accent-vivid)', boxShadow: '0 10px 24px -10px var(--glow-accent-strong)' }}
      >
        <span aria-hidden className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
        <svg
          width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="relative"
        >
          {GLYPHS[name]}
        </svg>
      </div>
    </div>
  )
}
