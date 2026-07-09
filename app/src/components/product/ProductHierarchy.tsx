// ProductHierarchy — the product-framework tree: Product → LOB → Coverage →
// Sub-Coverage. Every sub-coverage renders nested under its parent (parent always
// visible); a coverage whose parentId doesn't resolve is collected under an explicit
// "Unlinked endorsements" branch rather than shown as a phantom top-level coverage or
// dropped — so the view can present no orphan. It is read-only navigation: it never
// moves or deletes a coverage, so it cannot create an orphan either (the parentId
// integrity that governs edits lives in the Coverages editor). The product node
// exposes all five detail views (Coverages · Pricing · Forms · States · Rules) and
// each coverage deep-links into its Coverages / Forms / Rules detail.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  buildCoverageTree, resolveLob, productSegments,
  type Coverage, type Form, type Product, type SegmentAxisId, type CoverageNode,
} from '@pf/shared'
import { Badge, ProductStatusPill, Skeleton, EmptyState } from '../ui'
import {
  IconChevronDown, IconChevronRight, IconLayers, IconWarning, IconAlertCircle,
  IconCoverage, IconPricing, IconForm, IconStates, IconRule, IconEndorsement,
} from '../ui/icons'
import type { WithId } from '../../context/ProductContext'
import type { ProductInventory } from '../../lib/usePortfolioInventory'

const DETAIL_TABS = [
  { key: 'coverages', label: 'Coverages', Icon: IconCoverage },
  { key: 'pricing',   label: 'Pricing',   Icon: IconPricing  },
  { key: 'forms',     label: 'Forms',     Icon: IconForm     },
  { key: 'states',    label: 'States',    Icon: IconStates   },
  { key: 'rules',     label: 'Rules',     Icon: IconRule     },
] as const

interface ProductHierarchyProps {
  products:  WithId<Product>[]
  byProduct: Map<string, ProductInventory>
  loading:   boolean
  error:     string | null
  groupBy:   SegmentAxisId | 'none'
}

function groupLabelFor(product: WithId<Product>, groupBy: SegmentAxisId | 'none'): string {
  if (groupBy === 'none') return ''
  const seg = productSegments(product)
  return groupBy === 'vertical' ? seg.vertical : groupBy === 'family' ? seg.family : (seg.marketSegments[0] ?? '—')
}

export function ProductHierarchy({ products, byProduct, loading, error, groupBy }: ProductHierarchyProps) {
  if (loading) return <div className="flex flex-col gap-3">{[1, 2].map(i => <Skeleton key={i} className="h-40 rounded-[16px]" />)}</div>
  if (error) {
    return (
      <div className="flex items-center gap-2.5 rounded-[12px] px-4 py-3 text-sm" style={{ background: 'var(--color-danger-soft)', border: '1px solid var(--color-danger-line)' }}>
        <IconAlertCircle size={16} className="text-danger shrink-0" aria-hidden="true" />
        <span className="text-danger">Couldn't load the framework — {error}</span>
      </div>
    )
  }
  if (products.length === 0) {
    return <EmptyState icon={<IconLayers size={32} />} title="No products to map" description="No products match the current filters." compact />
  }

  // Partition into segment groups, preserving encounter order.
  const groups = new Map<string, WithId<Product>[]>()
  for (const p of products) {
    const label = groupLabelFor(p, groupBy)
    const arr = groups.get(label) ?? []
    arr.push(p); groups.set(label, arr)
  }

  return (
    <div className="flex flex-col gap-6">
      {[...groups.entries()].map(([label, ps]) => (
        <section key={label || '_'} className="flex flex-col gap-3">
          {groupBy !== 'none' && (
            <div className="flex items-center gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-[.09em] text-accent">{label}</h3>
              <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
              <span className="text-[11px] text-faint tnum">{ps.length}</span>
            </div>
          )}
          {ps.map(p => (
            <ProductTree key={p.id} product={p} inv={byProduct.get(p.id)} />
          ))}
        </section>
      ))}
    </div>
  )
}

