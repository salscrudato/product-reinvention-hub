// TaskLensPanel — the contextual artifact lens inside the task-detail slide-over. Rendered
// ONLY when the task's project links a product (wrapped in ProductProvider by the drawer),
// it reads the live product context and shows exactly the one lens resolveTaskLens picked:
// rating + live premium, forms + filing status, the coverage tree, the rule set, or a
// generic overview. refIds and form numbers are monospace chips that deep-link into the
// existing product editors. Every branch has an honest empty state — never a blank panel.
import { useMemo } from 'react'
import { evaluate, resolveLob, resolveRatingKit } from '@pf/shared'
import { useProductCtx } from '../../../context/useProductCtx'
import { Badge, Skeleton } from '../../ui'
import { IconArrowRight, IconExternalLink } from '../../ui/icons'
import { productDeepLink, type LensDescriptor } from './taskLens'

// ─── Monospace deep-link chip — the load-bearing refId / form-number handle ─────────
function LinkChip({ label, to, onNavigate, tone = 'default' }: {
  label: string; to: string; onNavigate: (to: string) => void; tone?: 'default' | 'accent'
}) {
  const toneCls = tone === 'accent' ? 'bg-accent-soft text-accent' : 'bg-raised text-dim'
  return (
    <button type="button" onClick={() => onNavigate(to)} title={`Open ${label}`}
      className={`inline-flex items-center rounded-[6px] px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none tracking-[-.01em] ${toneCls} cursor-pointer hover:bg-accent-soft hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent`}>
      {label}
    </button>
  )
}

function TabLink({ label, to, onNavigate }: { label: string; to: string; onNavigate: (to: string) => void }) {
  return (
    <button type="button" onClick={() => onNavigate(to)}
      className="inline-flex items-center gap-1 text-[12px] font-semibold text-accent hover:underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
      {label}<IconArrowRight size={12} aria-hidden="true" />
    </button>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-faint italic px-0.5 py-1">{children}</p>
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-[9px] bg-raised min-w-0"
      style={{ border: '1px solid var(--color-border)' }}>
      {children}
    </div>
  )
}

const MAX_ROWS = 8

