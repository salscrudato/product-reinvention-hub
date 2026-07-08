// HomeownersRatingPanel — the bespoke HO-3 rating worksheet (coastal wind/hail gating,
// the Coverage F ≥ $5k constraint, the repeating SPP schedule). Extracted from
// ProductPricing so that route stays line-agnostic: Homeowners renders this hand-tuned
// panel; every other line renders the data-driven GenericRatingPanel. The inputs are a
// local sandbox that drives the live trace — no persistence — so they aren't role-gated;
// the grid editor is the mutation surface and is VIEWER-gated separately.
import type { ReactNode } from 'react'
import type { RatingInputs, RatingInputMap, LDTable } from '@pf/shared'
import { Button } from '../ui'
import { IconPlus, IconTrash, IconPeril } from '../ui/icons'

// ─── Field primitives — one calm, consistent rhythm across the worksheet ───────

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-dim">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint leading-snug">{hint}</span>}
    </label>
  )
}

const controlCls =
  'h-9 px-2.5 rounded-[9px] bg-surface border border-border-strong text-sm text-text tabular-nums ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent transition-colors'

interface SelectProps {
  label: string
  hint?: string
  options: { label: string; value: number | string; disabled?: boolean }[]
  value: number | string
  onChange: (v: number | string) => void
}
function Select({ label, hint, options, value, onChange }: SelectProps) {
  return (
    <Field label={label} hint={hint}>
      <select className={controlCls} value={String(value)}
        onChange={e => {
          const opt = options.find(o => String(o.value) === e.target.value)
          onChange(opt?.value ?? e.target.value)
        }}>
        {options.map(o => (
          <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
            {o.label}{o.disabled ? ' (blocked)' : ''}
          </option>
        ))}
      </select>
    </Field>
  )
}

function NumberInput({ label, hint, value, onChange, min, max, step }: {
  label: string; hint?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number
}) {
  return (
    <Field label={label} hint={hint}>
      <input type="number" min={min} max={max} step={step ?? 1000} className={`${controlCls} font-mono`}
        value={value} onChange={e => onChange(Number(e.target.value))} />
    </Field>
  )
}

/** A calm switch toggle matching the design system (mirrors TermOptionsDialog). */
function Toggle({ id, checked, onChange, label, hint }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <label htmlFor={id} className="flex flex-col gap-0.5 cursor-pointer">
        <span className="text-sm text-text">{label}</span>
        {hint && <span className="text-[11px] text-faint leading-snug">{hint}</span>}
      </label>
      <button id={id} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className="shrink-0 mt-0.5 w-9 h-[22px] rounded-full p-0.5 transition-colors flex items-center"
        style={{ background: checked ? 'var(--color-accent)' : 'var(--color-border-strong)' }}>
        <span className="w-[18px] h-[18px] rounded-full bg-white transition-transform" style={{ transform: checked ? 'translateX(14px)' : 'translateX(0)' }} />
      </button>
    </div>
  )
}

/** A titled group of related inputs — the spine of the "calm, grouped form". */
function Section({ title, children, cols = 2 }: { title: string; children: ReactNode; cols?: 1 | 2 }) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">{title}</p>
      <div className={cols === 2 ? 'grid grid-cols-2 gap-3' : 'flex flex-col gap-3'}>{children}</div>
    </section>
  )
}

// ─── The worksheet ─────────────────────────────────────────────────────────────

