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
import { lazy, Suspense, useCallback, useId, useMemo, useRef, useState } from 'react'
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
  IconChevronRight,
} from '../components/ui/icons'
import { readWorkbooks } from '../lib/import/readWorkbook'
import { readUploadFiles, runUnifiedImport, type UnifiedStageEvent } from './unifiedImportClient'
import { IconAgent } from '../components/icons'
import { WaveformLoader } from '../components/ai/WaveformLoader'
import { WarningsPanel, type ImportWarning } from './WarningsPanel'
import { VirtualList } from './VirtualList'

// The visualizer is opt-in, so its code loads only when someone actually watches —
// keeps the Builder/Products route chunks inside the 25 kB per-chunk budget.
const AgentVisualizer = lazy(() =>
  import('./AgentVisualizer').then(m => ({ default: m.AgentVisualizer })))
import { adapter } from '../lib/backend'
import type { DraftDedupMatch } from '../lib/backend'
import { canI } from '../lib/canI'
import { importPlan, type ImportProgress, type ImportResult } from '../lib/import/importProduct'
import { newDraftId, filingLineage, importLineage } from '../lib/draft/draft'
import { hashFiles, mintRunId, readinessFromBundle, readinessFromLocalXlsx } from '../lib/import/provenance'
import { deleteDraftProduct } from '../lib/product/deleteDraft'

