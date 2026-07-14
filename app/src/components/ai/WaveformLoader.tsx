// WaveformLoader — the AI-inspired wait state for every grounded-answer stream.
// A compact horizontal sound wave of 6 bars in the token accent color: subtle
// amplitude motion while tokens stream (`active`), settling to rest when the
// stream completes. Pure CSS/SVG-free markup — six spans driven by the `wf-osc`
// keyframe in index.css; prefers-reduced-motion swaps to a calm static pulse
// (see the explicit .wf-bar override in the reduced-motion block).
//
// Sizes: 'xs' fits inside chips/buttons, 'sm' inline rows, 'md' block waits.

const SIZES = {
  xs: { h: 10, w: 2,   gap: 2 },
  sm: { h: 14, w: 2.5, gap: 3 },
  md: { h: 20, w: 3,   gap: 4 },
} as const

/** Per-bar rhythm: min amplitude, duration and phase offset. Staggered so the
 *  wave reads organic rather than metronomic. */
const BARS = [
  { min: 0.35, dur: 920,  delay: 0   },
  { min: 0.55, dur: 780,  delay: 120 },
  { min: 0.30, dur: 1040, delay: 240 },
  { min: 0.70, dur: 860,  delay: 60  },
  { min: 0.40, dur: 980,  delay: 300 },
  { min: 0.55, dur: 820,  delay: 180 },
] as const

export interface WaveformLoaderProps {
  /** True while tokens are streaming; false settles the bars to rest. */
  active?: boolean
  size?: keyof typeof SIZES
  /** Accessible label; empty string renders it purely decorative. */
  label?: string
  className?: string
}

export function WaveformLoader({ active = true, size = 'sm', label = 'Generating…', className = '' }: WaveformLoaderProps) {
  const s = SIZES[size]
  return (
    <span
      // Bars paint with currentColor so the wave adopts its context — accent in
      // chips and prose (`text-accent`), white inside filled accent buttons.
      className={`inline-flex items-center shrink-0 ${active ? '' : 'wf-rest'} ${className || 'text-accent'}`}
      style={{ gap: s.gap, height: s.h }}
      role={label ? 'status' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      {BARS.map((b, i) => (
        <span
          key={i}
          className="wf-bar rounded-full"
          style={{
            width: s.w,
            height: s.h,
            background: 'currentColor',
            ['--wf-min' as string]: String(b.min),
            ['--wf-dur' as string]: `${b.dur}ms`,
            ['--wf-delay' as string]: `${b.delay}ms`,
          }}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}
