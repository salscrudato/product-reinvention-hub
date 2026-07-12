// ImportWorkbookModal — EDITOR/ADMIN-only ISO workbook importer. Two-section
// Import Review: Section 1 "Detected" lists every classified entity with its
// refId chip before any write; Section 2 "Review & confirm" surfaces warnings
// and unmapped columns. Nothing writes until "Import N items" is confirmed.
// VIEWER never reaches this (gated in Products.tsx and defensively here).
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { mapIsoWorkbook, type ImportPlan, type PlannedEntity } from '@pf/shared'
import { useUser } from '../../context/useUser'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import {
  IconUpload, IconFileSpreadsheet, IconCheckCircle, IconWarning, IconInfo,
  IconSpinner, IconCoverage, IconForm, IconRule, IconPricing, IconTable,
  IconEndorsement, IconArrowRight, IconClose,
  type IconType,
} from '../ui/icons'
import { readWorkbooks } from '../../lib/import/readWorkbook'
import { importPlan, type ImportProgress, type ImportResult } from '../../lib/import/importProduct'
import { newDraftId, importLineage } from '../../lib/draft/draft'

interface Props { onClose: () => void; onImported: (productId: string) => void }
type Phase = 'select' | 'parsing' | 'preview' | 'importing' | 'done' | 'error'

// Total items that will be written by importPlan() for a given plan.
function planItemCount(p: ImportPlan): number {
  return (p.product ? 1 : 0) +
    p.coverages.length + p.forms.length + p.rules.length + p.formRules.length +
    (p.ratingProgram ? 1 : 0) + p.rtTables.length + p.ldTables.length
}

const ENTITY_SHOW = 6

