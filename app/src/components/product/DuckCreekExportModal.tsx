// DuckCreekExportModal — preview + validation report before download.
// Shows per-section counts, any validation issues, and the instance-vs-manuscript-
// definition caveat from docs/DUCKCREEK_MAPPING.md. Download is gated on a passing
// validation report; the manuScriptID is shown so the user knows what was emitted.
// On confirm, calls the server-side exportDuckCreek callable to record the audit
// event before triggering the file download.
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Dialog, Button } from '../ui'
import {
  IconCheckCircle, IconWarning, IconDownload, IconSpinner,
  IconInfo, IconCheck, IconCopy, IconAlertCircle,
} from '../ui/icons'
import { adapter } from '../../lib/backend'
import { useUser } from '../../context/useUser'
import { buildDuckCreekExport, downloadXml } from '../../lib/export/duckcreek'
import type { DuckCreekExportData, DuckCreekExportResult } from '../../lib/export/duckcreek'

interface Props {
  data:    DuckCreekExportData
  onClose: () => void
}

// PDM section keys (camelCase) → human-readable labels for the round-trip table.
// Generic so a newly-added section still reads sensibly ("ratingSteps" → "Rating steps").
function humanizeSection(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// Shared grid template so header, rows and the total footer line up column-for-column.
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_1.5rem] items-center gap-3'

