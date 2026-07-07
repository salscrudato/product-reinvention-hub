// HeroMark — the floating brand mark above the portfolio assistant. A crisp, modern,
// techy "product manager": a clean avatar silhouette in the accent gradient with a
// sharp white rim light, wrapped by one precise tilted data-orbit (a thin ring + node
// that slowly rotates), with a crisp sparkle accent. No fuzzy halo — depth comes from a
// tight drop-shadow, so every edge stays sharp. The whole mark gives a lively little
// bounce. Pure inline SVG + design tokens (pure-white highlights only). Motion
// auto-stills under prefers-reduced-motion (global rule in index.css). aria-hidden.
export function HeroMark({ size = 88 }: { size?: number }) {
  return (
    <div
      className="hero-mark relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"
        style={{ filter: 'drop-shadow(0 8px 16px var(--glow-accent))', overflow: 'visible' }}>
        <defs>
          <linearGradient id="hm-body" x1="26" y1="16" x2="74" y2="94" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--color-accent-bright)" />
            <stop offset="1" stopColor="var(--color-accent-strong)" />
          </linearGradient>
          <radialGradient id="hm-spark" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Tilted data-orbit — one crisp thin ring + a single node, slowly rotating.
            The invisible circle anchors the group's box on (50,50) for a centred spin. */}
        <g className="hero-mark__orbit">
          <circle cx="50" cy="50" r="41" fill="none" stroke="none" />
          <g transform="rotate(-24 50 50)">
            <ellipse cx="50" cy="53" rx="41" ry="12.5" fill="none" stroke="var(--color-accent-bright)" strokeOpacity="0.55" strokeWidth="1.5" />
            <circle cx="91" cy="53" r="2.6" fill="var(--color-accent-bright)" />
            <circle cx="9" cy="53" r="1.6" fill="var(--color-accent)" />
          </g>
        </g>

        {/* The PM figure — crisp avatar: shoulders + head with a sharp rim light */}
        <path d="M26 89 C26 66 74 66 74 89 Z" fill="url(#hm-body)" />
        <circle cx="50" cy="34" r="13.5" fill="url(#hm-body)" />
        {/* Sharp top-left rim highlight on the head */}
        <path d="M40.5 25 A13.5 13.5 0 0 1 58 24.2" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        {/* Crisp shoulder highlight */}
        <path d="M31 82 C33 71 45 68 50 68" stroke="#FFFFFF" strokeOpacity="0.28" strokeWidth="1.5" fill="none" strokeLinecap="round" />

        {/* Crisp 4-point sparkle */}
        <circle className="hero-mark__spark" cx="73" cy="18" r="7" fill="url(#hm-spark)" opacity="0.8" />
        <path className="hero-mark__spark" d="M73 11 L75 16 L80 18 L75 20 L73 25 L71 20 L66 18 L71 16 Z" fill="#FFFFFF" />
      </svg>
    </div>
  )
}
