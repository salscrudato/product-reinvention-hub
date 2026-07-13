// PromoteDraftDialog — the ONLY path by which a draft becomes a published product.
// Promotion flips lifecycle → LAUNCHED (status ACTIVE, review APPROVED) on the product
// doc via a single adapter.db.mutate() update, guarded by:
//   • Role: EDITOR/ADMIN only (hidden for VIEWER here; enforced server-side by the
//     Firestore product-write rule — both sides, always).
//   • A TYPED confirmation: the user must type the product's exact name. Nothing is
//     written until it matches, so a draft can never slip into the portfolio by a
//     stray click.
//   • Optimistic concurrency: expectedRev guards against promoting a stale draft.
// Because no other surface writes lifecycle:'LAUNCHED', this dialog is the single,
// audited gate between the Drafts workbench and the published Products portfolio.
import { useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { Dialog, Button } from '../ui'
import { IconSpinner, IconArrowUp, IconWarning } from '../ui/icons'
import { LineageBadge } from './LineageBadge'
import type { Product } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

interface Props {
  product: WithId<Product>
  actor:   { uid: string; name: string }
  onClose: () => void
  onPromoted?: (id: string) => void
}

export function PromoteDraftDialog({ product, actor, onClose, onPromoted }: Props) {
  const [typed, setTyped]   = useState('')
  const [busy, setBusy]     = useState(false)
  // A malformed / partially-imported draft may lack a name; fall back to refId/id so the
  // dialog never crashes and still gates promotion behind a typed confirmation.
  const target = (product.name ?? product.refId ?? product.id ?? '').trim()
  const displayName = target || 'this draft'
  const matches = target.length > 0 && typed.trim() === target

  async function promote() {
    if (!matches || busy) return
    setBusy(true)
    try {
      await adapter.db.mutate({
        op: 'update', path: `products/${product.id}`, entityType: 'product', productId: product.id, actor,
        data: { lifecycle: 'LAUNCHED', status: 'ACTIVE', reviewStatus: 'APPROVED' },
        expectedRev: product.rev,
      })
      toast.success(`${displayName} promoted to the portfolio`)
      onPromoted?.(product.id)
      onClose()
    } catch (err) {
      if (err instanceof MutationConflictError) {
        // No open editor to reload into — closing returns to the live-subscribed product view.
        conflictToast({ discard: onClose })
      } else {
        toast.error(err instanceof Error ? err.message : 'Promotion failed.')
      }
      setBusy(false)
    }
  }

  return (
    <Dialog open title="Promote to published product" onClose={onClose} width="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5 rounded-[12px] p-3.5" style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-border)' }}>
          <IconArrowUp size={16} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-dim">
            Promoting moves <span className="font-medium text-text">{displayName}</span> out of Drafts and into the
            published <span className="font-medium text-text">Products</span> portfolio, where it counts toward the
            portfolio and is visible to everyone. This is the only way a draft becomes published.
          </p>
        </div>

        {product.lineage && <LineageBadge lineage={product.lineage} variant="full" />}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="promote-confirm" className="text-sm text-dim">
            Type the product name <span className="font-mono text-text">{target}</span> to confirm:
          </label>
          <input
            id="promote-confirm"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && matches) void promote() }}
            autoComplete="off"
            aria-invalid={typed.length > 0 && !matches}
            placeholder={target}
            className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
            style={{ borderColor: typed.length > 0 && !matches ? 'var(--color-danger)' : 'var(--color-border-strong)' }}
          />
          {typed.length > 0 && !matches && (
            <span className="flex items-center gap-1 text-[11px] text-danger">
              <IconWarning size={12} aria-hidden="true" /> Doesn&apos;t match — promotion stays disabled.
            </span>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void promote()} disabled={!matches || busy}>
            {busy ? <IconSpinner size={14} className="animate-spin" aria-hidden="true" /> : <IconArrowUp size={14} aria-hidden="true" />}
            Promote to published
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
