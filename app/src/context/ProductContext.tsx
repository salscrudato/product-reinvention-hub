// All realtime data for a product workspace, subscribed once at the shell level.
// Every tab reads from this context rather than subscribing independently.
import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { adapter } from '../lib/backend'
import type {
  Product, Coverage, Rule, FormRule, RatingProgram,
  Form, LDTable, RTTable, Version, Comment,
} from '@pf/shared'
import { repairPersistedProgram } from '@pf/shared'

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
  // True when the load-bearing product-document subscription errored (permission / offline) —
  // distinct from "product not found" (a null doc). Lets the workspace show a recoverable
  // error instead of hanging on the skeleton forever. `retry` re-subscribes.
  error:           boolean
  retry:           () => void
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
  // Which subscriptions have delivered at least once — a SET of keys, not a tally.
  // A raw counter counted EVENTS: these are live subscriptions, so one chatty collection
  // firing repeatedly could reach TOTAL_SUBS on its own and flip `loading` to false while
  // coverages had not arrived yet — the "first visit shows nothing, going back shows it all"
  // symptom. Keying by collection makes re-delivery idempotent.
  const [resolved,      setResolved]      = useState<ReadonlySet<string>>(new Set())
  const [error,         setError]         = useState(false)
  const [reloadKey,     setReloadKey]     = useState(0)

  const SUB_KEYS = ['product', 'coverages', 'rules', 'formRules', 'ratingPrograms',
    'forms', 'ldTables', 'rtTables', 'versions', 'comments'] as const
  const TOTAL_SUBS = SUB_KEYS.length

  const inc = (key: typeof SUB_KEYS[number]) => setResolved(prev => {
    if (prev.has(key)) return prev            // same Set → no needless re-render
    const next = new Set(prev); next.add(key); return next
  })

  useEffect(() => {
    setResolved(new Set()); setError(false)
    const unsubs = [
      // Product document — the load-bearing subscription. A listener ERROR here (permission /
      // offline) flags `error` so the workspace shows a recoverable state instead of hanging
      // on the skeleton (a null doc, by contrast, is "not found" → the workspace redirects).
      adapter.db.subscribe<WithId<Product>>(`products/${pid}`, (d) => {
        if (!Array.isArray(d)) setProduct(d)
        inc('product')
      }, () => { setError(true); inc('product') }),
      // Sub-collections
      adapter.db.subscribe<WithId<Coverage>>(`products/${pid}/coverages`, (d) => {
        if (Array.isArray(d)) { setCoverages(d.sort((a,b) => (a.order??0)-(b.order??0))); inc('coverages') }
      }),
      adapter.db.subscribe<WithId<Rule>>(`products/${pid}/rules`, (d) => {
        if (Array.isArray(d)) { setRules(d); inc('rules') }
      }),
      adapter.db.subscribe<WithId<FormRule>>(`products/${pid}/formRules`, (d) => {
        if (Array.isArray(d)) { setFormRules(d); inc('formRules') }
      }),
      adapter.db.subscribe<WithId<RatingProgram>>(`products/${pid}/ratingPrograms`, (d) => {
        // Repair at the boundary: a program imported before the brain emitted canonical steps
        // persists steps with no `source`, and every downstream reader (evaluator, the grid
        // worksheet, RatingAlgorithm, the Excel export) reads `step.source.type`. One repair
        // here keeps them all on contract; it fixes SHAPE only and never invents a rate.
        if (Array.isArray(d)) { setRatingProgram(repairPersistedProgram(d[0] ?? null)); inc('ratingPrograms') }
      }),
      // Forms are a shared top-level library that can grow past the list cap once several
      // large products are imported (a single CORE import adds ~1359). Filter SERVER-SIDE by
      // productRefIds so we only ever load this product's forms — a client-side filter over the
      // whole collection would silently miss rows beyond MAX_LIST.
      adapter.db.subscribe<WithId<Form>>('forms', (d) => {
        if (Array.isArray(d)) {
          // Server already scoped to this product; keep the defensive filter as a belt-and-braces.
          setForms(d.filter(f => (f.productRefIds ?? []).includes(pid)))
          inc('forms')
        }
      }, undefined, { where: [{ field: 'productRefIds', op: 'array-contains', value: pid }] }),
      adapter.db.subscribe<WithId<LDTable> & { id: string }>('ldTables', (d) => {
        if (Array.isArray(d)) {
          const rec: Record<string, LDTable> = {}
          d.forEach(t => { rec[t.id] = t })
          setLdTables(rec); inc('ldTables')
        }
      }),
      adapter.db.subscribe<WithId<RTTable> & { id: string }>('rtTables', (d) => {
        if (Array.isArray(d)) {
          const rec: Record<string, RTTable> = {}
          d.forEach(t => { rec[t.id] = t })
          setRtTables(rec); inc('rtTables')
        }
      }),
      // Versions are read from the dedicated /db/versions endpoint (PCM-B) —
      // the where-filter names the product so the adapter can scope the read
      // (and the subscribe cache key stays per-product).
      adapter.db.subscribe<WithId<Version>>('versions', (d) => {
        if (Array.isArray(d)) {
          // Newest-first. `at` is a Firestore Timestamp (has toDate/seconds) after commit,
          // or a number/ISO string in tests — extract millis from all three so the audit
          // trail orders correctly (the old `instanceof Object ? 0` collapsed every
          // server Timestamp to 0, leaving the timeline effectively unsorted).
          const ms = (at: unknown): number => {
            if (at == null) return 0
            const o = at as { toDate?: () => Date; seconds?: number }
            if (typeof o.toDate === 'function') return o.toDate().getTime()
            if (typeof o.seconds === 'number') return o.seconds * 1000
            const n = Number(at); if (Number.isFinite(n)) return n
            const p = Date.parse(String(at)); return Number.isNaN(p) ? 0 : p
          }
          setVersions(d.filter(v => v.productId === pid).sort((a, b) => ms(b.at) - ms(a.at)))
          inc('versions')
        }
      }, undefined, { where: [{ field: 'productId', op: '==', value: pid }] }),
      adapter.db.subscribe<WithId<Comment>>('comments', (d) => {
        if (Array.isArray(d)) { setComments(d.filter(c => c.entityPath?.startsWith(`products/${pid}`))); inc('comments') }
      }),
    ]
    return () => { unsubs.forEach(u => u()); setResolved(new Set()) }
  }, [pid, reloadKey])

  const value = useMemo(() => ({
    pid, product, coverages, rules, formRules, ratingProgram,
    forms, ldTables, rtTables, versions, comments,
    loading: resolved.size < TOTAL_SUBS,
    error,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    retry: () => { setResolved(new Set()); setError(false); setReloadKey(k => k + 1) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pid, product, coverages, rules, formRules, ratingProgram, forms, ldTables, rtTables, versions, comments, resolved, error])

  return (
    <Ctx value={value}>
      {children}
    </Ctx>
  )
}

// useProductCtx lives in useProductCtx.ts to satisfy react/only-export-components
export { Ctx }
