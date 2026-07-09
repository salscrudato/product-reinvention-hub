// FacetPanel — the hierarchical facet tree with live faceted counts. Entity-agnostic: it
// renders whatever the schema declares (hierarchies, flat enums, a date range) and reads
// counts + selection straight from the engine output. Zero-count values are disabled, not
// hidden, so the shape of the taxonomy stays visible. Values found in the data but missing
// from the schema are surfaced in a dedicated group rather than dropped.

import { useMemo, useState } from 'react'
import { IconChevronRight, IconFilter, IconSearch, IconWarning } from '../../components/ui/icons'
import type {
  DateRangeFacet, DateRangeValue, EnumFacet, FacetCounts, FacetSchema, FilterState,
  HierarchyFacet, UnknownValue,
} from './facetTypes'

interface FacetPanelProps<T> {
  schema:         FacetSchema<T>
  counts:         FacetCounts
  state:          FilterState
  unknownValues:  UnknownValue[]
  onToggleEnum:   (facetId: string, value: string) => void
  onToggleParent: (facetId: string, parent: string) => void
  onToggleChild:  (facetId: string, child: string) => void
  onSetDateRange: (facetId: string, range: Partial<DateRangeValue>) => void
}

// ─── A single selectable row (real checkbox for free keyboard + SR support) ─────
function CheckRow({ id, label, count, checked, disabled, indent, onToggle }: {
  id: string; label: string; count: number; checked: boolean; disabled: boolean; indent?: boolean; onToggle: () => void
}) {
  return (
    <label
      htmlFor={id}
      className={`group flex items-center gap-2 py-1 px-1.5 rounded-[7px] text-sm transition-colors ${indent ? 'ml-6' : ''} ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--color-ghost)]'
      }`}
    >
      <input
        type="checkbox" id={id} checked={checked} disabled={disabled} onChange={onToggle}
        className="accent-accent shrink-0 w-3.5 h-3.5"
      />
      <span className={`flex-1 min-w-0 truncate ${checked ? 'text-text font-medium' : 'text-dim'}`}>{label}</span>
      <span key={count} className="chip-in tnum text-[11px] text-faint tabular-nums shrink-0">{count}</span>
    </label>
  )
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-[11px] font-semibold uppercase tracking-[.07em] text-faint px-1.5 mb-1">
      {children}
    </h3>
  )
}

// ─── Hierarchy facet ─────────────────────────────────────────────────────────────
function HierarchyFacetView<T>({ facet, counts, state, unknowns, onToggleParent, onToggleChild }: {
  facet: HierarchyFacet<T>
  counts: FacetCounts
  state: FilterState
  unknowns: UnknownValue[]
  onToggleParent: (facetId: string, parent: string) => void
  onToggleChild: (facetId: string, child: string) => void
}) {
  const value = state.hierarchies[facet.id] ?? { parents: [], children: [] }
  const bucket = counts.hierarchies[facet.id] ?? { parents: {}, children: {} }
  // Expand parents that have a selected child by default; the chevron toggles the rest.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>()
    for (const p of facet.parents) if (p.children.some((c) => value.children.includes(c.value))) s.add(p.value)
    return s
  })
  const headingId = `facet-${facet.id}`
  const unknownChildren = unknowns.filter((u) => u.axis === 'child')

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <SectionHeading id={headingId}>{facet.parent.label}</SectionHeading>
      <div role="group" aria-label={facet.parent.label} className="flex flex-col">
        {facet.parents.map((parent) => {
          const pCount = bucket.parents[parent.value] ?? 0
          const pChecked = value.parents.includes(parent.value)
          const isOpen = expanded.has(parent.value)
          const hasChildren = parent.children.length > 0
          return (
            <div key={parent.value} className="flex flex-col">
              <div className="flex items-center">
                {hasChildren ? (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`${facet.id}-${parent.value}-children`}
                    aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${parent.label}`}
                    onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(parent.value)) n.delete(parent.value); else n.add(parent.value); return n })}
                    className="w-5 h-6 flex items-center justify-center text-faint hover:text-text rounded-[5px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  >
                    <IconChevronRight size={13} className="transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} aria-hidden="true" />
                  </button>
                ) : <span className="w-5" aria-hidden="true" />}
                <div className="flex-1 min-w-0">
                  <CheckRow
                    id={`${facet.id}-${parent.value}`} label={parent.label} count={pCount}
                    checked={pChecked} disabled={pCount === 0 && !pChecked}
                    onToggle={() => onToggleParent(facet.id, parent.value)}
                  />
                </div>
              </div>
              {isOpen && hasChildren && (
                <div id={`${facet.id}-${parent.value}-children`} role="group" aria-label={`${parent.label} ${facet.child.label}`} className="facet-reveal flex flex-col">
                  {parent.children.map((child) => {
                    const cCount = bucket.children[child.value] ?? 0
                    const cChecked = value.children.includes(child.value)
                    return (
                      <CheckRow
                        key={child.value} id={`${facet.id}-${child.value}`} label={child.label} count={cCount}
                        checked={cChecked} disabled={cCount === 0 && !cChecked} indent
                        onToggle={() => onToggleChild(facet.id, child.value)}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {unknownChildren.length > 0 && <UnknownGroup label={`In data, not in ${facet.child.label.toLowerCase()}`} values={unknownChildren} />}
      </div>
    </section>
  )
}

// ─── Flat enum facet ──────────────────────────────────────────────────────────────
function EnumFacetView<T>({ facet, counts, state, unknowns, onToggle }: {
  facet: EnumFacet<T>
  counts: FacetCounts
  state: FilterState
  unknowns: UnknownValue[]
  onToggle: (facetId: string, value: string) => void
}) {
  const selected = state.enums[facet.id] ?? []
  const bucket = counts.enums[facet.id] ?? {}
  const [q, setQ] = useState('')
  const headingId = `facet-${facet.id}`
  const searchable = facet.options.length > 12
  const shown = useMemo(
    () => (q ? facet.options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()) || o.value.toLowerCase().includes(q.toLowerCase())) : facet.options),
    [q, facet.options],
  )

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <SectionHeading id={headingId}>{facet.label}</SectionHeading>
      {searchable && (
        <div className="relative mb-1 px-1.5">
          <IconSearch size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Filter ${facet.label} options`}
            placeholder={`Filter ${facet.label.toLowerCase()}…`}
            className="w-full h-7 pl-7 pr-2 rounded-[7px] bg-surface border border-border text-xs placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
        </div>
      )}
      <div role="group" aria-label={facet.label} className={`flex flex-col ${searchable ? 'max-h-64 overflow-y-auto -mx-1 px-1' : ''}`}>
        {shown.map((o) => {
          const count = bucket[o.value] ?? 0
          const checked = selected.includes(o.value)
          return (
            <CheckRow
              key={o.value} id={`${facet.id}-${o.value}`} label={o.label} count={count}
              checked={checked} disabled={count === 0 && !checked}
              onToggle={() => onToggle(facet.id, o.value)}
            />
          )
        })}
        {shown.length === 0 && <p className="text-xs text-faint italic px-1.5 py-1">No match.</p>}
        {unknowns.length > 0 && <UnknownGroup label={`In data, not in ${facet.label.toLowerCase()}`} values={unknowns} />}
      </div>
    </section>
  )
}

