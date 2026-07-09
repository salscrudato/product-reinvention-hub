// usePortfolioInventory — loads the coverages + forms behind the inventory table and
// the product-framework hierarchy. The portfolio card view only needs the product
// docs, so this heavier per-product aggregate is fetched lazily (only while an
// inventory/hierarchy view is active) and re-fetched when the in-scope product set
// changes. Reads go through the adapter (never firebase/*), mirroring the portfolio
// export which loads the same shape.
import { useEffect, useState } from 'react'
import { adapter } from './backend'
import type { Coverage, Form } from '@pf/shared'
import type { WithId } from '../context/ProductContext'

export interface ProductInventory {
  coverages: WithId<Coverage>[]
  forms:     WithId<Form>[]
}

export interface PortfolioInventory {
  byProduct: Map<string, ProductInventory>
  loading:   boolean
  error:     string | null
}

/** Fetch coverages (per product) and forms (once, filtered by product) for the given
 *  products. A product's doc id equals its refId, and forms link back through
 *  `productRefIds` — so a form belongs to a product when either matches. */
export function usePortfolioInventory(
  products: WithId<{ refId: string | null }>[],
  enabled: boolean,
): PortfolioInventory {
  const [byProduct, setByProduct] = useState<Map<string, ProductInventory>>(new Map())
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  // A stable key over the in-scope product ids so we refetch only when the set moves.
  const ids = products.map(p => p.id)
  const key = enabled ? ids.slice().sort().join('|') : ''

  useEffect(() => {
    if (!enabled || ids.length === 0) {
      setLoading(false); setError(null)
      if (ids.length === 0) setByProduct(new Map())
      return
    }
    let cancelled = false
    setLoading(true); setError(null)
    ;(async () => {
      try {
        const allForms = await adapter.db.list<WithId<Form>>('forms')
        const entries = await Promise.all(products.map(async p => {
          const coverages = await adapter.db.list<WithId<Coverage>>(`products/${p.id}/coverages`)
          const refs = new Set([p.id, p.refId].filter(Boolean) as string[])
          const forms = allForms.filter(f => (f.productRefIds ?? []).some(r => refs.has(r)))
          return [p.id, { coverages, forms }] as const
        }))
        if (!cancelled) setByProduct(new Map(entries))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load inventory')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // `key` captures both `enabled` and the product-id set; products/ids are derived
    // from it each render, so they need not be listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { byProduct, loading, error }
}
