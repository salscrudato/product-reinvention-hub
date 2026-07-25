// AgentVisualizer — "Watch the agents": a live view of the unified-import pipeline,
// rendered ONLY from real SSE events already emitted by the server (zero protocol
// changes; the client merely forwards the existing `json` events it used to drop).
//
// Honesty contract (the load-bearing design rule):
//   • Stage state (queued/thinking/done/error), timings, counts, notices and spend all
//     come from live events. Nothing is simulated; before the first event the view is
//     an explicit "waiting" state, and idle looks idle.
//   • The ensemble composition shown per stage (which model roles fan out, which
//     provider adversarially validates) is the pipeline's CODE CONFIGURATION — it
//     describes design, not observed per-call activity, and is labelled as such.
//     Per-call fan-out/escalation events are not in today's stream (wanted additive
//     fields are recorded in orchestration.md).
//   • Token/spend telemetry arrives once, at run end (brain:spend / import:spend) —
//     shown then, per deployment, never extrapolated live.
//
// Three event families (the router decides server-side):
//   brain   — brain:stage0..6 tool events + brain:* json payloads   (workbooks/CSV)
//   filing  — filing:classify / filing:extract:* / filing:reconcile (PDFs)
//   fallback— extract:coverages single-pass                          (legacy)
//
// A11y: aria-live region announces stage transitions; prefers-reduced-motion swaps the
// animated constellation for a calm stepper list (pulses/springs are also globally
// collapsed by the index.css reduced-motion guard). Hand-rolled SVG; tokens only.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { UnifiedStageEvent } from './unifiedImportClient'
import type { NoticeEvent } from '../lib/ai/notices'
import {
  IconAgent, IconStage, IconVerify, IconReconcile, IconDisagreement, IconStream, IconEscalate,
  IconSplit, IconTable, IconCombine, IconWarning, IconCheckCircle, IconClose, IconExpand,
} from '../components/icons'

// ─── Model (pure — unit-tested) ───────────────────────────────────────────────

export type StageStatus = 'queued' | 'active' | 'done' | 'error'
export type Family = 'unknown' | 'brain' | 'filing' | 'fallback'

export interface VizAgent {
  key:      string
  label:    string                 // role name as the pipeline code names it
  deployment: string               // fleet deployment the role maps to
  provider: 'anthropic' | 'openai' | 'deterministic'
  note?:    string
}

export interface VizStage {
  id:      string
  label:   string
  sub:     string                  // one-line ensemble description (code configuration)
  agents:  VizAgent[]
  status:  StageStatus
  startAt?: number
  endAt?:   number
  detail?:  string                 // latest summary from the live event
  notes:    string[]               // stage-4 progress details, capped
  events:   number                 // count of live events observed for this stage (drives pulses)
}

export interface DeploymentSpend {
  calls: number; inputTokens: number; outputTokens: number; usd: number
}
export interface RunSpend {
  spendUsd: number; calls: number; noCap: boolean
  byDeployment: Record<string, DeploymentSpend>
}

export interface VizModel {
  family:       Family
  stages:       VizStage[]
  input?:       { sourceName?: string; sheetCount?: number; sheetNames?: string[] }
  discrepancies: { field: string; note: string }[]
  discrepancyCount: number
  outputCounts?: Record<string, number>
  spend?:       RunSpend
  notices:      NoticeEvent[]
  degraded:     boolean
  /** REAL ladder hand-offs (brain:escalation events) — never simulated. */
  escalations:  { fromRole: string; toRole: string; deployment: string; at: number }[]
  /** Chronological human announcements for the aria-live region. */
  announcements: string[]
  lastEventAt?: number
}

// The pipeline's code configuration (server/lib/import-brain/*): which roles each
// stage fans out to and which fleet deployment each role maps to. Labels only —
// live per-call activity is not in the stream and is never invented here.
const A = (key: string, label: string, deployment: string, provider: VizAgent['provider'], note?: string): VizAgent =>
  ({ key, label, deployment, provider, note })

