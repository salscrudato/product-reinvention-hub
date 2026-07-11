// UnifiedImportModal — EDITOR/ADMIN-only entry point for ALL ingestion formats:
// ISO workbooks (XLSX), carrier filing PDFs, SERFF packages, ERC packages, and
// unknown formats. Streams to the `unifiedImport` Cloud Function (7-stage pipeline).
//
// Review invariants that hold for every format:
//   • UNRESOLVED items are first-class and always shown above accepted sections.
//   • FormatCard proposals are a DISTINCT approval lane — clearly labelled, never
//     mixed with ordinary review sections, never auto-persisted.
//   • SplitProduct proposals are shown so the reviewer sees what multi-product
//     structure was detected.
//   • Nothing is written to Firestore until the reviewer clicks "Import as draft".
//   • Writes go through importPlan() → adapter.db.mutate() — identical to the
//     existing FilingImportModal path, so the mutation invariant holds.
//   • VIEWER sees the import button as disabled; the whole modal is read-only.
import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  UnifiedProposalBundle, FilingReviewSectionKey, ImportPlan,
  FormatCard, FormatFingerprint, SplitProductProposal, SampledVerification,
} from '@pf/shared'
import { DisagreementHeatmap } from './DisagreementHeatmap'
import { useUser } from '../context/useUser'
import { Dialog } from '../components/ui/Dialog'
import { Button } from '../components/ui/Button'
import { NoticeBanner } from '../components/ui/NoticeBanner'
import {
  IconUpload, IconFile, IconCheckCircle, IconWarning, IconSpinner,
  IconCoverage, IconRule, IconPricing, IconTable, IconArrowRight, IconClose,
} from '../components/ui/icons'
import { readUploadFiles, runUnifiedImport, type UnifiedStageEvent } from './unifiedImportClient'
import { importPlan, type ImportProgress, type ImportResult } from '../lib/import/importProduct'
import { newDraftId, filingLineage, importLineage } from '../lib/draft/draft'

interface Props { onClose: () => void; onImported: (productId: string) => void }
type Phase = 'select' | 'streaming' | 'review' | 'importing' | 'done' | 'error'

const SECTION_META: { key: FilingReviewSectionKey; label: string; Icon: typeof IconCoverage }[] = [
  { key: 'coverages', label: 'Coverages',          Icon: IconCoverage },
  { key: 'tables',    label: 'Rate & L&D tables',  Icon: IconTable    },
  { key: 'rules',     label: 'Rules',              Icon: IconRule     },
  { key: 'rating',    label: 'Rating program',     Icon: IconPricing  },
]

// Token-only color helpers — never raw hex outside CSS vars.
function confidenceColor(c: number): string {
  return c >= 0.8 ? 'var(--color-good)' : c >= 0.5 ? 'var(--color-warn)' : 'var(--color-faint)'
}

function acceptedPlan(bundle: UnifiedProposalBundle, accepted: Set<FilingReviewSectionKey>): ImportPlan {
  const p = bundle.plan
  const keepTables = accepted.has('tables') || accepted.has('rating')
  return {
    ...p,
    coverages:     accepted.has('coverages') ? p.coverages : [],
    forms:         accepted.has('coverages') ? p.forms     : [],
    rtTables:      keepTables ? p.rtTables : [],
    ldTables:      keepTables ? p.ldTables : [],
    rules:         accepted.has('rules')    ? p.rules      : [],
    ratingProgram: accepted.has('rating')   ? p.ratingProgram : null,
  }
}

