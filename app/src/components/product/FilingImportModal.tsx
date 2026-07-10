// FilingImportModal — EDITOR/ADMIN-only importer for a real carrier rate FILING (the documents
// carriers actually file: a rate order of calculations, a rate manual, a policy form). It
// streams the PDFs to the `filingImport` Cloud Function (CLASSIFY → EXTRACT → RECONCILE),
// PREVIEWS the reconciled bundle — UNRESOLVED items FIRST, then per-section proposals with a
// confidence + citation each — and, on confirm, persists the accepted sections through the
// SAME atomic path the workbook importer uses (importPlan → adapter.db.mutate()), stamped with
// IMPORT lineage naming the filing documents. Nothing is written until the user accepts, and an
// UNRESOLVED item is never persisted — it is shown so the gap is visible, never silently dropped.
import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { FilingImportPlan, FilingReviewSectionKey, ImportPlan } from '@pf/shared'
import { useUser } from '../../context/useUser'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import {
  IconUpload, IconFile, IconCheckCircle, IconWarning, IconInfo, IconSpinner,
  IconCoverage, IconRule, IconPricing, IconTable, IconArrowRight, IconClose,
} from '../ui/icons'
import { readFilingFiles, runFilingImport, type FilingStageEvent } from '../../lib/import/filingImportClient'
import { importPlan, type ImportProgress, type ImportResult } from '../../lib/import/importProduct'
import { newDraftId, filingLineage } from '../../lib/draft/draft'

interface Props { onClose: () => void; onImported: (productId: string) => void }
type Phase = 'select' | 'streaming' | 'review' | 'importing' | 'done' | 'error'

// The five reviewable sections (product is always kept). UNRESOLVED is shown above these.
const SECTION_META: { key: FilingReviewSectionKey; label: string; Icon: typeof IconCoverage }[] = [
  { key: 'coverages', label: 'Coverages', Icon: IconCoverage },
  { key: 'tables',    label: 'Rate & L&D tables', Icon: IconTable },
  { key: 'rules',     label: 'Rules', Icon: IconRule },
  { key: 'rating',    label: 'Rating program', Icon: IconPricing },
]

function confidenceColor(c: number): string {
  return c >= 0.8 ? 'var(--color-good)' : c >= 0.5 ? 'var(--color-warn)' : 'var(--color-faint)'
}

/** Build the ImportPlan for the ACCEPTED sections only. Product is always kept; the rating
 *  program pulls its tables in when it is accepted (a step would dangle without them). */
function acceptedPlan(bundle: FilingImportPlan, accepted: Set<FilingReviewSectionKey>): ImportPlan {
  const p = bundle.plan
  const keepTables = accepted.has('tables') || accepted.has('rating')
  return {
    ...p,
    coverages: accepted.has('coverages') ? p.coverages : [],
    forms:     accepted.has('coverages') ? p.forms : [],
    rtTables:  keepTables ? p.rtTables : [],
    ldTables:  keepTables ? p.ldTables : [],
    rules:     accepted.has('rules') ? p.rules : [],
    ratingProgram: accepted.has('rating') ? p.ratingProgram : null,
  }
}

