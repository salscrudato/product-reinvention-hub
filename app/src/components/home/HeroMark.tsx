// HeroMark — the floating brand mark above the portfolio assistant. Not a block: a
// stylised, techy "product manager" figure — a clean avatar silhouette in the accent
// gradient, wrapped by a slowly-spinning data orbit (a gyroscopic tilted ring with two
// nodes) and topped by a pulsing "idea" spark, over a breathing glow. The whole mark
// gives a lively little bounce. Pure inline SVG + CSS custom properties (design tokens;
// pure-white highlights only). Motion auto-stills under prefers-reduced-motion via the
// global rule in index.css. Decorative → aria-hidden.
export function HeroMark({ size = 88 }: { size?: number }) {
  return (
    <div
      className="hero-mark relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"
        style={{ filter: 'drop-shadow(0 12px 26px var(--glow-accent))', overflow: 'visible' }}>
        <defs>
          {/* Figure body — three-stop diagonal for depth */}
          <linearGradient id="hm-person" x1="24" y1="18" x2="78" y2="92" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--color-accent-bright)" />
            <stop offset="0.55" stopColor="var(--color-accent)" />
            <stop offset="1" stopColor="var(--color-accent-strong)" />
          </linearGradient>
          {/* Soft luminous node/spark glow */}
          <radialGradient id="hm-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <filter id="hm-soft" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="3.6" />
          </filter>
        </defs>

        {/* Breathing halo */}
        <circle className="hero-mark__halo" cx="50" cy="54" r="33" fill="var(--color-accent-bright)" filter="url(#hm-soft)" />

        {/* Techy data orbit — a tilted ring + two nodes, slowly rotating like a gyroscope */}
        <g className="hero-mark__orbit">
          <g transform="rotate(-20 50 50)">
            <ellipse cx="50" cy="52" rx="42" ry="13" fill="none" stroke="#FFFFFF" strokeOpacity="0.22" strokeWidth="1.25" />
            <circle cx="92" cy="52" r="2.4" fill="#FFFFFF" />
            <circle cx="8" cy="52" r="1.8" fill="var(--color-accent-bright)" />
          </g>
        </g>

        {/* The PM figure — shoulders + head, gradient body with a soft rim highlight */}
        <path d="M24 90 C24 64 76 64 76 90 Z" fill="url(#hm-person)" />
        <circle cx="50" cy="35" r="14" fill="url(#hm-person)" />
        <ellipse cx="44.5" cy="30" rx="4" ry="5" fill="#FFFFFF" opacity="0.22" />
        <path d="M40 26 A14 14 0 0 1 60 26" stroke="#FFFFFF" strokeOpacity="0.3" strokeWidth="1.25" fill="none" strokeLinecap="round" />

        {/* Pulsing idea spark */}
        <circle className="hero-mark__spark" cx="70" cy="18" r="6" fill="url(#hm-glow)" />
        <circle cx="70" cy="18" r="2.2" fill="#FFFFFF" />
      </svg>
    </div>
  )
}
