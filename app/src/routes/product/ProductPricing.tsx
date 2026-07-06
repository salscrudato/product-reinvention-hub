// Pricing worksheet — live rating evaluation via the shared engine. The rating kit
// (getters + worked example + input worksheet) is resolved from the product's LOB, so
// Homeowners renders its bespoke panel and every other line (GL, imported) renders the
// data-driven panel — both trace through the same evaluator. Line-agnostic, not HO-only.
import { useState, useMemo, useRef, useEffect } from 'react'
import { IconDownload, IconRefresh, IconRule, IconTable } from '../../components/ui/icons'
import { evaluate, resolveLob, resolveRatingKit } from '@pf/shared'
import type { RatingInputs, RatingInputMap, TraceEntry } from '@pf/shared'
import { useProductCtx } from '../../context/useProductCtx'
import { Button, Badge, Skeleton } from '../../components/ui'
import { HomeownersRatingPanel } from '../../components/product/HomeownersRatingPanel'
import { GenericRatingPanel } from '../../components/product/GenericRatingPanel'
import { RatingFlow } from '../../lib/svg/ratingFlow'

// ─── Trace: animated flow diagram + detailed table + clean SVG export ─────────

function TracePanel({ trace, finalPremium }: { trace: TraceEntry[]; finalPremium: number }) {
  const [view, setView] = useState<'flow' | 'table'>('flow')
  const flowRef = useRef<HTMLDivElement>(null)

  // Export the on-screen flow SVG verbatim (adds a page-background rect for a
  // self-contained file). Serialising the rendered node keeps export == on-screen.
  function exportSVG() {
    const svg = flowRef.current?.querySelector('svg')
    if (!svg) return
    const clone = svg.cloneNode(true) as SVGSVGElement
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#F7F7FA')
    clone.insertBefore(bg, clone.firstChild)
    const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone)
    const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' }))
    const a = document.createElement('a'); a.href = url; a.download = 'rating-flow.svg'; a.click()
    URL.revokeObjectURL(url)
  }

  const seg = (v: 'flow' | 'table', icon: React.ReactNode, label: string) => (
    <button onClick={() => setView(v)} aria-pressed={view === v}
      className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-[7px] text-xs font-medium transition-colors ${view === v ? 'bg-surface text-accent shadow-[var(--shadow-card)]' : 'text-dim hover:text-text'}`}>
      {icon}{label}
    </button>
  )

  return (
    <div className="flex flex-col gap-0 h-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-text">Rating trace</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-[9px] bg-raised" role="tablist" aria-label="Trace view">
            {seg('flow', <IconRule size={13} />, 'Flow')}
            {seg('table', <IconTable size={13} />, 'Table')}
          </div>
          <Button variant="ghost" size="sm" onClick={exportSVG} aria-label="Export rating flow as SVG"><IconDownload size={13} />SVG</Button>
        </div>
      </div>

      {view === 'flow' ? (
        <div ref={flowRef} className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
          <RatingFlow trace={trace} finalPremium={finalPremium} />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-faint uppercase tracking-wide" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {['Step','Op','Source','Factor / $','Running total'].map(h => <th key={h} className="text-left px-3 py-2">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {trace.map(t => (
                  <tr key={t.stepId} className="hover:bg-raised" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2 font-mono text-text">{t.stepId}</td>
                    <td className="px-3 py-2"><Badge label={t.op} color={t.op === 'MUL' ? 'purple' : t.op === 'ADD' ? 'good' : t.op === 'SET' ? 'blue' : 'warn'} /></td>
                    <td className="px-3 py-2 font-mono text-dim truncate max-w-[140px]">{t.sourceRef}</td>
                    <td className="px-3 py-2 font-mono text-text">
                      {t.op === 'MUL' ? `×${t.factorOrAmount}` : t.op === 'ADD' ? `+$${t.factorOrAmount.toFixed(2)}` : t.op === 'SET' ? `$${t.factorOrAmount}` : `≥$${t.factorOrAmount}`}
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-text">
                      ${t.runningTotal.toLocaleString(undefined, { minimumFractionDigits: t.rounded ? 0 : 2, maximumFractionDigits: 2 })}
                      {t.rounded && <span className="text-faint text-[10px] ml-1">rounded</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Final premium */}
          <div
            className="flex items-center justify-between px-5 py-4 rounded-[12px] mt-3"
            style={{ background: 'var(--gradient-accent-soft)', border: '1px solid var(--color-accent-line)' }}
          >
            <span className="text-sm font-semibold text-text">Final premium</span>
            <span className="text-2xl font-bold tabular-nums gradient-text">${finalPremium.toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main route ───────────────────────────────────────────────────────────────

export default function ProductPricing() {
  const { product, ratingProgram, ldTables, rtTables, loading } = useProductCtx()
  const lob  = useMemo(() => resolveLob(product), [product])
  const kit  = useMemo(() => resolveRatingKit(lob.prefix), [lob.prefix])
  const isHO = lob.prefix === 'HO'
  const coastal = useMemo(() => new Set<string>(lob.peril.eligibleStates), [lob])
  const [inputs, setInputs]       = useState<RatingInputMap>(() => ({ ...kit.workedExample }))
  const [riskState, setRiskState] = useState('OH')

  // Reset to this line's worked example whenever the line changes (mount + product load).
  useEffect(() => { setInputs({ ...kit.workedExample }) }, [lob.prefix, kit])

  const upd = (patch: RatingInputMap) => setInputs(prev => ({ ...prev, ...patch }))

  const result = useMemo(() => {
    if (!ratingProgram || !Object.keys(rtTables).length || !Object.keys(ldTables).length) return null
    try {
      return evaluate(ratingProgram, inputs, kit.makeRtGetter(rtTables), kit.makeLdGetter(ldTables))
    } catch { return null }
  }, [ratingProgram, rtTables, ldTables, inputs, kit])

  if (loading) return <div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><Skeleton className="h-[500px]" /><Skeleton className="h-[500px]" /></div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Left — inputs (bespoke Homeowners worksheet, else the data-driven panel) */}
      <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-text">Rating inputs</span>
          <Button variant="ghost" size="sm" onClick={() => setInputs({ ...kit.workedExample })}>
            <IconRefresh size={13} />Reset to worked example
          </Button>
        </div>

        {isHO ? (
          <HomeownersRatingPanel
            inputs={inputs as RatingInputs} onChange={upd}
            riskState={riskState} setRiskState={setRiskState}
            coastal={coastal} ldTables={ldTables} />
        ) : (
          <GenericRatingPanel spec={kit.inputSpec} inputs={inputs} ldTables={ldTables} onChange={upd} />
        )}
      </div>

      {/* Right — trace */}
      <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
        {!ratingProgram || !result ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-faint">
            <IconRefresh size={24} className={!ratingProgram ? '' : 'animate-spin'} />
            <span className="text-sm">{!ratingProgram ? 'No rating program found' : 'Loading tables...'}</span>
          </div>
        ) : (
          <TracePanel trace={result.trace} finalPremium={result.finalPremium} />
        )}
      </div>
    </div>
  )
}
