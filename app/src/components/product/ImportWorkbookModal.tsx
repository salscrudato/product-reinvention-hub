// ImportWorkbookModal — EDITOR/ADMIN-only ISO workbook importer. Reads the four
// Accenture ISO template workbooks (Framework, Forms, Rating, Rules), maps them onto
// the canonical model with the pure @pf/shared mapper, PREVIEWS a full import summary
// (counts, warnings, unmapped columns) before writing anything, and — on confirm —
// persists the whole product tree through adapter.db.mutate() with a live progress
// counter, then links into the created product. VIEWER never reaches this (the entry
// point is gated in Products.tsx and, defensively, here).
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { mapIsoWorkbook, type ImportPlan } from '@pf/shared'
import { useUser } from '../../context/useUser'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import {
  IconUpload, IconFileSpreadsheet, IconCheckCircle, IconWarning, IconInfo,
  IconSpinner, IconCoverage, IconForm, IconRule, IconPricing, IconTable,
  IconLayers, IconEndorsement, IconArrowRight, IconClose,
} from '../ui/icons'
import { readWorkbooks } from '../../lib/import/readWorkbook'
import { importPlan, type ImportProgress, type ImportResult } from '../../lib/import/importProduct'
import { newDraftId, importLineage } from '../../lib/draft/draft'

interface Props { onClose: () => void; onImported: (productId: string) => void }
type Phase = 'select' | 'parsing' | 'preview' | 'importing' | 'done' | 'error'

const COUNT_TILES: { key: string; label: string; Icon: typeof IconCoverage }[] = [
  { key: 'coverages',     label: 'Coverages',     Icon: IconCoverage },
  { key: 'forms',         label: 'Forms',         Icon: IconForm },
  { key: 'dynamicFields', label: 'Dynamic fields', Icon: IconLayers },
  { key: 'rules',         label: 'Rules',         Icon: IconRule },
  { key: 'formRules',     label: 'Form rules',    Icon: IconEndorsement },
  { key: 'ratingSteps',   label: 'Rating steps',  Icon: IconPricing },
  { key: 'rtTables',      label: 'Rate tables',   Icon: IconTable },
  { key: 'ldTables',      label: 'L&D tables',    Icon: IconTable },
]

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
      // Land under a freshly-minted, distinct draft id (never the canonical refId), so
      // an import can never clobber or demote a launched product with the same refId.
      const draftId = newDraftId(plan.productId)
      const lineage = importLineage(fileNames, plan.productId, actor)
      const res = await importPlan(plan, actor, setProgress, { productId: draftId, lineage })
      setResult(res); setPhase('done')
      if (res.failed) toast.warning(`Imported ${res.written} items as a draft, ${res.failed} skipped`)
      else toast.success(`Imported ${res.written} items as a draft`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
      setPhase('error')
    }
  }

  const summary = plan?.summary
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Dialog open title="Import ISO workbook" onClose={onClose} width="max-w-2xl">
      {!canEdit ? (
        <p className="text-sm text-danger">You need editor access to import products.</p>
      ) : phase === 'select' ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Upload the ISO product-specification workbooks — Framework, Forms, Rating and Rules.
            You can select all four at once. We&apos;ll map them onto the model and preview a full
            summary before anything is written. The import lands as a <span className="font-medium text-text">draft</span> you
            review and promote later — it never touches the published portfolio.
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
            <span className="flex items-center justify-center w-12 h-12 rounded-[12px]" style={{ background: 'var(--color-accent-soft)' }}>
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
      ) : phase === 'preview' && summary ? (
        <div className="flex flex-col gap-4">
          {!plan?.product ? (
            <div className="flex items-start gap-2.5 rounded-[12px] p-3.5" style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-border)' }}>
              <IconWarning size={16} className="text-danger shrink-0 mt-0.5" />
              <div className="text-sm text-dim">
                No product framework was found in these files. Include the “Product Framework”
                workbook (with a <span className="font-mono text-xs">…PROD…</span> row) to create a product.
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-[12px] p-3.5" style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-border)' }}>
              <span className="flex items-center justify-center w-9 h-9 rounded-[10px] shrink-0" style={{ background: 'var(--gradient-accent)' }}>
                <IconFileSpreadsheet size={18} className="text-white" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text truncate">{summary.productName}</div>
                <div className="text-xs text-dim">
                  <span className="font-mono">{summary.productRefId}</span>
                  {summary.lobName ? <> · {summary.lobName}</> : null}
                </div>
              </div>
            </div>
          )}

          {/* Count tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {COUNT_TILES.map(({ key, label, Icon }) => (
              <div key={key} className="flex flex-col gap-1 rounded-[12px] p-3 bg-surface" style={{ border: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-1.5 text-faint">
                  <Icon size={13} /><span className="text-[11px] uppercase tracking-wide">{label}</span>
                </div>
                <div className="text-xl font-semibold tabular-nums text-text">{summary.counts[key] ?? 0}</div>
              </div>
            ))}
          </div>

          {/* Sheets recognized */}
          {summary.sheetsRecognized.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-dim">
              <IconCheckCircle size={14} className="text-good" />
              <span className="text-faint">Recognized:</span>
              {summary.sheetsRecognized.map(s => (
                <span key={s} className="px-2 py-0.5 rounded-full bg-raised text-[11px]">{s}</span>
              ))}
            </div>
          )}

          {/* Warnings */}
          {summary.warnings.length > 0 && (
            <details className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer text-sm text-text hover:bg-raised">
                <IconWarning size={15} className="text-warn" />
                {summary.warnings.length} warning{summary.warnings.length !== 1 ? 's' : ''}
                <span className="text-xs text-faint ml-auto">(non-blocking)</span>
              </summary>
              <ul className="max-h-40 overflow-y-auto px-3.5 pb-3 pt-1 flex flex-col gap-1 text-xs text-dim">
                {summary.warnings.map((w, i) => <li key={i} className="flex gap-1.5"><span className="text-faint">•</span>{w}</li>)}
              </ul>
            </details>
          )}

          {/* Unmapped columns */}
          {summary.unmappedColumns.length > 0 && (
            <details className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer text-sm text-text hover:bg-raised">
                <IconInfo size={15} className="text-info" />
                Unmapped columns
                <span className="text-xs text-faint ml-auto">(left as-is)</span>
              </summary>
              <div className="max-h-40 overflow-y-auto px-3.5 pb-3 pt-1 flex flex-col gap-2 text-xs">
                {summary.unmappedColumns.map(u => (
                  <div key={u.sheet}>
                    <div className="text-faint mb-0.5">{u.sheet}</div>
                    <div className="flex flex-wrap gap-1">
                      {u.columns.map(c => <span key={c} className="px-1.5 py-0.5 rounded bg-raised text-dim">{c}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={runImport} disabled={!plan?.product}>
              Import as draft <IconArrowRight size={14} />
            </Button>
          </div>
        </div>
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
            <div className="text-base font-semibold text-text">Draft created</div>
            <p className="text-sm text-dim">
              {result.written} item{result.written !== 1 ? 's' : ''} written to a new draft
              {result.failed ? <span className="text-danger"> · {result.failed} skipped</span> : null}. Promote it when it&apos;s ready.
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
          <div className="flex items-start gap-2.5 rounded-[12px] p-3.5 bg-danger/10" style={{ border: '1px solid var(--color-border)' }}>
            <IconClose size={16} className="text-danger shrink-0 mt-0.5" />
            <div className="text-sm text-dim">{error || 'Something went wrong.'}</div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={() => { setPhase('select'); setError(''); setPlan(null) }}>Try again</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
