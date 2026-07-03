// Public share view — fetches a read-only product snapshot via the share function.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adapter } from '../lib/backend'
import { Badge, StatusPill, LifecyclePill, Skeleton, Logo } from '../components/ui'
import type { Product, Coverage, Form } from '@pf/shared'

interface Snapshot {
  product:   Product & { id: string }
  coverages: (Coverage & { id: string })[]
  forms:     (Form & { id: string })[]
  expired:   false
}

export default function ShareView() {
  const { token } = useParams<{ token: string }>()
  const [data,    setData]    = useState<Snapshot | null>(null)
  const [expired, setExpired] = useState(false)
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    adapter.fns.call<{ token: string }, Snapshot | { expired: true }>(
      'getShareSnapshot', { token },
    )
      .then(result => {
        if ('expired' in result && result.expired) setExpired(true)
        else setData(result as Snapshot)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load share'))
      .finally(() => setLoading(false))
  }, [token])

  // Reflect the shared product in the tab title.
  useEffect(() => {
    const name = (data?.product as { name?: string } | undefined)?.name
    if (name) document.title = `${name} · Product Reinvention Hub`
    return () => { document.title = 'Product Reinvention Hub' }
  }, [data])

  if (loading) {
    return (
      <div className="min-h-svh bg-page flex items-center justify-center">
        <div className="flex flex-col gap-4 w-full max-w-2xl px-6">
          <Skeleton className="h-32 rounded-[16px]" />
          <Skeleton className="h-48 rounded-[16px]" />
        </div>
      </div>
    )
  }

  if (expired) {
    return (
      <div className="min-h-svh bg-page flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl font-bold text-text">Link expired</p>
          <p className="text-dim mt-2">This share link is no longer valid. Ask the owner to create a new one.</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-svh bg-page flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl font-bold text-text">Could not load</p>
          <p className="text-dim mt-2">{error || 'Share link not found.'}</p>
        </div>
      </div>
    )
  }

  const { product, coverages, forms } = data

  return (
    <div className="min-h-svh bg-page">
      {/* Header */}
      <header className="bg-surface px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2.5">
          <Logo size={24} rounded={6} />
          <span className="font-semibold text-sm text-text">Product Reinvention Hub</span>
        </div>
        <Badge label="Read-only snapshot" color="default" />
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 flex flex-col gap-6">
        {/* Product hero */}
        <div className="rounded-[16px] p-6" style={{ background: 'linear-gradient(135deg, rgba(192,38,211,.06), rgba(236,72,153,.04))', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <StatusPill status={product.status} />
            <LifecyclePill lifecycle={product.lifecycle} />
            {product.lob?.name && <Badge label={product.lob.name} color="blue" />}
          </div>
          <h1 className="text-2xl font-bold text-text">{product.name}</h1>
          {product.refId && <p className="text-sm font-mono text-dim mt-1">{product.refId}</p>}
          {product.description && <p className="text-sm text-dim mt-2">{product.description}</p>}
          <div className="flex gap-4 mt-3 text-sm text-dim">
            <span>{coverages.length} coverages</span>
            <span>{product.states?.length ?? 0} states</span>
            <span>{product.marketSegment}</span>
          </div>
        </div>

        {/* Coverages */}
        {coverages.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-text mb-3">Coverages</h2>
            <div className="flex flex-col gap-2">
              {coverages.filter(c => !c.parentId).map(cov => {
                const subs = coverages.filter(c => c.parentId === cov.refId)
                return (
                  <div key={cov.id} className="bg-surface rounded-[12px] p-4" style={{ border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">{cov.name}</span>
                      {cov.refId && <span className="text-xs font-mono text-faint">{cov.refId}</span>}
                      <Badge label={cov.requirement} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
                    </div>
                    {subs.length > 0 && (
                      <div className="ml-4 mt-2 flex flex-col gap-1">
                        {subs.map(s => (
                          <div key={s.id} className="flex items-center gap-2 text-sm text-dim">
                            <span>↳ {s.name}</span>
                            {s.refId && <span className="font-mono text-xs text-faint">{s.refId}</span>}
                            <Badge label={s.requirement} color="default" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Forms */}
        {forms.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-text mb-3">Forms ({forms.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {forms.map(form => (
                <div key={form.id} className="bg-surface rounded-[12px] px-4 py-3" style={{ border: '1px solid var(--color-border)' }}>
                  <p className="text-sm font-medium text-text">{form.name}</p>
                  <p className="text-xs font-mono text-faint mt-0.5">{form.number} · Ed. {form.edition}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="text-xs text-faint text-center pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          Read-only snapshot · Product Reinvention Hub · Expires 30 days from creation
        </footer>
      </main>
    </div>
  )
}
