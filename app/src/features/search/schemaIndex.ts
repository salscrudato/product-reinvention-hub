// Precomputed lookup maps for a schema.
//
// The engine, URL sync and token parser all need the same O(1) lookups: canonical
// value <-> display token, child -> parent, declared option sets. Building them once
// per schema (the hook memoizes on schema identity) keeps re-filter under 16ms even at
// 5,000 entities and keeps the pure engine free of repeated array scans.
//
// token vs value: a FacetOption's `value` is the canonical form the accessor returns
// and the engine compares against ('ACTIVE', 'PRODUCT'); its `token` is the URL-param +
// command-bar form ('Active', 'Product'). `valueOfToken` resolves any surface form
// (token, label, alias, or the raw value) back to the canonical value, so a hand-typed
// or hand-edited URL is tolerant while state stays canonical.

import type { EnumFacet, Facet, FacetSchema, HierarchyFacet } from './facetTypes'

/** Collapse casing + whitespace drift to a stable comparison key. */
export const normalizeToken = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

export interface EnumIndex {
  facetId:      string
  values:       string[]                 // declared canonical values, in schema order
  labelOf:      Map<string, string>      // value -> label
  tokenOf:      Map<string, string>      // value -> token (URL/command-bar form)
  valueOfToken: Map<string, string>      // normalized surface form -> canonical value
}

export interface HierIndex {
  facetId:            string
  parents:            string[]
  parentLabelOf:      Map<string, string>
  parentTokenOf:      Map<string, string>
  parentValueOfToken: Map<string, string>
  childrenOf:         Map<string, string[]>   // parent value -> child values (schema order)
  childParentOf:      Map<string, string>     // child value -> parent value
  childLabelOf:       Map<string, string>
  childTokenOf:       Map<string, string>
  childValueOfToken:  Map<string, string>
}

export interface SchemaIndex<T> {
  schema:      FacetSchema<T>
  facetById:   Map<string, Facet<T>>
  enums:       Map<string, EnumIndex>
  hierarchies: Map<string, HierIndex>
}

interface TokenSource { value: string; label: string; token?: string; aliases?: readonly string[] }

/** Register every surface form of an option so `valueOfToken` resolves it back. */
function registerToken(map: Map<string, string>, o: TokenSource): void {
  map.set(normalizeToken(o.value), o.value)
  map.set(normalizeToken(o.label), o.value)
  if (o.token) map.set(normalizeToken(o.token), o.value)
  for (const a of o.aliases ?? []) map.set(normalizeToken(a), o.value)
}

function indexEnum<T>(facet: EnumFacet<T>): EnumIndex {
  const idx: EnumIndex = {
    facetId: facet.id, values: [], labelOf: new Map(), tokenOf: new Map(), valueOfToken: new Map(),
  }
  for (const o of facet.options) {
    idx.values.push(o.value)
    idx.labelOf.set(o.value, o.label)
    idx.tokenOf.set(o.value, o.token ?? o.value)
    registerToken(idx.valueOfToken, o)
  }
  return idx
}

function indexHierarchy<T>(facet: HierarchyFacet<T>): HierIndex {
  const idx: HierIndex = {
    facetId: facet.id, parents: [],
    parentLabelOf: new Map(), parentTokenOf: new Map(), parentValueOfToken: new Map(),
    childrenOf: new Map(), childParentOf: new Map(),
    childLabelOf: new Map(), childTokenOf: new Map(), childValueOfToken: new Map(),
  }
  for (const p of facet.parents) {
    idx.parents.push(p.value)
    idx.parentLabelOf.set(p.value, p.label)
    idx.parentTokenOf.set(p.value, p.token ?? p.value)
    registerToken(idx.parentValueOfToken, { value: p.value, label: p.label, token: p.token, aliases: p.aliases })
    idx.childrenOf.set(p.value, p.children.map((c) => c.value))
    for (const c of p.children) {
      idx.childParentOf.set(c.value, p.value)
      idx.childLabelOf.set(c.value, c.label)
      idx.childTokenOf.set(c.value, c.token ?? c.value)
      registerToken(idx.childValueOfToken, c)
    }
  }
  return idx
}

export function createSchemaIndex<T>(schema: FacetSchema<T>): SchemaIndex<T> {
  const index: SchemaIndex<T> = {
    schema, facetById: new Map(), enums: new Map(), hierarchies: new Map(),
  }
  for (const facet of schema.facets) {
    index.facetById.set(facet.id, facet)
    if (facet.kind === 'enum') index.enums.set(facet.id, indexEnum(facet))
    else if (facet.kind === 'hierarchy') index.hierarchies.set(facet.id, indexHierarchy(facet))
  }
  return index
}

/** Normalize an enum accessor result to a plain array of canonical values. */
export function enumValuesOf<T>(facet: EnumFacet<T>, entity: T): string[] {
  const v = facet.accessor(entity)
  if (v == null) return []
  return typeof v === 'string' ? [v] : [...v]
}
