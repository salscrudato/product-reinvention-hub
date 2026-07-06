// ratingFlow.tsx — bespoke, animated SVG of a rating algorithm's step-by-step
// trace: a vertical spine of operation cards (SET/MUL/ADD/MIN_FLOOR), each citing
// its source refId, flowing into the final premium. Renders as a real <svg> so it
// scales crisply and exports cleanly (parent serialises the node). Palette is a
// single local map (SVG exports can't resolve CSS vars) mirroring the brand tokens.
// When inputs change, the affected step cards flash a soft accent halo (`changedStepIds`),
// so the link between an input and the premium reads instantly — reduced-motion safe.
import type { TraceEntry } from '@pf/shared'

const OP: Record<string, { color: string; tint: string; sign: string }> = {
  SET:       { color: '#2563EB', tint: 'rgba(37,99,235,.10)',  sign: 'SET' },
  MUL:       { color: '#8B1FE0', tint: 'rgba(139,31,224,.10)', sign: '×' },
  ADD:       { color: '#059669', tint: 'rgba(5,150,105,.10)',  sign: '+' },
  MIN_FLOOR: { color: '#B45309', tint: 'rgba(180,83,9,.10)',   sign: '≥' },
}

const ACCENT = '#8B1FE0'
const MONO = 'JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace'

function opValue(t: TraceEntry): string {
  switch (t.op) {
    case 'MUL':       return `× ${t.factorOrAmount}`
    case 'ADD':       return `+ $${t.factorOrAmount.toFixed(2)}`
    case 'SET':       return `$${t.factorOrAmount}`
    default:          return `≥ $${t.factorOrAmount}`
  }
}

interface RatingFlowProps {
  trace: TraceEntry[]
  finalPremium: number
  animate?: boolean
  /** Step ids whose value moved since the last input change — flashed with an accent halo. */
  changedStepIds?: Set<string>
  /** Number shown in the final node (e.g. a count-up value); defaults to finalPremium.
   *  Kept separate so animating the display doesn't re-key the halo every frame. */
  displayPremium?: number
}

/** Vertical rating-flow diagram. Width is fixed (360) — the SVG scales to its box. */
export function RatingFlow({ trace, finalPremium, animate = true, changedStepIds, displayPremium }: RatingFlowProps) {
  const W = 360, PAD = 14, CARD_H = 50, GAP = 14, CARD_W = W - PAD * 2
  const steps = trace.filter(t => t.op !== 'MIN_FLOOR') // floor is represented by the final node
  const FINAL_H = 60
  const stepTop = (i: number) => PAD + i * (CARD_H + GAP)
  const finalY = stepTop(steps.length)
  const H = finalY + FINAL_H + PAD
  const finalChanged = changedStepIds?.has('s11') || changedStepIds?.has('__final__')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, height: 'auto', display: 'block', margin: '0 auto' }}
      role="img" aria-label={`Rating flow: ${steps.length} steps resolving to a final premium of $${finalPremium.toLocaleString()}.`}>
      <defs>
        <linearGradient id="rf-final" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#A100FF" /><stop offset="100%" stopColor="#7A00E6" />
        </linearGradient>
      </defs>

      {/* Connectors between steps (drawn under the cards) */}
      {steps.map((t, i) => {
        const y1 = stepTop(i) + CARD_H, y2 = (i < steps.length - 1 ? stepTop(i + 1) : finalY)
        const col = OP[t.op]?.color ?? '#8E90A0'
        return <line key={`c${i}`} x1={W / 2} y1={y1} x2={W / 2} y2={y2} stroke={col} strokeOpacity={0.35} strokeWidth={2} strokeLinecap="round" />
      })}

      {/* Step cards */}
      {steps.map((t, i) => {
        const y = stepTop(i)
        const op = OP[t.op] ?? { color: '#8E90A0', tint: 'rgba(142,144,160,.10)', sign: t.op }
        const changed = changedStepIds?.has(t.stepId) ?? false
        return (
          <g key={t.stepId} className={animate ? 'flow-step' : undefined} style={{ '--step-delay': `${i * 70}ms` } as React.CSSProperties}>
            {/* Changed halo — keyed by running total so it re-triggers on each move */}
            {changed && (
              <rect key={`halo-${t.runningTotal}`} className="flow-pulse" x={PAD - 3} y={y - 3} width={CARD_W + 6} height={CARD_H + 6} rx={14} fill={ACCENT} />
            )}
            <rect x={PAD} y={y} width={CARD_W} height={CARD_H} rx={12} fill="#fff"
              stroke={changed ? ACCENT : 'rgba(19,19,26,.08)'} strokeWidth={changed ? 1.5 : 1} />
            {/* op accent bar */}
            <rect x={PAD} y={y + 8} width={4} height={CARD_H - 16} rx={2} fill={op.color} />
            {/* op badge */}
            <rect x={PAD + 12} y={y + CARD_H / 2 - 9} width={30} height={18} rx={5} fill={op.tint} />
            <text x={PAD + 27} y={y + CARD_H / 2 + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={op.color} style={{ fontFamily: MONO }}>{op.sign}</text>
            {/* label + source ref (traceability) */}
            <text x={PAD + 52} y={y + 20} fontSize={10.5} fontWeight={600} fill="#131318">{t.label.length > 30 ? t.label.slice(0, 29) + '…' : t.label}</text>
            <text x={PAD + 52} y={y + 34} fontSize={8.5} fill="#8E90A0" style={{ fontFamily: MONO }}>{t.sourceRef} · {opValue(t)}</text>
            {/* running total */}
            <text x={PAD + CARD_W - 12} y={y + CARD_H / 2 + 4} textAnchor="end" fontSize={13} fontWeight={700} fill={changed ? ACCENT : '#131318'} style={{ fontFamily: MONO }}>
              ${t.runningTotal.toLocaleString(undefined, { minimumFractionDigits: t.rounded ? 0 : 2, maximumFractionDigits: 2 })}
            </text>
          </g>
        )
      })}

      {/* Final premium node */}
      <g className={animate ? 'flow-step' : undefined} style={{ '--step-delay': `${steps.length * 70}ms` } as React.CSSProperties}>
        {finalChanged && (
          <rect key={`halo-final-${finalPremium}`} className="flow-pulse" x={PAD - 3} y={finalY - 3} width={CARD_W + 6} height={FINAL_H + 6} rx={16} fill={ACCENT} />
        )}
        <rect x={PAD} y={finalY} width={CARD_W} height={FINAL_H} rx={14} fill="url(#rf-final)"
          style={{ filter: 'drop-shadow(0 8px 20px rgba(139,31,224,.28))' }} />
        <text x={PAD + 18} y={finalY + 26} fontSize={11} fontWeight={600} fill="rgba(255,255,255,.9)">Final premium</text>
        <text x={PAD + 18} y={finalY + 44} fontSize={9} fill="rgba(255,255,255,.7)" style={{ fontFamily: MONO }}>MAX(running, minimum) · round 0</text>
        <text x={PAD + CARD_W - 18} y={finalY + FINAL_H / 2 + 8} textAnchor="end" fontSize={26} fontWeight={800} fill="#fff" style={{ fontFamily: MONO }}>
          ${(displayPremium ?? finalPremium).toLocaleString()}
        </text>
      </g>
    </svg>
  )
}
