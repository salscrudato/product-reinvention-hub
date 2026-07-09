// Pure FilterState transitions. Every mutator returns a new state (no aliasing), so the
// hook stays a thin wrapper: reduce -> reconcile -> write URL. Kept pure and separate so
// the reducer logic is unit-testable without React.

import type { ActiveChip, DateRangeValue, FilterState, HierarchyValue } from './facetTypes'
import { emptyFilterState } from './facetTypes'
import type { SchemaIndex } from './schemaIndex'

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])]

export function cloneState(s: FilterState): FilterState {
  return {
    text: s.text,
    enums: Object.fromEntries(Object.entries(s.enums).map(([k, v]) => [k, [...v]])),
    hierarchies: Object.fromEntries(
      Object.entries(s.hierarchies).map(([k, v]) => [k, { parents: [...v.parents], children: [...v.children] }]),
    ),
    dateRanges: Object.fromEntries(Object.entries(s.dateRanges).map(([k, v]) => [k, { ...v }])),
  }
}

export function setText(s: FilterState, text: string): FilterState {
  const n = cloneState(s); n.text = text; return n
}

export function toggleEnum(s: FilterState, facetId: string, value: string): FilterState {
  const n = cloneState(s)
  const cur = n.enums[facetId] ?? []
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
  if (next.length) n.enums[facetId] = next
  else delete n.enums[facetId]
  return n
}

export function toggleParent<T>(index: SchemaIndex<T>, s: FilterState, facetId: string, parent: string): FilterState {
  const n = cloneState(s)
  const hv: HierarchyValue = n.hierarchies[facetId] ?? { parents: [], children: [] }
  if (hv.parents.includes(parent)) {
    // Deselecting a parent drops the whole branch: its children would be orphans.
    const declared = index.hierarchies.get(facetId)?.childrenOf.get(parent) ?? []
    hv.parents = hv.parents.filter((p) => p !== parent)
    hv.children = hv.children.filter((c) => !declared.includes(c))
  } else {
    hv.parents = [...hv.parents, parent]
  }
  if (hv.parents.length || hv.children.length) n.hierarchies[facetId] = hv
  else delete n.hierarchies[facetId]
  return n
}

export function toggleChild<T>(index: SchemaIndex<T>, s: FilterState, facetId: string, child: string): FilterState {
  const parent = index.hierarchies.get(facetId)?.childParentOf.get(child)
  if (!parent) return s   // unknown child — no-op rather than corrupt the state
  const n = cloneState(s)
  const hv: HierarchyValue = n.hierarchies[facetId] ?? { parents: [], children: [] }
  if (hv.children.includes(child)) {
    hv.children = hv.children.filter((c) => c !== child)   // parent stays: branch remains selected
  } else {
    hv.children = [...hv.children, child]
    if (!hv.parents.includes(parent)) hv.parents = [...hv.parents, parent]
  }
  if (hv.parents.length || hv.children.length) n.hierarchies[facetId] = hv
  else delete n.hierarchies[facetId]
  return n
}

export function setDateRange(s: FilterState, facetId: string, range: Partial<DateRangeValue>): FilterState {
  const n = cloneState(s)
  const cur = n.dateRanges[facetId] ?? { from: null, to: null }
  const next: DateRangeValue = {
    from: range.from !== undefined ? range.from : cur.from,
    to: range.to !== undefined ? range.to : cur.to,
  }
  if (next.from == null && next.to == null) delete n.dateRanges[facetId]
  else n.dateRanges[facetId] = next
  return n
}

export function clearFacet(s: FilterState, facetId: string): FilterState {
  if (facetId === '__text__') return setText(s, '')
  const n = cloneState(s)
  delete n.enums[facetId]; delete n.hierarchies[facetId]; delete n.dateRanges[facetId]
  return n
}

export function clearAll(): FilterState {
  return emptyFilterState()
}

export function removeChip<T>(index: SchemaIndex<T>, s: FilterState, chip: ActiveChip): FilterState {
  switch (chip.role) {
    case 'text':     return setText(s, '')
    case 'value':    return toggleEnum(s, chip.facetId, chip.value)
    case 'parent':   return toggleParent(index, s, chip.facetId, chip.value)
    case 'child':    return toggleChild(index, s, chip.facetId, chip.value)
    case 'dateFrom': return setDateRange(s, chip.facetId, { from: null })
    case 'dateTo':   return setDateRange(s, chip.facetId, { to: null })
  }
}

/** Union another state into a base (used by the command bar and interpreted queries).
 *  Facet selections union; free text is taken from the incoming patch. */
export function mergeStates(base: FilterState, add: FilterState): FilterState {
  const n = cloneState(base)
  n.text = add.text
  for (const [id, vals] of Object.entries(add.enums)) n.enums[id] = union(n.enums[id] ?? [], vals)
  for (const [id, hv] of Object.entries(add.hierarchies)) {
    const cur = n.hierarchies[id] ?? { parents: [], children: [] }
    n.hierarchies[id] = { parents: union(cur.parents, hv.parents), children: union(cur.children, hv.children) }
  }
  for (const [id, r] of Object.entries(add.dateRanges)) n.dateRanges[id] = r
  return n
}
