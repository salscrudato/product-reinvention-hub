// TermOptionsDialog — the rich editor for a coverage's limits, deductibles or
// elective options. Expresses the typed model: kind · structure · basis · range ·
// optionSet. Each StandardOption row shows type, value/parts, label override, a
// per-option state scope (⊆ coverage footprint), default flag, enabled toggle,
// constraintNote and a remove button. Every constraint is enforced live and as a
// hard pre-save gate through the shared validator: exactly one enabled default;
// option states ⊆ coverage scope; values within [min,max]; and the Homeowners
// demonstratives (Coverage F $5,000 ⇒ Coverage E ≥ $300,000; wind/hail % ded ≥
// all-peril ded in dollars). Legacy fields are synced back so rating + export keep
// working, and the mutate() seam re-checks the structural invariants.
import { useState, useEffect, Fragment } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { Dialog, Button, EmptyState, Combobox } from '../ui'
import {
	  IconPlus, IconTrash, IconStar, IconCheck, IconClose, IconWarning,
	  IconSingle, IconLayers, IconSplit, IconCombine, IconScheduled,
	  IconPercent, IconClock, IconPeril, IconLimit, IconDeductible, IconCheckSquare,
	  IconFilter,
	} from '../ui/icons'
import { LIMIT_STRUCTURES, DEDUCTIBLE_STRUCTURES, LIMIT_BASES } from '../../lib/insurance/vocab'
import {
	  resolveTermOptions, ensureOneDefault, syncLegacy,
	  isPercentTerm, deriveStructure, deriveBasis, resolveLob, validateCoverageTerms,
	  niceLadder, suggestRange, type RangeDensity,
	} from '@pf/shared'
import { StateTileMap } from './StateTileMap'
import type {
  Coverage, CoverageTerm, StandardOption, OptionValueType,
  LimitStructure, DeductibleStructure, LimitBasis,
} from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

type Mode = 'LIMIT' | 'DEDUCTIBLE' | 'OPTION'

const STRUCT_ICON: Record<string, typeof IconSingle> = {
  single: IconSingle, layers: IconLayers, split: IconSplit,
  combine: IconCombine, scheduled: IconScheduled, percent: IconPercent, clock: IconClock, peril: IconPeril,
}

	const OPTION_TYPES: Record<Mode, { id: OptionValueType; label: string }[]> = {
	  LIMIT: [
	    { id: 'FLAT', label: '$' },
	    { id: 'PERCENT', label: '%' },
	    { id: 'SPLIT', label: 'Split' },
	    { id: 'CSL', label: 'CSL' },
	    { id: 'SCHEDULED', label: 'Item' },
	  ],
	  DEDUCTIBLE: [
	    { id: 'FLAT', label: '$' },
	    { id: 'PERCENT', label: '%' },
	    { id: 'WAITING_PERIOD', label: 'Hrs' },
	    { id: 'SPLIT', label: 'Split' },
	  ],
	  OPTION: [
	    { id: 'FLAT', label: '$' },
	    { id: 'PERCENT', label: '%' },
	  ],
	}

// Per-mode header identity + copy.
const MODE_META: Record<Mode, { Icon: typeof IconLimit; title: string; noun: string }> = {
  LIMIT:      { Icon: IconLimit,       title: 'Limit Options',      noun: 'limit' },
  DEDUCTIBLE: { Icon: IconDeductible,  title: 'Deductible Options', noun: 'deductible' },
  OPTION:     { Icon: IconCheckSquare, title: 'Coverage Options',   noun: 'option' },
}

// The option value-type a structure implies (used when the structure changes).
function impliedType(structure: string): OptionValueType {
  switch (structure) {
    case 'SPLIT':          return 'SPLIT'
    case 'CSL':            return 'CSL'
    case 'SCHEDULED':      return 'SCHEDULED'
    case 'PERCENT':
    case 'PERCENT_MIN_MAX': return 'PERCENT'
    case 'WAITING_PERIOD':  return 'WAITING_PERIOD'
    default:                return 'FLAT'
  }
}

const parseNum = (s: string) => { const n = Number(s.replace(/[,$%\s]/g, '')); return Number.isFinite(n) ? n : 0 }

interface Props {
  cov: WithId<Coverage>
  mode: Mode
  onClose: () => void
  // States selected in the Coverages page filter. When non-empty, the option table shows
  // only options available in at least one of them (an all-states option always qualifies).
  // Display-only: save() always persists the full option set, never the filtered view.
  filterStates?: string[]
}

