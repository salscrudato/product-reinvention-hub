// terms.ts — canonical logic for coverage limit/deductible terms. Pure functions
// shared by the app editors, the rating/export code and any Function that reads a
// term. The rich `optionSet` is authoritative when present; otherwise it is
// derived from the legacy (`options`/`default`/`min`/`max`) fields + LD table so
// seeded content renders in the new UI. On save the editor persists `optionSet`
// AND mirrors the legacy fields (see `syncLegacy`) so nothing downstream breaks.
import type {
  CoverageTerm, LDTable, StandardOption, OptionValueType,
  LimitStructure, DeductibleStructure, LimitBasis,
} from '../types'

export function isPercentTerm(t: Pick<CoverageTerm, 'unit' | 'basis'>): boolean {
  return t.unit === '%' || t.unit === 'percent' || (t.basis?.toLowerCase().includes('percent') ?? false)
}

/** The default value-type for a term with no explicit typing yet. */
function deriveOptionType(t: CoverageTerm): OptionValueType {
  if (isPercentTerm(t)) return 'PERCENT'
  return 'FLAT'
}

export function deriveStructure(t: CoverageTerm): LimitStructure | DeductibleStructure {
  if (t.structure) return t.structure
  if (t.kind === 'DEDUCTIBLE') return isPercentTerm(t) ? 'PERCENT' : 'FLAT'
  return 'SINGLE'
}

export function deriveBasis(t: CoverageTerm): LimitBasis {
  if (t.limitBasis) return t.limitBasis
  const b = t.basis?.toLowerCase() ?? ''
  if (b.includes('person')) return 'PER_PERSON'
  if (b.includes('aggregate')) return 'AGGREGATE'
  if (b.includes('item')) return 'PER_ITEM'
  if (b.includes('claim')) return 'PER_CLAIM'
  if (b.includes('location')) return 'PER_LOCATION'
  return 'PER_OCCURRENCE'
}

const compactMoney = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`
  : n >= 1_000 ? `$${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
  : `$${n.toLocaleString()}`

/** Human label for an option, honouring an explicit `label` then its type. */
export function formatOption(o: StandardOption, compact = false): string {
  if (o.label) return o.label
  switch (o.type) {
    case 'PERCENT':        return `${o.value}%`
    case 'WAITING_PERIOD': return o.value % 24 === 0 ? `${o.value / 24} days` : `${o.value} hours`
    case 'SPLIT':          return (o.parts ?? []).map(p => compact ? compactMoney(p) : `$${p.toLocaleString()}`).join(' / ')
    default:               return compact ? compactMoney(o.value) : `$${o.value.toLocaleString()}`
  }
}

/** Numeric options for range math — SPLIT/WAITING are excluded from min/max. */
function numericValue(o: StandardOption): number | undefined {
  return o.type === 'SPLIT' ? undefined : o.value
}

/** Resolve a term's option matrix: the stored `optionSet` if present, otherwise a
 *  derived one from legacy fields + LD table. Always returns at least the default. */
export function resolveTermOptions(t: CoverageTerm, ldTable?: LDTable): StandardOption[] {
  if (t.optionSet?.length) return t.optionSet

  const type = deriveOptionType(t)
  const fromLegacy = (t.options?.filter(o => typeof o === 'number') as number[] | undefined) ?? []
  const fromTable  = ldTable?.rows.map(r => r.value) ?? []
  const numbers    = [...new Set([...fromLegacy, ...fromTable])].sort((a, b) => a - b)

  const defNum = typeof t.default === 'number' ? t.default : undefined
  const values = numbers.length ? numbers : defNum !== undefined ? [defNum] : []

  const opts: StandardOption[] = values.map(v => {
    const row = ldTable?.rows.find(r => r.value === v)
    return {
      id: `opt-${v}`, type, value: v,
      allStates: true, states: [],
      isDefault: defNum !== undefined ? v === defNum : false,
      enabled: true,
      // Surface LD-table metadata so editors can display constraint notes + labels.
      ...(row?.constraintNote ? { constraintNote: row.constraintNote } : {}),
      ...(row?.label ? { label: row.label } : {}),
    }
  })
  return ensureOneDefault(opts)
}

/** Guarantee exactly one enabled option is the default (relationship integrity). */
export function ensureOneDefault(opts: StandardOption[]): StandardOption[] {
  if (!opts.length) return opts
  const enabled = opts.filter(o => o.enabled)
  const pool = enabled.length ? enabled : opts
  const chosen = pool.find(o => o.isDefault) ?? pool[0]
  return opts.map(o => ({ ...o, isDefault: o.id === chosen.id }))
}

/** Mirror the rich option matrix back onto the legacy fields the rating engine,
 *  Excel export and compact summaries still read. Keeps the two representations
 *  consistent so we never have to migrate all consumers at once. */
export function syncLegacy(opts: StandardOption[]): Pick<CoverageTerm, 'options' | 'default' | 'min' | 'max'> {
  const enabled = opts.filter(o => o.enabled)
  const nums = enabled.map(numericValue).filter((n): n is number => n !== undefined).sort((a, b) => a - b)
  const def = enabled.find(o => o.isDefault) ?? enabled[0]
  const defVal = def ? (def.type === 'SPLIT' ? formatOption(def) : def.value) : ''
  return {
    options: nums,
    default: defVal,
    ...(nums.length ? { min: nums[0], max: nums[nums.length - 1] } : {}),
  }
}
