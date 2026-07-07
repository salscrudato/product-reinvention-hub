// useDictionaryCorpus — loads the coverages + rules + forms the Data Dictionary needs to
// compute each term's "used in" back-references LIVE (never a persisted snapshot, so the
// links can't go stale). Products are watched in realtime; the heavier per-product
// coverage/rule lists (plus the global forms) are re-fetched when the product set changes.
// All access is through the adapter seam — never firebase/* directly.
import { useEffect, useState } from 'react'
import { adapter } from './backend'
import { useLiveCollection, type LoadStatus } from './useLiveCollection'
import type { Coverage, Rule, Form, Product, DictUsageCorpus } from '@pf/shared'

const EMPTY: DictUsageCorpus = { coverages: [], rules: [], forms: [] }

export function useDictionaryCorpus(): { corpus: DictUsageCorpus; status: LoadStatus } {
  const products = useLiveCollection<Product>('products')
  const [corpus, setCorpus] = useState<DictUsageCorpus>(EMPTY)
  const [status, setStatus] = useState<LoadStatus>('loading')

  // Stable key over the in-scope product ids so we refetch only when the set moves.
  const ids = products.items.map(p => p.id)
  const key = products.status === 'ready' ? ids.slice().sort().join('|') : ''

  useEffect(() => {
    if (products.status === 'error') { setStatus('error'); return }
    if (products.status !== 'ready') { setStatus('loading'); return }
    if (ids.length === 0) { setCorpus(EMPTY); setStatus('ready'); return }

    let cancelled = false
    setStatus('loading')
    ;(async () => {
      try {
        const forms = await adapter.db.list<Form & { id: string }>('forms')
        const per = await Promise.all(products.items.map(async p => {
          const [covs, rules] = await Promise.all([
            adapter.db.list<Coverage & { id: string }>(`products/${p.id}/coverages`),
            adapter.db.list<Rule & { id: string }>(`products/${p.id}/rules`),
          ])
          return { pid: p.id, covs, rules }
        }))
        if (cancelled) return
        setCorpus({
          coverages: per.flatMap(({ pid, covs }) => covs.map(c => ({
            refId: c.refId, name: c.name, terms: c.terms,
            productId: pid, entityPath: `products/${pid}/coverages/${c.id}`,
          }))),
          rules: per.flatMap(({ pid, rules }) => rules.map(r => ({
            refId: r.refId, condition: r.condition, outcome: r.outcome, subCategory: r.subCategory,
            productId: pid, entityPath: `products/${pid}/rules/${r.id}`,
          }))),
          forms: forms.map(f => ({
            number: f.number, name: f.name, description: f.description,
            dynamicFields: f.dynamicFields, productRefIds: f.productRefIds,
            entityPath: `forms/${f.id}`,
          })),
        })
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
    // `key` captures the product-id set + ready state; items are derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, products.status])

  return { corpus, status }
}
