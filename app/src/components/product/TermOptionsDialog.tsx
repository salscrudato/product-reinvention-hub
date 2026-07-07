// TermOptionsDialog — the rich editor for a coverage's limits or deductibles.
// Expresses the typed model: kind · structure · basis · range · optionSet.
// Each StandardOption row shows type, value/parts, label override, a per-option
// state scope (⊆ coverage footprint), default flag, enabled toggle, constraintNote
// and a remove button. Integrity rules enforced on save: exactly one enabled default;
// option states ⊆ coverage scope; values within [min,max]. Legacy fields synced back
// so rating + export keep working.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { Dialog, Button, EmptyState } from '../ui'
import {
	  IconPlus, IconTrash, IconStar, IconCheck, IconClose, IconInfo,
	  IconSingle, IconLayers, IconSplit, IconCombine, IconScheduled,
	  IconPercent, IconClock, IconPeril, IconLimit, IconDeductible,
	} from '../ui/icons'
import { LIMIT_STRUCTURES, DEDUCTIBLE_STRUCTURES, LIMIT_BASES } from '../../lib/insurance/vocab'
import {
	  resolveTermOptions, ensureOneDefault, syncLegacy, formatOption,
	  isPercentTerm, deriveStructure, deriveBasis, resolveLob,
	} from '@pf/shared'
import { StateTileMap } from './StateTileMap'
import type {
  Coverage, CoverageTerm, StandardOption, OptionValueType,
  LimitStructure, DeductibleStructure, LimitBasis,
} from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

type Mode = 'LIMIT' | 'DEDUCTIBLE'

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

function rangeOk(o: StandardOption, t: CoverageTerm): boolean {
  if (o.type === 'SPLIT' || o.type === 'WAITING_PERIOD') return true
  if (t.min !== undefined && o.value < t.min) return false
  if (t.max !== undefined && o.value > t.max) return false
  return true
}

interface Props { cov: WithId<Coverage>; mode: Mode; onClose: () => void }

