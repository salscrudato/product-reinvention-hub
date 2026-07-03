// Logo — the Product Reinvention Hub mark: a hub node with three connected
// satellites on the brand gradient tile. Echoes the landing product graph.
// Apple-inspired: geometric, balanced, legible from 16px up.
import { useId } from 'react'

export function Logo({ size = 28, className = '', rounded = 8 }: { size?: number; className?: string; rounded?: number }) {
  const gid = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} role="img" aria-label="Product Reinvention Hub">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9333EA" />
          <stop offset="0.55" stopColor="#C026D3" />
          <stop offset="1" stopColor="#DB2777" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx={rounded} fill={`url(#${gid})`} />
      <g stroke="#fff" strokeWidth="1.7" strokeLinecap="round" opacity="0.92">
        <line x1="16" y1="16" x2="16" y2="7.6" />
        <line x1="16" y1="16" x2="23.6" y2="20.4" />
        <line x1="16" y1="16" x2="8.4" y2="20.4" />
      </g>
      <g fill="#fff">
        <circle cx="16" cy="16" r="3.2" />
        <circle cx="16" cy="7" r="2.3" />
        <circle cx="23.9" cy="20.5" r="2.3" />
        <circle cx="8.1" cy="20.5" r="2.3" />
      </g>
    </svg>
  )
}