export function FilingImportModal({ onClose, onImported }: Props) {
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'

  const [phase, setPhase]     = useState<Phase>('select')
  const [dragOver, setDrag]   = useState(false)
  const [fileNames, setFiles] = useState<string[]>([])
  const [stages, setStages]   = useState<FilingStageEvent[]>([])
  const [bundle, setBundle]   = useState<FilingImportPlan | null>(null)
  const [accepted, setAccepted] = useState<Set<FilingReviewSectionKey>>(new Set())
  const [progress, setProgress] = useState<ImportProgress>({ done: 0, total: 0, label: '' })
  const [result, setResult]   = useState<ImportResult | null>(null)
  const [error, setError]     = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(async (files: File[]) => {
    const docs = files.filter(f => /\.(pdf|txt)$/i.test(f.name))
    if (!docs.length) { setError('Please choose the filing PDFs (rate order, manual, policy form).'); setPhase('error'); return }
    setFiles(docs.map(f => f.name)); setStages([]); setError(''); setPhase('streaming')
    try {
      const documents = await readFilingFiles(docs)
      const b = await runFilingImport(documents, {
        onStage: (e) => setStages(prev => [...prev, e]),
      })
      setBundle(b)
      setAccepted(new Set<FilingReviewSectionKey>(['coverages', 'tables', 'rules', 'rating']))
      setPhase('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the filing.')
      setPhase('error')
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    void handleFiles(Array.from(e.dataTransfer.files))
  }, [handleFiles])

  const toggle = (k: FilingReviewSectionKey) => setAccepted(prev => {
    const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n
  })

  async function runImport() {
    if (!bundle?.plan.product || !bundle.plan.productId || !user) return
    setPhase('importing')
    setProgress({ done: 0, total: 0, label: 'Starting…' })
    try {
      const actor = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
      const draftId = newDraftId(bundle.plan.productId)
      const lineage = filingLineage(fileNames, bundle.baseFormNumber, bundle.filingState, actor)
      const res = await importPlan(acceptedPlan(bundle, accepted), actor, setProgress, { productId: draftId, lineage })
      setResult(res); setPhase('done')
      if (res.failed) toast.warning(`Imported ${res.written} items as a draft, ${res.failed} skipped`)
      else toast.success(`Imported ${res.written} items as a draft`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
      setPhase('error')
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Dialog open title="Import a rate filing" onClose={onClose} width="max-w-2xl">
      {!canEdit ? (
        <p className="text-sm text-danger">You need editor access to import a filing.</p>
      ) : phase === 'select' ? (
        <SelectPane
          dragOver={dragOver} setDrag={setDrag} onDrop={onDrop}
          onBrowse={() => inputRef.current?.click()} inputRef={inputRef} onFiles={handleFiles}
        />
      ) : phase === 'streaming' ? (
        <StreamingPane fileNames={fileNames} stages={stages} />
      ) : phase === 'review' && bundle ? (
        <ReviewPane bundle={bundle} accepted={accepted} toggle={toggle} onCancel={onClose} onImport={runImport} />
      ) : phase === 'importing' ? (
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-center gap-2 text-sm text-text">
            <IconSpinner size={16} className="animate-spin text-accent" aria-hidden="true" />
            Writing {progress.done} of {progress.total}…
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-raised" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--color-accent-bright), var(--color-accent-strong))' }} />
          </div>
          <p className="text-xs text-faint truncate">{progress.label}</p>
        </div>
      ) : phase === 'done' && result ? (
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <span className="flex items-center justify-center w-12 h-12 rounded-full" style={{ background: 'var(--color-accent-soft)' }}>
              <IconCheckCircle size={26} className="text-good" />
            </span>
            <div className="text-base font-semibold text-text">Draft created from the filing</div>
            <p className="text-sm text-dim">
              {result.written} item{result.written !== 1 ? 's' : ''} written to a new draft
              {result.failed ? <span className="text-danger"> · {result.failed} skipped</span> : null}. Open pricing to see the trace.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => onImported(result.productId)}>Open draft <IconArrowRight size={14} /></Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-start gap-2.5 rounded-[12px] p-3.5 bg-danger/10" style={{ border: '1px solid var(--color-border)' }}>
            <IconClose size={16} className="text-danger shrink-0 mt-0.5" />
            <div className="text-sm text-dim">{error || 'Something went wrong.'}</div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => { setPhase('select'); setError(''); setBundle(null) }}>Try again</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

// ─── Panes ────────────────────────────────────────────────────────────────────────

function SelectPane({ dragOver, setDrag, onDrop, onBrowse, inputRef, onFiles }: {
  dragOver: boolean; setDrag: (b: boolean) => void; onDrop: (e: React.DragEvent) => void
  onBrowse: () => void; inputRef: React.RefObject<HTMLInputElement | null>; onFiles: (f: File[]) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-dim">
        Upload the documents a carrier actually files — the <span className="text-text font-medium">rate order of calculations</span>,
        the <span className="text-text font-medium">rate manual</span>, and the <span className="text-text font-medium">policy form</span>.
        We classify each, extract the rating variables, rules and coverages, and reconcile them into
        one <span className="text-text font-medium">draft</span> you review before anything is written. Rate tables are parsed deterministically —
        the model never transcribes a factor.
      </p>
      <button
        type="button" onClick={onBrowse}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)} onDrop={onDrop}
        className="group flex flex-col items-center justify-center gap-3 rounded-[14px] py-10 px-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ border: `1.5px dashed ${dragOver ? 'var(--color-accent)' : 'var(--color-border-strong)'}`, background: dragOver ? 'var(--color-accent-soft)' : 'var(--color-surface)' }}
      >
        <span className="flex items-center justify-center w-12 h-12 rounded-[12px]" style={{ background: 'var(--color-accent-soft)' }}>
          <IconUpload size={22} className="text-accent" />
        </span>
        <span className="text-sm font-medium text-text">Drop the filing PDFs here, or click to browse</span>
        <span className="text-xs text-faint">.pdf · rate order · manual · policy form</span>
      </button>
      <input ref={inputRef} type="file" accept=".pdf,.txt,application/pdf" multiple className="sr-only"
        onChange={e => { if (e.target.files) void onFiles(Array.from(e.target.files)) }} />
    </div>
  )
}

function StreamingPane({ fileNames, stages }: { fileNames: string[]; stages: FilingStageEvent[] }) {
  // Collapse tool start/end into a live checklist of stages.
  const rows = stages.filter(s => s.kind === 'tool')
  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex items-center gap-2 text-sm text-text">
        <IconSpinner size={16} className="animate-spin text-accent" aria-hidden="true" />
        Reading {fileNames.length} document{fileNames.length !== 1 ? 's' : ''} — classify · extract · reconcile…
      </div>
      <div className="flex flex-col gap-1.5 max-h-[46vh] overflow-y-auto">
        {rows.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {s.phase === 'end'
              ? <IconCheckCircle size={13} className="text-good shrink-0" />
              : <IconSpinner size={13} className="animate-spin text-accent shrink-0" aria-hidden="true" />}
            <span className="font-mono text-dim">{s.name}</span>
            {s.summary && <span className="text-faint truncate">· {s.summary}</span>}
          </div>
        ))}
        {stages.filter(s => s.kind === 'notice' && s.message).map((s, i) => (
          <div key={`n${i}`} className="flex items-center gap-2 text-xs text-warn"><IconInfo size={13} />{s.message}</div>
        ))}
      </div>
    </div>
  )
}