const BRAIN_STAGES: Omit<VizStage, 'status' | 'notes' | 'events'>[] = [
  { id: 'route',     label: 'Route',           sub: 'Magic-byte artifact router · cheap assist escalates on low confidence',
    agents: [A('router', 'ROUTER', 'claude-haiku-4-5', 'anthropic', 'escalates to opus below confidence floor')] },
  { id: 'classify',  label: 'Sheet classify',  sub: 'BULK pre-filter, then two reasoners classify independently and adjudicate',
    agents: [A('bulk', 'BULK', 'claude-haiku-4-5', 'anthropic'),
             A('ra', 'REASONER_A', 'claude-opus-4-8', 'anthropic'),
             A('rb', 'REASONER_B', 'gpt-5.1', 'openai', 'different provider — decorrelated')] },
  { id: 'headerLock', label: 'Header lock',    sub: 'Deterministic fast path; AI fallback only when heuristics are unsure',
    agents: [A('det', 'DETERMINISTIC', 'regex heuristics', 'deterministic'),
             A('ra', 'REASONER_A', 'claude-opus-4-8', 'anthropic', 'fallback')] },
  { id: 'columnMap', label: 'Column → field map', sub: 'Two reasoners map in parallel, then reconcile to consensus',
    agents: [A('ra', 'REASONER_A', 'claude-opus-4-8', 'anthropic'),
             A('rb', 'REASONER_B', 'gpt-5.1', 'openai', 'parallel — reconciled')] },
  { id: 'extract',   label: 'Row extract',     sub: 'Dual bulk extractors cross-check; conflicts climb the haiku → sonnet → opus ladder',
    agents: [A('bulk', 'BULK', 'claude-haiku-4-5', 'anthropic'),
             A('alt', 'BULK_ALT', 'gpt-5-mini', 'openai', 'cross-check'),
             A('ladder', 'LADDER', 'sonnet → opus', 'anthropic', 'conflicted fields only')] },
  { id: 'sweep',     label: 'Conservation sweep', sub: 'Every unaccounted cell is swept — haiku + gpt-mini vote, ladder to sonnet on conflict',
    agents: [A('bulk', 'BULK', 'claude-haiku-4-5', 'anthropic'),
             A('alt', 'BULK_ALT', 'gpt-5-mini', 'openai', 'second vote'),
             A('ladder', 'LADDER', 'sonnet', 'anthropic', 'conflicts only')] },
  { id: 'validate',  label: 'Adversarial validate', sub: 'gpt-5.1 validator — OpenAI family, decorrelated from the Anthropic extractors',
    agents: [A('val', 'VALIDATOR', 'gpt-5.1', 'openai', 'cross-provider adversarial check')] },
  { id: 'reconcile', label: 'Reconcile & plan', sub: 'Deterministic ISO join + plan assembly — aggregates, writes nothing',
    agents: [A('det', 'DETERMINISTIC', 'aggregation', 'deterministic')] },
]

const FILING_STAGES: Omit<VizStage, 'status' | 'notes' | 'events'>[] = [
  { id: 'route',    label: 'Route',            sub: 'Magic-byte artifact router',
    agents: [A('router', 'ROUTER', 'claude-haiku-4-5', 'anthropic')] },
  { id: 'classify', label: 'Document classify', sub: 'Role per document (rate order / manual / policy form)',
    agents: [A('bulk', 'BULK', 'claude-haiku-4-5', 'anthropic', 'ladder escalates on empty result')] },
  { id: 'rateOrder', label: 'Rate-order extract', sub: 'haiku first; escalation ladder on empty result',
    agents: [A('bulk', 'BULK', 'claude-haiku-4-5', 'anthropic'), A('ladder', 'LADDER', 'sonnet → opus', 'anthropic')] },
  { id: 'manual',   label: 'Manual-rules extract', sub: 'haiku first; escalation ladder on empty result',
    agents: [A('bulk', 'BULK', 'claude-haiku-4-5', 'anthropic'), A('ladder', 'LADDER', 'sonnet → opus', 'anthropic')] },
  { id: 'policyForm', label: 'Policy-form extract', sub: 'Coverage extraction from the base form',
    agents: [A('bulk', 'BULK', 'claude-haiku-4-5', 'anthropic'), A('ladder', 'LADDER', 'sonnet → opus', 'anthropic')] },
  { id: 'reconcile', label: 'Reconcile',        sub: 'Assembles the filing bundle — writes nothing',
    agents: [A('det', 'DETERMINISTIC', 'aggregation', 'deterministic')] },
]

const FALLBACK_STAGES: Omit<VizStage, 'status' | 'notes' | 'events'>[] = [
  { id: 'coverages', label: 'Coverage extract', sub: 'Single-pass forced-tool extraction (legacy robustness path)',
    agents: [A('bulk', 'BULK', 'claude-haiku-4-5', 'anthropic')] },
]

