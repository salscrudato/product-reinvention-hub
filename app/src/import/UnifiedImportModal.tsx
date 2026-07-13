// UnifiedImportModal — EDITOR/ADMIN-only entry point for ALL ingestion formats:
// ISO workbooks (XLSX), carrier filing PDFs, SERFF packages, ERC packages, and
// unknown formats. Streams to the `unifiedImport` Cloud Function (7-stage pipeline).
//
// Two-section Import Review:
//   Section 1 "Detected" — classified entities (refId chips, confidence, citation)
//     with a per-section Include toggle. Read-only. Nothing writes here.
//   Section 2 "Review & confirm" — unresolved items, inter-model disagreements,
//     validator discrepancies, FormatCard. Explicitly states nothing is saved until
//     the user confirms.
//
// Invariants:
//   • UNRESOLVED items live in Section 2 — clearly labelled "shown, not written."
//   • FormatCard is a DISTINCT approval lane in Section 2, never auto-persisted.
//   • Nothing is written to Cosmos until the reviewer clicks "Import N items."
//   • Writes go through importPlan() → adapter.db.mutate() — the mutation invariant holds.
//   • VIEWER sees no write action (canEdit = false → modal body is read-only text).
import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  UnifiedProposalBundle, FilingReviewSectionKey, ImportPlan,
  FormatCard, FormatFingerprint, SplitProductProposal, SampledVerification, UnresolvedItem,
  IsoGrid, AliasOverlay, ReviewDefect, ImportNotice,
} from '@pf/shared'
import { mapIsoWorkbook } from '@pf/shared'
import { DisagreementHeatmap } from './DisagreementHeatmap'
import { useUser } from '../context/useUser'
import { Dialog } from '../components/ui/Dialog'
import { Button } from '../components/ui/Button'
import { NoticeBanner } from '../components/ui/NoticeBanner'
import {
  IconUpload, IconFile, IconCheckCircle, IconWarning, IconSpinner,
  IconCoverage, IconRule, IconPricing, IconTable, IconArrowRight, IconClose,
} from '../components/ui/icons'
import { readWorkbooks } from '../lib/import/readWorkbook'
import { readUploadFiles, runUnifiedImport, type UnifiedStageEvent } from './unifiedImportClient'
import { adapter } from '../lib/backend'
import { canI } from '../lib/canI'
import { importPlan, type ImportProgress, type ImportResult } from '../lib/import/importProduct'
import { newDraftId, filingLineage, importLineage } from '../lib/draft/draft'

interface Props { onClose: () => void; onImported: (productId: string) => void }
type Phase = 'select' | 'streaming' | 'review' | 'xlsx-plan' | 'importing' | 'done' | 'error'

interface AISuggestions {
  aliasOverlay:     AliasOverlay
  enumOverlay:      Record<string, string>
  confidences:      Record<string, number>
  citations:        Record<string, string>
  droppedProposals: { kind: string; index: number; item: unknown }[]
  meta:             { proposerModel: string; validatorModel: string; columnAliases: number; enumCrosswalk: number; sheetRoleHints: number; dropped: number }
}

/** Extract first-row headers and up to 15 data rows per sheet for the proposeMapping payload. */
function buildSheetSamples(grids: IsoGrid[]): {
  headers: Record<string, string[]>
  samples: Record<string, string[][]>
} {
  const headers: Record<string, string[]> = {}
  const samples: Record<string, string[][]> = {}
  for (const g of grids) {
    const head = (g.cells[0] ?? []).map(c => c == null ? '' : String(c))
    headers[g.sheet] = head
    samples[g.sheet] = g.cells.slice(1, 16).map(row => row.map(c => c == null ? '' : String(c)))
  }
  return { headers, samples }
}

// Sniff format by magic bytes: ZIP (XLSX/XLSM) = PK\x03\x04, PDF = %PDF.
// Extension alone is not trusted (rename-safe).
async function sniffFormat(file: File): Promise<'xlsx' | 'pdf' | 'other'> {
  const buf = await file.slice(0, 4).arrayBuffer()
  const b = new Uint8Array(buf)
  if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return 'xlsx'
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'
  return 'other'
}

