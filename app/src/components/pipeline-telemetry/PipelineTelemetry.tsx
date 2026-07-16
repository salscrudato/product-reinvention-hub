// PipelineTelemetry — presentation-only pipeline stage visualization.
// Parents feed stage state through props (no fetching, no adapter calls, no I/O);
// the import surfaces own the SSE plumbing, marketing surfaces own nothing at all.
//
// Modes:
//   live    — nodes light in sequence as the parent updates statuses; the active
//             node pulses; per-stage model badge + running count under the node.
//   ambient — a subtle 12s autonomous loop for marketing surfaces; pausable;
//             renders a static completed state under prefers-reduced-motion.
//   compact — a horizontal mini strip for tight surfaces (dots + rail only).
//
// Custom SVG only, tokens only. Motion is transform/opacity on the spring band
// (--dur-2 + --ease-spring); the active pulse reuses the .viz-ring keyframe,
// which the global reduced-motion guard in index.css already neutralises.
//
// A11y: the visualization is one role="img" with an aria-label summarising the
// stage states ("Import pipeline: 3 of 6 stages complete, extracting"); every
// internal element is decorative (aria-hidden). The ambient pause control lives
// OUTSIDE the role="img" container — descendants of an img role are
// presentational, so an interactive child there would be unreachable.
import { useEffect, useState } from 'react'

export type PipelineStageStatus = 'pending' | 'active' | 'done' | 'error'

export interface PipelineStage {
  id: string
  label: string
  status: PipelineStageStatus
  /** Model deployment handling this stage (e.g. "haiku", "sonnet"). */
  modelBadge?: string
  /** Running counter under the node (e.g. "412 rows"). */
  count?: string
}

export type PipelineTelemetryMode = 'live' | 'ambient' | 'compact'

interface PipelineTelemetryProps {
  stages: PipelineStage[]
  mode: PipelineTelemetryMode
  /** Accessible name prefix for the summary label. */
  title?: string
}

const AMBIENT_LOOP_MS = 12_000

/** Reactively track prefers-reduced-motion (same pattern as AgentVisualizer). */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

function summaryLabel(title: string, stages: PipelineStage[]): string {
  const done = stages.filter((s) => s.status === 'done').length
  const active = stages.find((s) => s.status === 'active')
  const errored = stages.filter((s) => s.status === 'error')
  let label = `${title}: ${done} of ${stages.length} stages complete`
  if (active) label += `, ${active.label.toLowerCase()}`
  if (errored.length) label += `, error in ${errored.map((s) => s.label.toLowerCase()).join(', ')}`
  return label
}

// ─── Stage node glyph (custom SVG) ────────────────────────────────────────────

const nodeSpring = {
  transition: 'transform var(--dur-2) var(--ease-spring), opacity var(--dur-2) var(--ease-spring)',
} as const

function StageNode({ status, size, pulse }: { status: PipelineStageStatus; size: number; pulse: boolean }) {
  const c = size / 2
  const r = c - 3
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      {status === 'active' && pulse && (
        <circle className="viz-ring" cx={c} cy={c} r={r} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
      )}
      {status === 'pending' && (
        <circle cx={c} cy={c} r={r} fill="var(--color-raised)" stroke="var(--color-border-strong)" strokeWidth="1.5"
          style={{ ...nodeSpring, opacity: 0.9 }} />
      )}
      {status === 'active' && (
        <>
          <circle cx={c} cy={c} r={r} fill="var(--color-accent-soft)" stroke="var(--color-accent)" strokeWidth="1.5" style={nodeSpring} />
          <circle cx={c} cy={c} r={r * 0.38} fill="var(--color-accent)" style={nodeSpring} />
        </>
      )}
      {status === 'done' && (
        <>
          <circle cx={c} cy={c} r={r} fill="var(--color-good-soft)" stroke="var(--color-good-line)" strokeWidth="1.5" style={nodeSpring} />
          <path
            d={`M ${c - r * 0.42} ${c + r * 0.05} l ${r * 0.3} ${r * 0.32} l ${r * 0.55} ${-r * 0.62}`}
            fill="none" stroke="var(--color-good)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={nodeSpring}
          />
        </>
      )}
      {status === 'error' && (
        <>
          <circle cx={c} cy={c} r={r} fill="var(--color-danger-badge)" stroke="var(--color-danger-line)" strokeWidth="1.5" style={nodeSpring} />
          <path
            d={`M ${c - r * 0.35} ${c - r * 0.35} l ${r * 0.7} ${r * 0.7} M ${c + r * 0.35} ${c - r * 0.35} l ${-r * 0.7} ${r * 0.7}`}
            stroke="var(--color-danger)" strokeWidth="2" strokeLinecap="round" style={nodeSpring}
          />
        </>
      )}
    </svg>
  )
}