// Brain tool names → stage ids (brain:stage{N}:{name}). EVERY sub-stage the pipeline emits
// is mapped — an unmapped tool event is silently dropped, which is exactly what used to hide
// the long-running sweep and the final plan assembly. `digest` (sheet read/census) lands on
// classify (both stage-1 reads); `sweep` is its own stage; `isoJoin`/`plan` (stage-7) land on
// the reconcile-&-plan stage.
const BRAIN_TOOL_TO_STAGE: Record<string, string> = {
  '0:route': 'route', '1:digest': 'classify', '1:classify': 'classify', '2:headerLock': 'headerLock',
  '3:columnMap': 'columnMap', '4:extract': 'extract', '4:sweep': 'sweep',
  '5:validate': 'validate', '6:reconcile': 'reconcile', '7:isoJoin': 'reconcile', '7:plan': 'reconcile',
}
// Filing tool names → stage ids.
const FILING_TOOL_TO_STAGE: Record<string, string> = {
  'filing:classify': 'classify', 'filing:extract:rateOrder': 'rateOrder',
  'filing:extract:manual': 'manual', 'filing:extract:policyForm': 'policyForm',
  'filing:reconcile': 'reconcile',
}

function freshStages(defs: Omit<VizStage, 'status' | 'notes' | 'events'>[]): VizStage[] {
  return defs.map(d => ({ ...d, status: 'queued', notes: [], events: 0 }))
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

// Keep a generous window of the most recent live sub-events per stage — enough to show
// every sheet/batch the pipeline reports (a big workbook streams ~5-10 per stage), rendered
// as a scrollable activity feed rather than a fixed 4. Bounded so a pathological run can't
// grow the model without limit.
const MAX_NOTES = 40

/** Fold the raw SSE event list into the render model. Pure; exported for tests. */
export function buildVizModel(events: UnifiedStageEvent[], streamError?: string): VizModel {
  let family: Family = 'unknown'
  let stages: VizStage[] = []
  const model: VizModel = {
    family, stages, discrepancies: [], discrepancyCount: 0,
    notices: [], degraded: false, escalations: [], announcements: [],
  }

  const ensureFamily = (f: Exclude<Family, 'unknown'>) => {
    if (family === f) return
    // Preserve any observed 'route' stage state across the family switch.
    const route = stages.find(s => s.id === 'route')
    family = f
    stages = freshStages(f === 'brain' ? BRAIN_STAGES : f === 'filing' ? FILING_STAGES : FALLBACK_STAGES)
    if (route) {
      const idx = stages.findIndex(s => s.id === 'route')
      if (idx >= 0) stages[idx] = route
    }
    model.family = family
    model.stages = stages
  }

  const stageById = (id: string): VizStage | undefined => stages.find(s => s.id === id)

  const applyTool = (stageId: string, ev: UnifiedStageEvent, label?: string) => {
    const st = stageById(stageId)
    if (!st) return
    st.events += 1
    model.lastEventAt = ev.at
    if (ev.summary) st.detail = ev.summary
    if (ev.phase === 'start') {
      st.status = 'active'
      st.startAt = st.startAt ?? ev.at
      model.announcements.push(`${label ?? st.label} started${ev.summary ? ` — ${ev.summary}` : ''}`)
    } else if (ev.phase === 'end') {
      st.status = 'done'
      st.endAt = ev.at
      model.announcements.push(`${label ?? st.label} complete${ev.summary ? ` — ${ev.summary}` : ''}`)
    } else if (ev.phase === 'progress' && ev.summary) {
      st.status = 'active'
      st.notes = [...st.notes.slice(-(MAX_NOTES - 1)), ev.summary]
    }
  }

  for (const ev of events) {
    if (ev.kind === 'notice' && ev.notice) {
      model.notices.push(ev.notice)
      if (ev.notice.kind === 'degrade') model.degraded = true
      continue
    }

    if (ev.kind === 'json' && ev.key) {
      model.lastEventAt = ev.at
      if (ev.key === 'brain:input') {
        ensureFamily('brain')
        const v = asRecord(ev.value)
        model.input = {
          sourceName: typeof v.sourceName === 'string' ? v.sourceName : undefined,
          sheetCount: typeof v.sheetCount === 'number' ? v.sheetCount : undefined,
          sheetNames: Array.isArray(v.sheetNames) ? v.sheetNames.map(String).slice(0, 24) : undefined,
        }
      } else if (ev.key === 'brain:stage5') {
        const arr = Array.isArray(ev.value) ? ev.value : []
        model.discrepancyCount = arr.length
        model.discrepancies = arr.slice(0, 5).map(d => {
          const r = asRecord(d)
          return {
            field: String(r.fieldLabel ?? r.field ?? r.fieldPath ?? r.refId ?? 'field'),
            note:  String(r.reason ?? r.note ?? r.detail ?? r.discrepancy ?? ''),
          }
        })
      } else if (ev.key === 'brain:output') {
        const v = asRecord(ev.value)
        const counts: Record<string, number> = {}
        for (const [k, n] of Object.entries(v)) if (typeof n === 'number') counts[k] = n
        model.outputCounts = counts
      } else if (ev.key === 'brain:escalation') {
        // A REAL haiku→sonnet→opus hand-off fired server-side. Attach it to the
        // model + note it on the currently-active stage; nothing animates unless
        // one of these events genuinely arrived.
        const v = asRecord(ev.value)
        const esc = {
          fromRole: String(v.fromRole ?? ''),
          toRole: String(v.toRole ?? ''),
          deployment: String(v.deployment ?? ''),
          at: ev.at,
        }
        model.escalations.push(esc)
        const active = stages.find(s => s.status === 'active')
        if (active) {
          active.events += 1
          active.notes = [...active.notes.slice(-(MAX_NOTES - 1)), `escalated ${esc.fromRole} → ${esc.toRole} (${esc.deployment})`]
        }
        model.announcements.push(`Escalation: ${esc.fromRole} handed off to ${esc.toRole}`)
      } else if (ev.key === 'brain:spend' || ev.key === 'import:spend') {
        const v = asRecord(ev.value)
        const by: Record<string, DeploymentSpend> = {}
        for (const [dep, s] of Object.entries(asRecord(v.byDeployment))) {
          const r = asRecord(s)
          by[dep] = {
            calls:        Number(r.calls) || 0,
            inputTokens:  Number(r.inputTokens) || 0,
            outputTokens: Number(r.outputTokens) || 0,
            usd:          Number(r.usd) || 0,
          }
        }
        model.spend = {
          spendUsd: Number(v.spendUsd) || 0,
          calls:    Number(v.calls) || 0,
          noCap:    Boolean(v.noCap),
          byDeployment: by,
        }
      }
      continue
    }

    if (ev.kind !== 'tool' || !ev.name) continue

    const brainMatch = /^brain:stage(\d+):(\w+)$/.exec(ev.name)
    if (brainMatch) {
      const key = `${brainMatch[1]}:${brainMatch[2]}`
      const stageId = BRAIN_TOOL_TO_STAGE[key]
      if (stageId === 'route') {
        // The router precedes BOTH families — keep family unknown until content events land.
        if (family === 'unknown') { stages = freshStages([BRAIN_STAGES[0]!]); model.stages = stages }
        applyTool('route', ev)
      } else if (stageId) {
        ensureFamily('brain')
        applyTool(stageId, ev)
      }
      continue
    }

    const filingStage = FILING_TOOL_TO_STAGE[ev.name]
    if (filingStage) {
      ensureFamily('filing')
      applyTool(filingStage, ev)
      continue
    }

    if (ev.name === 'extract:coverages') {
      ensureFamily('fallback')
      applyTool('coverages', ev)
      continue
    }
    // Unknown tool event: real but unmapped — count it nowhere rather than guess.
  }

  if (streamError) {
    for (const st of stages) if (st.status === 'active') st.status = 'error'
    model.announcements.push(`Import stream error — ${streamError}`)
  }

  return model
}

// ─── Presentation helpers ─────────────────────────────────────────────────────

const PROVIDER_COLOR: Record<VizAgent['provider'], string> = {
  anthropic:     'var(--color-accent)',
  openai:        'var(--color-info)',
  deterministic: 'var(--color-faint)',
}

const STAGE_ICON: Record<string, typeof IconAgent> = {
  route: IconSplit, classify: IconStage, headerLock: IconTable, columnMap: IconCombine,
  extract: IconAgent, sweep: IconStream, validate: IconVerify, reconcile: IconReconcile,
  rateOrder: IconTable, manual: IconTable, policyForm: IconStage, coverages: IconAgent,
}

function fmtElapsed(ms: number): string {
  if (ms < 0) return '0s'
  const s = Math.floor(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function statusLabel(s: StageStatus): string {
  return s === 'queued' ? 'Queued' : s === 'active' ? 'Thinking' : s === 'done' ? 'Done' : 'Error'
}

function statusColor(s: StageStatus): string {
  return s === 'active' ? 'var(--color-accent)'
    : s === 'done' ? 'var(--color-good)'
    : s === 'error' ? 'var(--color-danger, var(--color-warn))'
    : 'var(--color-faint)'
}

/** Reactively track prefers-reduced-motion. */
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentChip({ agent, stageStatus }: { agent: VizAgent; stageStatus: StageStatus }) {
  const color = PROVIDER_COLOR[agent.provider]
  const dim = stageStatus === 'queued'
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2 py-0.5 text-[10px] font-medium transition-opacity duration-300"
      style={{
        border: `1px solid ${dim ? 'var(--color-border)' : color}`,
        color: dim ? 'var(--color-faint)' : 'var(--color-dim)',
        background: 'var(--color-surface)',
        opacity: dim ? 0.65 : 1,
      }}
      title={agent.note ? `${agent.label} · ${agent.deployment} — ${agent.note}` : `${agent.label} · ${agent.deployment}`}
    >
      <IconAgent size={10} aria-hidden="true" style={{ color: dim ? 'var(--color-faint)' : color }} />
      <span className="font-mono">{agent.label}</span>
      <span className="text-faint font-mono">{agent.deployment}</span>
    </span>
  )
}

// Live activity feed: the real sub-events the stage has reported (per sheet / per batch),
// scrollable and auto-pinned to the newest line while the stage is active — so a long stage
// (the conservation sweep) shows a moving log instead of sitting silent. Real events only.
function NotesFeed({ notes, active }: { notes: string[]; active: boolean }) {
  const ref = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (active && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [notes.length, active])
  if (notes.length === 0) return null
  return (
    <ul ref={ref} className="mt-1 flex flex-col gap-0.5 max-h-[108px] overflow-y-auto pr-1"
      aria-label="Live activity" aria-live={active ? 'polite' : undefined}>
      {notes.map((n, i) => (
        <li key={i} className="text-[10.5px] text-faint font-mono truncate leading-relaxed" title={n}>· {n}</li>
      ))}
    </ul>
  )
}

function StageRow({ stage, isLast, now, reduced }: {
  stage: VizStage; isLast: boolean; now: number; reduced: boolean
}) {
  const Icon = STAGE_ICON[stage.id] ?? IconStage
  const color = statusColor(stage.status)
  const elapsed = stage.startAt
    ? fmtElapsed((stage.endAt ?? now) - stage.startAt)
    : null

  return (
    <li className="relative flex gap-3">
      {/* Rail node + connector (hand-rolled SVG; pulses only while events flow) */}
      <div className="flex flex-col items-center shrink-0 w-7" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 28 28" className="shrink-0">
          <circle cx="14" cy="14" r="11" fill="var(--color-surface)" stroke={color} strokeWidth="1.6"
            style={{ transition: 'stroke 300ms' }} />
          {stage.status === 'active' && !reduced && (
            <circle cx="14" cy="14" r="11" fill="none" stroke={color} strokeWidth="1.6" opacity="0.5"
              className="viz-ring" />
          )}
          <g transform="translate(7,7)" style={{ color }}>
            <Icon size={14} aria-hidden="true" />
          </g>
        </svg>
        {!isLast && (
          <div className="relative flex-1 w-px my-0.5" style={{ background: 'var(--color-border)' }}>
            {/* One traveling pulse per event burst — keyed by the REAL event count so a
                pulse fires only when an event actually arrived; idle rails are still. */}
            {!reduced && stage.events > 0 && stage.status !== 'queued' && (
              <span key={stage.events} className="viz-pulse absolute left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full"
                style={{ background: color }} />
            )}
          </div>
        )}
      </div>

      {/* Stage card */}
      <div className="flex-1 min-w-0 rounded-[12px] px-3 py-2.5 mb-2.5 transition-colors duration-300"
        style={{
          border: `1px solid ${stage.status === 'active' ? color : 'var(--color-border)'}`,
          background: stage.status === 'active' ? 'var(--color-accent-soft)' : 'var(--color-surface)',
        }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12.5px] font-semibold text-text">{stage.label}</span>
          <span className="text-[10px] font-semibold uppercase tracking-[.07em] rounded px-1.5 py-px"
            style={{ color, border: `1px solid ${color}` }}>
            {statusLabel(stage.status)}
          </span>
          {elapsed && (
            <span className="text-[10px] font-mono text-faint tnum ml-auto" title="Elapsed (measured client-side from live events)">
              {elapsed}
            </span>
          )}
        </div>
        <p className="text-[11px] text-faint mt-0.5">{stage.sub}</p>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {stage.agents.map(a => <AgentChip key={a.key} agent={a} stageStatus={stage.status} />)}
        </div>
        {stage.detail && (
          <p className="text-[11px] text-dim mt-1.5 font-mono truncate" title={stage.detail}>{stage.detail}</p>
        )}
        <NotesFeed notes={stage.notes} active={stage.status === 'active'} />
      </div>
    </li>
  )
}

function SpendPanel({ spend }: { spend: RunSpend }) {
  const rows = Object.entries(spend.byDeployment)
  return (
    <section className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}
      aria-label="Fleet telemetry (measured at run end)">
      <div className="flex items-center gap-2 px-3 py-2 bg-raised">
        <IconStream size={13} className="text-dim" aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-dim flex-1">Fleet telemetry</span>
        {spend.noCap && (
          <span className="text-[10px] font-medium rounded px-1.5 py-px"
            style={{ color: 'var(--color-accent)', border: '1px solid var(--color-accent-line)' }}
            title="Import runs under the no-cap exemption — spend is never capped, telemetry always recorded.">
            no-cap · telemetry on
          </span>
        )}
      </div>
      <div className="px-3 py-2 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-faint">
              <th scope="col" className="font-medium pb-1">Deployment</th>
              <th scope="col" className="font-medium pb-1 text-right">Calls</th>
              <th scope="col" className="font-medium pb-1 text-right">In</th>
              <th scope="col" className="font-medium pb-1 text-right">Out</th>
              <th scope="col" className="font-medium pb-1 text-right">USD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([dep, s]) => (
              <tr key={dep} className="text-dim">
                <td className="font-mono py-0.5">{dep}</td>
                <td className="text-right tnum">{s.calls}</td>
                <td className="text-right tnum font-mono">{fmtTokens(s.inputTokens)}</td>
                <td className="text-right tnum font-mono">{fmtTokens(s.outputTokens)}</td>
                <td className="text-right tnum font-mono">${s.usd.toFixed(4)}</td>
              </tr>
            ))}
            <tr className="text-text font-medium" style={{ borderTop: '1px solid var(--color-border)' }}>
              <td className="py-0.5">Total</td>
              <td className="text-right tnum">{spend.calls}</td>
              <td /><td />
              <td className="text-right tnum font-mono">${spend.spendUsd.toFixed(4)}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-[10px] text-faint mt-1">
          Measured at run end from the pipeline's own spend event — per-stage live token counts are not streamed today.
        </p>
      </div>
    </section>
  )
}

