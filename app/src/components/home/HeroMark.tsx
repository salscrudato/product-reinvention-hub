// HeroMark — the floating brand mark above the portfolio assistant. It renders the core
// idea: a Product Manager as the single source of truth that absorbs all the scattered,
// abstract context. A gradient PM node (person in a purple disc) sits inside a slowly
// rotating dashed "field" ring, while dashed context-arrows stream IN from the left and
// converge on it (dashes flow inward). The whole mark gently floats. Pure inline SVG +
// design tokens (white highlights only); motion auto-stills under prefers-reduced-motion.
export function HeroMark({ size = 108 }: { size?: number }) {
  // 5 context streams converging on the node's left side; staggered so the inflow shimmers.
  const streams = [
    'M6 16 Q46 20 58 46',
    'M4 33 Q44 34 57 50',
    'M4 52 L57 52',
    'M4 71 Q44 70 57 54',
    'M6 88 Q46 84 58 58',
  ]
  return (
    <div
      className="hero-mark relative inline-flex items-center justify-center"
      style={{ width: size, height: Math.round(size * 0.86) }}
      aria-hidden="true"
    >
      <svg width={size} height={Math.round(size * 0.86)} viewBox="0 0 124 104" fill="none" xmlns="http://www.w3.org/2000/svg"
        style={{ filter: 'drop-shadow(0 10px 22px var(--glow-accent))', overflow: 'visible' }}>
        <defs>
          <linearGradient id="hm-node" x1="60" y1="30" x2="104" y2="76" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--color-accent-bright)" />
            <stop offset="1" stopColor="var(--color-accent-strong)" />
          </linearGradient>
          <marker id="hm-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M1 1 L6.5 4 L1 7 Z" fill="var(--color-accent)" />
          </marker>
        </defs>

        {/* Context streams flowing IN and converging on the node */}
        <g fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round"
          strokeDasharray="2 5" markerEnd="url(#hm-arrow)">
          {streams.map((d, i) => (
            <path key={i} className="hero-flow" d={d} style={{ animationDelay: `${i * -0.22}s` }} />
          ))}
        </g>

        {/* Rotating dashed "field" ring around the node */}
        <circle className="hero-mark__orbit" cx="84" cy="52" r="30" fill="none"
          stroke="var(--color-accent-bright)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="1.5 6.5" strokeLinecap="round" />

        {/* The PM node — single source of truth */}
        <circle cx="84" cy="52" r="23" fill="url(#hm-node)" />
        <circle cx="84.6" cy="52.6" r="22.4" fill="none" stroke="#FFFFFF" strokeOpacity="0.28" strokeWidth="1.25" />
        {/* Person */}
        <circle cx="84" cy="45.5" r="6.6" fill="#FFFFFF" />
        <path d="M72.5 66 C72.5 55 95.5 55 95.5 66 Z" fill="#FFFFFF" />
        {/* Sharp top-left rim light */}
        <path d="M69 44 A23 23 0 0 1 84 29.5" stroke="#FFFFFF" strokeOpacity="0.4" strokeWidth="1.25" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  )
}
