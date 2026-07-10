// LaunchRunway — the signature timeline strip above the board. The four pre-launch
// phases render as proportional segments (sized geometrically by their scheduled span)
// converging on a LAUNCH marker (= deadline); a TODAY marker sits on the line; a hatched
// COMPRESSION zone covers any span before today when the schedule is compressed; a slate
// "Governance / monitoring" tail sits after the launch marker. Tokenised violet ramp,
// reduced-motion safe (only colour transitions, globally neutralised).
import { toMillis, fmtShort, PRELAUNCH_PHASES, GTM_PHASES, type TaskDoc } from './gtm'

interface Props {
  seeded:     TaskDoc[]   // the project's origin==='seeded' tasks
  deadlineMs: number
  todayMs:    number
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n))
const GOV_VAR = GTM_PHASES[4]!.cssVar   // slate governance shade

export function LaunchRunway({ seeded, deadlineMs, todayMs }: Props) {
  const pre = seeded.filter(t => t.phaseOrder != null && t.phaseOrder <= 4 && t.startDate && t.dueAt)
  const gov = seeded.filter(t => t.phaseOrder === 5)

  const preStarts = pre.map(t => toMillis(t.startDate)!).filter(Number.isFinite)
  const projStart = preStarts.length ? Math.min(...preStarts) : deadlineMs
  const govEnds   = gov.map(t => toMillis(t.dueAt)).filter((m): m is number => m != null)
  const tEnd      = Math.max(deadlineMs, ...(govEnds.length ? govEnds : [deadlineMs]))

  const t0   = Math.min(projStart, todayMs)
  const t1   = Math.max(tEnd, todayMs + 86_400_000)
  const span = (t1 - t0) || 1
  const x = (ms: number) => clampPct(((ms - t0) / span) * 100)

  // Pre-launch phase segments (geometric extent per phase).
  const segments = PRELAUNCH_PHASES.map(ph => {
    const tasks = pre.filter(t => t.phaseL2 === ph.name)
    if (tasks.length === 0) return null
    const s = Math.min(...tasks.map(t => toMillis(t.startDate)!))
    const e = Math.max(...tasks.map(t => toMillis(t.dueAt)!))
    const left = x(s), width = Math.max(x(e) - left, 0.5)
    const days = tasks.reduce((sum, t) => sum + (t.slaDays ?? 0), 0)
    return { ph, left, width, days }
  }).filter(Boolean) as { ph: typeof PRELAUNCH_PHASES[number]; left: number; width: number; days: number }[]

  const launchX = x(deadlineMs)
  const todayX  = x(todayMs)
  const compressed = projStart < todayMs

  return (
    <section
      className="rounded-[14px] bg-surface p-4"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      aria-label="Launch runway"
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-faint">Launch runway</span>
        <span className="text-xs text-dim">
          <span className="font-semibold text-text">{fmtShort(projStart)}</span> to launch{' '}
          <span className="font-semibold text-text">{fmtShort(deadlineMs)}</span>
        </span>
      </div>

      {/* Track */}
      <div className="relative h-[46px] mx-0.5">
        <div className="absolute inset-0 rounded-[10px] overflow-hidden" style={{ background: 'var(--color-raised)' }}>
          {/* Compression zone (schedule starts before today) */}
          {compressed && (
            <div
              className="absolute inset-y-0 left-0"
              style={{
                width: `${todayX}%`,
                background: 'repeating-linear-gradient(45deg, var(--color-danger-soft), var(--color-danger-soft) 7px, transparent 7px, transparent 14px)',
                borderRight: '2px dashed var(--color-danger-line)',
              }}
              title="Compressed timeline — these tasks start before today"
            />
          )}
          {/* Governance / monitoring tail (post-launch) */}
          {gov.length > 0 && (
            <div
              className="absolute inset-y-0"
              style={{
                left: `${launchX}%`, width: `${Math.max(100 - launchX, 1)}%`,
                background: `repeating-linear-gradient(45deg, var(${GOV_VAR}), var(${GOV_VAR}) 6px, transparent 6px, transparent 12px)`,
                opacity: 0.85,
              }}
              title="Governance & monitoring (post-launch)"
            />
          )}
          {/* Pre-launch phase segments */}
          {segments.map(({ ph, left, width, days }) => (
            <div
              key={ph.name}
              className="absolute inset-y-0 flex items-center justify-center overflow-hidden"
              style={{
                left: `${left}%`, width: `${width}%`,
                background: `var(${ph.cssVar})`, borderRight: '2px solid var(--color-surface)',
              }}
              title={`${ph.name}: ${days} business days`}
            >
              <span
                className={`text-[11px] font-semibold whitespace-nowrap px-2 truncate ${
                  ph.light ? 'text-[color:var(--color-gtm-phase-ink)]' : 'text-white'}`}
                style={{ textShadow: ph.light ? 'none' : 'var(--shadow-onbar-text)' }}
              >
                {ph.short}{width > 12 ? ` · ${days}d` : ''}
              </span>
            </div>
          ))}
        </div>

        {/* Today marker */}
        <Marker leftPct={todayX} label="Today" tone="today" />
        {/* Launch marker */}
        <Marker leftPct={launchX} label="Launch" tone="launch" />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3.5 mt-7 text-[11px] text-faint">
        {GTM_PHASES.map(ph => (
          <span key={ph.name} className="inline-flex items-center gap-1.5">
            <i className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: `var(${ph.cssVar})` }} />
            {ph.name === 'Product Governance & Monitoring' ? 'Governance / monitoring' : ph.short}
          </span>
        ))}
      </div>
    </section>
  )
}

function Marker({ leftPct, label, tone }: { leftPct: number; label: string; tone: 'today' | 'launch' }) {
  const isLaunch = tone === 'launch'
  const color = isLaunch ? 'var(--color-accent-strong)' : 'var(--color-dim)'
  // Keep the flag inside the track edges: right-align the launch flag when near 100%.
  const nearEnd = leftPct > 88
  return (
    <div className="absolute -top-1.5 -bottom-1.5 z-[3]" style={{ left: `${leftPct}%`, width: 2, background: color }}>
      <span
        className="absolute -top-[19px] text-[10px] font-bold tracking-[.04em] whitespace-nowrap px-1.5 py-0.5 rounded-[6px] text-white"
        style={{
          background: color,
          left: nearEnd ? 'auto' : '50%',
          right: nearEnd ? 0 : 'auto',
          transform: nearEnd ? 'none' : 'translateX(-50%)',
        }}
      >
        {label}
      </span>
    </div>
  )
}
