// CloneProductModal — start a draft from an existing product. Pick any product; we
// deep-copy its whole sub-tree into a fresh, isolated DRAFT (see lib/draft/cloneProduct
// — every write via mutate(), the source untouched) and stamp lineage so the draft
// always shows what it was cloned from. EDITOR/ADMIN only (guarded here and by the
// Firestore product-write rule the clone's mutate() hits).
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { adapter } from '../../lib/backend'
import { useUser } from '../../context/useUser'
import { Dialog, Button, Skeleton, RefChip, LifecyclePill } from '../ui'
import { IconSearch, IconCopy, IconSpinner, IconProduct } from '../ui/icons'
import { cloneProductToDraft, type CloneProgress } from '../../lib/draft/cloneProduct'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

interface Props { onClose: () => void; onCloned: (id: string) => void }

export function CloneProductModal({ onClose, onCloned }: Props) {
  const { user } = useUser()
  const canEdit = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const [products, setProducts] = useState<WithId<Product>[]>([])
  const [loading, setLoading]   = useState(true)
  const [query, setQuery]       = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [progress, setProgress] = useState<CloneProgress | null>(null)

  useEffect(() => {
    const unsub = adapter.db.subscribe<WithId<Product>>('products', d => {
      if (Array.isArray(d)) { setProducts(d); setLoading(false) }
    })
    return unsub
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Prefer launched products at the top (the portfolio you usually leverage), then
    // by name. Drafts are cloneable too, so they aren't hidden.
    const list = [...products].sort((a, b) =>
      (a.lifecycle === 'LAUNCHED' ? 0 : 1) - (b.lifecycle === 'LAUNCHED' ? 0 : 1) || a.name.localeCompare(b.name))
    return q ? list.filter(p => `${p.name} ${p.refId ?? ''} ${p.marketSegment}`.toLowerCase().includes(q)) : list
  }, [products, query])

  async function clone() {
    const source = products.find(p => p.id === selected)
    if (!source || !user) return
    const actor = { uid: user.uid, name: user.name ?? user.email ?? 'Unknown' }
    setProgress({ done: 0, total: 0, label: 'Starting…' })
    try {
      const res = await cloneProductToDraft(source, actor, setProgress)
      toast.success(`Cloned ${res.written} items into a new draft`)
      onCloned(res.productId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clone failed.')
      setProgress(null)
    }
  }

  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Dialog open title="Clone an existing product" onClose={onClose} width="max-w-xl">
      {!canEdit ? (
        <p className="text-sm text-danger">You need editor access to clone products.</p>
      ) : progress ? (
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-center gap-2 text-sm text-text">
            <IconSpinner size={16} className="animate-spin text-accent" aria-hidden="true" />
            Cloning {progress.done} of {progress.total}…
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-raised" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all duration-200" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--color-accent-bright), var(--color-accent-strong))' }} />
          </div>
          <p className="text-xs text-faint truncate">{progress.label}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Pick a product to leverage. We copy its coverages, rules, forms and rating program into a new
            <span className="font-medium text-text"> draft</span> — the original is never changed, and the draft records what it came from.
          </p>
          <div className="relative">
            <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
            <input
              className="w-full h-9 pl-9 pr-3 rounded-[9px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25 focus:border-accent"
              placeholder="Search products…" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search products to clone"
            />
          </div>

          <div className="flex flex-col gap-1.5 max-h-[46vh] overflow-y-auto -mx-1 px-1" role="radiogroup" aria-label="Product to clone">
            {loading ? (
              [1, 2, 3].map(i => <Skeleton key={i} className="h-14 rounded-[12px]" />)
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-dim">
                <IconProduct size={26} className="text-faint" aria-hidden="true" />
                <span className="text-sm">No products match.</span>
              </div>
            ) : visible.map(p => {
              const on = selected === p.id
              return (
                <button
                  key={p.id} type="button" role="radio" aria-checked={on}
                  onClick={() => setSelected(p.id)}
                  className={`flex items-center gap-3 rounded-[12px] p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${on ? 'bg-accent-soft' : 'bg-raised hover:bg-hover'}`}
                  style={{ border: `1px solid ${on ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}
                >
                  <span className="flex items-center justify-center w-4 h-4 rounded-full shrink-0"
                    style={{ border: `2px solid ${on ? 'var(--color-accent)' : 'var(--color-border-strong)'}` }}>
                    {on && <span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-accent)' }} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text truncate">{p.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {p.refId && <RefChip id={p.refId} />}
                      <span className="text-[11px] text-faint truncate">{p.marketSegment}</span>
                    </div>
                  </div>
                  <LifecyclePill lifecycle={p.lifecycle} />
                </button>
              )
            })}
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void clone()} disabled={!selected}>
              <IconCopy size={14} aria-hidden="true" />Clone to draft
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
