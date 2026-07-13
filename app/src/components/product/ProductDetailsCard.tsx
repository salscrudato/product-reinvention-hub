// ProductDetailsCard — the editable identity of a product on the Overview tab. Every
// product field is editable here (EDITOR/ADMIN): name, line of business, market segment
// and description inline; footprint and status link to their dedicated editors (States
// tab, Promote flow). Writes go through the adapter's atomic mutate() with optimistic
// concurrency, so each edit is audited + versioned and shows up in the History trail.
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { ProductStatusPill } from '../ui'
import { InlineEdit } from '../ui/InlineEdit'
import { IconEdit } from '../ui/icons'
import { LOB_REGISTRY } from '@pf/shared'
import { MARKET_SEGMENTS } from '../../lib/insurance/vocab'

const LOB_OPTIONS = Object.values(LOB_REGISTRY).map(l => ({ refId: l.refId, name: l.name }))

export function ProductDetailsCard() {
  const { pid, product } = useProductCtx()
  const { user } = useUser()
  const navigate = useNavigate()
  const canEdit = canI(user, 'product:write')
  if (!product) return null
  const actor = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }

  async function save(data: Record<string, unknown>) {
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${pid}`, data,
        entityType: 'product', productId: pid, actor,
        expectedRev: (product as { rev?: number }).rev,
      })
      toast.success('Product updated')
    } catch (err) {
      if (err instanceof MutationConflictError) {
        conflictToast({})
      } else {
        toast.error('Update failed')
      }
      throw err   // keep the inline editor open so the edit isn't lost
    }
  }

  const stateCount = product.states?.length ?? 0
  const footprint = product.allStates ? 'All states' : `${stateCount} state${stateCount === 1 ? '' : 's'}`

  return (
    <section className="rounded-[16px] overflow-hidden bg-surface" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <h2 className="text-sm font-semibold text-text">Product details</h2>
        <p className="text-[11px] text-faint">{canEdit ? 'Every field is editable — changes are versioned in History.' : 'Read-only — an EDITOR or ADMIN can change these fields.'}</p>
      </div>

      <dl className="divide-y divide-[var(--color-border)]">
        <Row label="Name">
          <InlineEdit value={product.name} canEdit={canEdit} ariaLabel="product name" placeholder="Product name"
            className="font-medium" onSave={v => save({ name: v })} />
        </Row>

        <Row label="Line of business">
          {canEdit ? (
            <select value={product.lob?.refId ?? ''} aria-label="Line of business"
              onChange={e => { const l = LOB_OPTIONS.find(o => o.refId === e.target.value); if (l) void save({ lob: { refId: l.refId, name: l.name } }) }}
              className="h-8 px-2.5 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25">
              {!LOB_OPTIONS.some(o => o.refId === product.lob?.refId) && product.lob?.name && (
                <option value={product.lob.refId ?? ''}>{product.lob.name}</option>
              )}
              {LOB_OPTIONS.map(o => <option key={o.refId} value={o.refId}>{o.name}</option>)}
            </select>
          ) : (
            <span className="text-text">{product.lob?.name ?? '—'}</span>
          )}
        </Row>

        <Row label="Market segment">
          {canEdit ? (
            <select value={product.marketSegment ?? ''} aria-label="Market segment"
              onChange={e => void save({ marketSegment: e.target.value })}
              className="h-8 px-2.5 rounded-[8px] bg-surface border border-border-strong text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent/25">
              {!MARKET_SEGMENTS.includes(product.marketSegment) && product.marketSegment && (
                <option value={product.marketSegment}>{product.marketSegment}</option>
              )}
              {MARKET_SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ) : (
            <span className="text-text">{product.marketSegment || '—'}</span>
          )}
        </Row>

        <Row label="Description" align="start">
          <InlineEdit value={product.description ?? ''} canEdit={canEdit} ariaLabel="product description" multiline
            placeholder="Describe this product…" emptyLabel="No description yet"
            className="text-dim leading-relaxed" onSave={v => save({ description: v })} />
        </Row>

        <Row label="Footprint">
          <div className="flex items-center gap-2">
            <span className="text-text tnum">{footprint}</span>
            {canEdit && (
              <button onClick={() => navigate(`/app/products/${pid}/states`)}
                className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[6px]">
                <IconEdit size={12} aria-hidden="true" />Edit states
              </button>
            )}
          </div>
        </Row>

        <Row label="Status">
          <div className="flex items-center gap-2">
            <ProductStatusPill lifecycle={product.lifecycle} />
            {canEdit && product.lifecycle !== 'LAUNCHED' && (
              <span className="text-[12px] text-faint">Advance via Promote</span>
            )}
          </div>
        </Row>
      </dl>
    </section>
  )
}

function Row({ label, children, align = 'center' }: { label: string; children: React.ReactNode; align?: 'center' | 'start' }) {
  return (
    <div className={`grid grid-cols-[130px_1fr] gap-3 px-5 py-3 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <dt className="text-[12px] font-medium text-faint uppercase tracking-[.05em]">{label}</dt>
      <dd className="text-sm min-w-0">{children}</dd>
    </div>
  )
}
