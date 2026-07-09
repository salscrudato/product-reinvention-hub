// LLM fallback for the global command bar — the ONLY LLM touchpoint in this feature, and
// it is off by default (VITE_SEARCH_LLM !== 'true'). It runs only after deterministic
// tokens AND cross-entity joins have failed.
//
// Binding invariants (CLAUDE.md) override the original brief here: the Anthropic call
// lives server-side in functions/ (never the browser) and uses claude-sonnet-5 (never a
// browser-side model id). The browser calls the `interpretSearch` callable through the
// adapter and receives a filter SPEC — never a filtered list. We then validate every
// value in that spec against the real vocabularies and discard anything unknown, so a
// hallucinated facet can never silently hide entities. The caller applies the result as
// visible, editable chips (by navigating to the tab with the filter in the URL); the
// model output never bypasses that surface.

import { adapter } from '../../lib/backend'
import type { FilterState } from './facetTypes'
import { emptyFilterState } from './facetTypes'
import { type SchemaIndex, normalizeToken } from './schemaIndex'

export type InterpretEntity = 'rule' | 'coverage' | 'form'

/** Only the lookup maps are needed to validate a spec — not the T-typed accessors — so
 *  this accepts a structural subset of SchemaIndex and stays entity-agnostic. */
export type ValidationIndex = Pick<SchemaIndex<unknown>, 'enums' | 'hierarchies'>

export interface InterpretedResult {
  entityType:  InterpretEntity
  state:       FilterState
  explanation: string
}

interface RawSpec {
  entityType?:  unknown
  enums?:       Record<string, unknown>
  hierarchies?: Record<string, unknown>
  text?:        unknown
  explanation?: unknown
}

/** Feature flag — off by default. The global bar only offers "Interpret with AI" when this
 *  is explicitly enabled in the environment. */
export const SEARCH_LLM_ENABLED: boolean = import.meta.env.VITE_SEARCH_LLM === 'true'

/** Validate a raw model spec against the real vocabularies. Unknown facet ids and unknown
 *  values are dropped; returns null when nothing valid remains (degrade gracefully). */
export function validateSpec(raw: RawSpec, indexes: Record<InterpretEntity, ValidationIndex>): InterpretedResult | null {
  const entityType = raw?.entityType
  if (entityType !== 'rule' && entityType !== 'coverage' && entityType !== 'form') return null
  const index = indexes[entityType]
  const state = emptyFilterState()

  if (typeof raw.text === 'string') state.text = raw.text.trim().slice(0, 120)

  if (raw.enums && typeof raw.enums === 'object') {
    for (const [facetId, vals] of Object.entries(raw.enums)) {
      const eidx = index.enums.get(facetId)
      if (!eidx || !Array.isArray(vals)) continue
      const kept: string[] = []
      for (const v of vals) {
        if (typeof v !== 'string') continue
        const canon = eidx.valueOfToken.get(normalizeToken(v))
        if (canon && !kept.includes(canon)) kept.push(canon)
      }
      if (kept.length) state.enums[facetId] = kept
    }
  }

  if (raw.hierarchies && typeof raw.hierarchies === 'object') {
    for (const [facetId, val] of Object.entries(raw.hierarchies)) {
      const hidx = index.hierarchies.get(facetId)
      if (!hidx || !val || typeof val !== 'object') continue
      const v = val as { parents?: unknown; children?: unknown }
      const parents = new Set<string>()
      const children = new Set<string>()
      if (Array.isArray(v.parents)) for (const p of v.parents) {
        if (typeof p === 'string') { const c = hidx.parentValueOfToken.get(normalizeToken(p)); if (c) parents.add(c) }
      }
      if (Array.isArray(v.children)) for (const ch of v.children) {
        if (typeof ch === 'string') {
          const c = hidx.childValueOfToken.get(normalizeToken(ch))
          if (c) { children.add(c); const par = hidx.childParentOf.get(c); if (par) parents.add(par) }
        }
      }
      if (parents.size || children.size) state.hierarchies[facetId] = { parents: [...parents], children: [...children] }
    }
  }

  const empty = !state.text && !Object.keys(state.enums).length && !Object.keys(state.hierarchies).length
  if (empty) return null
  return { entityType, state, explanation: typeof raw.explanation === 'string' ? raw.explanation : 'Interpreted your query into the filters below.' }
}

/** Ask the server-side interpreter for a filter spec, then validate it locally. Returns
 *  null on any API error, malformed response, or empty interpretation. */
export async function interpretQuery(query: string, indexes: Record<InterpretEntity, ValidationIndex>): Promise<InterpretedResult | null> {
  try {
    const raw = await adapter.fns.call<{ query: string }, RawSpec>('interpretSearch', { query })
    return validateSpec(raw ?? {}, indexes)
  } catch {
    return null
  }
}
