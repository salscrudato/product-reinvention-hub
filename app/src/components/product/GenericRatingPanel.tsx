// GenericRatingPanel — a data-driven rating worksheet for any line that isn't the
// bespoke Homeowners panel. It renders one control per field in the LOB's rating input
// spec (resolved through the rating kit), sourcing select options from the loaded LD
// tables when a field declares an `ldTableRef`. When a line ships no spec, it falls back
// to deriving controls from the worked-example values — so imported lines still price.
import type { RatingInputMap, RatingInputField, LDTable } from '@pf/shared'

function InputSelect({ label, options, value, onChange }: {
  label: string
  options: { label: string; value: number | string }[]
  value: number | string
  onChange: (v: number | string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-dim">{label}</span>
      <select
        className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
        value={String(value)}
        onChange={e => {
          const opt = options.find(o => String(o.value) === e.target.value)
          onChange(opt?.value ?? e.target.value)
        }}
      >
        {options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </div>
  )
}

/** Derive a spec from raw worked-example values when a line ships no explicit spec. */
function deriveSpec(inputs: RatingInputMap): RatingInputField[] {
  return Object.entries(inputs)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')
    .map(([key, v]) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()),
      kind: typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : 'text',
    }))
}

export function GenericRatingPanel({ spec, inputs, ldTables, onChange }: {
  spec?: RatingInputField[]
  inputs: RatingInputMap
  ldTables: Record<string, LDTable>
  onChange: (patch: RatingInputMap) => void
}) {
  const fields = spec && spec.length ? spec : deriveSpec(inputs)

  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map(f => {
        const value = inputs[f.key]

        if (f.kind === 'boolean') {
          return (
            <div key={f.key} className="flex items-center gap-2 col-span-2">
              <input type="checkbox" id={f.key} checked={Boolean(value)} className="accent-accent"
                onChange={e => onChange({ [f.key]: e.target.checked })} />
              <label htmlFor={f.key} className="text-xs text-dim">{f.label}</label>
            </div>
          )
        }

        if (f.kind === 'select') {
          // Options come from the referenced LD table, else the field's inline options.
          const ldOpts = f.ldTableRef
            ? (ldTables[f.ldTableRef]?.rows.map(r => ({ label: r.label, value: r.value })) ?? [])
            : []
          const options = ldOpts.length ? ldOpts : (f.options ?? [])
          return (
            <InputSelect key={f.key} label={f.label} options={options}
              value={(value as number | string) ?? options[0]?.value ?? ''}
              onChange={v => onChange({ [f.key]: v })} />
          )
        }

        if (f.kind === 'number') {
          return (
            <div key={f.key} className="flex flex-col gap-1">
              <span className="text-xs text-dim">{f.label}</span>
              <input type="number" min={f.min} step={f.step ?? 1}
                className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
                value={Number(value ?? 0)} onChange={e => onChange({ [f.key]: Number(e.target.value) })} />
            </div>
          )
        }

        // text
        return (
          <div key={f.key} className="flex flex-col gap-1">
            <span className="text-xs text-dim">{f.label}</span>
            <input type="text"
              className="h-8 px-2 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25"
              value={String(value ?? '')} onChange={e => onChange({ [f.key]: e.target.value })} />
          </div>
        )
      })}
    </div>
  )
}
