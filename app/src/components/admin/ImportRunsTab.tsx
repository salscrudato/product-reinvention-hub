// ImportRunsTab — Import pipeline telemetry (Platform console › Import Runs).
//
// One row per ingested workbook/filing; drill into a run to see the pipeline as
// the brain ran it: every stage with its timing, its input/output payloads
// (bounded server-side), model spend, escalations and flag-not-invent notices.
// Read-only observability over /api/admin/import/runs (server/lib/ai/run-trace.js).
//
// Charts follow the dataviz rules: magnitude bars use ONE hue (the accent token),
// status colors are the reserved semantic tokens and always ship with an icon or
// label, values wear text tokens with tabular-nums — never the mark color.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { adapter } from '../../lib/backend'
import type { ImportRunPayload, ImportRunStep, ImportRunSummary, ImportRunTrace } from '../../lib/backend'
import { Badge, Button, Drawer, EmptyState, Skeleton } from '../ui'
import {
  IconActivity, IconAgent, IconAlertCircle, IconBack, IconChevronRight, IconClipboard,
  IconEscalate, IconFileSpreadsheet, IconInfo, IconLayers, IconLink, IconRefresh,
  IconReconcile, IconSplit, IconTable, IconVerify, IconWarning, type IconType,
} from '../icons'

// ─── formatting ───────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${n >= 1 ? n.toFixed(2) : n.toFixed(4)}`
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms)) return '—'
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString()
}

// ─── stage vocabulary (business labels) ───────────────────────────────────────

interface StageMeta { title: string; blurb: string; icon: IconType }

const STAGE_META: Record<string, StageMeta> = {
  'brain:stage0:route': {
    title: 'Receive & route',
    blurb: 'Each file is identified by its bytes — never its filename — and routed to the right pipeline: Excel workbooks to the adaptive import brain, PDFs to filing extraction.',
    icon: IconSplit,
  },
  'brain:stage1:classify': {
    title: 'Classify sheets',
    blurb: 'Two independent AI readers decide what each worksheet contains (product framework, forms, rates, rules…). A fast pre-filter skips cover sheets; a referee model settles disagreements.',
    icon: IconLayers,
  },
  'brain:stage2:headerLock': {
    title: 'Lock headers',
    blurb: 'Finds the exact header row and data region of every content sheet. A deterministic scorer handles the clear cases; an AI reasoner steps in when the layout is ambiguous.',
    icon: IconTable,
  },
  'brain:stage3:columnMap': {
    title: 'Map columns',
    blurb: 'Matches every column to a canonical product field. Two reasoning models map in parallel and their answers are reconciled; unmapped columns are surfaced, never guessed.',
    icon: IconLink,
  },
  'brain:stage4:extract': {
    title: 'Extract rows',
    blurb: 'Reads every row into product entities with a source-cell citation on each field. Two fast models vote; disagreements escalate to stronger models and a consensus judge.',
    icon: IconAgent,
  },
  'brain:stage5:validate': {
    title: 'Adversarial validation',
    blurb: 'An independent model from a different vendor tries to find mistakes: ungrounded values, altered reference IDs, out-of-range enums, dropped rows. Findings become warnings — nothing is silently fixed.',
    icon: IconVerify,
  },
  'brain:stage6:reconcile': {
    title: 'Reconcile',
    blurb: 'Deterministically assembles all stage results into one output with per-entity confidence and a review queue. This step runs no AI and writes nothing.',
    icon: IconReconcile,
  },
  'brain:stage7:isoJoin': {
    title: 'Canonical join',
    blurb: 'When the workbook parses into a recognizable plan, the deterministic mapper contributes registry-derived reference IDs and hierarchy as the identity oracle.',
    icon: IconLink,
  },
  'brain:stage7:plan': {
    title: 'Build import plan',
    blurb: 'Produces the reviewable import plan: every value cited to its source cell, unknowns flagged for review, nothing invented. This is what the import review screen shows.',
    icon: IconClipboard,
  },
  'extract:coverages': {
    title: 'Single-pass extraction',
    blurb: 'Fallback path: one grounded AI pass proposes coverages directly from the document, each with a citation. Used when the staged pipelines are unavailable.',
    icon: IconAgent,
  },
}

function stageMeta(name: string): StageMeta {
  const known = STAGE_META[name]
  if (known) return known
  const tail = name.split(':').pop() ?? name
  const title = tail.replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  return { title: title.charAt(0).toUpperCase() + title.slice(1), blurb: 'Pipeline step.', icon: IconActivity }
}

