// DuckCreekExportPanel — the export RESULT panel (P3, read-only by design).
//
// Runs POST /api/export/duckcreek through the adapter seam and presents the
// outcome: a clean summary of the 17-row gap report (MAPPED / DEFAULTED with its
// named spec rule / MISSING), the overlay-delta lint status, and — on success —
// downloads for the four bundle artifacts. NO inputs, NO override capture, NO
// tenant mapping memory: that HITL surface is deliberately cut scope (BACKLOG).
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui'
import { IconDownload, IconFileCode, IconFileSpreadsheet, IconWarning } from '../icons'
import { adapter } from '../../lib/backend'
import type { DuckCreekExportResult, DuckCreekGapRow } from '../../lib/backend/types'

interface Props {
  open: boolean
  onClose: () => void
  productId: string
  productName: string
}

type Phase = { state: 'running' } | { state: 'error'; message: string } | { state: 'done'; result: DuckCreekExportResult }

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function b64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function StatusChip({ status }: { status: DuckCreekGapRow['status'] }) {
  const tone = status === 'MAPPED' ? 'text-good' : status === 'DEFAULTED' ? 'text-warn' : 'text-danger'
  const bg = status === 'MAPPED' ? 'var(--color-good-soft)' : status === 'DEFAULTED' ? 'var(--color-warn-soft)' : 'var(--color-danger-soft)'
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[6px] text-[10px] font-semibold tracking-wide ${tone}`}
      style={{ background: bg }}>
      {status}
    </span>
  )
}

export function DuckCreekExportPanel({ open, onClose, productId, productName }: Props) {
  const [phase, setPhase] = useState<Phase>({ state: 'running' })
  const runFor = useRef<string | null>(null)

  useEffect(() => {
    if (!open) { runFor.current = null; return }
    if (runFor.current === productId) return
    runFor.current = productId
    setPhase({ state: 'running' })
    adapter.export.duckcreek(productId)
      .then((result) => setPhase({ state: 'done', result }))
      .catch((err: unknown) => setPhase({ state: 'error', message: err instanceof Error ? err.message : 'Export failed' }))
  }, [open, productId])

  const result = phase.state === 'done' ? phase.result : null
  const gap = result?.gapReport
  const defaulted = gap?.rows.filter((r) => r.status === 'DEFAULTED') ?? []

  return (
    <Dialog open={open} onClose={onClose} title={`Duck Creek export — ${productName}`} width="max-w-2xl"
      footer={<div className="flex justify-end"><Button variant="ghost" size="sm" onClick={onClose}>Close</Button></div>}>
      {phase.state === 'running' && (
        <p className="text-sm text-dim py-6 text-center" role="status">
          Emitting the Author XML overlay, Unity workbook pair and export manifest…
        </p>
      )}

      {phase.state === 'error' && (
        <div className="flex items-start gap-2 text-sm text-danger py-4" role="alert">
          <IconWarning size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>Export failed: {phase.message}</span>
        </div>
      )}

      {result && gap && (
        <div className="space-y-4">
          {/* Outcome banner */}
          {result.blocked ? (
            <div className="flex items-start gap-2 text-sm text-danger rounded-[10px] px-3.5 py-2.5" role="alert"
              style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-line)' }}>
              <IconWarning size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <strong>Export blocked.</strong> {gap.missing.length} required field{gap.missing.length === 1 ? '' : 's'} MISSING
                — no safe spec default exists, so nothing was emitted (flagged, not dropped).
              </span>
            </div>
          ) : (
            <div className="text-sm text-good rounded-[10px] px-3.5 py-2.5"
              style={{ background: 'var(--color-good-soft)', border: '1px solid var(--color-good-line)' }}>
              <strong>Overlay emitted.</strong> Delta lint green
              {result.lint && result.lint.findings.length > 0 ? ` (${result.lint.findings.length} warning${result.lint.findings.length === 1 ? '' : 's'})` : ''}.
              {result.dictionaryRevealed ? ' Data Dictionary revealed for this tenant.' : ''}
            </div>
          )}

          {/* Gap-report summary */}
          <div>
            <h3 className="text-xs font-semibold text-faint uppercase tracking-wide mb-1.5">
              Completeness — spec §5 inventory ({gap.counts.mapped} mapped · {gap.counts.defaulted} defaulted · {gap.counts.missing} missing)
            </h3>
            <ul className="space-y-1.5">
              {gap.rows.map((row) => (
                <li key={row.specRow} className="flex items-start gap-2 text-xs text-text">
                  <span className="text-faint w-8 shrink-0 text-right">§5.{row.specRow}</span>
                  <StatusChip status={row.status} />
                  <span className="min-w-0">
                    <span className="text-text">{row.field}</span>
                    {row.value !== undefined && <span className="text-dim"> = {row.value}</span>}
                    {row.status === 'DEFAULTED' && row.rule && (
                      <span className="block text-dim">{row.rule}</span>
                    )}
                    {row.status === 'MAPPED' && row.source && (
                      <span className="block text-dim">{row.source}</span>
                    )}
                    {row.detail && <span className="block text-faint">{row.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Artifacts */}
          {!result.blocked && result.artifacts && (
            <div>
              <h3 className="text-xs font-semibold text-faint uppercase tracking-wide mb-1.5">
                Delivery bundle — one atomic unit; rates ride the TableConfig workbook, never the XML
              </h3>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" size="sm"
                  onClick={() => download(result.artifacts!.overlayFileName, new Blob([result.artifacts!.overlayXml], { type: 'application/xml' }))}>
                  <IconFileCode size={14} aria-hidden="true" /> {result.artifacts.overlayFileName}
                </Button>
                <Button variant="ghost" size="sm"
                  onClick={() => download(`${gap.productRefId.replace(/[^A-Za-z0-9.-]+/g, '_')}_CoverageConfig.xlsx`, b64ToBlob(result.artifacts!.coverageConfigXlsxB64, XLSX_MIME))}>
                  <IconFileSpreadsheet size={14} className="text-good" aria-hidden="true" /> CoverageConfig.xlsx
                </Button>
                <Button variant="ghost" size="sm"
                  onClick={() => download(`${gap.productRefId.replace(/[^A-Za-z0-9.-]+/g, '_')}_TableConfig.xlsx`, b64ToBlob(result.artifacts!.tableConfigXlsxB64, XLSX_MIME))}>
                  <IconFileSpreadsheet size={14} className="text-good" aria-hidden="true" /> TableConfig.xlsx
                </Button>
                <Button variant="ghost" size="sm"
                  onClick={() => download('export-manifest.json', new Blob([JSON.stringify(result.artifacts!.manifest, null, 2)], { type: 'application/json' }))}>
                  <IconDownload size={14} aria-hidden="true" /> export-manifest.json
                </Button>
              </div>
              {defaulted.length > 0 && (
                <p className="text-xs text-faint mt-2">
                  {defaulted.length} defaulted value{defaulted.length === 1 ? '' : 's'} carry their spec rule in the
                  manifest <code>hitl[]</code> inventory — review before delivery to Duck Creek.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

export default DuckCreekExportPanel
