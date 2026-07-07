// Logo — the Product Reinvention Hub mark. A luminous product core (the hub) with a
// single node tracing a tilted orbit around it: one clean gesture that reads as
// continuous reinvention (motion) resolving on a bright, focused centre. Bespoke on a
// violet gradient tile with a soft top sheen and an inner core-glow for premium depth.
// Fully self-contained and crisp from 16px up; the gradient fills the whole tile so no
// white shows beneath the mark. Mirrored byte-for-byte by /public/{favicon,icon}.svg.
import { useId } from 'react'

export function Logo({ size = 28, className = '', rounded = 8 }: { size?: number; className?: string; rounded?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} role="img" aria-label="Product Reinvention Hub">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A100FF" /><stop offset="0.5" stopColor="#8B1FE0" /><stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="4" y1="2" x2="20" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.24" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-core`} cx="0.5" cy="0.42" r="0.6">
          <stop offset="55%" stopColor="#fff" /><stop offset="100%" stopColor="#fff" stopOpacity="0.9" />
        </radialGradient>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" /><stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="32" height="32" rx={rounded} fill={`url(#${id}-bg)`} />
      <rect width="32" height="32" rx={rounded} fill={`url(#${id}-sheen)`} />

      {/* Tilted orbit + node, then the luminous hub core on top */}
      <g transform="translate(16 16)">
        <g transform="rotate(-24)">
          <ellipse rx="10.6" ry="5.5" fill="none" stroke="#fff" strokeOpacity="0.9" strokeWidth="1.9" />
          <circle cx="6.1" cy="-4.5" r="2.25" fill="#fff" />
        </g>
        <circle r="6.3" fill={`url(#${id}-glow)`} />
        <circle r="3.3" fill={`url(#${id}-core)`} />
      </g>
    </svg>
  )
}
