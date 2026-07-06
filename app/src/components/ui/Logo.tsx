// Logo — the Product Reinvention Hub mark: three curved blades flowing inward to a
// luminous core. It embodies the app's spirit — every signal (coverages, rating, news,
// tasks, the copilot) converging on the product manager at the centre, with a rotational
// sweep that reads as continuous reinvention. Bespoke bezier blades on a violet gradient
// tile; the gradient fills the whole tile so no white shows beneath the mark. Legible 16px up.
import { useId } from 'react'

// One curved blade (a comma that fattens outward, tapering into the core), centred at the
// origin and pointing up; rotated 3× to form the converging pinwheel. Opacity steps down
// blade-to-blade so the sweep reads as motion, not a static fan.
const BLADE = 'M0 -4 C3.6 -4.8 5.6 -7.8 4.8 -11 C4.5 -12.1 3.2 -12.4 2.2 -11.6 C0.4 -10.2 -0.6 -7 0 -4 Z'
const BLADES = [{ rot: 0, op: 1 }, { rot: 120, op: 0.82 }, { rot: 240, op: 0.66 }]

export function Logo({ size = 28, className = '', rounded = 8 }: { size?: number; className?: string; rounded?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} role="img" aria-label="Product Reinvention Hub">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A100FF" /><stop offset="0.5" stopColor="#8B1FE0" /><stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="5" y1="3" x2="20" y2="26" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.22" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-core`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="55%" stopColor="#fff" /><stop offset="100%" stopColor="#fff" stopOpacity="0.85" />
        </radialGradient>
      </defs>

      <rect width="32" height="32" rx={rounded} fill={`url(#${id}-bg)`} />
      <rect width="32" height="32" rx={rounded} fill={`url(#${id}-sheen)`} />

      {/* Converging pinwheel + luminous core */}
      <g transform="translate(16 16)">
        {BLADES.map((b, i) => <path key={i} d={BLADE} fill="#fff" fillOpacity={b.op} transform={`rotate(${b.rot})`} />)}
        <circle r="2.7" fill={`url(#${id}-core)`} />
      </g>
    </svg>
  )
}
