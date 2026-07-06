// Pricing worksheet — live rating evaluation via the shared engine; defaults to $1,528 worked example.
import { useState, useMemo, useRef } from 'react'
import { IconDownload, IconRefresh, IconRule, IconTable } from '../../components/ui/icons'
import { evaluate, resolveLob } from '@pf/shared'
import { makeHO3RtGetter, makeHO3LdGetter, HO3_WORKED_EXAMPLE } from '@pf/shared'
import type { RatingInputs, TraceEntry } from '@pf/shared'
import { useProductCtx } from '../../context/useProductCtx'
import { Button, Badge, Skeleton } from '../../components/ui'
import { RatingFlow } from '../../lib/svg/ratingFlow'

// ─── Input panel ─────────────────────────────────────────────────────────────

interface InputSelectProps {
  label: string
  options: { label: string; value: number | string; disabled?: boolean; note?: string }[]
  value: number | string
  onChange: (v: number | string) => void
}
function InputSelect({ label, options, value, onChange }: InputSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-dim">{label}</span>
      <select
        className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
        value={String(value)} onChange={e => {
          const opt = options.find(o => String(o.value) === e.target.value)
          onChange(opt?.value ?? e.target.value)
        }}
      >
        {options.map(o => <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>{o.label}{o.disabled ? ' (blocked)' : ''}</option>)}
      </select>
    </div>
  )
}

