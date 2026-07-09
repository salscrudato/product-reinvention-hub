// The deterministic filter engine — pure functions, no React, fully unit-testable.
//
// Semantics: OR within a dimension, AND across dimensions. Everything is client-side
// and exact; there is no fuzzy matching in the filter path (fuzziness lives only in the
// command-bar typeahead, which resolves to exact facet chips). In a compliance context,
// silently hiding an entity via a fuzzy interpretation is a serious failure, so the
// filter never guesses.

import type {
  ActiveChip, DateRangeFacet, DateRangeValue, EnumFacet, Facet, FacetCounts, FacetSchema,
  FilterState, HierarchyFacet, HierarchyValue, ReconcileReport, UnknownValue,
} from './facetTypes'
import { type SchemaIndex, enumValuesOf } from './schemaIndex'

// ─── Per-dimension match tests ───────────────────────────────────────────────────

function enumMatches<T>(facet: EnumFacet<T>, entity: T, selected: readonly string[]): boolean {
  if (selected.length === 0) return true                 // dimension inactive
  const values = enumValuesOf(facet, entity)
  return values.some((v) => selected.includes(v))        // OR within the dimension
}

function hierarchyMatches<T>(
  facet: HierarchyFacet<T>, index: SchemaIndex<T>, entity: T, value: HierarchyValue,
): boolean {
  if (value.parents.length === 0 && value.children.length === 0) return true
  const parent = facet.parentAccessor(entity)
  if (parent == null || !value.parents.includes(parent)) return false
  // Children selected *under this entity's parent*. A parent with no selected children
  // matches its whole branch; a parent with selected children matches only those.
  const declared = index.hierarchies.get(facet.id)?.childrenOf.get(parent) ?? []
  const selectedUnderParent = value.children.filter((c) => declared.includes(c))
  if (selectedUnderParent.length === 0) return true
  const child = facet.childAccessor(entity)
  return child != null && selectedUnderParent.includes(child)
}

function dateMatches<T>(facet: DateRangeFacet<T>, entity: T, range: DateRangeValue): boolean {
  if (range.from == null && range.to == null) return true
  const v = facet.accessor(entity)
  if (v == null) return false
  if (range.from != null && v < range.from) return false
  if (range.to != null && v > range.to) return false
  return true
}

function facetMatches<T>(facet: Facet<T>, index: SchemaIndex<T>, entity: T, state: FilterState): boolean {
  switch (facet.kind) {
    case 'enum':      return enumMatches(facet, entity, state.enums[facet.id] ?? [])
    case 'hierarchy': return hierarchyMatches(facet, index, entity, state.hierarchies[facet.id] ?? { parents: [], children: [] })
    case 'dateRange': return dateMatches(facet, entity, state.dateRanges[facet.id] ?? { from: null, to: null })
  }
}

/** Free text is an exact, conjunctive substring match: every whitespace-separated term
 *  must appear in the entity's searchable text. Deterministic by design. */
function textMatches<T>(schema: FacetSchema<T>, entity: T, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const haystack = schema.getText(entity).toLowerCase()
  return terms.every((t) => haystack.includes(t))
}