export function DuckCreekExportModal({ data, onClose }: Props) {
  const { user } = useUser()
  const [result,     setResult]     = useState<DuckCreekExportResult | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [auditing,   setAuditing]   = useState(false)
  const [copied,     setCopied]     = useState(false)

  // Build is synchronous pure computation — run in an effect so the dialog
  // renders its loading state first, then fills in immediately.
  useEffect(() => {
    try {
      setResult(buildDuckCreekExport(data))
    } catch (e) {
      setBuildError((e as Error).message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally one-shot: rebuild only if user closes + re-opens

  async function copyManuscriptId() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.manuScriptID)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  async function handleDownload() {
    if (!result?.report.ok || !user) return
    setAuditing(true)
    try {
      await adapter.fns.call<
        { productId: string; productRefId?: string; manuScriptID: string },
        { ok: boolean }
      >('exportDuckCreek', {
        productId:    data.product.id,
        productRefId: data.product.refId ?? undefined,
        manuScriptID: result.manuScriptID,
      })
      downloadXml(result.xml, result.fileName)
      toast.success('Duck Creek manuscript downloaded')
      onClose()
    } catch {
      toast.error('Export failed — audit record could not be written')
    } finally {
      setAuditing(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Export to Duck Creek manuscript" width="max-w-2xl">

      {/* Loading while the pure build runs */}
      {!result && !buildError && (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-faint">
          <IconSpinner size={20} className="animate-spin text-accent" aria-hidden="true" />
          <p className="text-sm">Building manuscript…</p>
        </div>
      )}

      {/* Build error (no rating program, etc.) */}
      {buildError && (
        <div className="flex flex-col gap-5">
          <div className="rounded-[12px] p-4 bg-raised" style={{ border: '1px solid var(--color-border)' }}>
            <div className="flex items-start gap-3">
              <span
                className="shrink-0 grid place-items-center w-9 h-9 rounded-[10px]"
                style={{ background: 'color-mix(in srgb, var(--color-danger) 14%, transparent)', color: 'var(--color-danger)' }}
              >
                <IconWarning size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-danger">Cannot build manuscript</p>
                <p className="text-sm text-dim mt-0.5 leading-relaxed">{buildError}</p>
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}

      {/* Validation report */}
      {result && (() => {
        const { report } = result
        const totalPdm    = report.counts.reduce((n, c) => n + c.expected, 0)
        const totalXml    = report.counts.reduce((n, c) => n + c.emitted, 0)
        const errorCount  = report.issues.filter(i => i.severity === 'error').length
        const ok          = report.ok
        const tint        = ok ? 'var(--color-good)' : 'var(--color-danger)'

        return (
          <div className="flex flex-col gap-5">

            {/* Status + manuscript identity — a compact "receipt" header */}
            <div className="rounded-[12px] p-4 bg-raised" style={{ border: '1px solid var(--color-border)' }}>
              <div className="flex items-start gap-3">
                <span
                  className="shrink-0 grid place-items-center w-9 h-9 rounded-[10px]"
                  style={{ background: `color-mix(in srgb, ${tint} 14%, transparent)`, color: tint }}
                >
                  {ok
                    ? <IconCheckCircle size={18} aria-hidden="true" />
                    : <IconWarning     size={18} aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" style={{ color: tint }}>
                    {ok ? 'Validation passed' : 'Validation failed'}
                  </p>
                  <p className="text-xs text-dim mt-0.5 leading-relaxed">
                    {ok
                      ? `All ${report.counts.length} sections round-tripped — ${totalXml} nodes emitted.`
                      : `${errorCount} ${errorCount === 1 ? 'issue' : 'issues'} must be resolved before download.`}
                  </p>
                </div>
              </div>

              {/* Manuscript ID + output file */}
              <div
                className="mt-3.5 pt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3"
                style={{ borderTop: '1px solid var(--color-border)' }}
              >
                <div className="min-w-0">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-faint mb-1">Manuscript ID</p>
                  <div className="flex items-center gap-1.5">
                    <code className="text-xs font-mono text-text truncate" title={result.manuScriptID}>
                      {result.manuScriptID}
                    </code>
                    <button
                      onClick={() => void copyManuscriptId()}
                      className="shrink-0 grid place-items-center w-6 h-6 rounded-[6px] text-faint hover:text-accent hover:bg-hover transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                      aria-label="Copy manuscript ID"
                    >
                      {copied
                        ? <IconCheck size={13} className="text-good" aria-hidden="true" />
                        : <IconCopy  size={13} aria-hidden="true" />}
                    </button>
                  </div>
                </div>
                <div className="min-w-0 sm:text-right">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-faint mb-1">Output file</p>
                  <code className="text-xs font-mono text-dim truncate block" title={result.fileName}>
                    {result.fileName}
                  </code>
                </div>
              </div>
            </div>

            {/* Fail-closed validation dimensions — each must pass before download is allowed. */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint mb-2">Validation checks</p>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['Well-formed',     report.wellFormed],
                  ['Namespace',       report.namespaceDeclared],
                  ['ID conventions',  report.idPrefixesValid],
                  ['Cross-refs',      report.crossRefsValid],
                  ['Round-trip',      report.roundTripOk],
                  ['Required fields', report.requiredFieldsPresent],
                  ['Enums',           report.enumsValid],
                  ['Numeric formats', report.numericFormatsValid],
                ] as const).map(([label, pass]) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-medium"
                    style={{
                      background: `color-mix(in srgb, ${pass ? 'var(--color-good)' : 'var(--color-danger)'} 12%, transparent)`,
                      color: pass ? 'var(--color-good)' : 'var(--color-danger)',
                    }}
                  >
                    {pass
                      ? <IconCheck       size={12} aria-hidden="true" />
                      : <IconAlertCircle size={12} aria-hidden="true" />}
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Per-section round-trip counts */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint mb-2">Round-trip check</p>
              <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>

                {/* Header */}
                <div className={`${ROW_GRID} px-4 py-2.5 bg-raised`} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Section</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-faint text-right">PDM</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-faint text-right">XML</span>
                  <span aria-hidden="true" />
                </div>

                {/* Rows */}
                {report.counts.map((c, i) => {
                  const empty = c.expected === 0 && c.emitted === 0
                  return (
                    <div
                      key={c.section}
                      className={`${ROW_GRID} px-4 py-2 hover:bg-raised transition-colors`}
                      style={i < report.counts.length - 1 ? { borderBottom: '1px solid var(--color-border)' } : undefined}
                    >
                      <span className="text-[13px] text-text truncate">{humanizeSection(c.section)}</span>
                      <span className={`text-[13px] text-right font-mono ${empty ? 'text-faint' : 'text-dim'}`}>
                        {empty ? '—' : c.expected}
                      </span>
                      <span className={`text-[13px] text-right font-mono ${empty ? 'text-faint' : c.ok ? 'text-text' : 'text-danger font-semibold'}`}>
                        {empty ? '—' : c.emitted}
                      </span>
                      <span className="grid place-items-center">
                        {empty
                          ? null
                          : c.ok
                          ? <IconCheck        size={14} className="text-good"   aria-hidden="true" />
                          : <IconAlertCircle  size={14} className="text-danger" aria-hidden="true" />}
                      </span>
                    </div>
                  )
                })}

                {/* Total */}
                <div className={`${ROW_GRID} px-4 py-2.5 bg-raised`} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">Total</span>
                  <span className="text-[13px] text-right font-mono font-semibold text-text">{totalPdm}</span>
                  <span className="text-[13px] text-right font-mono font-semibold text-text">{totalXml}</span>
                  <span className="grid place-items-center">
                    {totalPdm === totalXml
                      ? <IconCheck       size={14} className="text-good"   aria-hidden="true" />
                      : <IconAlertCircle size={14} className="text-danger" aria-hidden="true" />}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-faint mt-2 leading-relaxed">
                <strong className="font-semibold text-dim">PDM</strong> counts nodes in the product data model;{' '}
                <strong className="font-semibold text-dim">XML</strong> counts nodes emitted to the manuscript. A check
                means the section round-tripped — nothing dropped, nothing invented.
              </p>
            </div>

            {/* Validation issues */}
            {report.issues.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Issues</p>
                {report.issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2.5 rounded-[8px] px-3 py-2 bg-raised">
                    {issue.severity === 'error'
                      ? <IconAlertCircle size={14} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
                      : <IconInfo        size={14} className="text-warn   shrink-0 mt-0.5" aria-hidden="true" />}
                    <p className={`text-xs leading-relaxed break-all ${issue.severity === 'error' ? 'text-danger' : 'text-warn'}`}>
                      <span className="font-mono mr-1 opacity-80">[{issue.code}]</span>{issue.message}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Instance-vs-definition caveat */}
            <div className="flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 bg-raised">
              <IconInfo size={14} className="text-faint shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-faint leading-relaxed">
                Manuscript-<strong className="font-semibold text-dim">shaped</strong> output — reuses Duck Creek vocabulary
                observed in an instance sample plus honest extensions (<code className="font-mono text-[11px]">refId</code> on
                every node, validValues lists). The proprietary manuscript-definition schema is not reproduced; retargeting
                the vocabulary is a mapping edit in <code className="font-mono text-[11px]">shared/src/duckcreek/mapping.ts</code>.
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
              <Button variant="ghost" size="sm" onClick={onClose} disabled={auditing}>
                Cancel
              </Button>
              <Button
                variant="primary" size="sm"
                onClick={() => void handleDownload()}
                disabled={!ok || auditing || !user}
                aria-label={
                  !ok
                    ? 'Download blocked — validation failed'
                    : auditing
                    ? 'Recording audit event…'
                    : `Download ${result.fileName}`
                }
              >
                {auditing
                  ? <><IconSpinner size={14} className="animate-spin" aria-hidden="true" />Recording…</>
                  : <><IconDownload size={14} aria-hidden="true" />Download .xml</>}
              </Button>
            </div>

          </div>
        )
      })()}
    </Dialog>
  )
}