interface Props { onClose: () => void; onImported: (productId: string) => void }
type Phase = 'select' | 'streaming' | 'duplicate' | 'review' | 'xlsx-plan' | 'importing' | 'done' | 'error'

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
  const EMPTY_PROGRESS: ImportProgress = { done: 0, total: 0, label: '', batch: 0, batches: 0, lastRefIds: [], etaMs: null, ratePerSec: null }
  const [progress, setProgress] = useState<ImportProgress>(EMPTY_PROGRESS)
  const [result, setResult]     = useState<ImportResult | null>(null)
  const [error, setError]       = useState('')
  // "Watch the agents" — opt-in live pipeline visualizer (renders only real SSE events).
  const [watchAgents, setWatch] = useState(false)
  const [vizExpanded, setVizExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Dedup-at-the-door (P3): hash + matches computed at file intake, BEFORE any upload,
  // AI spend, or draft creation. pendingFiles holds the File objects across the
  // duplicate interrupt (they never survive into ordinary modal state); replaceTarget
  // is the existing draft to remove AFTER a successful "Replace" import.
  const [dupes, setDupes] = useState<DraftDedupMatch[]>([])
  const pendingFiles  = useRef<File[] | null>(null)
  const contentHashRef = useRef<string | null>(null)
  const runIdRef       = useRef<string | null>(null)
  const replaceTarget  = useRef<string | null>(null)

  const proceedWithFiles = useCallback(async (docs: File[]) => {
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
      // Minted here, echoed by the server, and persisted with the bundle blob — the
      // draft's extraction report recovers the full bundle through this id.
      const runId = mintRunId()
      runIdRef.current = runId
      const documents = await readUploadFiles(docs)
      const b = await runUnifiedImport(documents, {
        onStage: (e) => setStages(prev => [...prev, e]),
        runId,
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

  const handleFiles = useCallback(async (files: File[]) => {
    const validTypes = /\.(pdf|xlsx|xls|zip|txt|xml|csv)$/i
    const docs = files.filter(f => validTypes.test(f.name) || f.type !== '')
    if (!docs.length) {
      setError('Choose at least one document (PDF, XLSX, ZIP, TXT, XML, or CSV).')
      setPhase('error')
      return
    }
    setFiles(docs.map(f => f.name)); setStages([]); setError(''); setLocalPlan(null); setBundle(null)
    contentHashRef.current = null; runIdRef.current = null; replaceTarget.current = null

    // Dedup at the door: hash the raw bytes while the File objects exist and interrupt
    // BEFORE bytes leave the browser. Hash/lookup failure never blocks an import — the
    // gate is best-effort; the stamp is simply absent when hashing was impossible.
    try { contentHashRef.current = await hashFiles(docs) } catch { /* crypto unavailable — no stamp */ }
    if (contentHashRef.current) {
      try {
        const matches = await adapter.db.findDraftsByContentHash(contentHashRef.current)
        if (matches.length > 0) {
          pendingFiles.current = docs
          setDupes(matches)
          setPhase('duplicate')
          return
        }
      } catch { /* dedup lookup unavailable — proceed */ }
    }
    await proceedWithFiles(docs)
  }, [proceedWithFiles])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    void handleFiles(Array.from(e.dataTransfer.files))
  }, [handleFiles])

  const toggle = (k: FilingReviewSectionKey) => setAccepted(prev => {
    const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n
  })

  // "Replace" completion: the NEW draft is created first, then the existing one is
  // removed — a failed replace never destroys data before its replacement exists.
  // Fail-closed on lifecycle (hostile-review fix): the dedup interrupt's status check
  // is stale by delete time (the user can sit in review for an hour while someone
  // promotes the match), so re-read the CURRENT lifecycle immediately before deleting;
  // an unreadable doc is treated as LAUNCHED so deleteDraftProduct's guard refuses.
  // Best-effort: a refused/failed removal downgrades to a warning, never fails the import.
  // A PARTIAL import (skipped batches) keeps the existing draft — deleting it against
  // an incomplete replacement would destroy the only good copy (hostile-review fix).
  async function finishReplaceIfClean(res: ImportResult, actor: { uid: string; name: string }) {
    if (res.failed > 0 && replaceTarget.current) {
      replaceTarget.current = null
      toast.warning('Some items were skipped, so the existing draft was kept. Delete it manually once the new draft looks right.')
      return
    }
    await finishReplace(actor)
  }

  async function finishReplace(actor: { uid: string; name: string }) {
    const target = replaceTarget.current
    if (!target) return
    replaceTarget.current = null
    try {
      const live = await adapter.db.get<{ lifecycle?: string; lifecycleState?: string }>(`products/${target}`)
      if (!live) return   // already gone — nothing to replace
      await deleteDraftProduct({ id: target, lifecycle: live.lifecycle ?? live.lifecycleState?.toUpperCase() ?? 'LAUNCHED' }, actor)
      toast.success('Replaced the existing draft.')
    } catch (e) {
      toast.warning(`The new draft was created, but the existing draft could not be removed: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  async function runImport() {
    if (!bundle?.plan.product || !bundle.plan.productId || !user) return
    setPhase('importing')
    setProgress({ ...EMPTY_PROGRESS, label: 'Starting…' })
    try {
      const actor   = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
      const draftId = newDraftId(bundle.plan.productId)
      const lineage = buildLineage(bundle, fileNames, actor)
      const res = await importPlan(acceptedPlan(bundle, accepted), actor, setProgress, {
        productId: draftId, lineage,
        contentHash: contentHashRef.current ?? undefined,
        importRunId: runIdRef.current ?? undefined,
        readiness:   readinessFromBundle(bundle),
      })
      await finishReplaceIfClean(res, actor)
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
    setProgress({ ...EMPTY_PROGRESS, label: 'Starting…' })
    try {
      const actor   = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
      const draftId = newDraftId(localPlan.productId)
      const lineage = importLineage(fileNames, localPlan.product?.refId ?? null, actor)
      const res = await importPlan(localPlan, actor, setProgress, {
        productId: draftId, lineage,
        contentHash: contentHashRef.current ?? undefined,
        readiness:   readinessFromLocalXlsx((localPlan.summary.warnings ?? []).length + (localPlan.summary.defects ?? []).length),
      })
      await finishReplaceIfClean(res, actor)
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
      // Concept-linker tail (R4): the ambiguous links the deterministic passes left open, plus
      // the model id sets the server validates every proposed link against.
      const ratingGroups = ((localPlan.ratingProgram?.data as { ratingGroups?: Array<{ name: string; matchBasis: string }> })?.ratingGroups) ?? []
      const mintedTables = localPlan.ldTables.filter(t => (t.data as { mintedId?: boolean }).mintedId)
      const body = {
        unmappedColumns:     localPlan.summary.unmappedColumns,
        sheetsSkipped:       localPlan.summary.sheetsSkipped,
        headers,
        samples,
        dataValidationVocab: {},
        unmatchedGroups:     ratingGroups.filter(g => g.matchBasis === 'unmatched').map(g => g.name),
        unlinkedTables:      mintedTables.filter(t => !((t.data as { coverageRefIds?: string[] }).coverageRefIds?.length)).map(t => ({ refId: t.refId, name: (t.data as { name?: string }).name ?? '' })),
        unresolvedRuleRefs:  ((localPlan.summary.notices.find(n => n.code === 'unresolved_rule_refs')?.data as { refs?: string[] })?.refs) ?? [],
        coverageRefIds:      localPlan.coverages.map(c => c.refId).filter((r): r is string => !!r),
        tableRefIds:         mintedTables.map(t => t.refId).filter((r): r is string => !!r),
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
    const overlay: AliasOverlay = { columnAliases: {}, enumOverrides: {}, sheetRoleHints: {}, ratingGroupLinks: {}, tableCoverageLinks: {}, ruleReferenceLinks: {}, confidences: {}, citations: {} }
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
    // Concept links (R4): apply accepted proposals — the shared mapper validates each refId
    // against the model and applies it fill-only (never overriding a deterministic link).
    for (const [name, refIds] of Object.entries(aliasOverlay.ratingGroupLinks ?? {})) {
      if (acceptedSuggestions.has(`rgl:${name}`)) overlay.ratingGroupLinks![name] = refIds as string[]
    }
    for (const [tid, refIds] of Object.entries(aliasOverlay.tableCoverageLinks ?? {})) {
      if (acceptedSuggestions.has(`tcl:${tid}`)) overlay.tableCoverageLinks![tid] = refIds as string[]
    }
    for (const [txt, refIds] of Object.entries(aliasOverlay.ruleReferenceLinks ?? {})) {
      if (acceptedSuggestions.has(`rrl:${txt}`)) overlay.ruleReferenceLinks![txt] = refIds as string[]
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
        <StreamingPane
          fileNames={fileNames} stages={stages}
          watchAgents={watchAgents} onToggleWatch={() => setWatch(w => !w)}
          vizExpanded={vizExpanded} onToggleExpand={() => setVizExpanded(e => !e)}
        />
      ) : phase === 'duplicate' ? (
        <DuplicatePane
          matches={dupes}
          fileNames={fileNames}
          onOpenExisting={(id) => onImported(id)}
          onReplace={(id) => {
            replaceTarget.current = id
            const docs = pendingFiles.current; pendingFiles.current = null
            if (docs) void proceedWithFiles(docs)
          }}
          onImportCopy={() => {
            const docs = pendingFiles.current; pendingFiles.current = null
            if (docs) void proceedWithFiles(docs)
          }}
          onCancel={onClose}
        />
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
        // Live write stream: batch progress (chunk i of n), a soft ticker of the last
        // written refIds, percent, and an honest ETA from the observed write rate.
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm text-text">
              <WaveformLoader size="sm" label="" className="text-accent" />
              <span className="font-medium tabular-nums">Writing {progress.done} of {progress.total}</span>
              <span className="text-faint">·</span>
              <span className="text-xs text-dim tabular-nums">chunk {Math.max(progress.batch, 1)} of {Math.max(progress.batches, 1)}</span>
            </div>
            <span className="text-xs text-faint tabular-nums">
              {progress.etaMs != null
                ? progress.etaMs < 1500 ? 'almost done' : `~${Math.ceil(progress.etaMs / 1000)}s left`
                : 'measuring…'}
              {progress.ratePerSec ? ` · ${Math.round(progress.ratePerSec)}/s` : ''}
            </span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-raised"
            role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all duration-200"
              style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--color-accent-bright), var(--color-accent-strong))' }} />
          </div>
          {/* Soft ticker — the tail of what just committed (real refIds, atomic batches). */}
          <div className="flex items-center gap-1.5 min-h-[22px] overflow-hidden" aria-hidden="true">
            {progress.lastRefIds.map((r, i) => (
              <span key={`${r}-${i}`}
                className="chip-in inline-flex items-center px-1.5 py-0.5 rounded-[5px] font-mono text-[10px] text-dim bg-raised truncate max-w-[140px]"
                style={{ border: '1px solid var(--color-border)', opacity: 0.45 + 0.55 * ((i + 1) / progress.lastRefIds.length) }}>
                {r}
              </span>
            ))}
          </div>
          <p className="text-xs text-faint truncate">{progress.label}</p>
          <p className="text-[10.5px] text-faint">
            Every batch is atomic — entity + audit event + version + search index commit together.
          </p>
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
          {/* If the user was watching the agents, keep the pipeline visible so the
              failure point is evident (real events up to the disconnect). */}
          {watchAgents && stages.length > 0 && (
            <div className="max-h-[40vh] overflow-y-auto -mx-1 px-1">
              <Suspense fallback={null}>
                <AgentVisualizer
                  events={stages} streaming={false} streamError={error || 'stream ended unexpectedly'}
                  expanded={vizExpanded} onToggleExpand={() => setVizExpanded(e => !e)}
                />
              </Suspense>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => { setPhase('select'); setError(''); setBundle(null); setDupes([]); pendingFiles.current = null; replaceTarget.current = null }}>
              Try again
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

// ─── Panes ────────────────────────────────────────────────────────────────────

// Dedup interrupt (P3): shown BEFORE any upload or draft creation when the selected
// files' content hash matches an existing draft. Default focus = "Open existing"
// (the safe action); "Replace" is offered only for a single non-launched match.
function DuplicatePane({ matches, fileNames, onOpenExisting, onReplace, onImportCopy, onCancel }: {
  matches:        DraftDedupMatch[]
  fileNames:      string[]
  onOpenExisting: (id: string) => void
  onReplace:      (id: string) => void
  onImportCopy:   () => void
  onCancel:       () => void
}) {
  const explainId = useId()
  const replaceHintId = useId()
  const newest = matches[0]!
  const replaceable = matches.length === 1 && newest.status !== 'LAUNCHED'
  const when = (iso: string | null) => {
    if (!iso) return null
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex items-start gap-2.5 rounded-[12px] p-3.5"
        style={{ background: 'var(--color-warn-soft)', border: '1px solid var(--color-warn-line)' }}>
        <IconWarning size={16} className="text-warn shrink-0 mt-0.5" aria-hidden="true" />
        <p id={explainId} className="text-sm text-dim">
          <span className="font-medium text-text">{fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`}</span>{' '}
          {matches.length === 1 ? 'was already imported — an existing draft came from the same content.'
            : `was already imported — ${matches.length} existing drafts came from the same content.`}{' '}
          Nothing has been uploaded or created yet.
        </p>
      </div>
      <ul className="flex flex-col gap-2" aria-label="Existing drafts from this content">
        {matches.map((m) => (
          <li key={m.id} className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 bg-surface"
            style={{ border: '1px solid var(--color-border)' }}>
            <IconFile size={14} className="text-faint shrink-0" aria-hidden="true" />
            <span className="text-sm text-text truncate">{m.displayName ?? m.id}</span>
            <span className="ml-auto flex items-center gap-2 text-xs text-faint shrink-0">
              {when(m.importedAt) && <span>imported {when(m.importedAt)}</span>}
              {m.status && <span className="uppercase tracking-wide text-[10px]">{m.status}</span>}
            </span>
          </li>
        ))}
      </ul>
      {replaceable && (
        <p id={replaceHintId} className="text-xs text-faint">
          Replace imports the files again, then permanently deletes the existing draft once the new one is created.
        </p>
      )}
      <div className="flex flex-wrap gap-2 justify-end pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={onImportCopy}>Import as copy</Button>
        {replaceable && (
          <Button variant="destructive" onClick={() => onReplace(newest.id)} aria-describedby={replaceHintId}>
            Replace
          </Button>
        )}
        <Button variant="primary" autoFocus data-autofocus onClick={() => onOpenExisting(newest.id)} aria-describedby={explainId}>
          Open existing <IconArrowRight size={14} />
        </Button>
      </div>
    </div>
  )
}

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

function StreamingPane({ fileNames, stages, watchAgents, onToggleWatch, vizExpanded, onToggleExpand }: {
  fileNames: string[]; stages: UnifiedStageEvent[]
  watchAgents: boolean; onToggleWatch: () => void
  vizExpanded: boolean; onToggleExpand: () => void
}) {
  const rows    = stages.filter(s => s.kind === 'tool')
  const notices = stages.filter(s => s.kind === 'notice' && s.notice)
  return (
    // aria-live lives on the plain event list below (or inside the visualizer, which has
    // its own polite announcer) — never on this whole pane, to avoid double announcements.
    <div className="flex flex-col gap-4 py-2" aria-label="Import progress">
      <div className="flex items-center gap-2 text-sm text-text">
        <IconSpinner size={16} className="animate-spin text-accent" aria-hidden="true" />
        <span className="flex-1">
          Reading {fileNames.length} document{fileNames.length !== 1 ? 's' : ''} — fingerprint · plan · extract · reconcile…
        </span>
        {/* Opt-in agent visualizer toggle */}
        <button
          type="button"
          onClick={onToggleWatch}
          aria-pressed={watchAgents}
          className="inline-flex items-center gap-1.5 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{
            border: `1px solid ${watchAgents ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
            color: watchAgents ? 'var(--color-accent)' : 'var(--color-dim)',
            background: watchAgents ? 'var(--color-accent-soft)' : 'var(--color-surface)',
          }}
        >
          <IconAgent size={12} aria-hidden="true" />
          {watchAgents ? 'Watching the agents' : 'Watch the agents'}
        </button>
      </div>

      {watchAgents ? (
        <div className="max-h-[56vh] overflow-y-auto -mx-1 px-1">
          <Suspense fallback={
            <div className="flex items-center gap-2 text-xs text-dim py-2">
              <IconSpinner size={13} className="animate-spin text-accent" aria-hidden="true" />
              Loading the agent view…
            </div>
          }>
            <AgentVisualizer
              events={stages} streaming
              expanded={vizExpanded} onToggleExpand={onToggleExpand}
            />
          </Suspense>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[46vh] overflow-y-auto" role="status" aria-live="polite">
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
      )}
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
  // Defensive defaults: a server bundle variant (filing reconcile, fallback paths)
  // may omit optional arrays — never crash the review pane over a missing field.
  const { review = {} as UnifiedProposalBundle['review'], fingerprint, formatCard } = bundle
  const unresolved = bundle.unresolved ?? []
  const splitProducts = bundle.splitProducts ?? []
  const sampledVerifications = bundle.sampledVerifications ?? []
  const ensembleDisagreements = bundle.ensembleDisagreements
  // Structured warnings from stage 7 (additive bundle field; older bundles omit it).
  const importWarnings = (bundle as unknown as { importWarnings?: ImportWarning[] }).importWarnings ?? []
  // Big sections start folded so a 1,707-entity review opens scannable; the
  // virtualized list below keeps the expanded view at 60fps regardless.
  const [openSections, setOpenSections] = useState<Set<FilingReviewSectionKey>>(() =>
    new Set(SECTION_META.filter(({ key }) => (review[key]?.items?.length ?? 0) <= 12).map(({ key }) => key)))
  const toggleOpen = (k: FilingReviewSectionKey) =>
    setOpenSections(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const importCount = useMemo(() => {
    return countPlan(acceptedPlan(bundle, accepted))
  }, [bundle, accepted])

  const hasDetectedContent = SECTION_META.some(({ key }) => (review[key]?.items?.length ?? 0) > 0)

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
                const section = review[key] ?? { items: [] }
                if (!section.items?.length && !section.note) return null
                const on = accepted.has(key)
                const isOpen = openSections.has(key)
                return (
                  <div key={key} className="rounded-[12px] overflow-hidden"
                    style={{ border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}` }}>

                    {/* Section header: include toggle · stage glyph · count · fold */}
                    <div className="flex items-center gap-2 px-3.5 py-2.5 bg-raised" style={{ userSelect: 'none' }}>
                      <input type="checkbox" checked={on} onChange={() => toggle(key)}
                        className="w-4 h-4 accent-[var(--color-accent)] shrink-0 cursor-pointer"
                        aria-label={`Include ${label} in import`} />
                      <Icon size={13} className={on ? 'text-accent shrink-0' : 'text-dim shrink-0'} aria-hidden />
                      <button type="button" onClick={() => toggleOpen(key)} aria-expanded={isOpen}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                        <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-dim">
                          {label}
                        </span>
                        <IconChevronRight size={11} aria-hidden="true"
                          className="text-faint transition-transform duration-200"
                          style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} />
                      </button>
                      {/* Selected-vs-total at a glance */}
                      <span className="text-[11px] text-faint tnum">{on ? section.items.length : 0}/{section.items.length}</span>
                      <span className="text-[11px] font-medium ml-2 shrink-0"
                        style={{ color: on ? 'var(--color-good)' : 'var(--color-faint)' }}>
                        {on ? 'Included' : 'Skipped'}
                      </span>
                    </div>

                    {/* Per-item list: refId chip · label · confidence · citation.
                        Virtualized — every item is reachable, 60fps at 1,707 entities. */}
                    {section.note && (
                      <p className="text-xs text-faint italic px-3.5 py-1.5">{section.note}</p>
                    )}
                    {isOpen && (
                      <VirtualList
                        items={section.items}
                        rowHeight={30}
                        maxHeight={264}
                        className={on ? '' : 'opacity-40'}
                        renderRow={(it) => (
                          <div className="flex items-center gap-2 px-3.5 h-full min-w-0" style={{ borderTop: '1px solid var(--color-border)' }}>
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
                        )}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── Warnings — first-class, grouped, severity-tinted, human-language ── */}
        {importWarnings.length > 0 && <WarningsPanel warnings={importWarnings} />}

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
    // Concept-link proposals (R4) — resolve the ambiguous tail the deterministic passes left open.
    for (const [name, refIds] of Object.entries(aiSuggestions.aliasOverlay.ratingGroupLinks ?? {})) {
      const key = `rgl:${name}`
      aiItems.push({ key, label: `Rating-group link`, detail: `"${name}" → ${(refIds as string[]).join(', ')}`, confidence: aiSuggestions.confidences[key] ?? 1, citation: aiSuggestions.citations[key] ?? '' })
    }
    for (const [tid, refIds] of Object.entries(aiSuggestions.aliasOverlay.tableCoverageLinks ?? {})) {
      const key = `tcl:${tid}`
      aiItems.push({ key, label: `Table → coverage`, detail: `${tid} → ${(refIds as string[]).join(', ')}`, confidence: aiSuggestions.confidences[key] ?? 1, citation: aiSuggestions.citations[key] ?? '' })
    }
    for (const [txt, refIds] of Object.entries(aiSuggestions.aliasOverlay.ruleReferenceLinks ?? {})) {
      const key = `rrl:${txt}`
      aiItems.push({ key, label: `Rule ref → table`, detail: `"${txt}" → ${(refIds as string[]).join(', ')}`, confidence: aiSuggestions.confidences[key] ?? 1, citation: aiSuggestions.citations[key] ?? '' })
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
              {/* Every entity reachable — virtualized so 1,700+ rows stay at 60fps. */}
              <VirtualList
                items={items}
                rowHeight={30}
                maxHeight={210}
                renderRow={(e) => (
                  <div className="flex items-center gap-2 px-3.5 h-full min-w-0" style={{ borderTop: '1px solid var(--color-border)' }}>
                    {e.refId && (
                      <span className="text-[11px] font-mono text-accent shrink-0 px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--color-accent-soft)' }}>{e.refId}</span>
                    )}
                    <span className="text-xs text-text truncate">{e.label}</span>
                  </div>
                )}
              />
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

        {/* Warnings — first-class, grouped by kind, severity-tinted, human copy */}
        {plan.summary.warnings.length > 0 && <WarningsPanel warnings={plan.summary.warnings} />}

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