export function tokenizeText(text: string): string[] {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

// ─── Single-pass results + faceted counts ─────────────────────────────────────────
// Faceted-count semantics: a value's count is the number of entities matching every
// OTHER dimension (and the free text) with that value present in THIS dimension — i.e.
// "results if I toggle this value on, given what's already selected". So a value's count
// is computed with its own dimension excluded from the filter.
//
// The trick that keeps this O(entities x facets): an entity contributes to a dimension
// D's counts iff it matches the text and fails at most one facet, and if it fails
// exactly one, that one must be D. So one pass over the entities yields both the final
// results (fails zero) and every dimension's base set — no per-dimension re-scan.

export interface EngineOutput<T> { results: T[]; counts: FacetCounts }

function emptyCounts<T>(index: SchemaIndex<T>): FacetCounts {
  const counts: FacetCounts = { enums: {}, hierarchies: {} }
  for (const facet of index.schema.facets) {
    if (facet.kind === 'enum') counts.enums[facet.id] = {}
    else if (facet.kind === 'hierarchy') counts.hierarchies[facet.id] = { parents: {}, children: {} }
  }
  return counts
}

function tally<T>(facet: Facet<T>, entity: T, counts: FacetCounts): void {
  if (facet.kind === 'enum') {
    const bucket = counts.enums[facet.id]!
    for (const v of enumValuesOf(facet, entity)) bucket[v] = (bucket[v] ?? 0) + 1
  } else if (facet.kind === 'hierarchy') {
    const bucket = counts.hierarchies[facet.id]!
    const p = facet.parentAccessor(entity)
    if (p != null) bucket.parents[p] = (bucket.parents[p] ?? 0) + 1
    const c = facet.childAccessor(entity)
    if (c != null) bucket.children[c] = (bucket.children[c] ?? 0) + 1
  }
  // dateRange facets carry no discrete counts.
}

export function runEngine<T>(index: SchemaIndex<T>, entities: readonly T[], state: FilterState): EngineOutput<T> {
  const { schema } = index
  const facets = schema.facets
  const terms = tokenizeText(state.text)
  const results: T[] = []
  const counts = emptyCounts(index)

  for (const entity of entities) {
    if (!textMatches(schema, entity, terms)) continue

    let failed: string | null = null   // id of the single failing facet, if exactly one
    let failCount = 0
    for (const facet of facets) {
      if (!facetMatches(facet, index, entity, state)) {
        failCount++
        if (failCount > 1) break
        failed = facet.id
      }
    }

    if (failCount === 0) {
      results.push(entity)
      for (const facet of facets) tally(facet, entity, counts)   // contributes everywhere
    } else if (failCount === 1) {
      const facet = index.facetById.get(failed as string)
      if (facet) tally(facet, entity, counts)                    // contributes only to the dim it fails
    }
    // failCount >= 2 -> contributes to no dimension's base set
  }

  return { results, counts }
}

// ─── Reconciliation ────────────────────────────────────────────────────────────────
// Drops selections that no longer exist in the taxonomy (e.g. a hand-edited URL, or a
// schema that changed) and orphaned children whose parent is no longer selected, keeping
// every still-valid selection and reporting exactly what changed.

export interface Reconciled { state: FilterState; report: ReconcileReport }

export function reconcileState<T>(index: SchemaIndex<T>, state: FilterState): Reconciled {
  const report: ReconcileReport = { dropped: [] }

  const enums: Record<string, string[]> = {}
  for (const [facetId, values] of Object.entries(state.enums)) {
    const eidx = index.enums.get(facetId)
    if (!eidx) continue
    const kept: string[] = []
    for (const v of values) {
      if (eidx.labelOf.has(v)) kept.push(v)
      else report.dropped.push({ facetId, axis: 'value', value: v, reason: 'not in taxonomy' })
    }
    if (kept.length) enums[facetId] = kept
  }

  const hierarchies: Record<string, HierarchyValue> = {}
  for (const [facetId, value] of Object.entries(state.hierarchies)) {
    const hidx = index.hierarchies.get(facetId)
    if (!hidx) continue
    const parents: string[] = []
    for (const p of value.parents) {
      if (hidx.parentLabelOf.has(p)) parents.push(p)
      else report.dropped.push({ facetId, axis: 'parent', value: p, reason: 'not in taxonomy' })
    }
    const children: string[] = []
    for (const c of value.children) {
      const parent = hidx.childParentOf.get(c)
      if (!parent) { report.dropped.push({ facetId, axis: 'child', value: c, reason: 'not in taxonomy' }); continue }
      if (!parents.includes(parent)) { report.dropped.push({ facetId, axis: 'child', value: c, reason: 'category deselected' }); continue }
      children.push(c)
    }
    if (parents.length || children.length) hierarchies[facetId] = { parents, children }
  }

  const dateRanges: Record<string, DateRangeValue> = {}
  for (const [facetId, range] of Object.entries(state.dateRanges)) {
    if (index.facetById.get(facetId)?.kind === 'dateRange') dateRanges[facetId] = range
  }

  return { state: { text: state.text, enums, hierarchies, dateRanges }, report }
}

// ─── Unknown-value detection ──────────────────────────────────────────────────────
// A taxonomy value present in the data but absent from the schema. Surfaced (disabled
// chip), never hidden: hiding it would silently drop compliance-relevant entities.

export function detectUnknownValues<T>(index: SchemaIndex<T>, entities: readonly T[]): UnknownValue[] {
  const out: UnknownValue[] = []

  for (const [facetId, eidx] of index.enums) {
    const facet = index.facetById.get(facetId) as EnumFacet<T> | undefined
    if (!facet) continue
    const tally = new Map<string, number>()
    for (const e of entities) for (const v of enumValuesOf(facet, e)) {
      if (!eidx.labelOf.has(v)) tally.set(v, (tally.get(v) ?? 0) + 1)
    }
    for (const [value, count] of tally) out.push({ facetId, axis: 'enum', value, count })
  }

  for (const [facetId, hidx] of index.hierarchies) {
    const facet = index.facetById.get(facetId) as HierarchyFacet<T> | undefined
    if (!facet) continue
    const parentTally = new Map<string, number>()
    const childTally = new Map<string, number>()
    for (const e of entities) {
      const p = facet.parentAccessor(e)
      if (p != null && !hidx.parentLabelOf.has(p)) parentTally.set(p, (parentTally.get(p) ?? 0) + 1)
      const c = facet.childAccessor(e)
      if (c != null && !hidx.childParentOf.has(c)) childTally.set(c, (childTally.get(c) ?? 0) + 1)
    }
    for (const [value, count] of parentTally) out.push({ facetId, axis: 'parent', value, count })
    for (const [value, count] of childTally) out.push({ facetId, axis: 'child', value, count })
  }

  return out
}

// ─── Active-filter pills ─────────────────────────────────────────────────────────

export function buildChips<T>(index: SchemaIndex<T>, state: FilterState): ActiveChip[] {
  const chips: ActiveChip[] = []

  if (state.text.trim()) {
    chips.push({ facetId: '__text__', kind: 'text', role: 'text', value: state.text, label: `"${state.text.trim()}"` })
  }

  for (const [facetId, values] of Object.entries(state.enums)) {
    const eidx = index.enums.get(facetId)
    const facet = index.facetById.get(facetId)
    if (!eidx || !facet) continue
    const dimLabel = facet.kind === 'enum' ? facet.label : facetId
    for (const v of values) {
      chips.push({ facetId, kind: 'enum', role: 'value', value: v, label: `${dimLabel}: ${eidx.labelOf.get(v) ?? v}` })
    }
  }

  for (const [facetId, value] of Object.entries(state.hierarchies)) {
    const hidx = index.hierarchies.get(facetId)
    if (!hidx) continue
    // Parent chip only when the parent has no selected children (avoids "Product" plus
    // "Product > Eligibility" redundancy); otherwise the child chips carry the selection.
    for (const p of value.parents) {
      const declared = hidx.childrenOf.get(p) ?? []
      const hasChildSelection = value.children.some((c) => declared.includes(c))
      if (!hasChildSelection) {
        chips.push({ facetId, kind: 'hierarchy', role: 'parent', value: p, label: hidx.parentLabelOf.get(p) ?? p })
      }
    }
    for (const c of value.children) {
      chips.push({ facetId, kind: 'hierarchy', role: 'child', value: c, parent: hidx.childParentOf.get(c), label: hidx.childLabelOf.get(c) ?? c })
    }
  }

  for (const [facetId, range] of Object.entries(state.dateRanges)) {
    const facet = index.facetById.get(facetId)
    if (!facet || facet.kind !== 'dateRange') continue
    if (range.from != null) chips.push({ facetId, kind: 'dateRange', role: 'dateFrom', value: String(range.from), label: `${facet.label} from ${facet.format(range.from)}` })
    if (range.to != null)   chips.push({ facetId, kind: 'dateRange', role: 'dateTo',   value: String(range.to),   label: `${facet.label} to ${facet.format(range.to)}` })
  }

  return chips
}

export function hasActiveFilters(state: FilterState): boolean {
  return (
    state.text.trim().length > 0 ||
    Object.values(state.enums).some((v) => v.length > 0) ||
    Object.values(state.hierarchies).some((h) => h.parents.length > 0 || h.children.length > 0) ||
    Object.values(state.dateRanges).some((r) => r.from != null || r.to != null)
  )
}
