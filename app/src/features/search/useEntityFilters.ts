// useEntityFilters<T> — the one generic engine every tab reuses.
//
// The URL is the single source of truth: state is derived from the query params, every
// mutation reconciles then writes the params back, so every filtered view is instantly
// shareable and survives reload. The heavy lifting is pure (filterEngine); this hook is
// the thin React seam that memoizes it and syncs the URL.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FacetSchema, FilterState, ReconcileReport, UseEntityFiltersResult } from './facetTypes'
import { type SchemaIndex, createSchemaIndex } from './schemaIndex'
import { buildChips, detectUnknownValues, hasActiveFilters as hasActive, reconcileState, runEngine } from './filterEngine'
import * as ops from './stateOps'
import { ownedParamKeys, paramsToState, stateToParams } from './urlState'

/** Replace only the schema-owned params, preserving foreign ones (e.g. ?cov=, ?form=). */
function composeParams<T>(index: SchemaIndex<T>, current: URLSearchParams, state: FilterState): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of ownedParamKeys(index)) next.delete(key)
  for (const [key, value] of stateToParams(index, state)) next.append(key, value)
  return next
}

export function useEntityFilters<T>(entities: readonly T[], schema: FacetSchema<T>): UseEntityFiltersResult<T> {
  const [params, setParams] = useSearchParams()
  const [reconciliation, setReconciliation] = useState<ReconcileReport>({ dropped: [] })

  const index = useMemo(() => createSchemaIndex(schema), [schema])

  // Canonical, reconciled state derived from the URL.
  const state = useMemo(() => reconcileState(index, paramsToState(index, params)).state, [index, params])

  // Normalize a hand-edited / stale URL to its canonical serialization exactly once.
  // Safe against loops: state derives from params, and we only write when the string differs.
  useEffect(() => {
    const canonical = composeParams(index, params, state)
    if (canonical.toString() !== params.toString()) setParams(canonical, { replace: true })
  }, [index, params, state, setParams])

  const { results, counts } = useMemo(() => runEngine(index, entities, state), [index, entities, state])
  const unknownValues = useMemo(() => detectUnknownValues(index, entities), [index, entities])
  const activeChips = useMemo(() => buildChips(index, state), [index, state])

  const commit = useCallback((next: FilterState) => {
    const { state: reconciled, report } = reconcileState(index, next)
    setReconciliation(report)
    setParams((prev) => composeParams(index, prev, reconciled), { replace: true })
  }, [index, setParams])

  return {
    results,
    total: entities.length,
    counts,
    state,
    activeChips,
    unknownValues,
    reconciliation,
    hasActiveFilters: hasActive(state),

    setText:      useCallback((text) => commit(ops.setText(state, text)), [commit, state]),
    toggleEnum:   useCallback((facetId, value) => commit(ops.toggleEnum(state, facetId, value)), [commit, state]),
    toggleParent: useCallback((facetId, parent) => commit(ops.toggleParent(index, state, facetId, parent)), [commit, index, state]),
    toggleChild:  useCallback((facetId, child) => commit(ops.toggleChild(index, state, facetId, child)), [commit, index, state]),
    setDateRange: useCallback((facetId, range) => commit(ops.setDateRange(state, facetId, range)), [commit, state]),
    removeChip:   useCallback((chip) => commit(ops.removeChip(index, state, chip)), [commit, index, state]),
    clearFacet:   useCallback((facetId) => commit(ops.clearFacet(state, facetId)), [commit, state]),
    clearAll:     useCallback(() => commit(ops.clearAll()), [commit]),
    applyState:   useCallback((next) => commit(next), [commit]),
  }
}