function ProductTree({ product, inv }: { product: WithId<Product>; inv: ProductInventory | undefined }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const go = (sub: string) => navigate(`/app/products/${product.id}/${sub}`)

  const lob = resolveLob(product)
  const seg = productSegments(product)
  const coverages = inv?.coverages ?? []
  const forms = inv?.forms ?? []
  const { roots, orphans } = buildCoverageTree<WithId<Coverage>, WithId<Form>>(coverages, forms)

  return (
    <div className="bg-surface rounded-[16px] overflow-hidden transition-shadow hover:shadow-[var(--shadow-card)]" style={{ border: '1px solid var(--color-border)' }}>
      {/* Brand rail */}
      <span aria-hidden="true" className="block h-[3px] w-full"
        style={{ background: 'linear-gradient(90deg, var(--color-accent-bright) 0%, var(--color-accent-strong) 55%, transparent 100%)' }} />
      {/* Product node */}
      <div className="flex items-start gap-3 p-4">
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? `Collapse ${product.name}` : `Expand ${product.name}`}
          className="mt-0.5 w-6 h-6 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent shrink-0">
          {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        </button>
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => go('overview')}
              className="font-semibold text-[15px] text-text hover:text-accent transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[4px]">
              {product.name}
            </button>
            <ProductStatusPill lifecycle={product.lifecycle} />
          </div>
          {/* Detail entry points — all five detail views are one click away */}
          <div className="flex items-center gap-1 flex-wrap">
            {DETAIL_TABS.map(({ key, label, Icon }) => (
              <button key={key} onClick={() => go(key)} aria-label={`${product.name} — ${label}`}
                className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-[8px] bg-raised text-dim hover:bg-accent-soft hover:text-accent transition-colors text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                <Icon size={13} aria-hidden="true" />{label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4">
          {/* LOB node */}
          <div className="ml-3 pl-4 border-l" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-2 py-1.5 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-[.07em] text-faint">LOB</span>
              <span className="text-sm font-medium text-text">{lob.displayName}</span>
              <Badge label={seg.vertical} color="blue" />
              <Badge label={seg.family} color="purple" />
            </div>

            {/* Coverage tree */}
            <ul role="group" aria-label={`${product.name} coverages`} className="mt-1 flex flex-col">
              {roots.length === 0 && orphans.length === 0 && (
                <li className="text-sm text-faint py-2">No coverages yet.</li>
              )}
              {roots.map(node => (
                <CoverageBranch key={node.coverage.id} node={node} productId={product.id} depth={0} />
              ))}
            </ul>

            {/* Orphaned endorsements — surfaced explicitly, never as top-level coverages */}
            {orphans.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[.07em] text-warn">
                  <IconWarning size={12} aria-hidden="true" /> Unlinked endorsements
                </div>
                <ul role="group" aria-label="Unlinked endorsements" className="mt-1 flex flex-col">
                  {orphans.map(node => (
                    <CoverageBranch key={node.coverage.id} node={node} productId={product.id} depth={0} orphan />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CoverageBranch({ node, productId, depth, orphan = false }: {
  node: CoverageNode<WithId<Coverage>, WithId<Form>>; productId: string; depth: number; orphan?: boolean
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)
  const { coverage, forms, children } = node
  const ref = coverage.refId ?? coverage.id
  const covLink = (tab: string) => navigate(`/app/products/${productId}/${tab}?cov=${encodeURIComponent(ref)}`)
  const hasChildren = children.length > 0

  return (
    <li className="border-l pl-4 -ml-px" style={{ borderColor: 'var(--color-border)' }}>
      <div className="group flex items-center gap-2 py-1.5">
        {hasChildren ? (
          <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={open ? `Collapse ${coverage.name}` : `Expand ${coverage.name}`}
            className="w-5 h-5 rounded-[6px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent shrink-0">
            {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-5 h-5 flex items-center justify-center shrink-0" aria-hidden="true">
            <span className="w-1 h-1 rounded-full" style={{ background: 'var(--color-border-strong)' }} />
          </span>
        )}

        {(depth > 0 || orphan) && <IconEndorsement size={13} className="text-faint shrink-0" aria-hidden="true" />}

        <button onClick={() => covLink('coverages')}
          className="text-sm text-text hover:text-accent transition-colors text-left truncate focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[4px]"
          title={`Open ${coverage.name}`}>
          {coverage.name}
        </button>
        {orphan && (
          <span className="inline-flex items-center gap-1 text-[11px] text-warn" title={`Parent ${coverage.parentId ?? 'unknown'} was not found`}>
            <IconWarning size={11} aria-hidden="true" /> parent {coverage.parentId ?? '?'} missing
          </span>
        )}

        {/* Per-coverage deep links + at-a-glance form count */}
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button onClick={() => covLink('forms')} className="text-[11px] px-1.5 py-0.5 rounded-[6px] text-faint hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">Forms</button>
          <button onClick={() => covLink('rules')} className="text-[11px] px-1.5 py-0.5 rounded-[6px] text-faint hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">Rules</button>
        </div>
        {forms.length > 0 && (
          <span className="text-[11px] text-faint tnum shrink-0" title={forms.map(f => f.number).join(', ')}>
            {forms.length} form{forms.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {hasChildren && open && (
        <ul role="group" aria-label={`${coverage.name} sub-coverages`} className="flex flex-col">
          {children.map(child => (
            // A child's parent (this node) is present, so it is never itself "unlinked"
            // even when this node is the orphan root — only the top orphan flags it.
            <CoverageBranch key={child.coverage.id} node={child} productId={productId} depth={depth + 1} orphan={false} />
          ))}
        </ul>
      )}
    </li>
  )
}
