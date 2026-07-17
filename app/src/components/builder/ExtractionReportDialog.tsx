// ExtractionReportDialog — the "0 forms — view extraction report" deep-link target
// (P3 task 3). Recon truth: the admin Import Runs surface is SUPER_ADMIN-only and
// not URL-addressable, so an EDITOR needs a Builder-scoped report. When the draft
// carries an importRunId (stamped at apply since P3), the full persisted bundle is
// recovered through the EDITOR-reachable POST /api/ai/unifiedImportResult seam;
// otherwise (legacy draft, or the run-result blob store is not configured) the
// dialog degrades HONESTLY to the persisted readiness summary and says so.
import { useEffect, useState } from 'react'
import { adapter } from '../../lib/backend'
import type { DraftReadiness } from '../../lib/backend'
import { Dialog } from '../ui'
import { IconSpinner, IconWarning, IconAlertCircle } from '../ui/icons'

interface RunResult {
  runId: string
  finishedAt: string
  bundle: {
    counts?: { proposed?: number; accepted?: number; unresolved?: number }
    unresolved?: { label?: string; name?: string; reason?: string; severity?: string }[]
    importWarnings?: { kind?: string; detail?: string; sheet?: string | null; row?: number | null }[]
    completeness?: { assessment?: string; missing?: string[]; guidance?: string }
  }
}

interface Props {
  title:       string
  importRunId?: string | null
  readiness?:  DraftReadiness | null
  onClose:     () => void
}

const MAX_ROWS = 50
const num = (v: number | undefined) => (typeof v === 'number' ? v.toLocaleString('en-US') : '—')

export function ExtractionReportDialog({ title, importRunId, readiness, onClose }: Props) {
  const [loading, setLoading] = useState(!!importRunId)
  const [run, setRun]         = useState<RunResult | null>(null)
  const [fetchNote, setNote]  = useState<string | null>(null)

  useEffect(() => {
    if (!importRunId) return
    let cancelled = false
    adapter.fns.call<{ runId: string }, RunResult>('unifiedImportResult', { runId: importRunId })
      .then((r) => { if (!cancelled) setRun(r) })
      .catch((e) => {
        if (!cancelled) setNote(e instanceof Error ? e.message : 'The stored run result could not be loaded.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [importRunId])

  const r = readiness && readiness.source === 'summary' ? readiness : null
  const unresolved = run?.bundle.unresolved ?? []
  const warnings = run?.bundle.importWarnings ?? []

  return (
    <Dialog open title={`Extraction report — ${title}`} onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-4 text-sm">
        {/* Persistent live region: announces the loading → loaded/degraded swap to
            screen readers (the visual swap is otherwise silent). */}
        <p role="status" aria-live="polite" className="sr-only">
          {loading ? 'Loading the stored run result…'
            : run ? 'Extraction report loaded.'
            : 'Full run bundle unavailable — showing the readiness summary persisted with the draft.'}
        </p>
        {loading ? (
          <div className="flex items-center gap-2 py-6 justify-center text-dim">
            <IconSpinner size={16} className="animate-spin" aria-hidden="true" /> Loading the stored run result…
          </div>
        ) : (
          <>
            {/* Counts — from the recovered bundle when available, else the persisted summary. */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-dim tabular-nums">
              <span>Proposed <span className="font-medium text-text">{num(run?.bundle.counts?.proposed ?? (r?.citations ? r.citations.accepted + r.citations.unresolved : undefined))}</span></span>
              <span>Accepted <span className="font-medium text-text">{num(run?.bundle.counts?.accepted ?? r?.citations?.accepted)}</span></span>
              <span>Unresolved <span className="font-medium text-text">{num(run?.bundle.counts?.unresolved ?? r?.citations?.unresolved)}</span></span>
              {run?.bundle.completeness?.assessment && (
                <span>Completeness <span className="font-medium text-text">{run.bundle.completeness.assessment}</span></span>
              )}
              {r?.validation && <span>Validation <span className="font-medium text-text">{r.validation}</span></span>}
            </div>

            {/* Blockers — always the server's persisted reasons, verbatim. */}
            {r && r.blockers.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-[12px] p-3" style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-border)' }}>
                <span className="flex items-center gap-1.5 font-medium text-danger text-xs">
                  <IconWarning size={13} aria-hidden="true" /> Blocking issues ({r.blockers.length.toLocaleString('en-US')})
                </span>
                <ul className="flex flex-col gap-1 text-xs text-dim list-disc pl-4">
                  {r.blockers.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            )}

            {unresolved.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-warn">
                  <IconAlertCircle size={13} aria-hidden="true" /> Unresolved items ({unresolved.length.toLocaleString('en-US')})
                </span>
                <ul className="flex flex-col gap-1 text-xs text-dim max-h-[30vh] overflow-y-auto list-disc pl-4">
                  {unresolved.slice(0, MAX_ROWS).map((u, i) => (
                    <li key={i}>
                      <span className="text-text">{u.label ?? u.name ?? 'Item'}</span>
                      {u.severity === 'BLOCKING' && <span className="text-danger"> · blocking</span>}
                      {u.reason ? ` — ${u.reason}` : ''}
                    </li>
                  ))}
                  {unresolved.length > MAX_ROWS && <li className="text-faint">…and {(unresolved.length - MAX_ROWS).toLocaleString('en-US')} more</li>}
                </ul>
              </div>
            )}

            {warnings.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-dim">Import warnings ({warnings.length.toLocaleString('en-US')})</span>
                <ul className="flex flex-col gap-1 text-xs text-dim max-h-[24vh] overflow-y-auto list-disc pl-4">
                  {warnings.slice(0, MAX_ROWS).map((w, i) => (
                    <li key={i}>{w.kind ? <span className="font-mono text-[10px] text-faint">{w.kind}</span> : null} {w.detail ?? ''}</li>
                  ))}
                  {warnings.length > MAX_ROWS && <li className="text-faint">…and {(warnings.length - MAX_ROWS).toLocaleString('en-US')} more</li>}
                </ul>
              </div>
            )}

            {!run && (
              <p className="text-xs text-faint">
                {importRunId
                  ? `The full run bundle isn't available${fetchNote ? ` (${fetchNote})` : ''} — showing the readiness summary persisted with the draft.`
                  // No runId + a persisted summary = the local XLSX path, which never
                  // runs a server extraction — say that, not "before run tracking".
                  : r
                    ? 'This draft was imported from a local workbook — no server extraction run exists; showing the readiness summary persisted with the draft.'
                    : 'This draft was imported before run tracking, so no stored run bundle exists.'}
                {!r && ' No readiness summary was persisted either; this draft predates readiness tracking entirely.'}
              </p>
            )}
            {run && unresolved.length === 0 && warnings.length === 0 && (!r || r.blockers.length === 0) && (
              <p className="text-xs text-dim">The stored run reported no unresolved items, warnings, or blockers.</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}