const SECTION_META: { key: FilingReviewSectionKey; label: string; Icon: typeof IconCoverage }[] = [
  { key: 'coverages', label: 'Coverages',          Icon: IconCoverage },
  { key: 'tables',    label: 'Rate & L&D tables',  Icon: IconTable    },
  { key: 'rules',     label: 'Rules',              Icon: IconRule     },
  { key: 'rating',    label: 'Rating program',     Icon: IconPricing  },
]

// Color helper — token-only, never raw hex.
function confidenceColor(c: number): string {
  return c >= 0.8 ? 'var(--color-good)' : c >= 0.5 ? 'var(--color-warn)' : 'var(--color-faint)'
}

// Count writable items for a given plan (matches importPlan()'s `total` computation).
// ?? [] guards against a malformed server response missing an array field.
function countPlan(p: ImportPlan): number {
  return (p.product ? 1 : 0) + (p.coverages ?? []).length + (p.forms ?? []).length +
    (p.rules ?? []).length + (p.formRules ?? []).length + (p.ratingProgram ? 1 : 0) +
    (p.ldTables ?? []).length + (p.rtTables ?? []).length
}

function acceptedPlan(bundle: UnifiedProposalBundle, accepted: Set<FilingReviewSectionKey>): ImportPlan {
  const p = bundle.plan
  const keepTables = accepted.has('tables') || accepted.has('rating')
  return {
    ...p,
    coverages:     accepted.has('coverages') ? (p.coverages ?? []) : [],
    forms:         accepted.has('coverages') ? (p.forms ?? [])     : [],
    rtTables:      keepTables ? (p.rtTables ?? []) : [],
    ldTables:      keepTables ? (p.ldTables ?? []) : [],
    rules:         accepted.has('rules')    ? (p.rules ?? [])      : [],
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
  const canEdit    = canI(user, 'product:write')

  const [phase, setPhase]       = useState<Phase>('select')
  const [dragOver, setDrag]     = useState(false)
  const [fileNames, setFiles]   = useState<string[]>([])
  const [stages, setStages]     = useState<UnifiedStageEvent[]>([])
  const [bundle, setBundle]     = useState<UnifiedProposalBundle | null>(null)
  const [localPlan, setLocalPlan] = useState<ImportPlan | null>(null)
  const [localGrids, setLocalGrids] = useState<IsoGrid[]>([])
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestions | null>(null)
  const [aiAssistLoading, setAiAssistLoading] = useState(false)
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<string>>(new Set())
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
    setFiles(docs.map(f => f.name)); setStages([]); setError(''); setLocalPlan(null); setBundle(null)

    // Magic-byte sniff: all XLSX/XLSM (ZIP signature PK\x03\x04) → local ISO mapper.
    // Anything else (PDF, ZIP SERFF, mixed) → server pipeline.
    const formats = await Promise.all(docs.map(sniffFormat))
    if (formats.every(f => f === 'xlsx')) {
      setPhase('streaming')
      try {
        const grids = await readWorkbooks(docs)
        const plan  = mapIsoWorkbook(grids)
        setLocalGrids(grids)
        setLocalPlan(plan)
        setAiSuggestions(null)
        setAcceptedSuggestions(new Set())
        setPhase('xlsx-plan')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to read workbook.')
        setPhase('error')
      }
      return
    }

    setPhase('streaming')
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
      if (res.failed) toast.warning(`Imported ${res.written} items, ${res.failed} skipped`)
      else            toast.success(`Imported ${res.written} items`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
      setPhase('error')
    }
  }

  async function runImportXlsx() {
    if (!localPlan || !user) return
    if (!localPlan.productId) {
      setError('No product identified in the workbook — check the product row and try again.')
      setPhase('error')
      return
    }
    setPhase('importing')
    setProgress({ done: 0, total: 0, label: 'Starting…' })
    try {
      const actor   = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
      const draftId = newDraftId(localPlan.productId)
      const lineage = importLineage(fileNames, localPlan.product?.refId ?? null, actor)
      const res = await importPlan(localPlan, actor, setProgress, { productId: draftId, lineage })
      setResult(res); setPhase('done')
      if (res.failed) toast.warning(`Imported ${res.written} items, ${res.failed} skipped`)
      else            toast.success(`Imported ${res.written} items`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
      setPhase('error')
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  async function handleAiAssist() {
    if (!localPlan || !localGrids.length) return
    setAiAssistLoading(true)
    setAiSuggestions(null)
    try {
      const { headers, samples } = buildSheetSamples(localGrids)
      const body = {
        unmappedColumns:     localPlan.summary.unmappedColumns,
        sheetsSkipped:       localPlan.summary.sheetsSkipped,
        headers,
        samples,
        dataValidationVocab: {},
      }
      const data = await adapter.fns.call<typeof body, AISuggestions>('proposeMapping', body)
      setAiSuggestions(data)
      setAcceptedSuggestions(new Set()) // start with all suggestions unaccepted
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI Assist failed')
    } finally {
      setAiAssistLoading(false)
    }
  }

  function handleApplyOverlay() {
    if (!aiSuggestions || !localGrids.length) return
    // Build overlay from accepted suggestions only.
    const overlay: AliasOverlay = { columnAliases: {}, enumOverrides: {}, sheetRoleHints: {}, confidences: {}, citations: {} }
    const { aliasOverlay, confidences, citations } = aiSuggestions
    for (const [field, aliases] of Object.entries(aliasOverlay.columnAliases ?? {})) {
      for (const alias of aliases) {
        const key = `col:${field}:${alias}`
        if (acceptedSuggestions.has(key)) {
          if (!overlay.columnAliases![field]) overlay.columnAliases![field] = []
          overlay.columnAliases![field]!.push(alias)
          overlay.confidences![key] = confidences[key] ?? 1
          overlay.citations![key]   = citations[key]  ?? ''
        }
      }
    }
    for (const [raw, cat] of Object.entries(aliasOverlay.enumOverrides ?? {})) {
      const key = `enum:${raw}`
      if (acceptedSuggestions.has(key)) {
        overlay.enumOverrides![raw] = cat as import('@pf/shared').FormCategory
        overlay.confidences![key] = confidences[key] ?? 1
        overlay.citations![key]   = citations[key]  ?? ''
      }
    }
    for (const [sheet, role] of Object.entries(aliasOverlay.sheetRoleHints ?? {})) {
      const key = `sheet:${sheet}`
      if (acceptedSuggestions.has(key)) {
        overlay.sheetRoleHints![sheet] = role
      }
    }
    const newPlan = mapIsoWorkbook(localGrids, overlay)
    setLocalPlan(newPlan)
    setAiSuggestions(null)
    setAcceptedSuggestions(new Set())
    toast.success('Applied accepted suggestions — plan updated.')
  }

  return (
    <Dialog open title="Import product data" onClose={onClose} width="max-w-2xl">
      {!canEdit ? (
        <p className="text-sm text-danger">Editor access is required to import documents.</p>
      ) : phase === 'select' ? (
        <SelectPane
          dragOver={dragOver} setDrag={setDrag} onDrop={onDrop}
          onBrowse={() => inputRef.current?.click()} inputRef={inputRef} onFiles={handleFiles}
        />
      ) : phase === 'streaming' ? (
        <StreamingPane fileNames={fileNames} stages={stages} />
      ) : phase === 'xlsx-plan' && localPlan ? (
        <XlsxPlanPane
          plan={localPlan}
          onImport={runImportXlsx}
          onCancel={onClose}
          aiSuggestions={aiSuggestions}
          aiAssistLoading={aiAssistLoading}
          acceptedSuggestions={acceptedSuggestions}
          onAiAssist={handleAiAssist}
          onToggleSuggestion={key => setAcceptedSuggestions(prev => {
            const s = new Set(prev)
            if (s.has(key)) s.delete(key); else s.add(key)
            return s
          })}
          onApplyOverlay={handleApplyOverlay}
          hasUnmapped={localPlan.summary.unmappedColumns.length > 0 || localPlan.summary.sheetsSkipped.length > 0 || (localPlan.summary.defects ?? []).length > 0}
        />
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

// ─── Review pane — two-section Import Review ──────────────────────────────────

function ReviewPane({ bundle, accepted, toggle, cardStatus, setCardStatus, onCancel, onImport }: {
  bundle:         UnifiedProposalBundle
  accepted:       Set<FilingReviewSectionKey>
  toggle:         (k: FilingReviewSectionKey) => void
  cardStatus:     'PROPOSED' | 'APPROVED' | 'REJECTED'
  setCardStatus:  (s: 'PROPOSED' | 'APPROVED' | 'REJECTED') => void
  onCancel:       () => void
  onImport:       () => void
}) {
  const { review, unresolved, fingerprint, splitProducts, sampledVerifications, formatCard, ensembleDisagreements } = bundle

  const importCount = useMemo(() => {
    return countPlan(acceptedPlan(bundle, accepted))
  }, [bundle, accepted])

  const hasDetectedContent = SECTION_META.some(({ key }) => review[key].items.length > 0)

  const hasReviewItems =
    unresolved.length > 0 ||
    (ensembleDisagreements && ensembleDisagreements.length > 0) ||
    sampledVerifications.length > 0 ||
    splitProducts.length > 1 ||
    !!formatCard

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-5 max-h-[52vh] overflow-y-auto -mx-1 px-1">

        {/* ── Section 1: Detected ───────────────────────────────────────── */}
        <section aria-labelledby="u-sec1-heading">
          <div className="flex items-center gap-2 mb-2">
            <span aria-hidden="true"
              className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
              style={{ background: 'var(--color-accent)', color: 'white' }}>1</span>
            <h3 id="u-sec1-heading" className="text-[13px] font-semibold text-text">Detected</h3>
          </div>
          <p className="text-sm text-dim mb-3">Here's what was extracted from these documents.</p>

          {/* Product identity + format fingerprint */}
          <div className="flex items-center gap-3 rounded-[12px] p-3.5 mb-3"
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
                {bundle.baseFormNumber && (
                  <span className="font-mono text-accent">{bundle.baseFormNumber} {bundle.baseFormEdition}</span>
                )}
                {bundle.filingState && <><span className="text-faint">·</span><span>{bundle.filingState}</span></>}
                <span className="text-faint">·</span>
                <span className="tnum text-faint">{bundle.counts.proposed} proposed</span>
                <span className="text-faint">·</span>
                <span className="tnum text-faint">{bundle.counts.unresolved} unresolved</span>
              </div>
            </div>
            <FingerprintBadge fingerprint={fingerprint} />
          </div>

          {/* Entity sections with include toggles */}
          {!hasDetectedContent ? (
            <div className="rounded-[12px] p-4 text-sm text-dim"
              style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
              No insurance content detected in this file. Supported: product framework, forms,
              rating/ROC, rules, limits/deductibles.
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {SECTION_META.map(({ key, label, Icon }) => {
                const section = review[key]
                if (!section.items.length && !section.note) return null
                const on = accepted.has(key)
                return (
                  <div key={key} className="rounded-[12px] overflow-hidden"
                    style={{ border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}` }}>

                    {/* Section header with include toggle */}
                    <label className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer bg-raised hover:bg-raised transition-colors"
                      style={{ userSelect: 'none' }}>
                      <input type="checkbox" checked={on} onChange={() => toggle(key)}
                        className="w-4 h-4 accent-[var(--color-accent)] shrink-0"
                        aria-label={`Include ${label} in import`} />
                      <Icon size={13} className="text-dim shrink-0" aria-hidden />
                      <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-dim flex-1">
                        {label}
                      </span>
                      <span className="text-[11px] text-faint tnum">{section.items.length}</span>
                      <span className="text-[11px] font-medium ml-2 shrink-0"
                        style={{ color: on ? 'var(--color-good)' : 'var(--color-faint)' }}>
                        {on ? 'Included' : 'Skipped'}
                      </span>
                    </label>

                    {/* Per-item list: refId chip · label · confidence · citation */}
                    {section.note && (
                      <p className="text-xs text-faint italic px-3.5 py-1.5">{section.note}</p>
                    )}
                    <div className={`flex flex-col divide-y ${on ? '' : 'opacity-40'}`}
                      style={{ borderColor: 'var(--color-border)' }}>
                      {section.items.slice(0, 8).map((it, i) => (
                        <div key={i} className="flex items-center gap-2 px-3.5 py-1.5 min-w-0">
                          {/* refId chip — load-bearing display element, never stripped */}
                          {it.refId && (
                            <span className="text-[11px] font-mono text-accent shrink-0 px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--color-accent-soft)' }}>
                              {it.refId}
                            </span>
                          )}
                          <span className="text-xs text-text truncate flex-1">{it.label}</span>
                          {it.detail && (
                            <span className="text-[11px] text-faint font-mono truncate max-w-[90px] shrink-0"
                              title={it.detail}>{it.detail}</span>
                          )}
                          <span className="text-[11px] font-mono tnum shrink-0"
                            style={{ color: confidenceColor(it.confidence) }}
                            title="Confidence">
                            {Math.round(it.confidence * 100)}%
                          </span>
                          <span className="text-[10px] text-faint truncate max-w-[80px] shrink-0"
                            title={it.citation}>
                            {it.citation}
                          </span>
                        </div>
                      ))}
                      {section.items.length > 8 && (
                        <div className="px-3.5 py-1.5 text-[11px] text-faint text-center">
                          +{section.items.length - 8} more
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── Section 2: Review & confirm ───────────────────────────────── */}
        <section aria-labelledby="u-sec2-heading">
          <div className="flex items-center gap-2 mb-2">
            <span aria-hidden="true"
              className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
              style={{ background: 'var(--color-warn)', color: 'white' }}>2</span>
            <h3 id="u-sec2-heading" className="text-[13px] font-semibold text-text">Review & confirm</h3>
          </div>
          <p className="text-sm text-dim mb-3">
            Nothing is saved until you click &ldquo;Import {importCount} items&rdquo;
            {hasReviewItems ? ' — review these items before confirming.' : ' — no discrepancies or unresolved fields.'}
          </p>

          {hasReviewItems ? (
            <div className="flex flex-col gap-2.5">
              {/* Unresolved — shown, not written */}
              {unresolved.length > 0 && <UnresolvedSection unresolved={unresolved} />}

              {/* Inter-model disagreement heatmap */}
              {ensembleDisagreements && ensembleDisagreements.length > 0 && (
                <DisagreementHeatmap disagreements={ensembleDisagreements} />
              )}

              {/* Sampled table verifications */}
              {sampledVerifications.length > 0 && (
                <SampledVerificationsSection verifications={sampledVerifications} />
              )}

              {/* Split product proposals */}
              {splitProducts.length > 1 && (
                <SplitProductsSection proposals={splitProducts} />
              )}

              {/* FormatCard approval lane — distinct, never auto-persisted */}
              {formatCard && (
                <FormatCardLane card={formatCard} status={cardStatus} setStatus={setCardStatus} />
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-good">
              <IconCheckCircle size={14} />
              <span>All extracted items are verified — no unresolved fields or inter-model disagreements.</span>
            </div>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1"
        style={{ borderTop: '1px solid var(--color-border)' }}>
        <span className="text-xs text-faint">
          {importCount} item{importCount !== 1 ? 's' : ''} will be written
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onImport} disabled={importCount === 0}>
            Import {importCount} item{importCount !== 1 ? 's' : ''} <IconArrowRight size={14} />
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

function UnresolvedSection({ unresolved }: { unresolved: UnresolvedItem[] }) {
  return (
    <section className="rounded-[12px] overflow-hidden"
      style={{ border: '1px solid var(--color-warn-line, var(--color-border))' }}>
      <div className="flex items-center gap-2 px-3.5 py-2.5"
        style={{ background: 'var(--color-warn-soft, var(--color-raised))' }}>
        <IconWarning size={15} className="text-warn" />
        <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-text flex-1">
          Unresolved
        </h4>
        <span className="text-[11px] text-faint tnum">{unresolved.length}</span>
        <span className="text-[11px] text-faint ml-2">shown, not written</span>
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

      <div className="flex items-center gap-2 px-3.5 py-2.5"
        style={{ background: 'var(--color-accent-soft)' }}>
        <IconFile size={14} className="text-accent shrink-0" />
        <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-text flex-1">
          FormatCard — unknown format
        </h4>
        <span className="text-[11px] text-faint">proposed · approve to teach the registry</span>
      </div>

      <div className="flex flex-col gap-3 px-3.5 py-3">
        <p className="text-xs text-dim">
          This format was not recognized. The AI proposed the following document-role fingerprints
          and translation recipe fragment. Review and approve below — the card is never auto-persisted.
        </p>

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

        <div className="flex gap-2 pt-1">
          <button type="button"
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
          <button type="button"
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

// ─── XLSX-plan review pane (ISO workbook local path) ─────────────────────────────
// Mirrors the Section 1 entity-group layout from ImportWorkbookModal, rendered inline
// in this modal when all uploaded files are XLSX (magic-byte routed to local mapper).

function XlsxPlanPane({ plan, onImport, onCancel, aiSuggestions, aiAssistLoading, acceptedSuggestions, onAiAssist, onToggleSuggestion, onApplyOverlay, hasUnmapped }: {
  plan: ImportPlan
  onImport: () => void
  onCancel: () => void
  aiSuggestions: AISuggestions | null
  aiAssistLoading: boolean
  acceptedSuggestions: Set<string>
  onAiAssist: () => void
  onToggleSuggestion: (key: string) => void
  onApplyOverlay: () => void
  hasUnmapped: boolean
}) {
  const count = countPlan(plan)
  const products = plan.products ?? (plan.product ? [plan.product] : [])
  const defects  = (plan.summary as { defects?: ReviewDefect[] }).defects ?? []
  const notices  = (plan.summary as { notices?: ImportNotice[] }).notices ?? []

  const GROUPS: { label: string; Icon: typeof IconCoverage; items: typeof plan.coverages }[] = [
    { label: 'Coverages', Icon: IconCoverage, items: plan.coverages ?? [] },
    { label: 'Forms',     Icon: IconFile,     items: plan.forms     ?? [] },
    { label: 'Rules',     Icon: IconRule,     items: plan.rules     ?? [] },
    { label: 'L&D tables',Icon: IconTable,    items: plan.ldTables  ?? [] },
    { label: 'RT tables', Icon: IconTable,    items: plan.rtTables  ?? [] },
  ]

  // Flatten AI suggestions into keyed items for display.
  const aiItems: { key: string; label: string; detail: string; confidence: number; citation: string }[] = []
  if (aiSuggestions) {
    for (const [field, aliases] of Object.entries(aiSuggestions.aliasOverlay.columnAliases ?? {})) {
      for (const alias of aliases) {
        const key = `col:${field}:${alias}`
        aiItems.push({ key, label: `Column alias`, detail: `"${alias}" → ${field}`, confidence: aiSuggestions.confidences[key] ?? 1, citation: aiSuggestions.citations[key] ?? '' })
      }
    }
    for (const [raw, cat] of Object.entries(aiSuggestions.aliasOverlay.enumOverrides ?? {})) {
      const key = `enum:${raw}`
      aiItems.push({ key, label: `Enum crosswalk`, detail: `"${raw}" → ${cat}`, confidence: aiSuggestions.confidences[key] ?? 1, citation: aiSuggestions.citations[key] ?? '' })
    }
    for (const [sheet, role] of Object.entries(aiSuggestions.aliasOverlay.sheetRoleHints ?? {})) {
      const key = `sheet:${sheet}`
      aiItems.push({ key, label: `Sheet role`, detail: `"${sheet}" → ${role}`, confidence: aiSuggestions.confidences[key] ?? 1, citation: aiSuggestions.citations[key] ?? '' })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 max-h-[56vh] overflow-y-auto -mx-1 px-1">

        {/* N-product identity cards */}
        {products.length > 1 ? (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[.07em] text-dim px-0.5">
              {products.length} products detected
            </div>
            {products.map(pd => {
              const pdCoverages = (plan.coverages ?? []).filter(c =>
                (c.refId ?? '').toUpperCase().startsWith((pd.refId ?? '').slice(0, 2).toUpperCase()),
              )
              return (
                <div key={pd.refId} className="flex items-center gap-3 rounded-[12px] p-3"
                  style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-border)' }}>
                  <span className="flex items-center justify-center w-8 h-8 rounded-[9px] shrink-0"
                    style={{ background: 'var(--gradient-accent)' }}>
                    <IconFile size={15} className="text-white" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-text truncate">
                      {pd.data['name'] as string || pd.refId}
                    </div>
                    <div className="text-xs text-dim flex items-center gap-1.5">
                      <span className="font-mono text-accent">{pd.refId}</span>
                      <span className="text-faint">·</span>
                      <span className="tnum text-faint">{pdCoverages.length} coverages</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-[12px] p-3.5"
            style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-border)' }}>
            <span className="flex items-center justify-center w-9 h-9 rounded-[10px] shrink-0"
              style={{ background: 'var(--gradient-accent)' }}>
              <IconFile size={18} className="text-white" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text truncate">
                {plan.product
                  ? (plan.product.data['name'] as string || plan.product.refId)
                  : 'No product detected'}
              </div>
              <div className="text-xs text-dim flex items-center gap-1.5 flex-wrap">
                {plan.product?.refId && (
                  <span className="font-mono text-accent">{plan.product.refId}</span>
                )}
                <span className="text-faint">·</span>
                <span className="tnum text-faint">{count} entities</span>
                {plan.summary.warnings.length > 0 && (
                  <><span className="text-faint">·</span>
                    <span className="text-warn">{plan.summary.warnings.length} warnings</span></>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Entity groups */}
        <div className="flex flex-col gap-2">
          {GROUPS.map(({ label, Icon, items }) => items.length > 0 && (
            <div key={label} className="rounded-[12px] overflow-hidden"
              style={{ border: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-2 px-3.5 py-2 bg-raised">
                <Icon size={13} className="text-dim" aria-hidden />
                <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-dim">{label}</span>
                <span className="text-[11px] text-faint tnum ml-auto">{items.length}</span>
              </div>
              <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                {items.slice(0, 6).map((e, i) => (
                  <li key={e.docId || i} className="flex items-center gap-2 px-3.5 py-1.5">
                    {e.refId && (
                      <span className="text-[11px] font-mono text-accent shrink-0 px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--color-accent-soft)' }}>{e.refId}</span>
                    )}
                    <span className="text-xs text-text truncate">{e.label}</span>
                  </li>
                ))}
                {items.length > 6 && (
                  <li className="px-3.5 py-1.5 text-[11px] text-faint text-center">
                    +{items.length - 6} more
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>

        {/* Review defects (unmapped enums) */}
        {defects.length > 0 && (
          <section className="rounded-[12px] overflow-hidden"
            style={{ border: '1px solid var(--color-warn-line, var(--color-border))' }}>
            <div className="flex items-center gap-2 px-3.5 py-2.5"
              style={{ background: 'var(--color-warn-soft, var(--color-raised))' }}>
              <IconWarning size={15} className="text-warn" />
              <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-text flex-1">
                Review defects
              </h4>
              <span className="text-[11px] text-warn tnum">{defects.length}</span>
            </div>
            <ul className="flex flex-col gap-1 px-3.5 py-2.5">
              {defects.slice(0, 8).map((d, i) => (
                <li key={i} className="text-xs text-dim flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5 px-1 py-px rounded text-[10px] font-mono"
                    style={{ background: 'var(--color-warn-soft)', color: 'var(--color-warn)' }}>
                    {d.code}
                  </span>
                  <span>
                    {d.field && <><span className="font-medium">{d.field}</span> · </>}
                    {d.rawValue && <span className="font-mono">"{d.rawValue}"</span>}
                    {d.rowRef && <span className="text-faint"> @ {d.rowRef}</span>}
                  </span>
                </li>
              ))}
              {defects.length > 8 && (
                <li className="text-xs text-faint">+{defects.length - 8} more defects</li>
              )}
            </ul>
          </section>
        )}

        {/* Notices (e.g. forms_applicability_merged) */}
        {notices.length > 0 && (
          <section className="rounded-[12px] p-3"
            style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
            {notices.map((n, i) => (
              <p key={i} className="text-xs text-dim">{n.message}</p>
            ))}
          </section>
        )}

        {/* Warnings */}
        {plan.summary.warnings.length > 0 && (
          <section className="rounded-[12px] overflow-hidden"
            style={{ border: '1px solid var(--color-warn-line, var(--color-border))' }}>
            <div className="flex items-center gap-2 px-3.5 py-2.5"
              style={{ background: 'var(--color-warn-soft, var(--color-raised))' }}>
              <IconWarning size={15} className="text-warn" />
              <h4 className="text-[12px] font-semibold uppercase tracking-[.07em] text-text flex-1">
                Warnings
              </h4>
              <span className="text-[11px] text-faint tnum">{plan.summary.warnings.length}</span>
            </div>
            <ul className="flex flex-col gap-1 px-3.5 py-2.5">
              {plan.summary.warnings.slice(0, 6).map((w, i) => (
                <li key={i} className="text-xs text-dim">{w}</li>
              ))}
              {plan.summary.warnings.length > 6 && (
                <li className="text-xs text-faint">+{plan.summary.warnings.length - 6} more</li>
              )}
            </ul>
          </section>
        )}

        {/* AI Assist suggestions */}
        {aiSuggestions && aiItems.length > 0 && (
          <section className="rounded-[12px] overflow-hidden"
            style={{ border: '1px solid var(--color-accent)', background: 'var(--color-accent-soft)' }}>
            <div className="flex items-center gap-2 px-3.5 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-accent flex-1">
                AI suggestions ({aiItems.length}) — accept to apply
              </span>
              {aiSuggestions.meta.dropped > 0 && (
                <span className="text-[10px] text-faint">{aiSuggestions.meta.dropped} dropped by validator</span>
              )}
            </div>
            <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {aiItems.map(item => {
                const isAccepted = acceptedSuggestions.has(item.key)
                const pct = Math.round(item.confidence * 100)
                return (
                  <li key={item.key} className="flex items-start gap-3 px-3.5 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-dim">{item.label}</span>
                        <span className="text-[10px] px-1.5 py-px rounded font-mono"
                          style={{
                            background: pct >= 80 ? 'var(--color-good-soft)' : 'var(--color-warn-soft)',
                            color:      pct >= 80 ? 'var(--color-good)'      : 'var(--color-warn)',
                          }}>
                          {pct}%
                        </span>
                      </div>
                      <p className="text-xs text-text mt-0.5">{item.detail}</p>
                      {item.citation && (
                        <p className="text-[10px] text-faint font-mono mt-0.5">{item.citation}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onToggleSuggestion(item.key)}
                      className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-[8px]"
                      style={{
                        background: isAccepted ? 'var(--color-accent)' : 'var(--color-raised)',
                        color:      isAccepted ? 'white'               : 'var(--color-dim)',
                        border:     '1px solid var(--color-border)',
                      }}>
                      {isAccepted ? 'Accepted' : 'Accept'}
                    </button>
                  </li>
                )
              })}
            </ul>
            {acceptedSuggestions.size > 0 && (
              <div className="px-3.5 py-2.5 flex justify-end"
                style={{ borderTop: '1px solid var(--color-border)' }}>
                <Button variant="primary" onClick={onApplyOverlay}>
                  Apply {acceptedSuggestions.size} accepted <IconArrowRight size={13} />
                </Button>
              </div>
            )}
          </section>
        )}

        {aiSuggestions && aiItems.length === 0 && (
          <p className="text-xs text-dim px-1">
            AI found no additional mappings — the workbook appears fully deterministic.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-1"
        style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2">
          {hasUnmapped && !aiSuggestions && (
            <Button variant="ghost" onClick={onAiAssist} disabled={aiAssistLoading}>
              {aiAssistLoading ? <><IconSpinner size={14} className="animate-spin" /> Analyzing…</> : 'AI Assist'}
            </Button>
          )}
          <span className="text-xs text-faint">{count} item{count !== 1 ? 's' : ''} will be written</span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={onImport} disabled={count === 0 || !plan.product}>
            Import {count} item{count !== 1 ? 's' : ''} <IconArrowRight size={14} />
          </Button>
        </div>
      </div>
    </div>
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