// A labelled, collapsible entity group for Section 1.
function EntityGroup({ icon: Icon, label, entities }: {
  icon: IconType
  label: string
  entities: PlannedEntity[]
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? entities : entities.slice(0, ENTITY_SHOW)
  const extra = entities.length - ENTITY_SHOW

  return (
    <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 px-3.5 py-2 bg-raised">
        <Icon size={13} className="text-dim" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-[.07em] text-dim">{label}</span>
        <span className="text-[11px] text-faint tnum ml-auto">{entities.length}</span>
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
        {visible.map((e, i) => {
          const isChild = typeof e.data.parentId === 'string' && Boolean(e.data.parentId)
          return (
            <li key={e.docId || i}
              className={`flex items-center gap-2 py-1.5 pr-3.5${isChild ? ' pl-9' : ' pl-3.5'}`}>
              {e.refId ? (
                <span className="text-[11px] font-mono text-accent shrink-0 px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--color-accent-soft)' }}>
                  {e.refId}
                </span>
              ) : null}
              <span className="text-xs text-text truncate">{e.label}</span>
            </li>
          )
        })}
      </ul>
      {!expanded && extra > 0 && (
        <button type="button" onClick={() => setExpanded(true)}
          className="w-full py-1.5 text-[11px] text-faint hover:text-dim transition-colors"
          style={{ borderTop: '1px solid var(--color-border)' }}>
          +{extra} more
        </button>
      )}
    </div>
  )
}

export function ImportWorkbookModal({ onClose, onImported }: Props) {
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'

  const [phase, setPhase]       = useState<Phase>('select')
  const [dragOver, setDragOver] = useState(false)
  const [fileNames, setFiles]   = useState<string[]>([])
  const [plan, setPlan]         = useState<ImportPlan | null>(null)
  const [progress, setProgress] = useState<ImportProgress>({ done: 0, total: 0, label: '' })
  const [result, setResult]     = useState<ImportResult | null>(null)
  const [error, setError]       = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(async (files: File[]) => {
    const xlsx = files.filter(f => /\.xlsx$/i.test(f.name))
    if (!xlsx.length) { setError('Please choose one or more .xlsx workbooks.'); setPhase('error'); return }
    setFiles(xlsx.map(f => f.name)); setPhase('parsing'); setError('')
    try {
      const grids = await readWorkbooks(xlsx)
      setPlan(mapIsoWorkbook(grids))
      setPhase('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the workbook.')
      setPhase('error')
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    void handleFiles(Array.from(e.dataTransfer.files))
  }, [handleFiles])

  async function runImport() {
    if (!plan?.product || !plan.productId || !user) return
    setPhase('importing')
    setProgress({ done: 0, total: 0, label: 'Starting…' })
    try {
      const actor = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
      const draftId = newDraftId(plan.productId)
      const lineage = importLineage(fileNames, plan.productId, actor)
      const res = await importPlan(plan, actor, setProgress, { productId: draftId, lineage })
      setResult(res); setPhase('done')
      if (res.failed) toast.warning(`Imported ${res.written} items, ${res.failed} skipped`)
      else toast.success(`Imported ${res.written} items`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
      setPhase('error')
    }
  }

  const itemCount = plan ? planItemCount(plan) : 0
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Dialog open title="Import product data" onClose={onClose} width="max-w-2xl">
      {!canEdit ? (
        <p className="text-sm text-danger">You need editor access to import products.</p>

      ) : phase === 'select' ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Upload the ISO product-specification workbooks — Framework, Forms, Rating and Rules.
            You can select all four at once. We&apos;ll classify the content and show you a full
            preview before anything is written. The import lands as a{' '}
            <span className="font-medium text-text">draft</span> you review and promote later.
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className="group flex flex-col items-center justify-center gap-3 rounded-[14px] py-10 px-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{
              border: `1.5px dashed ${dragOver ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
              background: dragOver ? 'var(--color-accent-soft)' : 'var(--color-surface)',
            }}
          >
            <span className="flex items-center justify-center w-12 h-12 rounded-[12px]"
              style={{ background: 'var(--color-accent-soft)' }}>
              <IconUpload size={22} className="text-accent" />
            </span>
            <span className="text-sm font-medium text-text">Drop workbooks here, or click to browse</span>
            <span className="text-xs text-faint">.xlsx · Framework · Forms · Rating · Rules</span>
          </button>
          <input
            ref={inputRef} type="file" accept=".xlsx" multiple className="sr-only"
            onChange={e => { if (e.target.files) void handleFiles(Array.from(e.target.files)) }}
          />
        </div>

      ) : phase === 'parsing' ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <IconSpinner size={26} className="animate-spin text-accent" aria-hidden="true" />
          <p className="text-sm text-dim">Reading {fileNames.length} workbook{fileNames.length !== 1 ? 's' : ''}…</p>
        </div>

      ) : phase === 'preview' && plan ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-5 max-h-[calc(70vh-6rem)] overflow-y-auto -mx-1 px-1">

            {/* ── Section 1: Detected ─────────────────────────────────────── */}
            <section aria-labelledby="sec1-heading">
              <div className="flex items-center gap-2 mb-2">
                <span aria-hidden="true"
                  className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
                  style={{ background: 'var(--color-accent)', color: 'white' }}>1</span>
                <h3 id="sec1-heading" className="text-[13px] font-semibold text-text">Detected</h3>
              </div>
              <p className="text-sm text-dim mb-3">
                Here's what was found in{' '}
                {fileNames.length === 1
                  ? <span className="font-medium text-text">{fileNames[0]}</span>
                  : `${fileNames.length} workbooks`}.
              </p>

              {!plan.product ? (
                <div className="rounded-[12px] p-4 text-sm text-dim"
                  style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
                  No insurance content detected in this file. Supported: product framework, forms,
                  rating/ROC, rules, limits/deductibles.
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {/* Product identity */}
                  <div className="flex items-center gap-3 rounded-[12px] p-3.5"
                    style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-border)' }}>
                    <span className="flex items-center justify-center w-9 h-9 rounded-[10px] shrink-0"
                      style={{ background: 'var(--gradient-accent)' }}>
                      <IconFileSpreadsheet size={18} className="text-white" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text truncate">
                        {plan.summary.productName}
                      </div>
                      <div className="text-xs text-dim flex items-center gap-1.5">
                        {plan.summary.productRefId && (
                          <span className="font-mono text-accent">{plan.summary.productRefId}</span>
                        )}
                        {plan.summary.lobName
                          ? <><span className="text-faint">·</span><span>{plan.summary.lobName}</span></>
                          : null}
                      </div>
                    </div>
                  </div>

                  {/* Entity groups — one per canonical type */}
                  {plan.coverages.length > 0 &&
                    <EntityGroup icon={IconCoverage} label="Coverages" entities={plan.coverages} />}
                  {plan.forms.length > 0 &&
                    <EntityGroup icon={IconForm} label="Forms" entities={plan.forms} />}
                  {plan.rules.length > 0 &&
                    <EntityGroup icon={IconRule} label="Rules" entities={plan.rules} />}
                  {plan.formRules.length > 0 &&
                    <EntityGroup icon={IconEndorsement} label="Form rules" entities={plan.formRules} />}
                  {plan.ratingProgram &&
                    <EntityGroup icon={IconPricing} label="Rating program" entities={[plan.ratingProgram]} />}
                  {plan.rtTables.length > 0 &&
                    <EntityGroup icon={IconTable} label="Rate tables" entities={plan.rtTables} />}
                  {plan.ldTables.length > 0 &&
                    <EntityGroup icon={IconTable} label="L&D tables" entities={plan.ldTables} />}
                </div>
              )}
            </section>

            {/* ── Section 2: Review & confirm ─────────────────────────────── */}
            <section aria-labelledby="sec2-heading">
              <div className="flex items-center gap-2 mb-2">
                <span aria-hidden="true"
                  className="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
                  style={{ background: 'var(--color-warn)', color: 'white' }}>2</span>
                <h3 id="sec2-heading" className="text-[13px] font-semibold text-text">Review & confirm</h3>
              </div>
              <p className="text-sm text-dim mb-3">
                Nothing is saved until you click &ldquo;Import {itemCount} items&rdquo;
                {plan.summary.warnings.length === 0 && plan.summary.unmappedColumns.length === 0
                  ? ' — no issues were found in these workbooks.'
                  : ' — these items are non-blocking.'}
              </p>

              {plan.summary.warnings.length > 0 && (
                <details className="rounded-[12px] overflow-hidden mb-2"
                  style={{ border: '1px solid var(--color-border)' }}>
                  <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer text-sm text-text hover:bg-raised">
                    <IconWarning size={15} className="text-warn" />
                    {plan.summary.warnings.length} warning{plan.summary.warnings.length !== 1 ? 's' : ''}
                    <span className="text-xs text-faint ml-auto">non-blocking</span>
                  </summary>
                  <ul className="max-h-32 overflow-y-auto px-3.5 pb-3 pt-1 flex flex-col gap-1 text-xs text-dim">
                    {plan.summary.warnings.map((w, i) => <li key={i}>• {w}</li>)}
                  </ul>
                </details>
              )}

              {plan.summary.unmappedColumns.length > 0 && (
                <details className="rounded-[12px] overflow-hidden"
                  style={{ border: '1px solid var(--color-border)' }}>
                  <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer text-sm text-text hover:bg-raised">
                    <IconInfo size={15} className="text-info" />
                    Unmapped columns
                    <span className="text-xs text-faint ml-auto">left as-is</span>
                  </summary>
                  <div className="max-h-32 overflow-y-auto px-3.5 pb-3 pt-1 flex flex-col gap-2 text-xs">
                    {plan.summary.unmappedColumns.map(u => (
                      <div key={u.sheet}>
                        <div className="text-faint mb-0.5">{u.sheet}</div>
                        <div className="flex flex-wrap gap-1">
                          {u.columns.map(c => (
                            <span key={c} className="px-1.5 py-0.5 rounded bg-raised text-dim">{c}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {plan.summary.warnings.length === 0 && plan.summary.unmappedColumns.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-good">
                  <IconCheckCircle size={14} />
                  <span>No warnings or unmapped columns.</span>
                </div>
              )}
            </section>
          </div>

          {/* Footer */}
          <div className="flex gap-2 justify-end pt-2"
            style={{ borderTop: '1px solid var(--color-border)' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={runImport} disabled={!plan.product}>
              Import {itemCount} item{itemCount !== 1 ? 's' : ''} <IconArrowRight size={14} />
            </Button>
          </div>
        </div>

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
              Promote it when it&apos;s ready.
            </p>
          </div>
          {result.errors.length > 0 && (
            <details className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer text-sm text-text hover:bg-raised">
                <IconWarning size={15} className="text-warn" />{result.errors.length} skipped
              </summary>
              <ul className="max-h-40 overflow-y-auto px-3.5 pb-3 pt-1 flex flex-col gap-1 text-xs text-dim">
                {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            </details>
          )}
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
            <Button variant="primary" onClick={() => { setPhase('select'); setError(''); setPlan(null) }}>
              Try again
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
