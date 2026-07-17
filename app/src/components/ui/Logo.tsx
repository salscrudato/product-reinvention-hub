// Logo — the Reinvention Engine brand mark: "Greater Ascent".
//
// A play on the Accenture greater-than: a bold `>` chevron leaning into liftoff,
// its tip aimed clearly at a crescent moon resting in the upper-right, with a soft
// vapour trail — the "mist" — streaming from behind the chevron down toward the
// lower-left. The quiet story is an ascent to the moon: the chevron is the thrust
// vector, the mist its wake, the moon its destination. Confident, modern,
// Apple-restrained.
//
// The mark is a transparent glyph — no container, no plate behind it — so it sits
// cleanly on any surface, light or dark. Colour is token-driven: the chevron stroke,
// the moon and the mist all sample one gradient from the electric-blue accent
// (bright → accent → strong), so the mark restyles with the palette. The mist adds a
// second gradient that fades to transparent along the wake. Standalone assets in
// app/src/brand/ and /public carry the literal hex as the canonical definition.
import { useId } from 'react'

// Optical grid: 32-unit box. A bold greater-than (stroke 3.3) leaning into liftoff,
// its vertex at (18.6, 14.2); a slim crescent moon sitting directly off the vertex's
// line of travel (upper-right) so the ascent points clearly at it, its opening
// cradling the incoming chevron; two mist wisps trailing off the open side.
const CHEVRON = 'M5.8 12L18.6 14.2L13.2 25.8'
const MOON = 'M23.68 7.71A3.15 3.15 0 1 0 28.11 11.48A3 3 0 0 1 23.68 7.71Z'
const MIST_A = 'M12.4 18.4Q7.7 20.2 4.4 23.5'
const MIST_B = 'M13.9 21.6Q9.6 23 6.4 26'

export function Logo({ size = 28, className = '' }: { size?: number; className?: string }) {
  // Per-instance id: multiple marks can share a page, so the gradient refs must be unique.
  const gid = useId()
  const mid = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="img" aria-label="The Reinvention Engine">
      <defs>
        <linearGradient id={gid} x1="4" y1="6" x2="26" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--color-accent-bright)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--color-accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--color-accent-strong)' }} />
        </linearGradient>
        {/* Mist gradient — visible where the wake leaves the chevron, fading to nothing
            at the tail (lower-left) so the trail dissolves rather than ending abruptly. */}
        <linearGradient id={mid} x1="13" y1="19" x2="4" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--color-accent-bright)' }} stopOpacity="0.5" />
          <stop offset="1" style={{ stopColor: 'var(--color-accent)' }} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Mist wake — drawn first so it sits behind the chevron */}
      <path d={MIST_A} fill="none" stroke={`url(#${mid})`} strokeWidth={1.25} strokeLinecap="round" />
      <path d={MIST_B} fill="none" stroke={`url(#${mid})`} strokeWidth={1} strokeLinecap="round" />
      <path d={MOON} fill={`url(#${gid})`} />
      <path d={CHEVRON} fill="none" stroke={`url(#${gid})`} strokeWidth={3.3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