/** Rail segment between two nodes; lights up once the stage before it is done. */
function Rail({ lit, compact }: { lit: boolean; compact: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={compact ? 'w-4 shrink-0' : 'min-w-4 flex-1 self-start'}
      height={compact ? 12 : 28}
      style={!compact ? { marginTop: 0 } : undefined}
      preserveAspectRatio="none"
      viewBox="0 0 10 10"
    >
      <line x1="0" y1="5" x2="10" y2="5" stroke="var(--color-border-strong)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <line
        x1="0" y1="5" x2="10" y2="5"
        stroke="var(--color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke"
        style={{ opacity: lit ? 1 : 0, transition: 'opacity var(--dur-2) var(--ease-spring)' }}
      />
    </svg>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PipelineTelemetry({ stages, mode, title = 'Pipeline' }: PipelineTelemetryProps) {
  const reducedMotion = useReducedMotion()
  const [paused, setPaused] = useState(false)
  // Ambient tick: 0..n-1 = that stage is active, n = everything done (then wrap).
  const [tick, setTick] = useState(0)

  const ambient = mode === 'ambient'
  const compact = mode === 'compact'
  const animating = ambient && !paused && !reducedMotion && stages.length > 0

  useEffect(() => {
    if (!animating) return
    const stepMs = AMBIENT_LOOP_MS / (stages.length + 1)
    const id = window.setInterval(() => setTick((t) => (t + 1) % (stages.length + 1)), stepMs)
    return () => window.clearInterval(id)
  }, [animating, stages.length])

  const shown: PipelineStage[] = ambient
    ? stages.map((s, i) => ({
        ...s,
        status: reducedMotion || tick >= stages.length
          ? 'done'
          : i < tick ? 'done' : i === tick ? 'active' : 'pending',
      }))
    : stages

  const nodeSize = compact ? 14 : 28

  return (
    <div className={compact ? 'inline-flex items-center' : ''}>
      <div role="img" aria-label={summaryLabel(title, shown)} className={compact ? 'flex items-center' : 'flex items-start'}>
        {shown.map((stage, i) => (
          <div key={stage.id} aria-hidden="true" className={compact ? 'flex items-center' : 'flex flex-1 items-start'}>
            {i > 0 && <Rail lit={shown[i - 1].status === 'done'} compact={compact} />}
            {compact ? (
              <StageNode status={stage.status} size={nodeSize} pulse={!reducedMotion} />
            ) : (
              <div className="flex flex-col items-center gap-1" style={{ minWidth: 64 }}>
                <StageNode status={stage.status} size={nodeSize} pulse={!reducedMotion} />
                <span
                  className={`text-[11px] font-medium leading-tight text-center ${stage.status === 'active' ? 'text-text' : 'text-dim'}`}
                  style={nodeSpring}
                >
                  {stage.label}
                </span>
                {stage.modelBadge && (
                  <span className="font-mono text-[10px] font-medium leading-none px-1.5 py-0.5 rounded-[5px] bg-[var(--color-stage-warm-soft)] text-stage-warm">
                    {stage.modelBadge}
                  </span>
                )}
                {stage.count && (
                  <span className="text-[10px] tnum leading-none text-faint">{stage.count}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {ambient && !reducedMotion && (
        <button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
          className="mt-1 text-[11px] font-medium text-faint hover:text-dim focus-ring rounded"
        >
          {paused ? 'Play animation' : 'Pause animation'}
        </button>
      )}
    </div>
  )
}
