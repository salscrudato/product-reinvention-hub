// Logo — the Product Reinvention Hub brand mark: "Greater Ascent".
//
// A play on the Accenture greater-than: a bold `>` chevron tipped into an upward
// ascent — the forward/"greater" vector — aimed at a crescent moon in the corner.
// The quiet twist is a rocket to the moon: the chevron reads as a thrust vector /
// vapour trail climbing toward its destination. Confident, modern, Apple-restrained.
//
// The mark is a transparent glyph — no container, no plate behind it — so it sits
// cleanly on any surface, light or dark. Colour is token-driven: the chevron stroke
// and the moon share one gradient sampled from the brand violet
// (bright → accent → strong), so the mark restyles with the palette. Standalone
// assets in app/src/brand/ and /public carry the literal hex as the canonical
// definition; the .png OS icons are generated from those.

// Optical grid: 32-unit box. A bold greater-than (arm length 12, stroke 3.5) leaning
// ~22° into liftoff, its vertex at (17.6, 15.4); a crescent moon (r 3.15) resting in
// the upper-right corner, its opening cradling the incoming ascent.
import { useId } from 'react'

const CHEVRON = 'M5.69 13.94L17.6 15.4L10.05 24.73'
const MOON = 'M21.4 6.44A3.15 3.15 0 1 0 25.83 10.21A3 3 0 0 1 21.4 6.44Z'

export function Logo({ size = 28, className = '' }: { size?: number; className?: string }) {
  // Per-instance id: multiple marks can share a page, so the gradient ref must be unique.
  const gid = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="img" aria-label="Product Reinvention Hub">
      <defs>
        <linearGradient id={gid} x1="4" y1="6" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--color-accent-bright)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--color-accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-accent-strong)' }} />
        </linearGradient>
      </defs>
      <path d={MOON} fill={`url(#${gid})`} />
      <path d={CHEVRON} fill="none" stroke={`url(#${gid})`} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
