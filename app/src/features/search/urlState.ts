// FilterState <-> URLSearchParams. Every filtered view is shareable and bookmarkable
// (e.g. ?cat=Product&sub=Optional+Coverage+Eligibility&status=Active) and rehydrates on
// load. URL params carry the display token form ('Active', 'Product'), not the ALLCAPS
// enum; `valueOfToken` maps them back so canonical state stays canonical.

import type { DateRangeFacet, FilterState } from './facetTypes'
import { emptyFilterState } from './facetTypes'
import { type SchemaIndex, normalizeToken } from './schemaIndex'

/** Every query-param key a schema owns, so the hook can replace only its own params and
 *  leave foreign ones (deep links like ?cov=, ?form=) untouched. */
export function ownedParamKeys<T>(index: SchemaIndex<T>): string[] {
  const keys = new Set<string>(['q'])
  for (const facet of index.schema.facets) {
    if (facet.kind === 'enum') keys.add(facet.param)
    else if (facet.kind === 'hierarchy') { keys.add(facet.parent.param); keys.add(facet.child.param) }
    else if (facet.kind === 'dateRange') { keys.add(`${facet.param}From`); keys.add(`${facet.param}To`) }
  }
  return [...keys]
}

/** Serialize the schema-owned params only (foreign params are merged by the hook). */
export function stateToParams<T>(index: SchemaIndex<T>, state: FilterState): URLSearchParams {
  const p = new URLSearchParams()
  if (state.text.trim()) p.set('q', state.text.trim())

  for (const facet of index.schema.facets) {
    if (facet.kind === 'enum') {
      const eidx = index.enums.get(facet.id)!
      for (const v of state.enums[facet.id] ?? []) p.append(facet.param, eidx.tokenOf.get(v) ?? v)
    } else if (facet.kind === 'hierarchy') {
      const hidx = index.hierarchies.get(facet.id)!
      const hv = state.hierarchies[facet.id]
      if (hv) {
        for (const parent of hv.parents) p.append(facet.parent.param, hidx.parentTokenOf.get(parent) ?? parent)
        for (const child of hv.children) p.append(facet.child.param, hidx.childTokenOf.get(child) ?? child)
      }
    } else {
      const r = state.dateRanges[facet.id]
      if (r?.from != null) p.set(`${facet.param}From`, facet.format(r.from))
      if (r?.to != null)   p.set(`${facet.param}To`, facet.format(r.to))
    }
  }
  return p
}

export function paramsToState<T>(index: SchemaIndex<T>, params: URLSearchParams): FilterState {
  const state = emptyFilterState()
  state.text = params.get('q') ?? ''

  for (const facet of index.schema.facets) {
    if (facet.kind === 'enum') {
      const eidx = index.enums.get(facet.id)!
      const vals = new Set<string>()
      for (const raw of params.getAll(facet.param)) {
        const v = eidx.valueOfToken.get(normalizeToken(raw))
        if (v) vals.add(v)
      }
      if (vals.size) state.enums[facet.id] = [...vals]
    } else if (facet.kind === 'hierarchy') {
      const hidx = index.hierarchies.get(facet.id)!
      const parents = new Set<string>()
      const children = new Set<string>()
      for (const raw of params.getAll(facet.parent.param)) {
        const v = hidx.parentValueOfToken.get(normalizeToken(raw)); if (v) parents.add(v)
      }
      for (const raw of params.getAll(facet.child.param)) {
        const v = hidx.childValueOfToken.get(normalizeToken(raw))
        if (v) { children.add(v); const parent = hidx.childParentOf.get(v); if (parent) parents.add(parent) }
      }
      if (parents.size || children.size) state.hierarchies[facet.id] = { parents: [...parents], children: [...children] }
    } else {
      const df = facet as DateRangeFacet<T>
      const fromRaw = params.get(`${facet.param}From`)
      const toRaw = params.get(`${facet.param}To`)
      const from = fromRaw ? df.parse(fromRaw) : null
      const to = toRaw ? df.parse(toRaw) : null
      if (from != null || to != null) state.dateRanges[facet.id] = { from, to }
    }
  }
  return state
}