function buildLineage(bundle: UnifiedProposalBundle, fileNames: string[], actor: { uid: string; name: string }) {
  const { detectedFormat } = bundle.fingerprint
  if (detectedFormat === 'ISO_WORKBOOK') {
    return importLineage(fileNames, bundle.plan.product?.refId ?? null, actor)
  }
  return filingLineage(fileNames, bundle.baseFormNumber, bundle.filingState, actor)
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function UnifiedImportModal({ onClose, onImported }: Props) {
  const { user }   = useUser()
  const canEdit    = user?.role === 'EDITOR' || user?.role === 'ADMIN'

  const [phase, setPhase]       = useState<Phase>('select')
  const [dragOver, setDrag]     = useState(false)
  const [fileNames, setFiles]   = useState<string[]>([])
  const [stages, setStages]     = useState<UnifiedStageEvent[]>([])
  const [bundle, setBundle]     = useState<UnifiedProposalBundle | null>(null)
  const [accepted, setAccepted] = useState<Set<FilingReviewSectionKey>>(new Set())
  const [cardStatus, setCardStatus] = useState<'PROPOSED' | 'APPROVED' | 'REJECTED'>('PROPOSED')
  const [progress, setProgress] = useState<ImportProgress>({ done: 0, total: 0, label: '' })
  const [result, setResult]     = useState<ImportResult | null>(null)
  const [error, setError]       = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(async (files: File[]) => {
    const validTypes = /\.(pdf|xlsx|xls|zip|txt|xml|csv)$/i
    const docs = files.filter(f => validTypes.test(f.name) || f.type !== '')
    if (!docs.length) {
      setError('Choose at least one document (PDF, XLSX, ZIP, TXT, XML, or CSV).')
      setPhase('error')
      return
    }
    setFiles(docs.map(f => f.name)); setStages([]); setError(''); setPhase('streaming')
    try {
      const documents = await readUploadFiles(docs)
      const b = await runUnifiedImport(documents, {
        onStage: (e) => setStages(prev => [...prev, e]),
      })
      setBundle(b)
      setCardStatus(b.formatCard?.status ?? 'PROPOSED')
      setAccepted(new Set<FilingReviewSectionKey>(['coverages', 'tables', 'rules', 'rating']))
      setPhase('review')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
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
      const actor   = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
      const draftId = newDraftId(bundle.plan.productId)
      const lineage = buildLineage(bundle, fileNames, actor)
      const res = await importPlan(acceptedPlan(bundle, accepted), actor, setProgress, { productId: draftId, lineage })
      setResult(res); setPhase('done')
      if (res.failed) toast.warning(`Imported ${res.written} items as a draft, ${res.failed} skipped`)
      else            toast.success(`Imported ${res.written} items as a draft`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
      setPhase('error')
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Dialog open title="Unified import" onClose={onClose} width="max-w-2xl">
      {!canEdit ? (
        <p className="text-sm text-danger">Editor access is required to import documents.</p>
      ) : phase === 'select' ? (
        <SelectPane
          dragOver={dragOver} setDrag={setDrag} onDrop={onDrop}
          onBrowse={() => inputRef.current?.click()} inputRef={inputRef} onFiles={handleFiles}
        />
      ) : phase === 'streaming' ? (
        <StreamingPane fileNames={fileNames} stages={stages} />
      ) : phase === 'review' && bundle ? (
        <ReviewPane
          bundle={bundle} accepted={accepted} toggle={toggle} cardStatus={cardStatus}
          setCardStatus={setCardStatus} onCancel={onClose} onImport={runImport}
        />
      ) : phase === 'importing' ? (
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-center gap-2 text-sm text-text">
            <IconSpinner size={16} className="animate-spin text-accent" aria-hidden="true" />
            Writing {progress.done} of {progress.total}…
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-raised"
            role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all duration-200"
              style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--color-accent-bright), var(--color-accent-strong))' }} />
          </div>
          <p className="text-xs text-faint truncate">{progress.label}</p>
        </div>
      ) : phase === 'done' && result ? (
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <span className="flex items-center justify-center w-12 h-12 rounded-full"
              style={{ background: 'var(--color-accent-soft)' }}>
              <IconCheckCircle size={26} className="text-good" />
            </span>
            <div className="text-base font-semibold text-text">Draft created</div>
            <p className="text-sm text-dim">
              {result.written} item{result.written !== 1 ? 's' : ''} written to a new draft
              {result.failed ? <span className="text-danger"> · {result.failed} skipped</span> : null}.
              Open pricing to see the trace.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => onImported(result.productId)}>
              Open draft <IconArrowRight size={14} />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-start gap-2.5 rounded-[12px] p-3.5 bg-danger/10"
            style={{ border: '1px solid var(--color-border)' }}>
            <IconClose size={16} className="text-danger shrink-0 mt-0.5" />
            <div className="text-sm text-dim">{error || 'Something went wrong.'}</div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => { setPhase('select'); setError(''); setBundle(null) }}>
              Try again
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

// ─── Panes ────────────────────────────────────────────────────────────────────

function SelectPane({ dragOver, setDrag, onDrop, onBrowse, inputRef, onFiles }: {
  dragOver:  boolean; setDrag: (b: boolean) => void; onDrop: (e: React.DragEvent) => void
  onBrowse:  () => void; inputRef: React.RefObject<HTMLInputElement | null>
  onFiles:   (f: File[]) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-dim">
        Upload any insurance document — ISO workbook (XLSX), carrier filing PDFs, SERFF package,
        or ERC package. The pipeline classifies the format, extracts fields deterministically, and
        presents a <span className="text-text font-medium">draft</span> you review before anything
        is written. Rate tables are parsed deterministically — the model never transcribes a factor.
        Unknown formats trigger a <span className="text-text font-medium">FormatCard</span> proposal
        for human review.
      </p>
      <button
        type="button" onClick={onBrowse}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)} onDrop={onDrop}
        className="group flex flex-col items-center justify-center gap-3 rounded-[14px] py-10 px-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{
          border:     `1.5px dashed ${dragOver ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
          background: dragOver ? 'var(--color-accent-soft)' : 'var(--color-surface)',
        }}
      >
        <span className="flex items-center justify-center w-12 h-12 rounded-[12px]"
          style={{ background: 'var(--color-accent-soft)' }}>
          <IconUpload size={22} className="text-accent" />
        </span>
        <span className="text-sm font-medium text-text">Drop documents here, or click to browse</span>
        <span className="text-xs text-faint">.pdf · .xlsx · .zip · .txt · .xml · .csv</span>
      </button>
      <input ref={inputRef} type="file" aria-label="Choose files to import (PDF, Excel, ZIP, XML, CSV or text)"
        accept=".pdf,.xlsx,.xls,.zip,.txt,.xml,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/zip,text/plain,text/xml,text/csv"
        multiple className="sr-only"
        onChange={e => { if (e.target.files) void onFiles(Array.from(e.target.files)) }} />
    </div>
  )
}

function StreamingPane({ fileNames, stages }: { fileNames: string[]; stages: UnifiedStageEvent[] }) {
  const rows    = stages.filter(s => s.kind === 'tool')
  const notices = stages.filter(s => s.kind === 'notice' && s.notice)
  return (
    <div className="flex flex-col gap-4 py-2" role="status" aria-live="polite" aria-label="Import progress">
      <div className="flex items-center gap-2 text-sm text-text">
        <IconSpinner size={16} className="animate-spin text-accent" aria-hidden="true" />
        Reading {fileNames.length} document{fileNames.length !== 1 ? 's' : ''} — fingerprint · plan · extract · reconcile…
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
      </div>
      {notices.map((s, i) => (
        <NoticeBanner key={`n${i}`} notice={s.notice!} />
      ))}
    </div>
  )
}

// ─── Review pane ──────────────────────────────────────────────────────────────

function ReviewPane({ bundle, accepted, toggle, cardStatus, setCardStatus, onCancel, onImport }: {
  bundle:         UnifiedProposalBundle
  accepted:       Set<FilingReviewSectionKey>
  toggle:         (k: FilingReviewSectionKey) => void
  cardStatus:     'PROPOSED' | 'APPROVED' | 'REJECTED'
  setCardStatus:  (s: 'PROPOSED' | 'APPROVED' | 'REJECTED') => void
  onCancel:       () => void
  onImport:       () => void
}) {
  const { review, unresolved, counts, fingerprint, splitProducts, sampledVerifications, formatCard, ensembleDisagreements } = bundle
  const acceptedCount = useMemo(() => SECTION_META.filter(s => accepted.has(s.key)).length, [accepted])

  return (
    <div className="flex flex-col gap-4">
      {/* Header — product + fingerprint */}
      <div className="flex items-center gap-3 rounded-[12px] p-3.5"
        style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-border)' }}>
        <span className="flex items-center justify-center w-9 h-9 rounded-[10px] shrink-0"
          style={{ background: 'var(--gradient-accent)' }}>
          <IconFile size={18} className="text-white" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text truncate">
            {review.product.items[0]?.label ?? 'Imported product'}
          </div>
          <div className="text-xs text-dim flex items-center gap-1.5 flex-wrap">
            {bundle.baseFormNumber &&
              <span className="font-mono">{bundle.baseFormNumber} {bundle.baseFormEdition}</span>}
            {bundle.filingState && <><span className="text-faint">·</span><span>{bundle.filingState}</span></>}
            <span className="text-faint">·</span>
            <span className="tnum">{counts.accepted} proposed</span>
            <span className="text-faint">·</span>
            <span className="tnum">{counts.unresolved} unresolved</span>
          </div>
        </div>
        <FingerprintBadge fingerprint={fingerprint} />
      </div>

      <div className="flex flex-col gap-4 max-h-[52vh] overflow-y-auto -mx-1 px-1">

        {/* ── UNRESOLVED — first, never persisted ─────────────────────────── */}
        {unresolved.length > 0 && (
          <section className="rounded-[12px] overflow-hidden"
            style={{ border: '1px solid var(--color-warn-line, var(--color-border))' }}>
            <div className="flex items-center gap-2 px-3.5 py-2.5"
              style={{ background: 'var(--color-warn-soft, var(--color-raised))' }}>
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
                  {u.citation && (
                    <span className="block text-[11px] text-faint truncate" title={u.citation}>
                      Cited: {u.citation}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── FormatCard approval lane — distinct, clearly labelled ─────── */}
        {formatCard && (
          <FormatCardLane card={formatCard} status={cardStatus} setStatus={setCardStatus} />
        )}

        {/* ── Split product proposals ────────────────────────────────────── */}
        {splitProducts.length > 1 && (
          <SplitProductsSection proposals={splitProducts} />
        )}

        {/* ── Sampled table verifications ────────────────────────────────── */}
        {sampledVerifications.length > 0 && (
          <SampledVerificationsSection verifications={sampledVerifications} />
        )}

        {/* ── Ensemble disagreement heatmap (inter-model divergence) ─────── */}
        {ensembleDisagreements && ensembleDisagreements.length > 0 && (
          <DisagreementHeatmap disagreements={ensembleDisagreements} />
        )}

        {/* ── Per-section accept/reject ──────────────────────────────────── */}
        {SECTION_META.map(({ key, label, Icon }) => {
          const section = review[key]
          if (!section.items.length && !section.note) return null
          const on = accepted.has(key)
          return (
            <section key={key} className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={on} onChange={() => toggle(key)}
                  className="w-4 h-4 accent-[var(--color-accent)] shrink-0"
                  aria-label={`Accept ${label}`} />
                <Icon size={15} className="text-dim shrink-0" aria-hidden="true" />
                <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-dim">{label}</h4>
                <span className="text-[11px] text-faint tnum">{section.items.length}</span>
                <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                <span className="text-[11px] text-faint">{on ? 'Accepted' : 'Skipped'}</span>
              </label>
              {section.note && <p className="text-xs text-faint italic px-0.5">{section.note}</p>}
              <div className={`flex flex-col gap-1.5 ${on ? '' : 'opacity-50'}`}>
                {section.items.map((it, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-[10px] p-2.5 bg-raised"
                    style={{ border: '1px solid var(--color-border)' }}>
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {/* refId chip — load-bearing display element, never stripped */}
                        {it.refId && (
                          <span className="text-[11px] font-mono text-accent shrink-0">{it.refId}</span>
                        )}
                        <span className="text-[13px] text-text truncate">{it.label}</span>
                      </div>
                      {it.detail && (
                        <span className="text-[11px] text-dim font-mono truncate" title={it.detail}>
                          {it.detail}
                        </span>
                      )}
                      <span className="text-[11px] text-faint truncate" title={it.citation}>
                        Cited: {it.citation}
                      </span>
                    </div>
                    <span
                      className="text-[11px] font-mono tnum shrink-0 mt-0.5"
                      style={{ color: confidenceColor(it.confidence) }}
                      title="Confidence"
                    >
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
          <Button variant="primary" onClick={onImport}>
            Import as draft <IconArrowRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function FingerprintBadge({ fingerprint }: { fingerprint: FormatFingerprint }) {
  const { detectedFormat, lineGuesses, container } = fingerprint
  const top = lineGuesses[0]
  return (
    <div className="flex flex-col items-end gap-0.5 shrink-0 text-right">
      <span className="text-[11px] font-mono text-accent">{detectedFormat}</span>
      <span className="text-[10px] text-faint">{container} · {top?.lobRefId ?? 'line unknown'}</span>
    </div>
  )
}

function FormatCardLane({ card, status, setStatus }: {
  card:      FormatCard
  status:    'PROPOSED' | 'APPROVED' | 'REJECTED'
  setStatus: (s: 'PROPOSED' | 'APPROVED' | 'REJECTED') => void
}) {
  return (
    <section className="rounded-[12px] overflow-hidden"
      style={{ border: `1px solid ${status === 'APPROVED' ? 'var(--color-good)' : status === 'REJECTED' ? 'var(--color-danger, var(--color-border))' : 'var(--color-accent)'}` }}>

      {/* Lane header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5"
        style={{ background: 'var(--color-accent-soft)' }}>
        <IconFile size={14} className="text-accent shrink-0" />
        <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-text flex-1">
          FormatCard — unknown format
        </h4>
        <span className="text-[11px] text-faint">proposed · approve to teach the registry</span>
      </div>

      {/* Card body */}
      <div className="flex flex-col gap-3 px-3.5 py-3">
        <p className="text-xs text-dim">
          This format was not recognized. The AI proposed the following document-role fingerprints
          and translation recipe fragment. Review and approve below — the card is never auto-persisted.
        </p>

        {/* Proposed document roles */}
        {card.documentRoleFingerprints.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint mb-1.5">
              Document roles
            </div>
            <div className="flex flex-col gap-1">
              {card.documentRoleFingerprints.map((rf, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-accent shrink-0">{rf.role}</span>
                  <span className="text-faint truncate">{rf.signals?.join(', ')}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Proposed recipe fragment */}
        {Object.keys(card.translationRecipeFragment).length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint mb-1.5">
              Translation recipe (fragment)
            </div>
            <pre className="text-[11px] font-mono text-dim bg-raised rounded-[8px] p-2 overflow-x-auto"
              style={{ border: '1px solid var(--color-border)' }}>
              {JSON.stringify(card.translationRecipeFragment, null, 2)}
            </pre>
          </div>
        )}

        {/* Approve / Reject controls */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setStatus(status === 'APPROVED' ? 'PROPOSED' : 'APPROVED')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors"
            style={{
              background: status === 'APPROVED' ? 'var(--color-good)' : 'var(--color-raised)',
              color:      status === 'APPROVED' ? 'white'             : 'var(--color-text)',
              border:     `1px solid ${status === 'APPROVED' ? 'var(--color-good)' : 'var(--color-border)'}`,
            }}
          >
            <IconCheckCircle size={13} />
            {status === 'APPROVED' ? 'Approved' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => setStatus(status === 'REJECTED' ? 'PROPOSED' : 'REJECTED')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-colors"
            style={{
              background: status === 'REJECTED' ? 'var(--color-danger, var(--color-raised))' : 'var(--color-raised)',
              color:      status === 'REJECTED' ? 'white'                                     : 'var(--color-dim)',
              border:     `1px solid ${status === 'REJECTED' ? 'var(--color-danger, var(--color-border))' : 'var(--color-border)'}`,
            }}
          >
            <IconClose size={13} />
            {status === 'REJECTED' ? 'Rejected' : 'Reject'}
          </button>
        </div>
        {status === 'APPROVED' && (
          <p className="text-[11px] text-good -mt-1">
            Approved — the card is noted in your review. A separate step publishes it to the registry.
          </p>
        )}
      </div>
    </section>
  )
}

function SplitProductsSection({ proposals }: { proposals: SplitProductProposal[] }) {
  return (
    <section className="rounded-[12px] overflow-hidden"
      style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 px-3.5 py-2.5 bg-raised">
        <IconFile size={14} className="text-dim shrink-0" />
        <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-dim flex-1">
          Product splits
        </h4>
        <span className="text-[11px] text-faint tnum">{proposals.length}</span>
        <span className="text-[11px] text-faint ml-2">detected multi-product structure</span>
      </div>
      <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
        {proposals.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="font-mono text-accent shrink-0">{p.productToken}</span>
            <span className="text-text">{p.name}</span>
            {p.formScope && <span className="text-faint">· form {p.formScope}</span>}
            {p.coveragePartScope && <span className="text-faint">· {p.coveragePartScope}</span>}
          </div>
        ))}
        <p className="text-[11px] text-faint mt-1">
          Each token maps to one draft product. This import creates the first product; additional
          splits can be imported separately.
        </p>
      </div>
    </section>
  )
}

function SampledVerificationsSection({ verifications }: { verifications: SampledVerification[] }) {
  const fails = verifications.filter(v => v.verificationResult === 'FAIL')
  return (
    <section className="rounded-[12px] overflow-hidden"
      style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 px-3.5 py-2.5 bg-raised">
        <IconTable size={14} className="text-dim shrink-0" />
        <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-dim flex-1">
          Table verifications
        </h4>
        <span className="text-[11px] text-faint tnum">{verifications.length}</span>
        {fails.length > 0 && (
          <span className="text-[11px] text-warn ml-2">{fails.length} flagged</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-3.5 py-2.5">
        {verifications.map((v, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {v.verificationResult === 'PASS'
              ? <IconCheckCircle size={13} className="text-good shrink-0" />
              : v.verificationResult === 'PARTIAL'
                ? <IconWarning size={13} className="text-warn shrink-0" />
                : <IconClose size={13} className="text-danger shrink-0" />}
            <span className="font-mono text-dim shrink-0">{v.tableRefId}</span>
            {v.notes && <span className="text-faint truncate" title={v.notes}>— {v.notes}</span>}
          </div>
        ))}
        <p className="text-[11px] text-faint mt-0.5">
          Tables are parsed deterministically. The AI sampled a subset to verify correctness
          (verdict only — the model never transcribes factors).
        </p>
      </div>
    </section>
  )
}