function DiscrepancyPanel({ model }: { model: VizModel }) {
  // Cool stage tint: the adversarial validator lane reads analytically cool,
  // in deliberate contrast to the warm escalation lane above it.
  return (
    <section className="rounded-[12px] overflow-hidden"
      style={{ border: '1px solid var(--color-stage-cool-line)' }}
      aria-label="Validator discrepancies">
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--color-stage-cool-soft)' }}>
        <IconDisagreement size={13} style={{ color: 'var(--color-stage-cool)' }} aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-text flex-1">
          Validator findings
        </span>
        <span className="text-[11px] tnum" style={{ color: 'var(--color-stage-cool)' }}>{model.discrepancyCount}</span>
      </div>
      <ul className="px-3 py-2 flex flex-col gap-1">
        {model.discrepancies.map((d, i) => (
          <li key={i} className="text-[11px] text-dim truncate" title={`${d.field} ${d.note}`}>
            <span className="font-mono text-text">{d.field}</span>
            {d.note && <span className="text-faint"> — {d.note}</span>}
          </li>
        ))}
        {model.discrepancyCount > model.discrepancies.length && (
          <li className="text-[10.5px] text-faint">+{model.discrepancyCount - model.discrepancies.length} more — full detail lands in the review heatmap</li>
        )}
      </ul>
    </section>
  )
}