const WORKBOOK_STAGES = [
  'brain:stage0:route', 'brain:stage1:classify', 'brain:stage2:headerLock',
  'brain:stage3:columnMap', 'brain:stage4:extract', 'brain:stage5:validate',
  'brain:stage6:reconcile', 'brain:stage7:plan',
]

// ─── run status pill ──────────────────────────────────────────────────────────

function RunStatusPill({ status, needsReview }: { status: string; needsReview: boolean }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] text-xs font-medium leading-none bg-[var(--color-info-soft)] text-info">
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--color-info)' }} aria-hidden="true" />
        Running
      </span>
    )
  }
  if (status === 'failed') return <Badge label="Failed" color="danger" />
  if (needsReview) return <Badge label="Needs review" color="warn" />
  return <Badge label="Imported" color="good" />
}

// ─── mini stage strip (run rows) ──────────────────────────────────────────────

function StageDots({ stages }: { stages: ImportRunSummary['stages'] }) {
  if (!stages.length) return null
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {stages.slice(0, 10).map((s) => (
        <span
          key={s.name}
          title={`${stageMeta(s.name).title} — ${s.status}${s.durationMs != null ? ` · ${fmtDuration(s.durationMs)}` : ''}`}
          className={`w-1.5 h-1.5 rounded-full ${s.status === 'running' ? 'animate-pulse' : ''}`}
          style={{
            background: s.status === 'error' ? 'var(--color-danger)'
              : s.status === 'running' ? 'var(--color-info)'
              : 'var(--color-good)',
          }}
        />
      ))}
    </span>
  )
}

// ─── stat tiles ───────────────────────────────────────────────────────────────

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex-1 min-w-32 bg-surface rounded-[14px] p-4" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      <div className="text-xs text-faint">{label}</div>
      <div className="text-xl font-semibold text-text tabular-nums mt-1">{value}</div>
      {hint && <div className="text-xs text-dim mt-0.5">{hint}</div>}
    </div>
  )
}

// ─── payload helpers ──────────────────────────────────────────────────────────

interface SampleInfo { items: unknown[]; total: number; sampled: boolean }

function asSample(v: unknown): SampleInfo | null {
  if (Array.isArray(v)) return { items: v, total: v.length, sampled: false }
  const o = v as { __sample?: boolean; items?: unknown[]; totalItems?: number } | null
  if (o && o.__sample === true && Array.isArray(o.items)) {
    return { items: o.items, total: o.totalItems ?? o.items.length, sampled: true }
  }
  return null
}

function str(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-16 h-1.5 rounded-full bg-raised overflow-hidden" aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--color-accent)' }} />
      </span>
      <span className="text-xs text-dim tabular-nums">{pct}%</span>
    </span>
  )
}

function JsonBlock({ payload }: { payload: ImportRunPayload }) {
  return (
    <details className="mt-3">
      <summary className="text-xs text-dim cursor-pointer select-none hover:text-text transition-colors">
        Raw JSON{payload.truncated ? ` — large payload sampled (original ${Math.round(payload.bytes / 1024)} KB)` : ''}
      </summary>
      <pre className="mt-2 p-3 rounded-[10px] bg-raised text-xs font-mono text-dim overflow-auto max-h-80 whitespace-pre-wrap break-all">
        {JSON.stringify(payload.value, null, 2)}
      </pre>
    </details>
  )
}

function MiniTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-[10px]" style={{ border: '1px solid var(--color-border)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-faint">
            {headers.map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
              {r.map((c, j) => <td key={j} className="px-3 py-2 text-dim align-top">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const DOMAIN_COLOR: Record<string, 'good' | 'blue' | 'purple' | 'warn' | 'default'> = {
  'product-framework': 'purple', forms: 'blue', 'rating-roc': 'good', rules: 'warn',
  'limits-deductibles': 'blue', 'rate-tables': 'good', definitions: 'default', ignore: 'default',
}

/** Business rendering of a stage payload; JSON fallback covers shape drift. */
function StagePayloadView({ stage, payload }: { stage: number | null; payload: ImportRunPayload }) {
  const v = payload.value
  const sample = asSample(v)

  if (stage === 0 && v && typeof v === 'object' && !sample) {
    const o = v as { workbooks?: unknown[]; filingDocs?: unknown[]; unknown?: unknown[]; lobRefIdHint?: string; lobSource?: string; edition?: string }
    return (
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {(o.workbooks ?? []).map((w, i) => <Badge key={`w${i}`} label={`${str(w)} → workbook brain`} color="good" />)}
          {(o.filingDocs ?? []).map((f, i) => <Badge key={`f${i}`} label={`${str(f)} → filing extraction`} color="blue" />)}
          {(o.unknown ?? []).map((u, i) => {
            const uo = u as { name?: string; reason?: string }
            return <Badge key={`u${i}`} label={`${uo?.name ?? str(u)} — not importable`} color="warn" />
          })}
        </div>
        <div className="text-xs text-dim">
          Line of business: <span className="text-text font-medium">{o.lobRefIdHint ?? 'not detected'}</span>
          {o.lobSource ? <span className="text-faint"> (from {o.lobSource})</span> : null}
          {o.edition ? <span> · Edition <span className="text-text font-medium">{o.edition}</span></span> : null}
        </div>
      </div>
    )
  }

  if (stage === 1 && sample) {
    const rows = sample.items.map((it) => {
      const s = it as { sheetName?: string; domain?: string; confidence?: number }
      return { sheet: s?.sheetName ?? '—', domain: s?.domain ?? '—', confidence: typeof s?.confidence === 'number' ? s.confidence : null }
    })
    return (
      <div className="overflow-x-auto rounded-[10px]" style={{ border: '1px solid var(--color-border)' }}>
        <table className="w-full text-xs">
          <thead><tr className="text-left text-faint"><th className="px-3 py-2 font-medium">Worksheet</th><th className="px-3 py-2 font-medium">Classified as</th><th className="px-3 py-2 font-medium">Confidence</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td className="px-3 py-2 text-text">{r.sheet}</td>
                <td className="px-3 py-2"><Badge label={r.domain} color={DOMAIN_COLOR[r.domain] ?? 'default'} /></td>
                <td className="px-3 py-2">{r.confidence != null ? <ConfidenceBar value={r.confidence} /> : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (stage === 3 && sample) {
    const rows = sample.items.map((it) => {
      const m = it as { sheetName?: string; mappings?: Array<{ canonicalField?: string | null }>; unmappedIndices?: unknown[] }
      const mapped = Array.isArray(m?.mappings) ? m.mappings.filter((c) => c?.canonicalField != null).length : 0
      const unmapped = Array.isArray(m?.unmappedIndices) ? m.unmappedIndices.length : 0
      return [m?.sheetName ?? '—', `${mapped} mapped`, unmapped > 0 ? `${unmapped} unmapped` : '—']
    })
    return <MiniTable headers={['Worksheet', 'Columns mapped', 'Unmapped']} rows={rows} />
  }

  if (stage === 4 && v && typeof v === 'object' && !sample) {
    const o = v as { entityCount?: number; flagged?: number }
    return (
      <div className="flex gap-3">
        <StatTile label="Entities extracted" value={String(o.entityCount ?? '—')} />
        <StatTile label="Flagged for review" value={String(o.flagged ?? 0)} />
      </div>
    )
  }

  if (stage === 5 && sample) {
    if (sample.total === 0) return <div className="text-sm text-good">No discrepancies — the adversarial validator found nothing to challenge.</div>
    return (
      <div className="flex flex-col gap-2">
        {sample.items.slice(0, 30).map((it, i) => {
          const d = it as { kind?: string; fieldName?: string; expected?: unknown; found?: unknown; detail?: string }
          return (
            <div key={i} className="rounded-[10px] p-3 bg-raised text-xs">
              <div className="flex items-center gap-2">
                <Badge label={d?.kind ?? 'discrepancy'} color="warn" />
                {d?.fieldName && <span className="font-mono text-dim">{d.fieldName}</span>}
              </div>
              {(d?.expected !== undefined || d?.found !== undefined) && (
                <div className="mt-1.5 text-dim">expected <span className="text-text font-mono">{str(d?.expected)}</span> · found <span className="text-text font-mono">{str(d?.found)}</span></div>
              )}
              {d?.detail && <div className="mt-1 text-dim">{d.detail}</div>}
            </div>
          )
        })}
      </div>
    )
  }

  if (stage === 7 && v && typeof v === 'object' && !sample) {
    const o = v as { counts?: { proposed?: number; accepted?: number; unresolved?: number }; completeness?: { assessment?: string; guidance?: string }; warnings?: number }
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <StatTile label="Proposed" value={String(o.counts?.proposed ?? '—')} />
          <StatTile label="Accepted" value={String(o.counts?.accepted ?? '—')} />
          <StatTile label="Unresolved" value={String(o.counts?.unresolved ?? 0)} />
        </div>
        {o.completeness?.assessment && (
          <div className="text-sm text-dim">
            Completeness: <Badge label={o.completeness.assessment} color={o.completeness.assessment === 'COMPLETE' ? 'good' : 'warn'} />
            {o.completeness.guidance && <div className="mt-1 text-xs">{o.completeness.guidance}</div>}
          </div>
        )}
        {typeof o.warnings === 'number' && o.warnings > 0 && <div className="text-xs text-warn">{o.warnings} import warning(s) attached to the plan — see “Warnings & unresolved” on the run.</div>}
      </div>
    )
  }

  // Generic: sampled arrays get a count line; everything gets the JSON view.
  return (
    <div>
      {sample && <div className="text-sm text-dim">{sample.total} item(s){sample.sampled ? ` — showing the first ${sample.items.length}` : ''}.</div>}
      <JsonBlock payload={payload} />
    </div>
  )
}

// ─── stage inspector drawer ───────────────────────────────────────────────────

function outputForStep(trace: ImportRunTrace, step: ImportRunStep): ImportRunPayload | null {
  if (step.stage != null) {
    const direct = trace.outputs[`brain:stage${step.stage}`]
    if (direct) return direct
  }
  return trace.outputs[step.name] ?? null
}

function inputForStep(trace: ImportRunTrace, step: ImportRunStep): ImportRunPayload | null {
  if (step.stage == null) return null
  if (step.stage <= 1) return trace.outputs['brain:input'] ?? null
  // Each stage consumes the previous stage's output.
  for (let s = step.stage - 1; s >= 0; s--) {
    const prev = trace.outputs[`brain:stage${s}`]
    if (prev) return prev
  }
  return null
}

function StageDrawer({ trace, step, onClose }: { trace: ImportRunTrace; step: ImportRunStep | null; onClose: () => void }) {
  const meta = step ? stageMeta(step.name) : null
  const output = step ? outputForStep(trace, step) : null
  const input = step ? inputForStep(trace, step) : null
  return (
    <Drawer open={step != null} onClose={onClose} title={meta?.title ?? ''} width="w-[560px]">
      {step && meta && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-dim leading-relaxed">{meta.blurb}</p>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-dim">
            <span>Started <span className="text-text">{step.startedAt ? new Date(step.startedAt).toLocaleTimeString() : '—'}</span></span>
            <span>Duration <span className="text-text tabular-nums">{fmtDuration(step.durationMs)}</span></span>
            <span>Status <span className={step.status === 'error' ? 'text-danger' : step.status === 'running' ? 'text-info' : 'text-good'}>{step.status}</span></span>
          </div>

          {(step.detail || step.result) && (
            <div className="rounded-[10px] p-3 bg-raised text-sm">
              {step.detail && <div className="text-dim">{step.detail}</div>}
              {step.result && <div className="text-text font-medium mt-1">{step.result}</div>}
            </div>
          )}

          {step.progress.length > 0 && (
            <details>
              <summary className="text-xs text-dim cursor-pointer select-none hover:text-text transition-colors">Progress log ({step.progress.length})</summary>
              <div className="mt-2 flex flex-col gap-1 max-h-48 overflow-y-auto">
                {step.progress.map((p, i) => <div key={i} className="text-xs font-mono text-dim">{p}</div>)}
              </div>
            </details>
          )}

          {input && (
            <section>
              <h3 className="text-xs font-semibold text-faint uppercase tracking-wide mb-2">Input (from the previous step)</h3>
              <JsonBlock payload={input} />
            </section>
          )}

          <section>
            <h3 className="text-xs font-semibold text-faint uppercase tracking-wide mb-2">Output</h3>
            {output
              ? <StagePayloadView stage={step.stage} payload={output} />
              : <div className="text-sm text-faint">This step reported progress only — its result flows into the next step.</div>}
          </section>
        </div>
      )}
    </Drawer>
  )
}

// ─── pipeline flow ────────────────────────────────────────────────────────────

interface FlowNode { name: string; step: ImportRunStep | null }

function buildFlow(trace: ImportRunTrace): FlowNode[] {
  const byName = new Map(trace.steps.map((s) => [s.name, s]))
  const expected = trace.path === 'workbook' ? WORKBOOK_STAGES : trace.path === 'structural' ? WORKBOOK_STAGES.slice(1) : []
  const names = [...expected]
  for (const s of trace.steps) if (!names.includes(s.name)) names.push(s.name)
  const nodes = names.map((name) => ({ name, step: byName.get(name) ?? null }))
  // Chronology wins where we have it; expected order fills in the gaps.
  return nodes.sort((a, b) => {
    const ta = a.step?.startedAt ? Date.parse(a.step.startedAt) : Infinity
    const tb = b.step?.startedAt ? Date.parse(b.step.startedAt) : Infinity
    if (ta !== tb) return ta - tb
    return names.indexOf(a.name) - names.indexOf(b.name)
  })
}

function PipelineFlow({ trace, onSelect }: { trace: ImportRunTrace; onSelect: (s: ImportRunStep) => void }) {
  const nodes = buildFlow(trace)
  const runFailed = trace.status === 'failed'
  return (
    <div className="overflow-x-auto pb-2" role="list" aria-label="Pipeline stages">
      <div className="flex items-stretch gap-0 min-w-max">
        {nodes.map((n, i) => {
          const meta = stageMeta(n.name)
          const Icon = meta.icon
          const s = n.step
          const state: 'done' | 'running' | 'error' | 'pending' = s ? s.status === 'running' ? 'running' : s.status === 'error' ? 'error' : 'done' : 'pending'
          const border = state === 'error' ? 'var(--color-danger-line)' : state === 'running' ? 'var(--color-accent-line)' : 'var(--color-border)'
          return (
            <div key={n.name} className="flex items-center" role="listitem">
              {i > 0 && (
                <svg width="28" height="12" viewBox="0 0 28 12" className="shrink-0" aria-hidden="true">
                  <line x1="0" y1="6" x2="20" y2="6" stroke="var(--color-border-strong)" strokeWidth="1.5" />
                  <path d="M20 2 L26 6 L20 10" fill="none" stroke="var(--color-border-strong)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              <button
                onClick={() => s && onSelect(s)}
                disabled={!s}
                aria-label={`${meta.title} — ${state}${s?.durationMs != null ? `, ${fmtDuration(s.durationMs)}` : ''}`}
                className={`w-44 shrink-0 text-left rounded-[12px] p-3 bg-surface transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                  ${s ? 'cursor-pointer hover:-translate-y-0.5' : 'opacity-50'}`}
                style={{
                  border: `1px solid ${border}`,
                  borderStyle: state === 'pending' ? 'dashed' : 'solid',
                  boxShadow: s ? 'var(--shadow-card)' : 'none',
                }}
              >
                <div className="flex items-center gap-2">
                  <span className={state === 'error' ? 'text-danger' : state === 'running' ? 'text-accent' : state === 'pending' ? 'text-faint' : 'text-good'}>
                    <Icon size={15} />
                  </span>
                  <span className="text-xs font-semibold text-text truncate">{meta.title}</span>
                  {state === 'running' && <span className="ml-auto w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: 'var(--color-accent)' }} aria-hidden="true" />}
                </div>
                <div className="mt-1.5 text-xs text-dim truncate" title={s?.result ?? s?.detail ?? undefined}>
                  {state === 'pending' ? (runFailed ? 'Not reached' : 'Waiting…') : (s?.result ?? s?.detail ?? 'In progress…')}
                </div>
                <div className="mt-1 text-xs text-faint tabular-nums">{s ? fmtDuration(s.durationMs) : ''}</div>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── timing waterfall + spend (single-hue magnitude bars) ─────────────────────

function Waterfall({ steps }: { steps: ImportRunStep[] }) {
  const timed = steps.filter((s) => s.durationMs != null && s.durationMs > 0)
  const total = timed.reduce((n, s) => n + (s.durationMs ?? 0), 0)
  if (total === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {timed.map((s) => {
        const pct = Math.max(1, Math.round(((s.durationMs ?? 0) / total) * 100))
        return (
          <div key={s.name} className="flex items-center gap-3 text-xs">
            <span className="w-40 shrink-0 text-dim truncate">{stageMeta(s.name).title}</span>
            <span className="flex-1 h-2.5 rounded-[4px] bg-raised overflow-hidden" aria-hidden="true">
              <span className="block h-full rounded-[4px]" style={{ width: `${pct}%`, background: 'var(--color-accent)' }} />
            </span>
            <span className="w-16 shrink-0 text-right text-dim tabular-nums">{fmtDuration(s.durationMs)}</span>
          </div>
        )
      })}
    </div>
  )
}

function SpendPanel({ trace }: { trace: ImportRunTrace }) {
  const spend = trace.spend
  if (!spend || !spend.byDeployment || Object.keys(spend.byDeployment).length === 0) {
    return <div className="text-sm text-faint">No AI calls recorded{trace.status === 'running' ? ' yet' : ''}.</div>
  }
  const rows = Object.entries(spend.byDeployment).sort((a, b) => (b[1]?.usd ?? 0) - (a[1]?.usd ?? 0))
  const max = Math.max(...rows.map(([, r]) => r?.usd ?? 0), 0.000001)
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([dep, r]) => (
        <div key={dep} className="flex items-center gap-3 text-xs">
          <span className="w-44 shrink-0 font-mono text-dim truncate" title={dep}>{dep}</span>
          <span className="flex-1 h-2.5 rounded-[4px] bg-raised overflow-hidden" aria-hidden="true">
            <span className="block h-full rounded-[4px]" style={{ width: `${Math.max(2, Math.round(((r?.usd ?? 0) / max) * 100))}%`, background: 'var(--color-accent)' }} />
          </span>
          <span className="w-40 shrink-0 text-right text-faint tabular-nums">{r?.calls ?? 0} calls · {fmtTokens(r?.inputTokens)} in / {fmtTokens(r?.outputTokens)} out</span>
          <span className="w-16 shrink-0 text-right text-text font-medium tabular-nums">{fmtUsd(r?.usd)}</span>
        </div>
      ))}
      <div className="flex justify-between text-xs pt-1.5 mt-0.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <span className="text-dim">{spend.calls} model call(s){spend.noCap ? ' — import runs uncapped, fully metered' : ''}</span>
        <span className="text-text font-semibold tabular-nums">{fmtUsd(spend.spendUsd)}</span>
      </div>
    </div>
  )
}

// ─── run detail ───────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      <h2 className="text-sm font-semibold text-text mb-3">{title}</h2>
      {children}
    </section>
  )
}

const noticeTone = (level: string) =>
  level === 'error' ? { color: 'text-danger', Icon: IconAlertCircle }
  : level === 'warn' ? { color: 'text-warn', Icon: IconWarning }
  : { color: 'text-info', Icon: IconInfo }

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [trace, setTrace] = useState<ImportRunTrace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ImportRunStep | null>(null)

  const load = useCallback(() => {
    adapter.tenancy.getImportRun(runId).then(setTrace).catch((e: Error) => setError(e.message))
  }, [runId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (trace?.status !== 'running') return
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5000)
    return () => clearInterval(id)
  }, [trace?.status, load])

  if (error) return <EmptyState icon={<IconAlertCircle size={28} />} title="Run unavailable" description={error} action={<Button onClick={onBack}>Back to runs</Button>} />
  if (!trace) return <div className="flex flex-col gap-3"><Skeleton className="h-24" /><Skeleton className="h-40" /><Skeleton className="h-32" /></div>

  const warnings = asSample(trace.outputs['importWarnings']?.value)
  const unresolved = asSample(trace.outputs['unresolved']?.value)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} aria-label="Back to all runs"><IconBack size={14} /><span className="ml-1">All runs</span></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <IconFileSpreadsheet size={16} className="text-accent shrink-0" />
            <h2 className="text-base font-semibold text-text truncate">{trace.sourceName ?? trace.runId}</h2>
            <RunStatusPill status={trace.status} needsReview={trace.needsReview} />
            {trace.path && <Badge label={trace.path === 'workbook' ? 'Workbook' : trace.path === 'filing' ? 'Filing PDF' : trace.path === 'fallback' ? 'Fallback' : 'Structural'} color="blue" />}
          </div>
          <div className="text-xs text-dim mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            <span>{new Date(trace.startedAt).toLocaleString()}</span>
            <span>Duration <span className="text-text tabular-nums">{fmtDuration(trace.durationMs)}</span></span>
            <span>Tenant <span className="text-text">{trace.tenantId}</span></span>
            {trace.actor?.name && <span>By <span className="text-text">{trace.actor.name}</span></span>}
            <span className="font-mono text-faint">{trace.runId}</span>
          </div>
        </div>
      </div>

      {trace.error && (
        <div className="rounded-[12px] p-4 flex items-start gap-3 text-sm" style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-line)' }}>
          <IconAlertCircle size={16} className="text-danger shrink-0 mt-0.5" />
          <div><span className="font-semibold text-danger">Import failed. </span><span className="text-text">{trace.error}</span></div>
        </div>
      )}

      {trace.outcome && (
        <div className="flex gap-3 flex-wrap">
          <StatTile label="Proposed" value={String(trace.outcome.proposed ?? '—')} hint="entities found in the source" />
          <StatTile label="Accepted" value={String(trace.outcome.accepted ?? '—')} hint="made it into the plan" />
          <StatTile label="Unresolved" value={String(trace.outcome.unresolved ?? 0)} hint="need a human decision" />
          <StatTile label="Coverages" value={String(trace.outcome.coverages)} hint={`${trace.outcome.forms} forms · ${trace.outcome.rules} rules`} />
          <StatTile label="AI spend" value={fmtUsd(trace.spend?.spendUsd)} hint={`${trace.spend?.calls ?? 0} model calls`} />
        </div>
      )}

      <Section title="Pipeline — click a stage to inspect its input and output">
        <PipelineFlow trace={trace} onSelect={setSelected} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Where the time went"><Waterfall steps={trace.steps} /></Section>
        <Section title="AI spend by model"><SpendPanel trace={trace} /></Section>
      </div>

      {trace.escalations.length > 0 && (
        <Section title="Escalations — where cheap models handed off to stronger ones">
          <div className="flex flex-wrap gap-2">
            {trace.escalations.map((e, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-raised text-xs text-dim">
                <IconEscalate size={12} className="text-warn" />
                <span className="text-text font-medium">{e.fromRole ?? '?'}</span>
                <IconChevronRight size={10} />
                <span className="text-text font-medium">{e.toRole ?? '?'}</span>
                {e.deployment && <span className="font-mono text-faint">({e.deployment})</span>}
              </span>
            ))}
          </div>
        </Section>
      )}

      {(trace.notices.length > 0 || warnings || unresolved) && (
        <Section title="Warnings & unresolved — flagged, never invented">
          <div className="flex flex-col gap-2">
            {trace.notices.map((n, i) => {
              const { color, Icon } = noticeTone(n.level)
              return (
                <div key={`n${i}`} className="flex items-start gap-2.5 text-sm">
                  <Icon size={14} className={`${color} shrink-0 mt-0.5`} />
                  <div className="text-dim">{n.kind && <span className="text-faint font-mono text-xs mr-2">{n.kind}</span>}{n.message}</div>
                </div>
              )
            })}
            {warnings && warnings.items.slice(0, 40).map((w, i) => {
              const o = w as { kind?: string; sheet?: string; detail?: string }
              return (
                <div key={`w${i}`} className="flex items-start gap-2.5 text-sm">
                  <IconWarning size={14} className="text-warn shrink-0 mt-0.5" />
                  <div className="text-dim">
                    <span className="text-faint font-mono text-xs mr-2">{o?.kind ?? 'warning'}</span>
                    {o?.sheet && <span className="text-text mr-1">{o.sheet}:</span>}{o?.detail ?? str(w)}
                  </div>
                </div>
              )
            })}
            {warnings && warnings.total > 40 && <div className="text-xs text-faint">…and {warnings.total - 40} more warning(s).</div>}
            {unresolved && unresolved.items.slice(0, 20).map((u, i) => {
              const o = u as { kind?: string; name?: string; reason?: string }
              return (
                <div key={`u${i}`} className="flex items-start gap-2.5 text-sm">
                  <IconAlertCircle size={14} className="text-danger shrink-0 mt-0.5" />
                  <div className="text-dim"><span className="text-text font-medium mr-1">{o?.name ?? o?.kind ?? 'unresolved'}</span>{o?.reason ?? ''}</div>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      <StageDrawer trace={trace} step={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

// ─── run list ─────────────────────────────────────────────────────────────────

function RunRow({ run, onOpen }: { run: ImportRunSummary; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-surface rounded-[14px] p-4 transition-all hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      aria-label={`Import run ${run.sourceName ?? run.runId}, ${run.status}`}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <IconFileSpreadsheet size={16} className="text-accent shrink-0" />
        <span className="font-medium text-sm text-text truncate max-w-72" title={run.sourceName ?? undefined}>{run.sourceName ?? run.runId}</span>
        {run.documents.length > 1 && <span className="text-xs text-faint">{run.documents.length} files</span>}
        <RunStatusPill status={run.status} needsReview={run.needsReview} />
        {run.path && <Badge label={run.path === 'workbook' ? 'Workbook' : run.path === 'filing' ? 'Filing PDF' : run.path === 'fallback' ? 'Fallback' : 'Structural'} />}
        <span className="ml-auto flex items-center gap-4 text-xs text-dim">
          <StageDots stages={run.stages} />
          <span className="tabular-nums">{fmtDuration(run.durationMs)}</span>
          <span className="tabular-nums">{fmtUsd(run.spendUsd)}</span>
          <span className="w-20 text-right">{timeAgo(run.startedAt)}</span>
          <IconChevronRight size={14} className="text-faint" />
        </span>
      </div>
      <div className="mt-1.5 pl-7 text-xs text-faint flex flex-wrap gap-x-4 gap-y-0.5">
        <span>{run.tenantId}{run.actor?.name ? ` · ${run.actor.name}` : ''}</span>
        {run.outcome && <span>{run.outcome.accepted ?? 0} accepted · {run.outcome.unresolved ?? 0} unresolved · {run.outcome.importWarnings} warning(s)</span>}
        {run.error && <span className="text-danger truncate max-w-96">{run.error}</span>}
        {run.escalations > 0 && <span className="text-warn">{run.escalations} escalation(s)</span>}
      </div>
    </button>
  )
}

export default function ImportRunsTab() {
  const [runs, setRuns] = useState<ImportRunSummary[] | null>(null)
  const [storage, setStorage] = useState<'cosmos' | 'memory'>('cosmos')
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(() => {
    adapter.tenancy.listImportRuns({ limit: 50 })
      .then((r) => { setRuns(r.runs); setStorage(r.storage); setError(null) })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(() => { if (document.visibilityState === 'visible') load() }, 10_000)
    return () => clearInterval(id)
  }, [load])

  const stats = useMemo(() => {
    if (!runs || runs.length === 0) return null
    const finished = runs.filter((r) => r.status !== 'running')
    const ok = finished.filter((r) => r.status === 'succeeded').length
    const durations = finished.map((r) => r.durationMs ?? 0).filter((d) => d > 0).sort((a, b) => a - b)
    const median = durations.length ? durations[Math.floor(durations.length / 2)] : null
    const spend = runs.reduce((n, r) => n + (r.spendUsd ?? 0), 0)
    return {
      total: runs.length,
      running: runs.filter((r) => r.status === 'running').length,
      successPct: finished.length ? Math.round((ok / finished.length) * 100) : null,
      needsReview: runs.filter((r) => r.needsReview).length,
      median, spend,
    }
  }, [runs])

  if (selected) return <RunDetail runId={selected} onBack={() => setSelected(null)} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-dim">
          Every document ingestion, stage by stage — what each step of the import brain saw, decided and produced.
          {storage === 'memory' && <span className="text-warn"> Traces are held in memory only (Cosmos not configured); they reset when the server restarts.</span>}
        </p>
        <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={load} aria-label="Refresh runs"><IconRefresh size={14} /><span className="ml-1">Refresh</span></Button>
      </div>

      {error && <div className="text-sm text-danger">{error}</div>}

      {runs === null && !error && <div className="flex flex-col gap-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>}

      {runs !== null && runs.length === 0 && (
        <EmptyState
          icon={<IconActivity size={28} />}
          title="No import runs yet"
          description="Run an import from the Products screen (Import workbook / filing PDF) and its full pipeline trace will appear here."
        />
      )}

      {runs !== null && runs.length > 0 && stats && (
        <>
          <div className="flex gap-3 flex-wrap">
            <StatTile label="Runs" value={String(stats.total)} hint={stats.running > 0 ? `${stats.running} running now` : 'most recent 50'} />
            <StatTile label="Success rate" value={stats.successPct != null ? `${stats.successPct}%` : '—'} hint="of finished runs" />
            <StatTile label="Needs review" value={String(stats.needsReview)} hint="unresolved items or warnings" />
            <StatTile label="Median duration" value={fmtDuration(stats.median)} />
            <StatTile label="AI spend" value={fmtUsd(stats.spend)} hint="across listed runs" />
          </div>
          <div className="flex flex-col gap-2.5">
            {runs.map((r) => <RunRow key={r.runId} run={r} onOpen={() => setSelected(r.runId)} />)}
          </div>
        </>
      )}
    </div>
  )
}
