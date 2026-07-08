// Logo — the Product Reinvention Hub brand mark: "Composed Stack".
//
// Three precisely aligned plates descending through the brand violet: the composed,
// versioned parts of a product (coverages, forms, rules, rating) stacked into one
// governed whole. Layers = composition + versioning; the shared centre axis = precision
// and governance. Flat, calm, Apple-restrained.
//
// The mark is a transparent glyph — no container, no fill behind it — so it sits cleanly
// on any surface, light or dark. Colour is token-driven (var(--color-accent-*)) so it
// restyles with the palette; the three tones sample the brand gradient (bright → accent
// → strong). Standalone assets in app/src/brand/ and /public carry the literal hex as the
// canonical definition; the .png OS icons are generated from those.

// Optical grid: 32-unit box, centre (16,16). Three isometric plates (2.2:1), gently
// rounded corners, stacked on the centre axis with even 1.2-unit gaps.
const TOP = 'M17.27 5.78 21.73 7.82Q23 8.4 21.73 8.98L17.27 11.02Q16 11.6 14.73 11.02L10.27 8.98Q9 8.4 10.27 7.82L14.73 5.78Q16 5.2 17.27 5.78Z'
const MID = 'M17.27 13.38 21.73 15.42Q23 16 21.73 16.58L17.27 18.62Q16 19.2 14.73 18.62L10.27 16.58Q9 16 10.27 15.42L14.73 13.38Q16 12.8 17.27 13.38Z'
const BOT = 'M17.27 20.98 21.73 23.02Q23 23.6 21.73 24.18L17.27 26.22Q16 26.8 14.73 26.22L10.27 24.18Q9 23.6 10.27 23.02L14.73 20.98Q16 20.4 17.27 20.98Z'

export function Logo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="img" aria-label="Product Reinvention Hub">
      <path d={TOP} style={{ fill: 'var(--color-accent-bright)' }} />
      <path d={MID} style={{ fill: 'var(--color-accent)' }} />
      <path d={BOT} style={{ fill: 'var(--color-accent-strong)' }} />
    </svg>
  )
}