export function HomeownersRatingPanel({ inputs, onChange, riskState, setRiskState, coastal, ldTables }: {
  inputs: RatingInputs
  onChange: (patch: RatingInputMap) => void
  riskState: string
  setRiskState: (s: string) => void
  coastal: Set<string>
  ldTables: Record<string, LDTable>
}) {
  const upd = onChange
  const ldOpts = (ref: string) => ldTables[ref]?.rows.map(r => ({ label: r.label, value: r.value })) ?? []
  const covFOpts = ldOpts('HO.LD.002').map(o => ({ ...o, disabled: o.value === 5000 && inputs.covELimit < 300000 }))
  const windHailCoastal = coastal.has(riskState)

  return (
    <div className="flex flex-col gap-6">
      <Section title="Location & structure">
        <Select label="Territory" value={inputs.territory}
          options={[
            { label: 'T001 · $640', value: 'T001' }, { label: 'T002 · $700', value: 'T002' },
            { label: 'T003 · $815', value: 'T003' }, { label: 'T004 · $905', value: 'T004' },
            { label: 'T005 · $1,040', value: 'T005' },
          ]}
          onChange={v => upd({ territory: String(v) })} />

        <Field label="Risk state">
          <select className={controlCls} value={riskState} onChange={e => setRiskState(e.target.value)}>
            {['AZ','CA','CO','FL','GA','IL','IN','MI','NC','OH','PA','SC','TN','TX','VA'].map(s => (
              <option key={s} value={s}>{s}{coastal.has(s) ? '  ⚡ coastal' : ''}</option>
            ))}
          </select>
        </Field>

        <NumberInput label="Protection class" value={inputs.pc} min={1} max={10} step={1} onChange={v => upd({ pc: v })} />

        <Select label="Construction" value={inputs.construction}
          options={[{ label: 'Frame', value: 'F' }, { label: 'Masonry', value: 'M' }]}
          onChange={v => upd({ construction: String(v) })} />

        <NumberInput label="Coverage A ($)" value={inputs.covA} min={100000} onChange={v => upd({ covA: v })} />
      </Section>

      <Section title="Deductibles">
        <Select label="All-peril deductible" value={inputs.allPerilDed}
          options={ldOpts('HO.LD.003')} onChange={v => upd({ allPerilDed: Number(v) })} />

        {windHailCoastal ? (
          <>
            <div className="col-span-2">
              <Toggle id="wh" checked={inputs.windHailElected}
                onChange={c => upd({ windHailElected: c, windHailPct: c ? 1 : undefined })}
                label={<span className="inline-flex items-center gap-1.5"><IconPeril size={14} className="text-warn" />Wind/Hail % deductible</span>}
                hint="Coastal states only [HO.RU.008]" />
            </div>
            {inputs.windHailElected && (
              <Select label="Wind/hail %" value={inputs.windHailPct ?? 1}
                options={ldOpts('HO.LD.004').map(o => ({
                  label: o.label, value: o.value,
                  disabled: (Number(o.value) / 100 * inputs.covA) < inputs.allPerilDed,
                }))}
                onChange={v => upd({ windHailPct: Number(v) })} />
            )}
          </>
        ) : (
          <p className="col-span-2 text-xs text-faint italic leading-snug">
            Wind/hail % deductible not available for {riskState} [HO.RU.008]
          </p>
        )}
      </Section>

      <Section title="Coverage limits">
        <Select label="Coverage C %" value={inputs.covCPct}
          options={ldOpts('HO.LD.005')} onChange={v => upd({ covCPct: Number(v) })} />
        <Select label="Coverage E limit" value={inputs.covELimit}
          options={ldOpts('HO.LD.001')} onChange={v => upd({ covELimit: Number(v) })} />
        <Select label="Coverage F limit" hint="$5,000 requires Coverage E ≥ $300,000 [HO.RU.006]" value={inputs.covFLimit}
          options={covFOpts} onChange={v => upd({ covFLimit: Number(v) })} />
      </Section>

      <Section title="Rating factors">
        <Select label="Tier" value={inputs.tier}
          options={[{ label: 'A · ×0.90', value: 'A' }, { label: 'B · ×1.10', value: 'B' }, { label: 'C · ×1.25', value: 'C' }]}
          onChange={v => upd({ tier: String(v) })} />
        <Select label="Device credit" value={inputs.deviceCredit}
          options={[{ label: 'None', value: 'none' }, { label: 'Local alarm · ×0.98', value: 'local' }, { label: 'Central station · ×0.95', value: 'central' }]}
          onChange={v => upd({ deviceCredit: String(v) })} />
      </Section>

      <Section title="Endorsements & credits" cols={1}>
        <Toggle id="rc" checked={inputs.rcElected} onChange={c => upd({ rcElected: c })}
          label="Personal Property Replacement Cost" hint="HO 04 90 · ×1.10" />

        <Toggle id="wb" checked={inputs.waterBackupElected}
          onChange={c => upd({ waterBackupElected: c, waterBackupLimit: c ? 5000 : undefined })}
          label="Water Back-Up & Sump Overflow" hint="HO 04 95" />
        {inputs.waterBackupElected && (
          <div className="pl-1">
            <Select label="Water back-up limit" value={inputs.waterBackupLimit ?? 5000}
              options={ldOpts('HO.LD.006')} onChange={v => upd({ waterBackupLimit: Number(v) })} />
          </div>
        )}

        <Toggle id="spp" checked={inputs.sppElected}
          onChange={c => upd({ sppElected: c, sppItems: c ? (inputs.sppItems?.length ? inputs.sppItems : [{ itemClass: 'Jewelry', appraisedValue: 15000 }]) : [] })}
          label="Scheduled Personal Property" hint="HO 04 61 · rated per $100 of appraised value" />
        {inputs.sppElected && (
          <div className="flex flex-col gap-2 pl-1">
            {(inputs.sppItems ?? []).map((item, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                <select className="h-8 px-2 rounded-[7px] bg-surface border border-border-strong text-xs text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
                  value={item.itemClass}
                  onChange={e => { const s = [...(inputs.sppItems ?? [])]; s[i] = { ...s[i]!, itemClass: e.target.value }; upd({ sppItems: s }) }}>
                  {['Jewelry','Furs','Cameras','Fine Arts','Silverware','Musical Instruments'].map(c => <option key={c}>{c}</option>)}
                </select>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-faint text-xs pointer-events-none">$</span>
                  <input type="number" className="h-8 w-28 pl-5 pr-2 rounded-[7px] bg-surface border border-border-strong font-mono text-xs text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
                    value={item.appraisedValue}
                    onChange={e => { const s = [...(inputs.sppItems ?? [])]; s[i] = { ...s[i]!, appraisedValue: Number(e.target.value) }; upd({ sppItems: s }) }} />
                </div>
                <button aria-label="Remove item"
                  onClick={() => { const s = (inputs.sppItems ?? []).filter((_, j) => j !== i); upd({ sppItems: s }) }}
                  className="w-8 h-8 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[var(--color-danger-hover)] transition-colors">
                  <IconTrash size={14} />
                </button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="self-start"
              onClick={() => upd({ sppItems: [...(inputs.sppItems ?? []), { itemClass: 'Jewelry', appraisedValue: 10000 }] })}>
              <IconPlus size={13} />Add item
            </Button>
          </div>
        )}
      </Section>
    </div>
  )
}
