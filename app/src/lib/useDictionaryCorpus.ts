// useDictionaryCorpus — loads the coverages + rules + forms + rating-step data the
// Data Dictionary needs to compute each term's "used in" back-references LIVE (never a
// persisted snapshot, so the links can't go stale). Products are watched in realtime;
// the heavier per-product coverage/rule/ratingProgram lists (plus the global forms) are
// re-fetched when the product set changes OR when the server-side invalidation hook bumps
// meta/dictionaryCorpusVersion (written on every entity change by invalidate.ts).
// All access is through the adapter seam — never firebase/* directly.
import { useEffect, useState } from 'react'
import { adapter } from './backend'
import { useLiveCollection, type LoadStatus } from './useLiveCollection'
import type { Coverage, Rule, Form, Product, RatingProgram, DictUsageCorpus } from '@pf/shared'

const EMPTY: DictUsageCorpus = { coverages: [], rules: [], forms: [], ratingSteps: [] }

export function useDictionaryCorpus(): { corpus: DictUsageCorpus; status: LoadStatus } {
  const products = useLiveCollection<Product>('products')
  const [corpus, setCorpus] = useState<DictUsageCorpus>(EMPTY)
  const [status, setStatus] = useState<LoadStatus>('loading')
  // Incremented by the meta/dictionaryCorpusVersion subscription so the fetch
  // re-runs when entity content changes (not just when the product set changes).
  const [corpusVersion, setCorpusVersion] = useState(0)

  // Subscribe to the server-side corpus-version bump written by invalidate.ts.
  useEffect(() => {
    const unsub = adapter.db.subscribe<{ v?: number; updatedAt: unknown }>(
      'meta',
      docs => {
        if (!Array.isArray(docs)) return
        const vDoc = (docs as Array<{ id?: string; v?: number }>)
          .find(d => d.id === 'dictionaryCorpusVersion')
        if (vDoc?.v !== undefined) setCorpusVersion(vDoc.v)
      },
    )
    return unsub
  }, [])

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
          const [covs, rules, rps] = await Promise.all([
            adapter.db.list<Coverage & { id: string }>(`products/${p.id}/coverages`),
            adapter.db.list<Rule & { id: string }>(`products/${p.id}/rules`),
            adapter.db.list<RatingProgram & { id: string }>(`products/${p.id}/ratingPrograms`),
          ])
          return { pid: p.id, covs, rules, rps }
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
          ratingSteps: per.flatMap(({ pid, rps }) => rps.flatMap(rp =>
            (rp.steps ?? []).map((s: { id: string; label: string }) => ({
              programRefId: rp.refId ?? rp.id, stepId: s.id, label: s.label,
              productId: pid, entityPath: `products/${pid}/ratingPrograms/${rp.id}`,
            }))
          )),
        })
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
    // `key` captures the product-id set + ready state; corpusVersion re-triggers on
    // server-side entity changes; items are derived from both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, products.status, corpusVersion])

  return { corpus, status }
}