function ReviewPane({ bundle, accepted, toggle, onCancel, onImport }: {
  bundle: FilingImportPlan; accepted: Set<FilingReviewSectionKey>
  toggle: (k: FilingReviewSectionKey) => void; onCancel: () => void; onImport: () => void
}) {
  const { review, unresolved, counts } = bundle
  const acceptedCount = useMemo(() => SECTION_META.filter(s => accepted.has(s.key)).length, [accepted])
  return (
    <div className="flex flex-col gap-4">
      {/* Product header */}
      <div className="flex items-center gap-3 rounded-[12px] p-3.5" style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-border)' }}>
        <span className="flex items-center justify-center w-9 h-9 rounded-[10px] shrink-0" style={{ background: 'var(--gradient-accent)' }}>
          <IconFile size={18} className="text-white" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text truncate">{review.product.items[0]?.label}</div>
          <div className="text-xs text-dim">
            <span className="font-mono">{bundle.baseFormNumber} {bundle.baseFormEdition}</span> · {bundle.filingState} ·{' '}
            <span className="tnum">{counts.accepted}</span> proposed · <span className="tnum">{counts.unresolved}</span> unresolved
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 max-h-[52vh] overflow-y-auto -mx-1 px-1">
        {/* UNRESOLVED — first, and never persisted */}
        {unresolved.length > 0 && (
          <section className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-warn-line, var(--color-border))' }}>
            <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ background: 'var(--color-warn-soft, var(--color-raised))' }}>
              <IconWarning size={15} className="text-warn" />
              <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-text">Unresolved</h4>
              <span className="text-[11px] text-faint tnum">{unresolved.length}</span>
              <span className="text-[11px] text-faint ml-auto">shown, not written — nothing is silently dropped</span>
            </div>
            <ul className="flex flex-col gap-1.5 px-3.5 py-2.5">
              {unresolved.map((u, i) => (
                <li key={i} className="text-xs">
                  <span className="font-medium text-text">{u.name}</span>
                  <span className="text-faint"> — {u.reason}</span>
                  <span className="block text-[11px] text-faint truncate" title={u.citation}>Cited: {u.citation}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Per-section accept */}
        {SECTION_META.map(({ key, label, Icon }) => {
          const section = review[key]
          if (!section.items.length && !section.note) return null
          const on = accepted.has(key)
          return (
            <section key={key} className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={on} onChange={() => toggle(key)}
                  className="w-4 h-4 accent-[var(--color-accent)] shrink-0" aria-label={`Accept ${label}`} />
                <Icon size={15} className="text-dim shrink-0" aria-hidden="true" />
                <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-dim">{label}</h4>
                <span className="text-[11px] text-faint tnum">{section.items.length}</span>
                <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                <span className="text-[11px] text-faint">{on ? 'Accepted' : 'Skipped'}</span>
              </label>
              {section.note && <p className="text-xs text-faint italic px-0.5">{section.note}</p>}
              <div className={`flex flex-col gap-1.5 ${on ? '' : 'opacity-50'}`}>
                {section.items.map((it, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-[10px] p-2.5 bg-raised" style={{ border: '1px solid var(--color-border)' }}>
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {it.refId && <span className="text-[11px] font-mono text-accent shrink-0">{it.refId}</span>}
                        <span className="text-[13px] text-text truncate">{it.label}</span>
                      </div>
                      {it.detail && <span className="text-[11px] text-dim font-mono truncate" title={it.detail}>{it.detail}</span>}
                      <span className="text-[11px] text-faint truncate" title={it.citation}>Cited: {it.citation}</span>
                    </div>
                    <span className="text-[11px] font-mono tnum shrink-0 mt-0.5" style={{ color: confidenceColor(it.confidence) }} title="Confidence">
                      {Math.round(it.confidence * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-faint">{acceptedCount} section{acceptedCount === 1 ? '' : 's'} accepted</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onImport}>Import as draft <IconArrowRight size={14} /></Button>
        </div>
      </div>
    </div>
  )
}