// ─── Date-range facet (e.g. Form edition) ──────────────────────────────────────────
const msToMonth = (ms: number): string => { const d = new Date(ms); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const monthToMs = (m: string): number | null => { const [y, mo] = m.split('-').map(Number); return y && mo ? Date.UTC(y, mo - 1, 1) : null }

function DateRangeFacetView<T>({ facet, state, onSet }: {
  facet: DateRangeFacet<T>
  state: FilterState
  onSet: (facetId: string, range: Partial<DateRangeValue>) => void
}) {
  const r = state.dateRanges[facet.id] ?? { from: null, to: null }
  const headingId = `facet-${facet.id}`
  const inputCls = 'h-7 px-2 rounded-[7px] bg-surface border border-border text-xs text-text focus:outline-none focus:ring-2 focus:ring-accent/25 flex-1 min-w-0'
  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <SectionHeading id={headingId}>{facet.label}</SectionHeading>
      <div className="flex items-center gap-2 px-1.5">
        <input type="month" aria-label={`${facet.label} from`} className={inputCls}
          value={r.from != null ? msToMonth(r.from) : ''}
          onChange={(e) => onSet(facet.id, { from: e.target.value ? monthToMs(e.target.value) : null })} />
        <span className="text-[11px] text-faint" aria-hidden="true">to</span>
        <input type="month" aria-label={`${facet.label} to`} className={inputCls}
          value={r.to != null ? msToMonth(r.to) : ''}
          onChange={(e) => onSet(facet.id, { to: e.target.value ? monthToMs(e.target.value) : null })} />
      </div>
    </section>
  )
}

// ─── Unknown-value group (surfaced, disabled) ──────────────────────────────────────
function UnknownGroup({ label, values }: { label: string; values: UnknownValue[] }) {
  return (
    <div className="mt-1 pt-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-1 px-1.5 mb-0.5">
        <IconWarning size={11} className="text-warn" aria-hidden="true" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-warn">{label}</span>
      </div>
      {values.map((u) => (
        <div key={u.value} className="flex items-center gap-2 py-1 px-1.5 ml-0.5 text-sm opacity-70" title="Present in the data but not part of the taxonomy">
          <span className="flex-1 min-w-0 truncate text-dim italic">{u.value}</span>
          <span className="tnum text-[11px] text-faint">{u.count}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Panel ─────────────────────────────────────────────────────────────────────────
export function FacetPanel<T>({ schema, counts, state, unknownValues, onToggleEnum, onToggleParent, onToggleChild, onSetDateRange }: FacetPanelProps<T>) {
  return (
    <aside
      aria-label="Filters"
      className="glass rounded-[14px] p-3 flex flex-col gap-4"
      style={{ border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-2 px-1.5">
        <IconFilter size={14} className="text-accent" aria-hidden="true" />
        <span className="text-[13px] font-semibold text-text">Filters</span>
      </div>
      {schema.facets.map((facet) => {
        const facetUnknowns = unknownValues.filter((u) => u.facetId === facet.id)
        if (facet.kind === 'hierarchy') {
          return <HierarchyFacetView key={facet.id} facet={facet} counts={counts} state={state} unknowns={facetUnknowns} onToggleParent={onToggleParent} onToggleChild={onToggleChild} />
        }
        if (facet.kind === 'enum') {
          return <EnumFacetView key={facet.id} facet={facet} counts={counts} state={state} unknowns={facetUnknowns.filter((u) => u.axis === 'enum')} onToggle={onToggleEnum} />
        }
        return <DateRangeFacetView key={facet.id} facet={facet} state={state} onSet={onSetDateRange} />
      })}
    </aside>
  )
}
