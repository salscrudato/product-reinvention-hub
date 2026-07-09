// Command-bar input parsing (Linear / GitHub issue-search pattern).
//
// The bar accepts free text AND structured tokens: category:Product, sub:"Base Coverage
// (Default)", state:CA, status:Active. Tokens resolve deterministically against the
// active schema; whatever does not parse as a token is free text. Separately, a Fuse
// typeahead corpus lets partial input ("opt cov") surface the matching facet value with
// no network call — the fuzziness is only in the SUGGESTION, never in the applied filter.

import type { FilterState } from './facetTypes'
import { emptyFilterState } from './facetTypes'
import { type SchemaIndex, normalizeToken } from './schemaIndex'

// key:value  or  key:"quoted value"
const TOKEN_RE = /([\w-]+):(?:"([^"]*)"|(\S+))/g

interface KeyEntry {
  facetId: string
  axis: 'enum' | 'parent' | 'child'
  resolve: (raw: string) => string | null   // surface form -> canonical value
}

/** Map every token keyword (status, state, category, sub, plus each facet's own param)
 *  to how it resolves a value. Both the human token and the short URL param are accepted
 *  so `cat:Product` and `category:Product` both work. */
function keyRegistry<T>(index: SchemaIndex<T>): Map<string, KeyEntry> {
  const reg = new Map<string, KeyEntry>()
  for (const facet of index.schema.facets) {
    if (facet.kind === 'enum') {
      const eidx = index.enums.get(facet.id)!
      const entry: KeyEntry = { facetId: facet.id, axis: 'enum', resolve: (r) => eidx.valueOfToken.get(normalizeToken(r)) ?? null }
      reg.set(normalizeToken(facet.token), entry)
      reg.set(normalizeToken(facet.param), entry)
    } else if (facet.kind === 'hierarchy') {
      const hidx = index.hierarchies.get(facet.id)!
      const parentEntry: KeyEntry = { facetId: facet.id, axis: 'parent', resolve: (r) => hidx.parentValueOfToken.get(normalizeToken(r)) ?? null }
      const childEntry: KeyEntry = { facetId: facet.id, axis: 'child', resolve: (r) => hidx.childValueOfToken.get(normalizeToken(r)) ?? null }
      reg.set(normalizeToken(facet.parent.token), parentEntry)
      reg.set(normalizeToken(facet.parent.param), parentEntry)
      reg.set(normalizeToken(facet.child.token), childEntry)
      reg.set(normalizeToken(facet.child.param), childEntry)
    }
    // dateRange tokens are entered via the panel's range control, not free text.
  }
  return reg
}

export interface ParsedQuery {
  /** A FilterState patch (text = residual free text) to merge into the current state. */
  additions: FilterState
  /** Tokens whose key was known but value did not resolve — surfaced, not applied. */
  unresolved: { key: string; value: string }[]
}

export function parseCommandInput<T>(index: SchemaIndex<T>, input: string): ParsedQuery {
  const reg = keyRegistry(index)
  const additions = emptyFilterState()
  const unresolved: { key: string; value: string }[] = []

  const consumed: [number, number][] = []
  for (const m of input.matchAll(TOKEN_RE)) {
    const key = m[1]!
    const value = m[2] ?? m[3] ?? ''
    const entry = reg.get(normalizeToken(key))
    if (!entry) continue                                   // unknown key -> treat as free text
    consumed.push([m.index!, m.index! + m[0].length])
    const resolved = entry.resolve(value)
    if (!resolved) { unresolved.push({ key, value }); continue }
    if (entry.axis === 'enum') {
      const cur = additions.enums[entry.facetId] ?? []
      if (!cur.includes(resolved)) additions.enums[entry.facetId] = [...cur, resolved]
    } else {
      const hv = additions.hierarchies[entry.facetId] ?? { parents: [], children: [] }
      if (entry.axis === 'parent') { if (!hv.parents.includes(resolved)) hv.parents = [...hv.parents, resolved] }
      else {
        if (!hv.children.includes(resolved)) hv.children = [...hv.children, resolved]
        const parent = index.hierarchies.get(entry.facetId)?.childParentOf.get(resolved)
        if (parent && !hv.parents.includes(parent)) hv.parents = [...hv.parents, parent]
      }
      additions.hierarchies[entry.facetId] = hv
    }
  }

  // Everything not consumed by a recognized token is free text.
  let free = ''
  let cursor = 0
  for (const [start, end] of consumed) { free += input.slice(cursor, start); cursor = end }
  free += input.slice(cursor)
  additions.text = free.trim().replace(/\s+/g, ' ')

  return { additions, unresolved }
}

// ─── Typeahead corpus (Fuse) ───────────────────────────────────────────────────────

export interface Suggestion {
  facetId: string
  axis: 'enum' | 'parent' | 'child'
  value: string
  label: string          // display text
  group: string          // dimension label, for grouping the dropdown
  token: string          // canonical token form (for the "key:value" hint)
  keywords: string[]     // Fuse search keys: label + token + aliases
}

/** Build the flat suggestion corpus from a schema's declared options. Entity-agnostic;
 *  the CommandBar constructs a Fuse index over `keywords`. */
export function buildSuggestionCorpus<T>(index: SchemaIndex<T>): Suggestion[] {
  const out: Suggestion[] = []
  for (const facet of index.schema.facets) {
    if (facet.kind === 'enum') {
      for (const o of facet.options) {
        out.push({
          facetId: facet.id, axis: 'enum', value: o.value, label: o.label, group: facet.label,
          token: `${facet.token}:${o.token ?? o.value}`, keywords: [o.label, o.token ?? o.value, ...(o.aliases ?? [])],
        })
      }
    } else if (facet.kind === 'hierarchy') {
      for (const p of facet.parents) {
        out.push({
          facetId: facet.id, axis: 'parent', value: p.value, label: p.label, group: facet.parent.label,
          token: `${facet.parent.token}:${p.token ?? p.value}`, keywords: [p.label, p.token ?? p.value, ...(p.aliases ?? [])],
        })
        for (const c of p.children) {
          out.push({
            facetId: facet.id, axis: 'child', value: c.value, label: c.label, group: `${p.label}`,
            token: `${facet.child.token}:${c.token ?? c.value}`, keywords: [c.label, c.token ?? c.value, ...(c.aliases ?? [])],
          })
        }
      }
    }
  }
  return out
}

/** Merge one accepted suggestion into a state (union). */
export function applySuggestion<T>(index: SchemaIndex<T>, state: FilterState, s: Suggestion): FilterState {
  const additions = emptyFilterState()
  additions.text = state.text
  if (s.axis === 'enum') {
    additions.enums[s.facetId] = [s.value]
  } else {
    const hv = { parents: [] as string[], children: [] as string[] }
    if (s.axis === 'parent') hv.parents = [s.value]
    else {
      hv.children = [s.value]
      const parent = index.hierarchies.get(s.facetId)?.childParentOf.get(s.value)
      if (parent) hv.parents = [parent]
    }
    additions.hierarchies[s.facetId] = hv
  }
  return additions   // caller merges via mergeStates
}