function InputNumber({ label, value, onChange, min, step }: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-dim">{label}</span>
      <input
        type="number" min={min} step={step ?? 1000}
        className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
        value={value} onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

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
  const coastal = useMemo(() => new Set<string>(resolveLob(product).peril.eligibleStates), [product])
  const [inputs, setInputs]       = useState<RatingInputs>({ ...HO3_WORKED_EXAMPLE })
  const [riskState, setRiskState] = useState('OH')

  const upd = (patch: Partial<RatingInputs>) => setInputs(prev => ({ ...prev, ...patch }))

  const result = useMemo(() => {
    if (!ratingProgram || !Object.keys(rtTables).length || !Object.keys(ldTables).length) return null
    try {
      const rtGetter = makeHO3RtGetter(rtTables)
      const ldGetter = makeHO3LdGetter(ldTables)
      return evaluate(ratingProgram, inputs, rtGetter, ldGetter)
    } catch { return null }
  }, [ratingProgram, rtTables, ldTables, inputs])

  if (loading) return <div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><Skeleton className="h-[500px]" /><Skeleton className="h-[500px]" /></div>

  // Build LD option arrays from loaded tables
  const ldOpts = (ref: string) => ldTables[ref]?.rows.map(r => ({ label: r.label, value: r.value, note: r.constraintNote })) ?? []
  const covFOpts = ldOpts('HO.LD.002').map(o => ({ ...o, disabled: o.value === 5000 && inputs.covELimit < 300000 }))
  const windHailCoastal = coastal.has(riskState)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Left — inputs */}
      <div className="bg-surface rounded-[14px] p-5" style={{ border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-text">Rating inputs</span>
          <Button variant="ghost" size="sm" onClick={() => setInputs({ ...HO3_WORKED_EXAMPLE })}>
            <IconRefresh size={13} />Reset to $1,528
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <InputSelect label="Territory" value={inputs.territory}
            options={[{label:'T001 ($640)',value:'T001'},{label:'T002 ($700)',value:'T002'},{label:'T003 ($815)',value:'T003'},{label:'T004 ($905)',value:'T004'},{label:'T005 ($1,040)',value:'T005'}]}
            onChange={v => upd({ territory: String(v) })} />

          <div className="flex flex-col gap-1">
            <span className="text-xs text-dim">Risk state</span>
            <select className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none"
              value={riskState} onChange={e => setRiskState(e.target.value)}>
              {['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA'].map(s => (
                <option key={s} value={s}>{s}{coastal.has(s) ? ' ⚡' : ''}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-dim">Protection class</span>
            <input type="number" min={1} max={10} className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none"
              value={inputs.pc} onChange={e => upd({ pc: Number(e.target.value) })} />
          </div>

          <InputSelect label="Construction" value={inputs.construction}
            options={[{label:'Frame',value:'F'},{label:'Masonry',value:'M'}]}
            onChange={v => upd({ construction: String(v) })} />

          <InputNumber label="Coverage A ($)" value={inputs.covA} min={100000} onChange={v => upd({ covA: v })} />

          <InputSelect label="All-peril deductible" value={inputs.allPerilDed}
            options={ldOpts('HO.LD.003')} onChange={v => upd({ allPerilDed: Number(v) })} />

          {/* Wind/hail — only shown for coastal risk states */}
          {windHailCoastal ? (
            <>
              <div className="flex items-center gap-2 col-span-2">
                <input type="checkbox" id="wh" checked={inputs.windHailElected}
                  onChange={e => upd({ windHailElected: e.target.checked, windHailPct: e.target.checked ? 1 : undefined })} />
                <label htmlFor="wh" className="text-xs text-dim">Wind/Hail % deductible (coastal) [HO.RU.008]</label>
              </div>
              {inputs.windHailElected && (
                <InputSelect label="Wind/hail %" value={inputs.windHailPct ?? 1}
                  options={ldOpts('HO.LD.004').map(o => ({
                    label: o.label, value: o.value,
                    disabled: (Number(o.value) / 100 * inputs.covA) < inputs.allPerilDed,
                  }))}
                  onChange={v => upd({ windHailPct: Number(v) })} />
              )}
            </>
          ) : (
            <div className="col-span-2 text-xs text-faint italic">Wind/hail deductible not available for {riskState} [HO.RU.008]</div>
          )}

          <InputSelect label="Coverage C %" value={inputs.covCPct}
            options={ldOpts('HO.LD.005')} onChange={v => upd({ covCPct: Number(v) })} />

          <InputSelect label="Coverage E limit" value={inputs.covELimit}
            options={ldOpts('HO.LD.001')} onChange={v => upd({ covELimit: Number(v) })} />

          <InputSelect label="Coverage F limit [HO.RU.006]" value={inputs.covFLimit}
            options={covFOpts} onChange={v => upd({ covFLimit: Number(v) })} />

          <InputSelect label="Tier" value={inputs.tier}
            options={[{label:'A (×0.90)',value:'A'},{label:'B (×1.10)',value:'B'},{label:'C (×1.25)',value:'C'}]}
            onChange={v => upd({ tier: String(v) })} />

          <InputSelect label="Device credit" value={inputs.deviceCredit}
            options={[{label:'None',value:'none'},{label:'Local alarm (×0.98)',value:'local'},{label:'Central station (×0.95)',value:'central'}]}
            onChange={v => upd({ deviceCredit: String(v) })} />

          <div className="flex items-center gap-2 col-span-2">
            <input type="checkbox" id="rc" checked={inputs.rcElected}
              onChange={e => upd({ rcElected: e.target.checked })} />
            <label htmlFor="rc" className="text-xs text-dim">Replacement Cost (HO 04 90) ×1.10</label>
          </div>

          <div className="flex items-center gap-2 col-span-2">
            <input type="checkbox" id="wb" checked={inputs.waterBackupElected}
              onChange={e => upd({ waterBackupElected: e.target.checked, waterBackupLimit: e.target.checked ? 5000 : undefined })} />
            <label htmlFor="wb" className="text-xs text-dim">Water back-up (HO 04 95)</label>
          </div>
          {inputs.waterBackupElected && (
            <InputSelect label="Water back-up limit" value={inputs.waterBackupLimit ?? 5000}
              options={ldOpts('HO.LD.006')} onChange={v => upd({ waterBackupLimit: Number(v) })} />
          )}

          {/* SPP */}
          <div className="flex items-center gap-2 col-span-2">
            <input type="checkbox" id="spp" checked={inputs.sppElected}
              onChange={e => upd({ sppElected: e.target.checked, sppItems: e.target.checked ? (inputs.sppItems?.length ? inputs.sppItems : [{ itemClass: 'Jewelry', appraisedValue: 15000 }]) : [] })} />
            <label htmlFor="spp" className="text-xs text-dim">Scheduled Personal Property (HO 04 61)</label>
          </div>
          {inputs.sppElected && (
            <div className="col-span-2 flex flex-col gap-2">
              {(inputs.sppItems ?? []).map((item, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <select className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs"
                    value={item.itemClass}
                    onChange={e => { const s = [...(inputs.sppItems ?? [])]; s[i] = { ...s[i]!, itemClass: e.target.value }; upd({ sppItems: s }) }}>
                    {['Jewelry','Furs','Cameras','Fine Arts','Silverware','Musical Instruments'].map(c => <option key={c}>{c}</option>)}
                  </select>
                  <input type="number" className="h-7 px-2 rounded-[6px] bg-surface border border-border-strong text-xs"
                    value={item.appraisedValue}
                    onChange={e => { const s = [...(inputs.sppItems ?? [])]; s[i] = { ...s[i]!, appraisedValue: Number(e.target.value) }; upd({ sppItems: s }) }} />
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={() => upd({ sppItems: [...(inputs.sppItems ?? []), { itemClass: 'Jewelry', appraisedValue: 10000 }] })}>
                + Add item
              </Button>
            </div>
          )}
        </div>
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