export function TermOptionsDialog({ cov, mode, onClose, filterStates }: Props) {
	  const { pid, product, ldTables, coverages } = useProductCtx()
	  const { user } = useUser()
	  const canEdit = canI(user, 'product:write')
	  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }

	  const structures = mode === 'LIMIT' ? LIMIT_STRUCTURES : DEDUCTIBLE_STRUCTURES
	  const lob = resolveLob(product)
	  // Product footprint (denominator) for this coverage, clipped to the line's
	  // footprint so counts never exceed 100%.
	  const productFootprintStates = (product?.allStates
	    ? (product?.states?.length ? product.states : lob.footprintStates)
	    : (product?.states ?? lob.footprintStates)
	  ).filter(st => lob.footprintStates.includes(st))
	  // Effective coverage scope — either the full product footprint (when marked
	  // `allStates`) or the coverage's own subset, clipped to the product
	  // footprint.
	  const scopeStates = cov.allStates
	    ? productFootprintStates
	    : (cov.states ?? []).filter(st => productFootprintStates.includes(st))

  // Normalise every term of this kind so editing is uniform (rich optionSet + typing).
  const [terms, setTerms] = useState<CoverageTerm[]>(() =>
    (cov.terms ?? []).map(t => {
      if (t.kind !== mode) return t
      const opts = resolveTermOptions(t, t.ldTableRef ? ldTables[t.ldTableRef] : undefined)
      // OPTION terms are elective (a yes/no flag or a small set of selectable values);
      // they carry no limit structure, basis or range.
      if (mode === 'OPTION') return { ...t, optionSet: opts }
      const nums = opts.filter(o => o.type !== 'SPLIT' && o.type !== 'WAITING_PERIOD').map(o => o.value)
      const min = t.min ?? (nums.length ? Math.min(...nums) : undefined)
      const max = t.max ?? (nums.length ? Math.max(...nums) : undefined)
      // Only set optional fields when they have a value — a stored `undefined`
      // (e.g. a deductible's absent limitBasis) is unpersistable.
      return {
        ...t, optionSet: opts, structure: deriveStructure(t),
        ...(mode === 'LIMIT' ? { limitBasis: deriveBasis(t) } : {}),
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      }
    }))

  const kindTerms = terms.filter(t => t.kind === mode)
  const [activeId, setActiveId] = useState<string>(() => kindTerms[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const active = terms.find(t => t.id === activeId && t.kind === mode)

  // Live validation — the exact same shared rules the pre-save gate and the mutate()
  // seam enforce, scoped to the terms of this kind so nothing invisible blocks a save.
  const modeTermIds = new Set(kindTerms.map(t => t.id))
  const issues = validateCoverageTerms({ ...cov, terms }, coverages, product, ldTables, scopeStates)
    .filter(i => modeTermIds.has(i.termId))
  const errorCount = issues.filter(i => i.severity === 'error').length
  const optionIssues = (id: string) => issues.filter(i => i.optionId === id)
  const activeTermIssues = active ? issues.filter(i => i.termId === active.id && !i.optionId) : []

  function patchActive(patch: Partial<CoverageTerm>) {
    if (!canEdit) return
    setTerms(prev => prev.map(t => t.id === activeId ? { ...t, ...patch } : t))
  }
  function setOptions(next: StandardOption[]) { patchActive({ optionSet: ensureOneDefault(next) }) }

  function addTerm() {
    if (!canEdit) return
    const id = `${mode.toLowerCase()}-${Date.now()}`
    const t: CoverageTerm = mode === 'OPTION'
      ? { id, kind: 'OPTION', label: 'Option', basis: 'flag', default: false, optionSet: [] }
      : {
          id, kind: mode, label: mode === 'LIMIT' ? 'Limit' : 'Deductible',
          basis: 'per occurrence', default: 0, unit: 'dollars',
          structure: mode === 'LIMIT' ? 'SINGLE' : 'FLAT',
          // limitBasis is a limit-only concept — omit it for deductibles rather than
          // storing `undefined`, which Firestore rejects.
          ...(mode === 'LIMIT' ? { limitBasis: 'PER_OCCURRENCE' as LimitBasis } : {}),
          optionSet: [],
        }
    setTerms(prev => [...prev, t]); setActiveId(id)
  }

  function deleteTerm(id: string) {
    if (!canEdit) return
    const remaining = terms.filter(t => !(t.id === id && t.kind === mode))
    setTerms(remaining)
    const nextKind = remaining.filter(t => t.kind === mode)
    setActiveId(nextKind[0]?.id ?? '')
  }

  async function save() {
    if (!canEdit) return
    // Normalise exactly what we'll persist: guarantee one default, clip each option's
    // states to the coverage scope, and sync legacy fields. A yes/no OPTION flag keeps
    // its boolean `default` (there's no numeric matrix to sync).
    const nextTerms = terms.map(t => {
      if (t.kind !== mode) return t
      const opts = ensureOneDefault(t.optionSet ?? []).map(o => ({
        ...o,
        states: o.allStates ? [] : o.states.filter(s => scopeStates.includes(s)),
      }))
      if (mode === 'OPTION' && opts.length === 0) return { ...t, optionSet: [] }
      return { ...t, optionSet: opts, ...syncLegacy(opts) }
    })

    // Hard gate: every constraint (intrinsic invariants + HO demonstratives) must pass
    // before the write. This mirrors the live inline errors and the mutate() seam check.
    const blocking = validateCoverageTerms({ ...cov, terms: nextTerms }, coverages, product, ldTables, scopeStates)
      .filter(i => i.severity === 'error' && modeTermIds.has(i.termId))
    if (blocking.length) { toast.error(blocking[0].message); return }

    setSaving(true)
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/coverages/${cov.id}`,
        data: { terms: nextTerms }, entityType: 'coverage', productId: pid, actor,
        expectedRev: (cov as { rev?: number }).rev,
      })
      toast.success(`${mode === 'LIMIT' ? 'Limits' : mode === 'DEDUCTIBLE' ? 'Deductibles' : 'Options'} saved`)
      onClose()
    } catch (err) {
      if (err instanceof MutationConflictError) {
        conflictToast({ discard: onClose })
      } else {
        toast.error(err instanceof Error ? err.message : 'Save failed')
      }
    } finally { setSaving(false) }
  }

  const options = active?.optionSet ?? []
  // State cascade (display-only): when the Coverages page is filtered to one or more states,
  // the option table shows only options available in at least one — an all-states option
  // always qualifies. Save writes the full set, so filtering never drops data.
  const stateFilterSet = new Set(filterStates ?? [])
  const filterActive = stateFilterSet.size > 0
  const visibleOptions = filterActive
    ? options.filter(o => o.allStates || (o.states ?? []).some(s => stateFilterSet.has(s)))
    : options
  const pct = active ? isPercentTerm(active) : false
  const impliedActive = impliedType(active?.structure ?? (mode === 'LIMIT' ? 'SINGLE' : 'FLAT'))
  // The Range Builder only makes sense for single-number values — split limits and
  // waiting periods aren't laddered, so they keep the presets/paste path.
  const showRangeBuilder = mode !== 'OPTION' && impliedActive !== 'SPLIT' && impliedActive !== 'WAITING_PERIOD'
  const { Icon: ModeIcon, title: modeTitle, noun: modeLabel } = MODE_META[mode]

  // Append one or more values as options in a single edit — the engine behind both
  // the quick-add presets and the Excel-style paste. New values inherit the term's
  // current structure/type, apply to all states, and are enabled; ensureOneDefault
  // (via setOptions) guarantees exactly one default survives.
  function addValues(nums: number[]) {
    if (!canEdit || !active) return
    const type = impliedType(active.structure ?? (mode === 'LIMIT' ? 'SINGLE' : 'FLAT'))
    const seen = new Set(options.map(o => o.value))
    const additions: StandardOption[] = []
    nums.forEach((value, i) => {
      if (!Number.isFinite(value) || value < 0 || seen.has(value)) return
      seen.add(value)
      additions.push({ id: `opt-${Date.now()}-${i}`, type, value, allStates: true, states: [], isDefault: false, enabled: true })
    })
    if (additions.length) setOptions([...options, ...additions])
  }

  // Range Builder: enter min + max, get a logical ladder of round values between them
  // (and the endpoints), plus record the [min,max] as the term's allowed range.
  function applyRange(values: number[], bounds: { min: number; max: number }) {
    if (!canEdit || !active) return
    addValues(values)
    patchActive({ min: bounds.min, max: bounds.max })
  }

  return (
    <Dialog open onClose={onClose} width="max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}>
            <ModeIcon size={22} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-text">{modeTitle}</h2>
            <p className="text-sm text-dim">{cov.name}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-faint hover:text-text rounded-[8px] p-1.5 hover:bg-raised transition-colors"><IconClose size={18} /></button>
      </div>

      {/* Term selector — a searchable dropdown (was a per-state chip wall that grew to
          10+ rows on a state-varied limit). One term of this kind is active at a time:
          pick it here, Add creates another, the trash removes the active one. A lone
          term needs no picker, so it shows as a static label. */}
      {kindTerms.length > 0 && (
        <div className="flex items-center gap-2 mb-4">
          {kindTerms.length > 1 ? (
            <div className="flex-1 min-w-0 max-w-sm">
              <Combobox
                items={kindTerms}
                value={active ?? null}
                onChange={t => { if (t) setActiveId(t.id) }}
                getLabel={t => t.label}
                getValue={t => t.id}
                clearable={false}
                placeholder={`Search ${kindTerms.length} ${modeLabel}s…`}
              />
            </div>
          ) : active ? (
            <span className="inline-flex items-center h-9 px-3 rounded-[10px] bg-raised text-sm font-medium text-text min-w-0">
              <span className="truncate">{active.label}</span>
            </span>
          ) : null}
          {canEdit && kindTerms.length > 1 && active && (
            <button onClick={() => deleteTerm(active.id)} aria-label={`Remove ${active.label}`}
              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-faint hover:text-danger hover:bg-[var(--color-danger-hover)] transition-colors shrink-0"
              style={{ border: '1px solid var(--color-border)' }}>
              <IconTrash size={15} />
            </button>
          )}
          {canEdit && (
            <Button variant="default" size="sm" onClick={addTerm}>
              <IconPlus size={13} aria-hidden="true" />Add {modeLabel}
            </Button>
          )}
        </div>
      )}

      {/* No terms of this kind yet */}
      {!active ? (
        <div className="py-4">
          <EmptyState
            compact
            icon={<ModeIcon size={28} />}
            title={`No ${modeLabel}s defined yet`}
            description={`Add a ${modeLabel} to define the standard options a PM can select for ${cov.name}.`}
            action={canEdit ? (
              <Button variant="primary" size="sm" onClick={addTerm}>
                <IconPlus size={14} />Add {modeLabel}
              </Button>
            ) : undefined}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6 max-h-[62vh] overflow-y-auto pr-1 -mr-1">
          {/* ─ Election (options only) — a yes/no default until values are added ── */}
          {mode === 'OPTION' && options.length === 0 && active && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mb-2.5">Election</p>
              <label className="flex items-center gap-3 p-3 rounded-[12px] bg-surface cursor-pointer"
                style={{ border: '1px solid var(--color-border)' }}>
                <input type="checkbox" className="accent-accent" disabled={!canEdit}
                  checked={active.default === true}
                  onChange={e => patchActive({ default: e.target.checked })} />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-text">Elected by default</span>
                  <span className="text-xs text-dim">This is a yes/no election. Add selectable values below to offer specific amounts instead.</span>
                </span>
              </label>
            </section>
          )}

          {/* ─ Values — the primary PM surface (quick-add presets + paste) ────── */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <div>
                <p className="text-sm font-semibold text-text">
                  {mode === 'OPTION' ? 'Values a PM can select' : `Values a PM can pick for this ${modeLabel}`}
                </p>
                <p className="text-xs text-faint mt-0.5">
                  {options.length > 0
                    ? `${options.filter(o => o.enabled).length} offered · one is the default`
                    : 'Add the amounts underwriting will offer — the starred one is pre-selected.'}
                </p>
              </div>
              {canEdit && options.length > 0 && (
                <Button variant="default" size="sm" onClick={() => setOptions([...options, {
                  id: `opt-${Date.now()}`, type: impliedType(active.structure ?? 'SINGLE'),
                  value: 0, allStates: true, states: [], isDefault: options.length === 0, enabled: true,
                }])}>
                  <IconPlus size={13} />Custom
                </Button>
              )}
            </div>

            {/* Quick add — one-click presets + Excel-style paste (the fast PM path). */}
            {active && (
              <QuickAdd
                mode={mode} pct={pct}
                isWaiting={impliedType(active.structure ?? 'SINGLE') === 'WAITING_PERIOD'}
                canEdit={canEdit} existing={new Set(options.map(o => o.value))}
                onAddValues={addValues}
              />
            )}

            {/* Validation summary — every blocking issue, always visible even when a
                row is collapsed, so the PM sees exactly what stops the save. */}
            {(errorCount > 0 || activeTermIssues.length > 0) && (
              <div className="mb-2.5 flex flex-col gap-1.5 rounded-[10px] px-3 py-2.5"
                style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-line)' }}>
                {[...new Set(issues.filter(i => i.severity === 'error').map(i => i.message))].map(msg => (
                  <div key={msg} className="flex items-start gap-1.5">
                    <IconWarning size={12} className="text-danger shrink-0 mt-0.5" />
                    <p className="text-[11px] text-danger leading-relaxed">{msg}</p>
                  </div>
                ))}
              </div>
            )}

            {/* State cascade status — the Coverages page state filter is narrowing this table.
                Read-only here (clear it from the page's filter chips); shows what's applied so a
                PM knows the view is filtered and that the full set is still what saves. */}
            {filterActive && options.length > 0 && (
              <div className="mb-2.5 flex items-center gap-1.5 flex-wrap text-[11px]">
                <IconFilter size={12} className="text-accent shrink-0" aria-hidden="true" />
                <span className="text-faint">
                  Showing <span className="tnum tabular-nums text-dim">{visibleOptions.length}</span> of{' '}
                  <span className="tnum tabular-nums text-dim">{options.length}</span> — available in
                </span>
                {[...stateFilterSet].sort().map(st => (
                  <span key={st} className="px-1.5 py-0.5 rounded-[5px] font-mono bg-accent-soft text-accent">{st}</span>
                ))}
              </div>
            )}

            {options.length === 0 ? (
              <div className="rounded-[12px] bg-raised py-10 flex flex-col items-center gap-3 text-center"
                style={{ border: '1px dashed var(--color-border-strong)' }}>
                <p className="text-sm font-medium text-dim">
                  {mode === 'OPTION' ? 'No selectable values' : `0 ${modeLabel}s — add your first`}
                </p>
                <p className="text-xs text-faint max-w-[260px] leading-relaxed">
                  {mode === 'OPTION'
                    ? 'This is a yes/no election. Add values to offer specific amounts a PM can select.'
                    : `Add the standard values a PM can select when configuring this ${modeLabel}.`}
                </p>
                {canEdit && (
                  <Button variant="primary" size="sm" onClick={() => setOptions([{
                    id: `opt-${Date.now()}`, type: impliedType(active.structure ?? 'SINGLE'),
                    value: 0, allStates: true, states: [], isDefault: true, enabled: true,
                  }])}>
                    <IconPlus size={14} />Add first {mode === 'OPTION' ? 'value' : 'option'}
                  </Button>
                )}
              </div>
            ) : visibleOptions.length === 0 ? (
              <div className="rounded-[12px] bg-raised py-8 flex flex-col items-center gap-2 text-center"
                style={{ border: '1px dashed var(--color-border-strong)' }}>
                <p className="text-sm font-medium text-dim">
                  No {modeLabel}s available in {[...stateFilterSet].sort().join(', ')}
                </p>
                <p className="text-xs text-faint max-w-[280px] leading-relaxed">
                  All {options.length} {modeLabel}{options.length === 1 ? '' : 's'} apply to other states — adjust the state
                  filter on the Coverages page to see them.
                </p>
              </div>
            ) : (
              <ExcelGrid
                mode={mode}
                options={options}
                visibleOptions={visibleOptions}
                scopeStates={scopeStates}
                canEdit={canEdit}
                optionIssues={optionIssues}
                setOptions={setOptions}
                onAddRow={() => {
                  if (!active) return
                  setOptions([...options, {
                    id: `opt-${Date.now()}`,
                    type: impliedType(active.structure ?? (mode === 'LIMIT' ? 'SINGLE' : 'FLAT')),
                    value: 0, allStates: true, states: [], isDefault: options.length === 0, enabled: true,
                  }])
                }}
                onAddValues={addValues}
              />
            )}

            {/* Range builder — moved to bottom, collapsed by default */}
            {active && showRangeBuilder && (
              <details className="mt-3 rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer select-none text-[12px] font-medium text-dim hover:text-text hover:bg-raised">
                  <IconLayers size={13} aria-hidden="true" />
                  Build a range
                  <span className="ml-1 text-[11px] text-faint font-normal">— generate a min/max ladder</span>
                </summary>
                <div className="px-3.5 pb-4 pt-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <RangeBuilder
                    key={`range-${active.id}`}
                    pct={pct} canEdit={canEdit}
                    existing={new Set(options.map(o => o.value))}
                    initial={suggestRange(mode, pct, options.filter(o => o.type !== 'SPLIT' && o.type !== 'WAITING_PERIOD').map(o => o.value))}
                    onGenerate={applyRange}
                  />
                </div>
              </details>
            )}
          </section>

          {/* ─ Advanced (limits / deductibles) — structure, basis & range, tucked
              away so the common path stays jargon-free. Fully functional inside. ── */}
          {mode !== 'OPTION' && active && (
            <details className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <summary className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer select-none text-[13px] font-medium text-dim hover:text-text hover:bg-raised">
                <IconLayers size={14} aria-hidden="true" />
                Advanced — structure, basis &amp; range
                <span className="ml-1 text-[11px] text-faint font-normal">optional</span>
              </summary>
              <div className="flex flex-col gap-5 px-3.5 pb-4 pt-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
                {/* Structure */}
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mb-2.5">
                    {mode === 'LIMIT' ? 'Limit structure' : 'Deductible structure'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {structures.map(s => {
                      const Icon = STRUCT_ICON[s.icon] ?? IconSingle
                      const selected = (active.structure ?? 'SINGLE') === s.id
                      return (
                        <button key={s.id} disabled={!canEdit}
                          onClick={() => patchActive({
                            structure: s.id as LimitStructure | DeductibleStructure,
                            ...(mode === 'DEDUCTIBLE' ? { unit: impliedType(s.id) === 'PERCENT' ? '%' : 'dollars' } : {}),
                            optionSet: (active.optionSet ?? []).map(o => ({ ...o, type: impliedType(s.id) })),
                          })}
                          className={`text-left p-3 rounded-[12px] transition-all ${selected ? 'bg-accent-soft' : 'bg-surface hover:bg-raised'}`}
                          style={{ border: selected ? '1.5px solid var(--color-accent)' : '1px solid var(--color-border)' }}>
                          <div className="flex items-start justify-between gap-2">
                            <span className={`w-8 h-8 rounded-[9px] flex items-center justify-center ${selected ? 'text-accent bg-surface' : 'text-dim bg-raised'}`}
                              style={selected ? { border: '1px solid var(--color-accent-line)' } : undefined}>
                              <Icon size={17} />
                            </span>
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${selected ? 'bg-accent text-on-accent' : ''}`}
                              style={{ border: selected ? 'none' : '1.5px solid var(--color-border-strong)' }}>
                              {selected && <IconCheck size={10} strokeWidth={3} />}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-text mt-2">{s.label}</p>
                          <p className="text-xs text-dim mt-0.5 leading-snug">{s.blurb}</p>
                          <p className="font-mono text-[11px] text-accent mt-1.5">{s.sample}</p>
                        </button>
                      )
                    })}
                  </div>
                </section>

                {/* Basis (limits only) — the allowed range is entered via the Range Builder
                    above the values, so it isn't duplicated here. */}
                {mode === 'LIMIT' && (
                  <section>
                    <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mb-2.5">Limit basis</p>
                    <select disabled={!canEdit} value={active.limitBasis ?? 'PER_OCCURRENCE'}
                      onChange={e => patchActive({ limitBasis: e.target.value as LimitBasis })}
                      className="w-full h-10 px-3 rounded-[9px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25 sm:max-w-xs">
                      {LIMIT_BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                    </select>
                  </section>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 mt-6 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        {canEdit && active && errorCount > 0 && (
          <span className="mr-auto flex items-center gap-1.5 text-xs text-danger">
            <IconWarning size={13} />{errorCount} issue{errorCount === 1 ? '' : 's'} to resolve
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        {canEdit && active && (
          <Button variant="primary" size="sm" onClick={save} disabled={saving || errorCount > 0}
            title={errorCount > 0 ? 'Resolve the highlighted issues before saving' : undefined}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </div>
    </Dialog>
  )
}

// ─── Quick add — presets + Excel-style paste ─────────────────────────────────
// The fast path: one-click common values, or paste a column/row straight from a
// spreadsheet. Values are cleaned of $, %, commas and separators, then handed to the
// parent's addValues (which types + de-dupes them). Presets adapt to the active
// term's type so a % deductible offers %-presets, a waiting period offers hours, etc.
const FLAT_PRESETS: Record<Mode, number[]> = {
  LIMIT:      [25000, 50000, 100000, 250000, 500000, 1000000],
  DEDUCTIBLE: [250, 500, 1000, 2500, 5000, 10000],
  OPTION:     [100, 250, 500, 1000, 2500],
}
const PCT_PRESETS = [1, 2, 5, 10]
const HRS_PRESETS = [24, 48, 72, 168]

function parsePasted(text: string): number[] {
  return text
    .split(/[\s,;|\t\n]+/)
    .map(s => s.replace(/[$%,]/g, '').trim())
    .filter(Boolean)
    .map(Number)
    .filter(n => Number.isFinite(n))
}

function QuickAdd({ mode, pct, isWaiting, canEdit, existing, onAddValues }: {
  mode: Mode; pct: boolean; isWaiting: boolean; canEdit: boolean
  existing: Set<number>; onAddValues: (nums: number[]) => void
}) {
  const [paste, setPaste] = useState('')
  if (!canEdit) return null
  const presets = pct ? PCT_PRESETS : isWaiting ? HRS_PRESETS : FLAT_PRESETS[mode]
  const fmt = (n: number) => pct ? `${n}%` : isWaiting ? `${n}h` : n >= 1000 ? `$${(n / 1000).toLocaleString()}k` : `$${n.toLocaleString()}`
  const eg = pct ? '5, 10, 15' : isWaiting ? '24, 48, 72' : '1000, 2500, 5000'
  const commit = () => { const nums = parsePasted(paste); if (nums.length) { onAddValues(nums); setPaste('') } }

  return (
    <div className="mb-2.5 flex flex-col gap-2 rounded-[10px] bg-raised px-3 py-2.5" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint mr-0.5">Quick add</span>
        {presets.map(v => {
          const added = existing.has(v)
          return (
            <button key={v} type="button" disabled={added} onClick={() => onAddValues([v])}
              title={added ? 'Already added' : `Add ${fmt(v)}`}
              className={`px-2 py-1 rounded-[7px] text-[11px] font-medium font-mono transition-colors ${added ? 'text-faint cursor-default' : 'text-accent hover:bg-accent-soft'}`}
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
              {added ? `✓ ${fmt(v)}` : `+ ${fmt(v)}`}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <input value={paste} onChange={e => setPaste(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          onPaste={e => { const t = e.clipboardData.getData('text'); if (/[\s,;|\t\n]/.test(t)) { e.preventDefault(); onAddValues(parsePasted(t)) } }}
          placeholder={`Paste from Excel — e.g. ${eg}`}
          aria-label="Paste values to add"
          className="flex-1 h-8 px-2.5 rounded-[7px] bg-surface border border-border-strong font-mono text-xs text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25" />
        <Button variant="default" size="sm" onClick={commit} disabled={!paste.trim()}>Add</Button>
      </div>
    </div>
  )
}

// ─── Excel grid — compact spreadsheet-like view (replaces card-stack) ────────
// Manages all per-row editing state centrally so Fragment-based row pairs (data row
// + optional state-expansion row) compile without TypeScript tbody-children conflicts.

function ExcelGrid({
  mode, options, visibleOptions, scopeStates, canEdit, optionIssues, setOptions, onAddRow, onAddValues,
}: {
  mode: Mode
  options: StandardOption[]
  visibleOptions: StandardOption[]
  scopeStates: string[]
  canEdit: boolean
  optionIssues: (id: string) => Array<{ severity: string }>
  setOptions: (opts: StandardOption[]) => void
  onAddRow: () => void
  onAddValues: (nums: number[]) => void
}) {
  // Controlled value strings: only entries for rows the user is actively editing.
  const [localVals, setLocalVals] = useState<Record<string, string>>({})
  // Which row's state-scope panel is open (null = none).
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const colCount = canEdit ? 6 : 5

  // Drop stale localVals when options list changes (e.g. after a term switch or remove).
  useEffect(() => {
    setLocalVals(prev => {
      const ids = new Set(options.map(o => o.id))
      const hasStale = Object.keys(prev).some(id => !ids.has(id))
      if (!hasStale) return prev
      const next: Record<string, string> = {}
      Object.entries(prev).forEach(([id, v]) => { if (ids.has(id)) next[id] = v })
      return next
    })
  }, [options])

  const getVal = (o: StandardOption) =>
    o.id in localVals ? localVals[o.id] : (o.value ? String(o.value) : '')
  const setVal = (id: string, v: string) =>
    setLocalVals(prev => ({ ...prev, [id]: v }))
  const commitVal = (o: StandardOption) => {
    if (!(o.id in localVals)) return
    const n = parseNum(localVals[o.id])
    if (Number.isFinite(n) && n !== o.value)
      setOptions(options.map(x => x.id === o.id ? { ...x, value: n } : x))
    setLocalVals(prev => { const { [o.id]: _drop, ...rest } = prev; return rest })
  }

  const changeOpt = (next: StandardOption) =>
    setOptions(options.map(x => x.id === next.id ? next : x))
  const setDefault = (id: string) =>
    setOptions(options.map(x => ({ ...x, isDefault: x.id === id })))
  const removeOpt = (id: string) => {
    if (expandedId === id) setExpandedId(null)
    setOptions(options.filter(x => x.id !== id))
  }

  function handlePaste(e: React.ClipboardEvent) {
    if (!canEdit) return
    const text = e.clipboardData.getData('text')
    const parsed = parsePasted(text)
    if (parsed.length > 1) { e.preventDefault(); onAddValues(parsed) }
  }

  return (
    <div
      className="rounded-[10px] overflow-hidden"
      style={{ border: '1px solid var(--color-border)' }}
      onPaste={handlePaste}
    >
      <table className="w-full border-collapse text-sm" role="grid" aria-label="Options">
        <thead>
          <tr style={{ background: 'var(--color-raised)', borderBottom: '1px solid var(--color-border)' }}>
            <th scope="col" className="pl-3 pr-1 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[.07em] text-faint w-14">Type</th>
            <th scope="col" className="px-1 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[.07em] text-faint">Value</th>
            <th scope="col" className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[.07em] text-faint w-24">States</th>
            <th scope="col" className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[.07em] text-faint w-20">Default</th>
            <th scope="col" className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[.07em] text-faint w-12">On</th>
            {canEdit && <th scope="col" className="pr-3 py-1.5 w-8" />}
          </tr>
        </thead>
        <tbody>
          {visibleOptions.map((o, rowIdx) => {
            const valStr = getVal(o)
            const inScope = o.states.filter(s => scopeStates.includes(s))
            const activeStateCount = o.allStates ? scopeStates.length : inScope.length
            const activeSet = new Set(o.allStates ? scopeStates : inScope)
            const footprintSet = new Set(scopeStates)
            const isExpanded = expandedId === o.id
            const hasError = optionIssues(o.id).some(iss => iss.severity === 'error')
            const rowBg = rowIdx % 2 === 0 ? 'var(--color-surface)' : 'var(--color-raised)'

            function toggleState(st: string) {
              if (!canEdit || o.allStates || !scopeStates.includes(st)) return
              const on = o.states.includes(st)
              changeOpt({ ...o, states: on ? o.states.filter(x => x !== st) : [...o.states, st] })
            }

            return (
              <Fragment key={o.id}>
                <tr
                  className="group border-b last:border-b-0"
                  style={{ borderColor: 'var(--color-border)', background: rowBg, opacity: o.enabled ? 1 : 0.5 }}
                >
                  {/* Type */}
                  <td className="pl-3 pr-1 py-1 w-14">
                    <select
                      disabled={!canEdit}
                      value={o.type}
                      aria-label="Option type"
                      onChange={e => changeOpt({ ...o, type: e.target.value as OptionValueType })}
                      className="h-7 w-full px-1 rounded-[5px] bg-transparent text-[11px] text-dim focus:outline-none focus:ring-1 focus:ring-accent/25 cursor-pointer"
                    >
                      {OPTION_TYPES[mode].map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </td>

                  {/* Value */}
                  <td className="px-1 py-1">
                    {o.type === 'SPLIT' ? (
                      <div className="flex items-center gap-0.5">
                        {([0, 1, 2] as const).map(i => (
                          <input
                            key={`${o.id}-sp-${i}`}
                            disabled={!canEdit}
                            defaultValue={(o.parts ?? [])[i] ?? ''}
                            inputMode="numeric"
                            aria-label={`Split part ${i + 1}`}
                            placeholder={(['pp', 'pa', 'PD'] as const)[i]}
                            onBlur={e => {
                              const parts = [...(o.parts ?? [0, 0, 0])] as [number, number, number]
                              parts[i] = parseNum(e.target.value)
                              changeOpt({ ...o, parts, value: parts[0] })
                            }}
                            className="w-full h-7 px-1 rounded-[5px] bg-surface border border-border-strong font-mono text-[11px] text-center focus:outline-none focus:ring-1 focus:ring-accent/25"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="relative flex items-center">
                        {o.type !== 'PERCENT' && o.type !== 'WAITING_PERIOD' && (
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-faint text-[11px] pointer-events-none select-none">$</span>
                        )}
                        <input
                          disabled={!canEdit}
                          value={valStr}
                          inputMode="numeric"
                          aria-label="Option value"
                          onChange={e => setVal(o.id, e.target.value)}
                          onBlur={() => commitVal(o)}
                          onKeyDown={e => { if (e.key === 'Enter') { commitVal(o); (e.target as HTMLInputElement).blur() } }}
                          className={`w-full h-7 font-mono text-sm text-text bg-transparent hover:bg-surface focus:bg-surface focus:border focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-accent/25 rounded-[5px] transition-colors ${o.type === 'PERCENT' || o.type === 'WAITING_PERIOD' ? 'px-2 pr-6' : 'pl-5 pr-2'} ${hasError ? 'text-danger ring-1 ring-danger/40' : ''}`}
                        />
                        {(o.type === 'PERCENT' || o.type === 'WAITING_PERIOD') && (
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-faint text-[11px] pointer-events-none select-none">
                            {o.type === 'PERCENT' ? '%' : 'hrs'}
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* States */}
                  <td className="px-1 py-1 w-24 text-center">
                    <button
                      disabled={!canEdit}
                      onClick={() => setExpandedId(id => id === o.id ? null : o.id)}
                      aria-expanded={isExpanded}
                      className={`h-6 px-2 rounded-[5px] text-[11px] font-medium w-full transition-colors ${o.allStates ? 'text-dim hover:text-accent hover:bg-accent-soft' : activeStateCount === 0 ? 'text-danger bg-[var(--color-danger-hover)]' : 'text-accent bg-accent-soft'}`}
                    >
                      {o.allStates ? 'All states' : `${activeStateCount} st.`}
                    </button>
                  </td>

                  {/* Default */}
                  <td className="px-1 py-1 w-20 text-center">
                    <button
                      disabled={!canEdit}
                      onClick={() => setDefault(o.id)}
                      aria-pressed={o.isDefault}
                      title={o.isDefault ? 'Default — pre-selected' : 'Set as default'}
                      className={`h-6 px-2 rounded-[5px] flex items-center gap-1 mx-auto text-[11px] font-semibold transition-all ${o.isDefault ? 'bg-accent text-on-accent' : 'text-faint hover:text-accent hover:bg-accent-soft opacity-0 group-hover:opacity-100'}`}
                      style={o.isDefault ? undefined : { border: '1px solid var(--color-border-strong)' }}
                    >
                      <IconStar size={11} className={o.isDefault ? 'fill-current' : ''} />
                      {o.isDefault ? 'Default' : 'Set'}
                    </button>
                  </td>

                  {/* Enabled */}
                  <td className="px-1 py-1 w-12 text-center">
                    <button
                      disabled={!canEdit}
                      onClick={() => changeOpt({ ...o, enabled: !o.enabled })}
                      role="switch"
                      aria-checked={o.enabled}
                      className="w-8 h-[18px] rounded-full p-0.5 transition-colors flex items-center mx-auto"
                      style={{ background: o.enabled ? 'var(--color-accent)' : 'var(--color-border-strong)' }}
                    >
                      <span className="w-[14px] h-[14px] rounded-full bg-white transition-transform" style={{ transform: o.enabled ? 'translateX(12px)' : 'translateX(0)' }} />
                    </button>
                  </td>

                  {/* Delete */}
                  {canEdit && (
                    <td className="pr-3 py-1 w-8 text-center">
                      <button
                        onClick={() => removeOpt(o.id)}
                        aria-label="Remove option"
                        className="w-7 h-7 rounded-[5px] flex items-center justify-center mx-auto text-faint hover:text-danger hover:bg-[var(--color-danger-hover)] opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <IconTrash size={13} />
                      </button>
                    </td>
                  )}
                </tr>

                {/* State-scope expansion row */}
                {isExpanded && (
                  <tr style={{ background: 'var(--color-raised)' }}>
                    <td colSpan={colCount} className="px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                      <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 text-xs text-dim cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-accent"
                            checked={o.allStates}
                            disabled={!canEdit}
                            onChange={e => changeOpt({
                              ...o,
                              allStates: e.target.checked,
                              states: e.target.checked ? [] : (o.states.length ? o.states : scopeStates),
                            })}
                          />
                          Available in all of this coverage's states
                          <span className="ml-auto text-[11px] text-faint font-mono tnum">{activeStateCount} / {scopeStates.length}</span>
                          <button onClick={() => setExpandedId(null)} className="ml-2 text-[11px] text-accent font-medium hover:underline">Done</button>
                        </label>
                        {scopeStates.length === 0 ? (
                          <p className="text-xs text-faint italic">This coverage has no states in scope — set state scope on the coverage first.</p>
                        ) : (
                          <>
                            <div className="rounded-[10px] bg-page p-2" style={{ border: '1px solid var(--color-border)' }}>
                              <StateTileMap
                                active={activeSet}
                                footprint={footprintSet}
                                onToggle={canEdit && !o.allStates ? toggleState : undefined}
                                canEdit={canEdit && !o.allStates}
                                labels={{ active: 'Option available', available: 'In coverage scope', inactive: 'Out of coverage scope' }}
                                ariaLabel={`State applicability — ${activeStateCount} of ${scopeStates.length} states`}
                              />
                            </div>
                            {!o.allStates && o.states.length === 0 && (
                              <p className="text-[11px] text-danger">Select at least one state, or choose "All coverage states".</p>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          {canEdit && (
            <tr>
              <td
                colSpan={colCount}
                className="px-3 py-2"
                style={visibleOptions.length > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}
              >
                <button
                  onClick={onAddRow}
                  className="flex items-center gap-1 text-[12px] text-faint hover:text-accent font-medium transition-colors"
                >
                  <IconPlus size={12} aria-hidden="true" />Add row
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Range Builder — min + max → a logical ladder of round values ─────────────
// The premium fast-path for defining a limit/deductible: enter two numbers and the
// editor fills in the standard "round" values between them (endpoints included), tuned
// by a density control with a live preview. Non-destructive — generated values merge
// with any existing options (the parent's addValues de-dupes and types them).
function RangeBuilder({ pct, canEdit, existing, initial, onGenerate }: {
  pct: boolean; canEdit: boolean
  existing: Set<number>
  initial: { min: number; max: number }
  onGenerate: (values: number[], bounds: { min: number; max: number }) => void
}) {
  const [minStr, setMinStr] = useState(String(initial.min))
  const [maxStr, setMaxStr] = useState(String(initial.max))
  const [density, setDensity] = useState<RangeDensity>('standard')
  if (!canEdit) return null

  const min = parseNum(minStr)
  const max = parseNum(maxStr)
  const valid = Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > min
  const ladder = valid ? niceLadder(min, max, density, pct) : []
  const newCount = ladder.filter(v => !existing.has(v)).length

  const fmt = (n: number) =>
    pct ? `${n}%`
    : n >= 1_000_000 ? `$${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`
    : n >= 1_000 ? `$${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
    : `$${n.toLocaleString()}`

  const DENSITIES: { id: RangeDensity; label: string }[] = [
    { id: 'coarse',   label: 'Coarse'   },
    { id: 'standard', label: 'Standard' },
    { id: 'fine',     label: 'Fine'     },
  ]

  return (
    <div className="mb-2.5 rounded-[12px] p-3.5 flex flex-col gap-3"
      style={{ background: 'var(--gradient-accent-soft)', border: '1px solid var(--color-accent-line)' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[13px] font-semibold text-text flex items-center gap-1.5">
            <IconLayers size={14} className="text-accent" aria-hidden="true" />
            Build a range
          </p>
          <p className="text-[11px] text-dim mt-0.5">Enter a min and max — we&rsquo;ll fill in the logical values between.</p>
        </div>
        <div className="inline-flex items-center gap-0.5 p-0.5 rounded-[9px] bg-surface" style={{ border: '1px solid var(--color-border)' }} role="group" aria-label="Range density">
          {DENSITIES.map(d => (
            <button key={d.id} type="button" onClick={() => setDensity(d.id)} aria-pressed={density === d.id}
              className={`px-2 py-1 rounded-[7px] text-[11px] font-medium transition-colors ${density === d.id ? 'bg-accent text-on-accent' : 'text-dim hover:text-text'}`}>
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <RangeInput label="Minimum" value={minStr} onChange={setMinStr} pct={pct} />
        <span className="text-faint text-sm pb-2">–</span>
        <RangeInput label="Maximum" value={maxStr} onChange={setMaxStr} pct={pct} />
        <Button variant="primary" size="sm" onClick={() => onGenerate(ladder, { min, max })} disabled={!valid || ladder.length === 0}>
          <IconPlus size={13} />Generate {ladder.length || ''} value{ladder.length === 1 ? '' : 's'}
        </Button>
      </div>

      {valid && ladder.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1 flex-wrap">
            {ladder.map(v => {
              const added = existing.has(v)
              return (
                <span key={v} className={`px-1.5 py-0.5 rounded-[6px] text-[11px] font-mono ${added ? 'text-faint' : 'text-accent'}`}
                  style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}
                  title={added ? 'Already added' : 'Will be added'}>
                  {added ? `✓ ${fmt(v)}` : fmt(v)}
                </span>
              )
            })}
          </div>
          <p className="text-[10.5px] text-faint">
            {ladder.length} value{ladder.length === 1 ? '' : 's'}{newCount < ladder.length ? ` · ${newCount} new` : ''}
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-danger">Enter a minimum and a larger maximum.</p>
      )}
    </div>
  )
}

function RangeInput({ label, value, onChange, pct }: {
  label: string; value: string; onChange: (v: string) => void; pct: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[.06em] text-faint">{label}</span>
      <div className="relative">
        {!pct && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint text-xs pointer-events-none">$</span>}
        <input value={value} onChange={e => onChange(e.target.value)} inputMode="numeric" aria-label={label}
          className={`w-32 h-9 ${pct ? 'px-2.5 pr-6' : 'pl-6 pr-2.5'} rounded-[8px] bg-surface border border-border-strong font-mono text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25`} />
        {pct && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint text-xs pointer-events-none">%</span>}
      </div>
    </label>
  )
}
