// PageHero — the standard page banner: a soft gradient panel with a corner glow, a
// bespoke animated hero glyph, the page name, an optional subtitle/stat line, and a
// right-aligned action slot. Mirrors the product-workspace hero so every top-level
// surface reads as one system. Colour + gradient are token-only.
import type { ReactNode } from 'react'
import { HeroGlyph, type HeroGlyphName } from './heroGlyphs'

export function PageHero({ glyph, title, subtitle, stats, actions }: {
  glyph:     HeroGlyphName
  title:     string
  subtitle?: ReactNode
  stats?:    ReactNode
  actions?:  ReactNode
}) {
  return (
    <div className="rounded-[16px] p-5 sm:p-6 relative overflow-hidden" style={{ background: 'var(--gradient-hero)', border: '1px solid var(--color-border)' }}>
      {/* Corner glow */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute -top-20 -right-16 w-56 h-56 rounded-full blur-3xl opacity-30"
          style={{ background: 'radial-gradient(circle, var(--color-accent), var(--color-accent-strong))' }} />
      </div>

      <div className="relative flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 min-w-0">
          <HeroGlyph name={glyph} size={56} className="hero-bob-slow" />
          <div className="flex flex-col gap-1 min-w-0">
            <h1 className="text-2xl font-bold text-text leading-tight tracking-[-0.01em]">{title}</h1>
            {subtitle && <p className="text-sm text-dim">{subtitle}</p>}
            {stats}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
      </div>
    </div>
  )
}