// ─── Escalation ladder — renders ONLY on real brain:escalation events ─────────
// The haiku → sonnet → opus rungs light as far as a genuine hand-off reached;
// the newest hand-off animates once (keyed by the event count). Reduced motion
// renders the same rungs statically. No event → this panel does not exist.

const LADDER_RUNGS = [
  { role: 'BULK_VERIFY',    label: 'haiku'  },
  { role: 'MID_REASONER',   label: 'sonnet' },
  { role: 'GROUNDED_CITED', label: 'opus'   },
] as const

function EscalationLadder({ escalations, reduced }: {
  escalations: VizModel['escalations']; reduced: boolean
}) {
  const reachedIdx = Math.max(...escalations.map(e => LADDER_RUNGS.findIndex(r => r.role === e.toRole)), 0)
  const latest = escalations[escalations.length - 1]
  return (
    <section className="rounded-[12px] px-3 py-2.5"
      style={{ border: '1px solid var(--color-stage-warm-line)', background: 'var(--color-stage-warm-soft)' }}
      aria-label={`Escalation ladder — ${escalations.length} real hand-off${escalations.length === 1 ? '' : 's'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <IconEscalate size={13} style={{ color: 'var(--color-stage-warm)' }} aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[.07em]" style={{ color: 'var(--color-stage-warm)' }}>
          Escalation
        </span>
        <span className="flex items-center gap-1.5 ml-1" aria-hidden="true">
          {LADDER_RUNGS.map((r, i) => {
            const lit = i <= reachedIdx
            const isNewest = latest && r.role === latest.toRole
            return (
              <span key={r.role} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span key={isNewest && !reduced ? `arr-${escalations.length}` : `arr-${i}`}
                    className={`text-[11px] ${isNewest && !reduced ? 'chip-in' : ''}`}
                    style={{ color: lit ? 'var(--color-stage-warm)' : 'var(--color-faint)' }}>→</span>
                )}
                <span
                  key={isNewest && !reduced ? `rung-${escalations.length}` : `rung-${i}`}
                  className={`px-1.5 py-0.5 rounded-[6px] font-mono text-[10.5px] font-semibold ${isNewest && !reduced ? 'chip-in' : ''}`}
                  style={lit
                    ? { background: 'var(--color-stage-warm)', color: 'var(--color-surface)' }
                    : { color: 'var(--color-faint)', border: '1px solid var(--color-border)' }}>
                  {r.label}
                </span>
              </span>
            )
          })}
        </span>
        <span className="text-[10.5px] text-dim ml-auto tabular-nums">
          {escalations.length} hand-off{escalations.length === 1 ? '' : 's'} · latest → <span className="font-mono">{latest?.deployment}</span>
        </span>
      </div>
    </section>
  )
}

// ─── Root component ───────────────────────────────────────────────────────────

export interface AgentVisualizerProps {
  events:      UnifiedStageEvent[]
  streaming:   boolean
  streamError?: string
  /** Fullscreen overlay toggle (owned by the parent so the state survives collapse). */
  expanded:    boolean
  onToggleExpand: () => void
}

export function AgentVisualizer({ events, streaming, streamError, expanded, onToggleExpand }: AgentVisualizerProps) {
  const reduced = useReducedMotion()
  const model = useMemo(() => buildVizModel(events, streamError), [events, streamError])

  // 1s tick drives elapsed tickers while any stage is active (a text update, not motion).
  const [now, setNow] = useState(() => Date.now())
  const anyActive = model.stages.some(s => s.status === 'active')
  useEffect(() => {
    if (!anyActive || !streaming) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [anyActive, streaming])

  // aria-live: announce only the newest transition (polite; no announcement spam).
  const lastAnnouncement = model.announcements[model.announcements.length - 1] ?? ''
  const liveRef = useRef<HTMLParagraphElement>(null)

  // ESC closes the fullscreen overlay.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onToggleExpand() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, onToggleExpand])

  const body = (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <IconAgent size={15} className="text-accent" aria-hidden="true" />
        <span className="text-[12.5px] font-semibold text-text">Agent pipeline</span>
        {model.input?.sourceName && (
          <span className="text-[11px] text-faint font-mono truncate" title={model.input.sourceName}>
            {model.input.sourceName}
            {typeof model.input.sheetCount === 'number' && ` · ${model.input.sheetCount} sheet(s)`}
          </span>
        )}
        <button
          type="button"
          onClick={onToggleExpand}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-dim hover:text-accent transition-colors rounded-[6px] px-1.5 py-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          aria-expanded={expanded}
        >
          {expanded ? <><IconClose size={12} aria-hidden="true" /> Close</> : <><IconExpand size={12} aria-hidden="true" /> Expand</>}
        </button>
      </div>

      {/* aria-live announcer (visually hidden) */}
      <p ref={liveRef} aria-live="polite" role="status" className="sr-only">{lastAnnouncement}</p>

      {/* Pipeline — real events only. Before the first event: explicit waiting state. */}
      {model.stages.length === 0 ? (
        <div className="flex items-center gap-2 rounded-[12px] px-3 py-3 text-[12px] text-dim"
          style={{ border: '1px dashed var(--color-border-strong)', background: 'var(--color-surface)' }}>
          <IconStream size={14} className="text-faint" aria-hidden="true" />
          {streaming
            ? 'Waiting for pipeline events — nothing is shown until the agents actually report.'
            : 'No pipeline events were received on this run.'}
        </div>
      ) : (
        <ol className="flex flex-col" aria-label={`Import pipeline stages (${model.family})`}>
          {model.stages.map((s, i) => (
            <StageRow key={s.id} stage={s} isLast={i === model.stages.length - 1} now={now} reduced={reduced} />
          ))}
        </ol>
      )}

      {/* Escalation ladder hand-offs — renders ONLY when real events fired */}
      {model.escalations.length > 0 && <EscalationLadder escalations={model.escalations} reduced={reduced} />}

      {/* Degrade notice (a REAL event from the budget guard) */}
      {model.degraded && (
        <div className="flex items-start gap-2 rounded-[10px] px-3 py-2 text-[11px] text-dim"
          style={{ background: 'var(--color-warn-soft, var(--color-raised))', border: '1px solid var(--color-warn-line, var(--color-border))' }}>
          <IconWarning size={13} className="text-warn shrink-0 mt-px" aria-hidden="true" />
          Token soft ceiling reached mid-run — some calls used cheaper models (reported by the pipeline).
        </div>
      )}

      {/* Validator discrepancies (stage 5 payload — these feed the review heatmap) */}
      {model.discrepancyCount > 0 && <DiscrepancyPanel model={model} />}

      {/* Output counts */}
      {model.outputCounts && Object.keys(model.outputCounts).length > 0 && (
        <div className="flex items-center gap-3 flex-wrap rounded-[10px] px-3 py-2"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <IconCheckCircle size={13} className="text-good shrink-0" aria-hidden="true" />
          {Object.entries(model.outputCounts).map(([k, n]) => (
            <span key={k} className="text-[11px] text-dim">
              <span className="tnum font-mono text-text">{n}</span> {k.replace(/([A-Z])/g, ' $1').toLowerCase()}
            </span>
          ))}
        </div>
      )}

      {/* Fleet telemetry (run end) */}
      {model.spend && <SpendPanel spend={model.spend} />}

      {/* Stream error */}
      {streamError && (
        <div className="flex items-start gap-2 rounded-[10px] px-3 py-2 text-[11px] text-dim"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-raised)' }}>
          <IconClose size={13} className="text-danger shrink-0 mt-px" aria-hidden="true" />
          <span>
            The stream disconnected: {streamError}. A mid-run import cannot resume — re-upload to start a
            fresh run (nothing was written; imports only write after your review).
          </span>
        </div>
      )}

      {/* Honesty footnote */}
      <p className="text-[10px] text-faint leading-relaxed">
        Stage states, timings, per-sheet/per-batch activity, counts and telemetry all come from live pipeline
        events. The model roles shown per stage are the pipeline's code configuration; individual per-call
        token counts aren't streamed (they're totalled at run end).
      </p>
    </div>
  )

  if (!expanded) return body

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      role="dialog" aria-modal="true" aria-label="Agent pipeline — expanded view"
      style={{ background: 'var(--color-scrim)' }}>
      <div className="w-full max-w-3xl rounded-[16px] p-5 sm:p-6 my-auto"
        style={{ background: 'var(--color-page)', border: '1px solid var(--color-border-strong)', boxShadow: 'var(--shadow-card)' }}>
        {body}
      </div>
    </div>
  )
}