export function TaskLensPanel({ lens, pid, onNavigate }: {
  lens: LensDescriptor; pid: string; onNavigate: (to: string) => void
}) {
  const { product, coverages, rules, ratingProgram, forms, ldTables, rtTables, loading } = useProductCtx()

  // Live worked-example premium — the exact computation the pricing worksheet runs.
  const premium = useMemo(() => {
    if (lens.kind !== 'rating' || !product || !ratingProgram) return null
    if (!Object.keys(rtTables).length || !Object.keys(ldTables).length) return null
    try {
      const kit = resolveRatingKit(resolveLob(product).prefix)
      return evaluate(ratingProgram, { ...kit.workedExample }, kit.makeRtGetter(rtTables), kit.makeLdGetter(ldTables)).finalPremium
    } catch { return null }
  }, [lens.kind, product, ratingProgram, rtTables, ldTables])

  if (loading) return <div className="flex flex-col gap-2"><Skeleton className="h-8" /><Skeleton className="h-16" /></div>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold text-text">{lens.title}</h3>
          <p className="text-[12px] text-dim mt-0.5 leading-snug">{lens.blurb}</p>
        </div>
      </div>

      {/* ── Rating ── */}
      {lens.kind === 'rating' && (
        ratingProgram ? (
          <div className="flex flex-col gap-2.5">
            <div className="rounded-[12px] p-3.5 text-white" style={{ background: 'var(--gradient-accent)' }}>
              <div className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-white/80">Worked-example premium</div>
              <div className="text-2xl font-bold tabular-nums mt-1">{premium == null ? '—' : `$${Math.round(premium).toLocaleString()}`}</div>
              {ratingProgram.minimumPremium != null && (
                <div className="text-white/70 text-[11px] mt-0.5 tabular-nums">Minimum premium ${ratingProgram.minimumPremium.toLocaleString()}</div>
              )}
            </div>
            <Row>
              <span className="text-[13px] text-text font-medium flex-1 min-w-0 truncate">{ratingProgram.name}</span>
              {ratingProgram.refId && <LinkChip label={ratingProgram.refId} tone="accent"
                to={productDeepLink(pid, { tab: 'pricing' })} onNavigate={onNavigate} />}
            </Row>
            {premium == null && <Empty>Rating tables are still loading — open the worksheet to price this program.</Empty>}
            <TabLink label="Open pricing worksheet" to={productDeepLink(pid, { tab: 'pricing' })} onNavigate={onNavigate} />
          </div>
        ) : <Empty>No rating program on this product yet. Nothing to price.</Empty>
      )}

      {/* ── Forms & filing ── */}
      {lens.kind === 'forms' && (
        <div className="flex flex-col gap-2.5">
          {product && (
            <div className="flex items-center gap-2 text-[12px] text-dim">
              <span className="font-semibold uppercase tracking-[.06em] text-faint text-[10.5px]">Filing status</span>
              <Badge label={product.allStates ? 'All states' : `${product.states?.length ?? 0} states`}
                color={product.allStates ? 'good' : 'blue'} />
              <Badge label={product.lifecycle} color="default" className="capitalize" />
            </div>
          )}
          {forms.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {forms.slice(0, MAX_ROWS).map(f => (
                <Row key={f.id}>
                  <LinkChip label={f.number} tone="accent"
                    to={productDeepLink(pid, { tab: 'forms', formNumber: f.number })} onNavigate={onNavigate} />
                  <span className="text-[12.5px] text-dim flex-1 min-w-0 truncate">{f.name}</span>
                </Row>
              ))}
              {forms.length > MAX_ROWS && <Empty>+{forms.length - MAX_ROWS} more in the forms library.</Empty>}
            </div>
          ) : <Empty>No forms attached to this product yet.</Empty>}
          <TabLink label="Open forms library" to={productDeepLink(pid, { tab: 'forms' })} onNavigate={onNavigate} />
        </div>
      )}

      {/* ── Coverage tree ── */}
      {lens.kind === 'coverage' && (
        <div className="flex flex-col gap-2.5">
          {coverages.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {coverages.slice(0, MAX_ROWS).map(c => (
                <Row key={c.id}>
                  <span className="text-[12.5px] text-text flex-1 min-w-0 truncate"
                    style={c.parentId ? { paddingLeft: 12 } : undefined}>{c.name}</span>
                  <Badge label={c.requirement === 'MANDATORY' ? 'Req.' : c.requirement === 'UNKNOWN' ? '?' : 'Opt.'} color={c.requirement === 'MANDATORY' ? 'purple' : 'default'} />
                  {c.refId && <LinkChip label={c.refId}
                    to={productDeepLink(pid, { tab: 'coverages', ref: c.refId })} onNavigate={onNavigate} />}
                </Row>
              ))}
              {coverages.length > MAX_ROWS && <Empty>+{coverages.length - MAX_ROWS} more coverages.</Empty>}
            </div>
          ) : <Empty>No coverages defined on this product yet.</Empty>}
          <TabLink label="Open coverages" to={productDeepLink(pid, { tab: 'coverages' })} onNavigate={onNavigate} />
        </div>
      )}

      {/* ── Rules ── */}
      {lens.kind === 'rules' && (
        <div className="flex flex-col gap-2.5">
          {rules.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {rules.slice(0, MAX_ROWS).map(r => (
                <Row key={r.id}>
                  {r.refId && <LinkChip label={r.refId} tone="accent"
                    to={productDeepLink(pid, { tab: 'rules' })} onNavigate={onNavigate} />}
                  <span className="text-[12px] text-dim flex-1 min-w-0 truncate" title={`${r.condition} → ${r.outcome}`}>
                    {r.condition} → {r.outcome}
                  </span>
                </Row>
              ))}
              {rules.length > MAX_ROWS && <Empty>+{rules.length - MAX_ROWS} more rules.</Empty>}
            </div>
          ) : <Empty>No rules defined on this product yet.</Empty>}
          <TabLink label="Open rules" to={productDeepLink(pid, { tab: 'rules' })} onNavigate={onNavigate} />
        </div>
      )}

      {/* ── Generic overview ── */}
      {lens.kind === 'generic' && (
        product ? (
          <div className="flex flex-col gap-2.5">
            <Row>
              <span className="text-[13px] text-text font-medium flex-1 min-w-0 truncate">{product.name}</span>
              <Badge label={product.lob?.name ?? '—'} color="blue" />
            </Row>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Coverages', coverages.length], ['Forms', forms.length], ['Rules', rules.length]].map(([label, n]) => (
                <div key={label as string} className="rounded-[9px] bg-raised py-2" style={{ border: '1px solid var(--color-border)' }}>
                  <div className="text-lg font-bold text-text tabular-nums">{n as number}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-[.06em] text-faint">{label}</div>
                </div>
              ))}
            </div>
            <TabLink label="Open product overview" to={productDeepLink(pid, { tab: 'overview' })} onNavigate={onNavigate} />
          </div>
        ) : <Empty>Linked product not loaded yet.</Empty>
      )}

      <div className="flex items-center gap-1 text-[10.5px] text-faint pt-0.5">
        <IconExternalLink size={11} aria-hidden="true" />
        <span>Chips open the linked product editor.</span>
      </div>
    </div>
  )
}
