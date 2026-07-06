// HomeownersRatingPanel — the bespoke HO-3 rating worksheet (coastal wind/hail gating,
// the Coverage F ≥ $5k constraint, the repeating SPP schedule). Extracted verbatim from
// ProductPricing so that route can stay line-agnostic: Homeowners renders this hand-tuned
// panel; every other line renders the data-driven GenericRatingPanel. Behaviour unchanged.
import type { RatingInputs, RatingInputMap, LDTable } from '@pf/shared'
import { Button } from '../ui'

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

export function HomeownersRatingPanel({ inputs, onChange, riskState, setRiskState, coastal, ldTables }: {
  inputs: RatingInputs
  onChange: (patch: RatingInputMap) => void
  riskState: string
  setRiskState: (s: string) => void
  coastal: Set<string>
  ldTables: Record<string, LDTable>
}) {
  const upd = onChange
  const ldOpts = (ref: string) => ldTables[ref]?.rows.map(r => ({ label: r.label, value: r.value, note: r.constraintNote })) ?? []
  const covFOpts = ldOpts('HO.LD.002').map(o => ({ ...o, disabled: o.value === 5000 && inputs.covELimit < 300000 }))
  const windHailCoastal = coastal.has(riskState)

  return (
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
  )
}