export function TermOptionsDialog({ cov, mode, onClose }: Props) {
	  const { pid, product, ldTables } = useProductCtx()
	  const { user } = useUser()
	  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
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
	  const coastalStates = lob.peril.eligibleStates

  // Normalise every term of this kind so editing is uniform (rich optionSet + typing).
  const [terms, setTerms] = useState<CoverageTerm[]>(() =>
    (cov.terms ?? []).map(t => {
      if (t.kind !== mode) return t
      const opts = resolveTermOptions(t, t.ldTableRef ? ldTables[t.ldTableRef] : undefined)
      const nums = opts.filter(o => o.type !== 'SPLIT' && o.type !== 'WAITING_PERIOD').map(o => o.value)
      return {
        ...t, optionSet: opts, structure: deriveStructure(t),
        limitBasis: mode === 'LIMIT' ? deriveBasis(t) : undefined,
        min: t.min ?? (nums.length ? Math.min(...nums) : undefined),
        max: t.max ?? (nums.length ? Math.max(...nums) : undefined),
      }
    }))

  const kindTerms = terms.filter(t => t.kind === mode)
  const [activeId, setActiveId] = useState<string>(() => kindTerms[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const active = terms.find(t => t.id === activeId && t.kind === mode)

  function patchActive(patch: Partial<CoverageTerm>) {
    if (!canEdit) return
    setTerms(prev => prev.map(t => t.id === activeId ? { ...t, ...patch } : t))
  }
  function setOptions(next: StandardOption[]) { patchActive({ optionSet: ensureOneDefault(next) }) }

  function addTerm() {
    if (!canEdit) return
    const id = `${mode.toLowerCase()}-${Date.now()}`
    const t: CoverageTerm = {
      id, kind: mode, label: mode === 'LIMIT' ? 'Limit' : 'Deductible',
      basis: 'per occurrence', default: 0, unit: 'dollars',
      structure: mode === 'LIMIT' ? 'SINGLE' : 'FLAT',
      limitBasis: mode === 'LIMIT' ? 'PER_OCCURRENCE' : undefined, optionSet: [],
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
	    // Validate that every option value respects the [min,max] range for its term
	    // before persisting; out-of-range options are highlighted and block save.
	    const outOfRange = terms.flatMap(t => {
	      if (t.kind !== mode || !t.optionSet) return [] as StandardOption[]
	      return t.optionSet.filter(o => !rangeOk(o, t))
	    })
	    if (outOfRange.length) {
	      toast.error('Some options fall outside the defined range. Adjust their values or widen the range before saving.')
	      return
	    }

	    setSaving(true)
	    try {
	      const nextTerms = terms.map(t => {
	        if (t.kind !== mode || !t.optionSet) return t
	        const opts = ensureOneDefault(t.optionSet).map(o => ({
	          ...o,
	          // Enforce: each option's states ⊆ coverage scope.
	          states: o.allStates ? [] : o.states.filter(s => scopeStates.includes(s)),
	        }))
	        return { ...t, optionSet: opts, ...syncLegacy(opts) }
	      })
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}/coverages/${cov.id}`,
        data: { terms: nextTerms }, entityType: 'coverage', productId: pid, actor,
        expectedRev: (cov as { rev?: number }).rev,
      })
      toast.success(`${mode === 'LIMIT' ? 'Limits' : 'Deductibles'} saved`)
      onClose()
    } catch (err) {
      toast.error(err instanceof MutationConflictError
        ? 'Conflict — this coverage changed elsewhere. Please reopen.'
        : err instanceof Error ? err.message : 'Save failed')
    } finally { setSaving(false) }
  }

  const options = active?.optionSet ?? []
  const pct = active ? isPercentTerm(active) : false
  const ModeIcon = mode === 'LIMIT' ? IconLimit : IconDeductible
  const modeLabel = mode === 'LIMIT' ? 'limit' : 'deductible'

  return (
    <Dialog open onClose={onClose} width="max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-[12px] flex items-center justify-center text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}>
            <ModeIcon size={22} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-text">{mode === 'LIMIT' ? 'Limit Options' : 'Deductible Options'}</h2>
            <p className="text-sm text-dim">{cov.name}</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-faint hover:text-text rounded-[8px] p-1.5 hover:bg-raised transition-colors"><IconClose size={18} /></button>
      </div>

      {/* Term tabs — visible when coverage carries more than one term of this kind */}
      {kindTerms.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {kindTerms.map(t => (
            <div key={t.id} className="flex items-center gap-0.5">
              <button onClick={() => setActiveId(t.id)}
                className={`px-2.5 py-1 rounded-[7px] text-xs font-medium transition-colors ${t.id === activeId ? 'bg-accent text-white' : 'bg-raised text-dim hover:text-text'}`}>
                {t.label}
              </button>
              {canEdit && kindTerms.length > 1 && t.id === activeId && (
                <button onClick={() => deleteTerm(t.id)} aria-label={`Remove ${t.label}`}
                  className="w-6 h-6 rounded-[6px] flex items-center justify-center text-faint hover:text-danger hover:bg-[rgba(220,38,38,.08)] transition-colors">
                  <IconClose size={12} />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <button onClick={addTerm} aria-label={`Add another ${modeLabel}`}
              className="flex items-center gap-1 px-2 py-1 rounded-[7px] text-xs font-medium text-faint hover:text-accent hover:bg-accent-soft transition-colors">
              <IconPlus size={12} />Add
            </button>
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
          {/* ─ Structure ───────────────────────────────────────────────────── */}
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
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${selected ? 'bg-accent text-white' : ''}`}
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

          {/* ─ Basis + Range ──────────────────────────────────────────────── */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {mode === 'LIMIT' && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mb-2.5">Limit basis</p>
                <select disabled={!canEdit} value={active.limitBasis ?? 'PER_OCCURRENCE'}
                  onChange={e => patchActive({ limitBasis: e.target.value as LimitBasis })}
                  className="w-full h-10 px-3 rounded-[9px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25">
                  {LIMIT_BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </div>
            )}
            <div className={mode === 'LIMIT' ? '' : 'sm:col-span-2'}>
              <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint mb-2.5">Range {pct ? '(%)' : '($)'}</p>
              <div className="flex items-center gap-2">
                <input key={`min-${active.id}`} aria-label="Minimum" defaultValue={active.min ?? ''} disabled={!canEdit}
                  onBlur={e => patchActive({ min: e.target.value ? parseNum(e.target.value) : undefined })}
                  placeholder="min" className="w-full h-10 px-3 rounded-[9px] bg-surface border border-border-strong font-mono text-sm text-text text-center focus:outline-none focus:ring-2 focus:ring-accent/25" />
                <span className="text-faint text-sm">–</span>
                <input key={`max-${active.id}`} aria-label="Maximum" defaultValue={active.max ?? ''} disabled={!canEdit}
                  onBlur={e => patchActive({ max: e.target.value ? parseNum(e.target.value) : undefined })}
                  placeholder="max" className="w-full h-10 px-3 rounded-[9px] bg-surface border border-border-strong font-mono text-sm text-text text-center focus:outline-none focus:ring-2 focus:ring-accent/25" />
              </div>
            </div>
          </section>

          {/* ─ Standard options ───────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-2.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint">Standard options</p>
                {options.length > 0 && (
                  <p className="text-xs text-faint mt-0.5">
                    {options.filter(o => o.enabled).length} enabled · {options.length} total
                  </p>
                )}
              </div>
              {canEdit && (
                <Button variant="default" size="sm" onClick={() => setOptions([...options, {
                  id: `opt-${Date.now()}`, type: impliedType(active.structure ?? 'SINGLE'),
                  value: 0, allStates: true, states: [], isDefault: options.length === 0, enabled: true,
                }])}>
                  <IconPlus size={13} />Add option
                </Button>
              )}
            </div>

            {options.length === 0 ? (
              <div className="rounded-[12px] bg-raised py-10 flex flex-col items-center gap-3 text-center"
                style={{ border: '1px dashed var(--color-border-strong)' }}>
                <p className="text-sm font-medium text-dim">No options yet</p>
                <p className="text-xs text-faint max-w-[240px] leading-relaxed">
                  Add the standard values a PM can select when configuring this {modeLabel}.
                </p>
                {canEdit && (
                  <Button variant="primary" size="sm" onClick={() => setOptions([{
                    id: `opt-${Date.now()}`, type: impliedType(active.structure ?? 'SINGLE'),
                    value: 0, allStates: true, states: [], isDefault: true, enabled: true,
                  }])}>
                    <IconPlus size={14} />Add first option
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {options.map(o => (
	                  <OptionRow key={o.id} o={o} mode={mode} scopeStates={scopeStates} coastalStates={coastalStates} canEdit={canEdit}
                    inRange={rangeOk(o, active)}
                    onChange={next => setOptions(options.map(x => x.id === o.id ? next : x))}
                    onDefault={() => setOptions(options.map(x => ({ ...x, isDefault: x.id === o.id })))}
                    onRemove={() => setOptions(options.filter(x => x.id !== o.id))} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 mt-6 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        {canEdit && active && (
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        )}
      </div>
    </Dialog>
  )
}

// ─── One editable option row ─────────────────────────────────────────────────

function OptionRow({ o, mode, scopeStates, coastalStates, canEdit, inRange, onChange, onDefault, onRemove }: {
	  o: StandardOption; mode: Mode; scopeStates: string[]; coastalStates: readonly string[]; canEdit: boolean; inRange: boolean
	  onChange: (o: StandardOption) => void; onDefault: () => void; onRemove: () => void
	}) {
	  const [expanded, setExpanded] = useState(false)
	  const types = OPTION_TYPES[mode]
	  const activeStateCount = o.allStates ? scopeStates.length : o.states.length
	  const activeSet = new Set(o.allStates ? scopeStates : o.states)
	  const footprintSet = new Set(scopeStates)
	  const coastalSet = new Set(coastalStates)

	  function handleToggleState(st: string) {
	    if (!canEdit || o.allStates || !scopeStates.includes(st)) return
	    const on = o.states.includes(st)
	    const nextStates = on ? o.states.filter(x => x !== st) : [...o.states, st]
	    onChange({ ...o, states: nextStates })
	  }

  return (
    <div className="rounded-[10px] overflow-hidden bg-surface transition-all"
      style={{ border: `1px solid ${o.isDefault ? 'var(--color-accent-line)' : 'var(--color-border)'}`, opacity: o.enabled ? 1 : 0.55 }}>

      {/* Main row */}
      <div className="flex items-center gap-2 p-2">
        {/* Type */}
        <select disabled={!canEdit} value={o.type} aria-label="Option type"
          onChange={e => onChange({ ...o, type: e.target.value as OptionValueType })}
          className="h-8 px-1.5 rounded-[7px] bg-raised text-xs font-medium text-dim focus:outline-none focus:ring-2 focus:ring-accent/25 shrink-0">
          {types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>

        {/* Value */}
        {o.type === 'SPLIT' ? (
          <div className="flex items-center gap-1 flex-1">
            {[0, 1, 2].map(i => (
              <input key={`${o.id}-${i}`} disabled={!canEdit} defaultValue={o.parts?.[i] ?? ''} aria-label={`Split part ${i + 1}`}
                placeholder={['per person', 'per acc.', 'PD'][i]}
                onBlur={e => { const parts = [...(o.parts ?? [0, 0, 0])]; parts[i] = parseNum(e.target.value); onChange({ ...o, parts, value: parts[0] }) }}
                className="w-full h-8 px-2 rounded-[7px] bg-surface border border-border-strong font-mono text-xs text-center focus:outline-none focus:ring-2 focus:ring-accent/25" />
            ))}
          </div>
        ) : (
          <div className="relative flex-1">
            {o.type !== 'PERCENT' && o.type !== 'WAITING_PERIOD' && (
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-faint text-xs pointer-events-none">$</span>
            )}
            <input disabled={!canEdit} key={`${o.id}-val`} defaultValue={o.value || ''} inputMode="numeric" aria-label="Option value"
              onBlur={e => onChange({ ...o, value: parseNum(e.target.value) })}
              className={`w-full h-8 ${o.type === 'PERCENT' || o.type === 'WAITING_PERIOD' ? 'px-2' : 'pl-5 pr-2'} rounded-[7px] bg-surface border font-mono text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25 ${inRange ? 'border-border-strong' : 'border-danger'}`} />
            {(o.type === 'PERCENT' || o.type === 'WAITING_PERIOD') && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-faint text-[11px] pointer-events-none">
                {o.type === 'PERCENT' ? '%' : 'hrs'}
              </span>
            )}
          </div>
        )}

        {/* Label chip — shows when a display override is set */}
        {o.label && (
          <span className="shrink-0 px-2 py-0.5 rounded-[5px] text-[11px] text-dim bg-raised truncate max-w-[72px]" title={o.label}>
            "{o.label}"
          </span>
        )}

        {/* State applicability */}
	        <button disabled={!canEdit} onClick={() => setExpanded(v => !v)} aria-expanded={expanded} aria-label="Edit state applicability"
          className={`h-8 px-2.5 rounded-[7px] text-xs font-medium shrink-0 transition-colors
            ${o.allStates ? 'bg-raised text-dim' : activeStateCount === 0 ? 'bg-[rgba(220,38,38,.08)] text-danger' : 'bg-accent-soft text-accent'}
            hover:text-accent`}>
          {o.allStates ? 'All states' : `${activeStateCount} state${activeStateCount === 1 ? '' : 's'}`}
        </button>

        {/* Default (star) */}
        <button disabled={!canEdit} onClick={onDefault} aria-pressed={o.isDefault} title="Set as default"
          className={`w-8 h-8 rounded-[7px] flex items-center justify-center shrink-0 transition-colors ${o.isDefault ? 'text-warn bg-[rgba(180,83,9,.1)]' : 'text-faint hover:text-dim hover:bg-raised'}`}>
          <IconStar size={15} className={o.isDefault ? 'fill-current' : ''} />
        </button>

        {/* Enabled toggle */}
        <button disabled={!canEdit} onClick={() => onChange({ ...o, enabled: !o.enabled })} role="switch" aria-checked={o.enabled}
          title={o.enabled ? 'Enabled' : 'Disabled'}
          className="shrink-0 w-9 h-[22px] rounded-full p-0.5 transition-colors flex items-center"
          style={{ background: o.enabled ? 'var(--color-accent)' : 'var(--color-border-strong)' }}>
          <span className="w-[18px] h-[18px] rounded-full bg-white transition-transform"
            style={{ transform: o.enabled ? 'translateX(14px)' : 'translateX(0)' }} />
        </button>

        {/* Remove */}
        {canEdit && (
          <button onClick={onRemove} aria-label="Remove option"
            className="w-8 h-8 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[rgba(220,38,38,.08)] transition-colors shrink-0">
            <IconTrash size={15} />
          </button>
        )}
      </div>

      {/* Constraint note — shown inline below main row when non-empty */}
      {o.constraintNote && !expanded && (
        <div className="flex items-start gap-1.5 px-3 pb-2 pt-0">
          <IconInfo size={12} className="text-warn shrink-0 mt-0.5" />
          <p className="text-[11px] text-dim leading-relaxed">{o.constraintNote}</p>
        </div>
      )}

      {/* Expanded — state scope + label + constraint note editing */}
      {expanded && (
        <div className="px-3 pb-3 pt-2 flex flex-col gap-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          {/* State scope */}
	          <div className="flex flex-col gap-2">
	            <label className="flex items-center gap-2 text-xs text-dim cursor-pointer">
	              <input
	                type="checkbox"
	                className="accent-accent"
	                checked={o.allStates}
	                disabled={!canEdit}
	                onChange={e => onChange({
	                  ...o,
	                  allStates: e.target.checked,
	                  states: e.target.checked ? [] : (o.states.length ? o.states : scopeStates),
	                })}
	              />
	              Available in all of this coverage's states
	              <span className="ml-auto text-[11px] text-faint font-mono tnum">{activeStateCount} / {scopeStates.length}</span>
	            </label>
	            {scopeStates.length === 0 ? (
	              <p className="text-xs text-faint italic">
	                This coverage has no states in scope yet — set the coverage's state scope first.
	              </p>
	            ) : (
	              <>
	                <div className="rounded-[10px] bg-page p-2" style={{ border: '1px solid var(--color-border)' }}>
	                  <StateTileMap
	                    active={activeSet}
	                    coastal={coastalSet}
	                    footprint={footprintSet}
	                    onToggle={canEdit && !o.allStates ? handleToggleState : undefined}
	                    canEdit={canEdit && !o.allStates}
	                    labels={{
	                      active: 'Option available',
	                      available: 'In coverage scope',
	                      inactive: 'Out of coverage scope',
	                      coastal: coastalSet.size ? 'Coastal wind/hail' : undefined,
	                    }}
	                    ariaLabel={`State applicability for option — ${activeStateCount} of ${scopeStates.length} coverage states`}
	                  />
	                </div>
	                {!o.allStates && o.states.length === 0 && (
	                  <p className="text-[11px] text-danger">
	                    Select at least one state, or choose "All coverage states".
	                  </p>
	                )}
	              </>
	            )}
	          </div>

          {/* Label override */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-faint uppercase tracking-[.06em]">
              Display label <span className="normal-case font-normal">(optional — overrides derived value)</span>
            </label>
            <input key={`${o.id}-label`} disabled={!canEdit} defaultValue={o.label ?? ''} aria-label="Display label override"
              placeholder={formatOption(o)}
              onBlur={e => onChange({ ...o, label: e.target.value.trim() || undefined })}
              className="h-8 px-3 rounded-[7px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25" />
          </div>

          {/* Constraint note — editable */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-faint uppercase tracking-[.06em]">
              Constraint note <span className="normal-case font-normal">(optional — e.g. eligibility rule)</span>
            </label>
            <input key={`${o.id}-cnote`} disabled={!canEdit} defaultValue={o.constraintNote ?? ''} aria-label="Constraint note"
              placeholder="e.g. Coverage F $5,000 only when Coverage E ≥ $300,000"
              onBlur={e => onChange({ ...o, constraintNote: e.target.value.trim() || undefined })}
              className="h-8 px-3 rounded-[7px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25" />
          </div>

          {/* Preview + done */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-faint font-mono">{formatOption(o)}</span>
            <button onClick={() => setExpanded(false)} className="text-[11px] text-accent font-medium hover:underline">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
