// Logo — the Product Reinvention Hub mark: signal sources converging on a bright
// central core (the product manager at the centre of the app's insight graph).
// Balanced radial convergence + glassy sheen + core glow; legible from 16px up.
import { useId } from 'react'

// Sources feeding the hub, with the curve control point that bends each into the core.
const STREAMS = [
  { x: 6,  y: 8,  cx: 11, cy: 11 },
  { x: 5,  y: 16, cx: 10, cy: 16 },
  { x: 6,  y: 24, cx: 11, cy: 21 },
  { x: 26, y: 9,  cx: 21, cy: 12 },
  { x: 26, y: 23, cx: 21, cy: 20 },
]

export function Logo({ size = 28, className = '', rounded = 8 }: { size?: number; className?: string; rounded?: number }) {
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} role="img" aria-label="Product Reinvention Hub">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A100FF" /><stop offset="0.5" stopColor="#8B1FE0" /><stop offset="1" stopColor="#6D28D9" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.26" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-core`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.55" /><stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="32" height="32" rx={rounded} fill={`url(#${id}-bg)`} />
      <rect width="32" height="32" rx={rounded} fill={`url(#${id}-sheen)`} />

      {/* Streams converging on the core, with a source node at each far end */}
      <g stroke="#fff" strokeLinecap="round" fill="none">
        {STREAMS.map((s, i) => (
          <path key={i} d={`M${s.x} ${s.y} Q${s.cx} ${s.cy} 16 16`} strokeWidth="1.6" opacity="0.85" />
        ))}
      </g>
      <g fill="#fff">
        {STREAMS.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r="1.15" opacity="0.75" />)}
      </g>

      {/* Core */}
      <circle cx="16" cy="16" r="7" fill={`url(#${id}-core)`} />
      <circle cx="16" cy="16" r="3.6" fill="#fff" />
    </svg>
  )
}
