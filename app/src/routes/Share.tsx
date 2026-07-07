// Public share viewer — accessible without authentication.
// Reads from shares/{id} in Firestore (rules: allow read: if true).
// Shows a read-only snapshot of the product and its coverages at share time.
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { adapter } from '../lib/backend'
import { Logo } from '../components/ui'
import { Badge, Skeleton } from '../components/ui'
import { IconProduct, IconCoverage, IconForm, IconInfo } from '../components/ui/icons'
import type { Product, Coverage } from '@pf/shared'

interface ShareData {
  productId: string
  note:       string
  createdBy:  { uid: string; name: string }
  createdAt:  unknown
  expiresAt:  string
  snapshot:   {
    product:   Product & { id: string }
    coverages: (Coverage & { id: string })[]
  }
}

function fmt(iso: string) {
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) } catch { return iso }
}

export default function Share() {
  const { id } = useParams<{ id: string }>()
  const [data,    setData]    = useState<ShareData | null>(null)
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) { setError('Invalid share link.'); setLoading(false); return }
    adapter.db.get<ShareData>(`shares/${id}`)
      .then(d => {
        if (!d) { setError('Share link not found.'); return }
        if (d.expiresAt && new Date(d.expiresAt) < new Date()) { setError('This share link has expired.'); return }
        setData(d)
      })
      .catch(() => setError('Could not load this share link.'))
      .finally(() => setLoading(false))
  }, [id])

  return (
    <div className="min-h-svh bg-page">
      {/* Topbar */}
      <header className="flex items-center gap-3 h-14 px-6 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Logo size={24} rounded={6} />
        <span className="text-sm font-semibold text-text">Product Reinvention Hub</span>
        <span className="ml-2 text-xs text-faint">· Shared snapshot</span>
        <Link to="/sign-in" className="ml-auto text-xs text-accent hover:underline">Sign in →</Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        {loading && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-48 rounded-[14px]" />
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <IconInfo size={36} className="text-faint" />
            <p className="text-lg font-semibold text-text">{error}</p>
            <Link to="/" className="text-sm text-accent hover:underline">Go to homepage →</Link>
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-8">
            {/* Product header */}
            <div
              className="rounded-[16px] p-6"
              style={{ background: 'linear-gradient(135deg, rgba(139,31,224,.08) 0%, rgba(122,0,230,.06) 100%)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <IconProduct size={18} className="text-accent" />
                <span className="text-xs text-faint uppercase tracking-wide font-semibold">Product snapshot</span>
              </div>
              <h1 className="text-2xl font-bold text-text mb-1">{data.snapshot.product.name}</h1>
              <p className="text-sm text-dim mt-2">{data.snapshot.product.description}</p>

              <div className="flex flex-wrap gap-2 mt-4 text-xs text-faint">
                {data.note && <span className="bg-surface rounded-full px-3 py-1">{data.note}</span>}
                <span>Shared by {data.createdBy?.name}</span>
                <span>·</span>
                <span>Expires {fmt(data.expiresAt)}</span>
              </div>
            </div>

            {/* Coverages */}
            {data.snapshot.coverages.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <IconCoverage size={16} className="text-faint" />
                  <h2 className="text-sm font-semibold text-text">
                    Coverages ({data.snapshot.coverages.filter(c => !c.parentId).length} top-level)
                  </h2>
                </div>
                <div className="bg-surface rounded-[14px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                  {data.snapshot.coverages
                    .filter(c => !c.parentId)
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map(cov => {
                      const subs = data.snapshot.coverages.filter(c => c.parentId === cov.refId)
                      return (
                        <div key={cov.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                            <span className="text-sm font-medium text-text">{cov.name}</span>
                            <Badge label={cov.requirement} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
                            {cov.formNumbers?.length > 0 && (
                              <span className="flex items-center gap-1 text-xs text-faint ml-auto">
                                <IconForm size={12} />{cov.formNumbers.length} form{cov.formNumbers.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          {subs.length > 0 && (
                            <div className="pl-8 pb-2 flex flex-col gap-0.5">
                              {subs.map(s => (
                                <div key={s.id} className="flex items-center gap-2 px-4 py-1.5 text-sm text-dim">
                                  <span>{s.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            )}

            <p className="text-xs text-faint text-center">
              This is a read-only snapshot. Sign in for the live workspace.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
