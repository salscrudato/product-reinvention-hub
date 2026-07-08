// ldGetter.ts — the generic Limit/Deductible (LD) source getter, shared by every line.
// An `LD` rating source resolves the caller-selected option against a flat {label,value}
// LD table and returns that option's numeric `value`, validated to be a real row. Unlike the
// bespoke per-line RT getters (each a different lookup shape), LD lookup is uniform, so one
// implementation serves all lines.
//
// D6: this replaces the previous per-line throwing stubs. No seeded rating step uses an LD
// source today — limit/deductible selections flow into the engine as numeric INPUTs — so the
// $1,528 (Personal Home) and $1,002 (Personal Auto) canaries are untouched. But `'LD'` is a
// valid source type in the shared contract (types.ts) and the rating-step editor offers it, so
// the branch must be a working, tested path rather than a landmine. Pure TypeScript.
import type { LDTable } from '../types'
import type { LdGetter } from './evaluator'

export function makeLdGetter(tables: Record<string, LDTable>): LdGetter {
  return (tableRef: string, selectedValue: number | string): number => {
    const t = tables[tableRef]
    if (!t) throw new Error(`LD table not found: ${tableRef}`)
    // Match on the stored numeric value first, then the display label; return the option value.
    const row = t.rows.find(r => r.value === selectedValue || r.label === selectedValue)
    if (!row) throw new Error(`${tableRef}: no option matching '${selectedValue}'`)
    return row.value
  }
}
