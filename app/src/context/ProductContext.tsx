// All realtime data for a product workspace, subscribed once at the shell level.
// Every tab reads from this context rather than subscribing independently.
import { createContext, useEffect, useState, type ReactNode } from 'react'
import { adapter } from '../lib/backend'
import type {
  Product, Coverage, Rule, FormRule, RatingProgram,
  Form, LDTable, RTTable, Version, Comment,
} from '@pf/shared'

export type WithId<T> = T & { id: string }

export interface ProductContextValue {
  pid:             string
  product:         WithId<Product> | null
  coverages:       WithId<Coverage>[]
  rules:           WithId<Rule>[]
  formRules:       WithId<FormRule>[]
  ratingProgram:   WithId<RatingProgram> | null
  forms:           WithId<Form>[]           // global forms filtered by productRefIds
  ldTables:        Record<string, LDTable>
  rtTables:        Record<string, RTTable>
  versions:        WithId<Version>[]        // all versions for this product
  comments:        WithId<Comment>[]
  loading:         boolean
}

const Ctx = createContext<ProductContextValue | null>(null)

export function ProductProvider({ pid, children }: { pid: string; children: ReactNode }) {
  const [product,       setProduct]       = useState<WithId<Product> | null>(null)
  const [coverages,     setCoverages]     = useState<WithId<Coverage>[]>([])
  const [rules,         setRules]         = useState<WithId<Rule>[]>([])
  const [formRules,     setFormRules]     = useState<WithId<FormRule>[]>([])
  const [ratingProgram, setRatingProgram] = useState<WithId<RatingProgram> | null>(null)
  const [forms,         setForms]         = useState<WithId<Form>[]>([])
  const [ldTables,      setLdTables]      = useState<Record<string, LDTable>>({})
  const [rtTables,      setRtTables]      = useState<Record<string, RTTable>>({})
  const [versions,      setVersions]      = useState<WithId<Version>[]>([])
  const [comments,      setComments]      = useState<WithId<Comment>[]>([])
  const [loaded,        setLoaded]        = useState(0)   // count resolved subscriptions

  const TOTAL_SUBS = 10

  function inc() { setLoaded(n => Math.min(n + 1, TOTAL_SUBS)) }

  useEffect(() => {
    setLoaded(0)
    const unsubs = [
      // Product document
      adapter.db.subscribe<WithId<Product>>(`products/${pid}`, (d) => {
        if (!Array.isArray(d)) setProduct(d)
        inc()
      }),
      // Sub-collections
      adapter.db.subscribe<WithId<Coverage>>(`products/${pid}/coverages`, (d) => {
        if (Array.isArray(d)) { setCoverages(d.sort((a,b) => (a.order??0)-(b.order??0))); inc() }
      }),
      adapter.db.subscribe<WithId<Rule>>(`products/${pid}/rules`, (d) => {
        if (Array.isArray(d)) { setRules(d); inc() }
      }),
      adapter.db.subscribe<WithId<FormRule>>(`products/${pid}/formRules`, (d) => {
        if (Array.isArray(d)) { setFormRules(d); inc() }
      }),
      adapter.db.subscribe<WithId<RatingProgram>>(`products/${pid}/ratingPrograms`, (d) => {
        if (Array.isArray(d)) { setRatingProgram(d[0] ?? null); inc() }
      }),
      // Global collections (small — filter client-side)
      adapter.db.subscribe<WithId<Form>>('forms', (d) => {
        if (Array.isArray(d)) {
          setForms(d.filter(f => (f.productRefIds ?? []).includes(pid) || (f.productRefIds ?? []).some(r => r === pid)))
          inc()
        }
      }),
      adapter.db.subscribe<WithId<LDTable> & { id: string }>('ldTables', (d) => {
        if (Array.isArray(d)) {
          const rec: Record<string, LDTable> = {}
          d.forEach(t => { rec[t.id] = t })
          setLdTables(rec); inc()
        }
      }),
      adapter.db.subscribe<WithId<RTTable> & { id: string }>('rtTables', (d) => {
        if (Array.isArray(d)) {
          const rec: Record<string, RTTable> = {}
          d.forEach(t => { rec[t.id] = t })
          setRtTables(rec); inc()
        }
      }),
      adapter.db.subscribe<WithId<Version>>('versions', (d) => {
        if (Array.isArray(d)) {
          setVersions(d.filter(v => v.productId === pid).sort((a,b) => {
            const ta = a.at instanceof Object ? 0 : Number(a.at)
            const tb = b.at instanceof Object ? 0 : Number(b.at)
            return tb - ta
          }))
          inc()
        }
      }),
      adapter.db.subscribe<WithId<Comment>>('comments', (d) => {
        if (Array.isArray(d)) { setComments(d.filter(c => c.entityPath?.startsWith(`products/${pid}`))); inc() }
      }),
    ]
    return () => { unsubs.forEach(u => u()); setLoaded(0) }
  }, [pid])

  return (
    <Ctx value={{
      pid, product, coverages, rules, formRules, ratingProgram,
      forms, ldTables, rtTables, versions, comments,
      loading: loaded < TOTAL_SUBS,
    }}>
      {children}
    </Ctx>
  )
}

// useProductCtx lives in useProductCtx.ts to satisfy react/only-export-components
export { Ctx }
