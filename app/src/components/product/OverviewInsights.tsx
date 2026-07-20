// OverviewInsights — the executive-report rail of the product Overview: a
// read-only geographic footprint (the same tile choropleth the States tab
// edits, here as a glanceable visual that deep-links into that tab) and a
// deterministic composition read (included vs optional, rated vs unrated —
// hand-rolled split bars, no chart library, token colors only). Everything is
// computed straight from the loaded product context; no model call.
import { useNavigate } from 'react-router-dom'
import { useProductCtx } from '../../context/useProductCtx'
import { StateTileMap } from './StateTileMap'
import { IconStates, IconArrowRight, IconCoverage } from '../ui/icons'
import { resolveLob } from '@pf/shared'
import type { ReactNode } from 'react'

function PanelShell({ title, icon, action, children }: {
  title: string; icon: ReactNode; action?: ReactNode; children: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className="bg-surface rounded-[16px] overflow-hidden"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {icon}
        <h3 className="text-[11px] font-semibold uppercase tracking-[.08em] text-faint flex-1">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

// ─── Geographic footprint — the States choropleth, read-only ──────────────────
export function FootprintPanel() {
  const { pid, product } = useProductCtx()
  const navigate = useNavigate()
  if (!product) return null

  const lob = resolveLob(product)
  const footprint = new Set<string>(lob.footprintStates)
  const active = (product.allStates
    ? (product.states?.length ? product.states : lob.footprintStates)
    : (product.states ?? lob.footprintStates)
  ).filter(st => footprint.has(st))

  return (
    <PanelShell
      title="Geographic footprint"
      icon={<IconStates size={14} className="text-accent" aria-hidden="true" />}
      action={
        <button
          onClick={() => navigate(`/app/products/${pid}/states`)}
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-dim hover:text-accent transition-colors rounded-[6px] px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Manage <IconArrowRight size={11} aria-hidden="true" />
        </button>
      }
    >
      <StateTileMap
        active={new Set(active)}
        footprint={footprint}
        canEdit={false}
        ariaLabel={`Geographic footprint: ${product.allStates ? 'all footprint states' : `${active.length} states in scope`}`}
      />
    </PanelShell>
  )
}

// ─── Composition — deterministic split bars ────────────────────────────────────
function SplitBar({ label, a, b, aLabel, bLabel }: {
  label: string; a: number; b: number; aLabel: string; bLabel: string
}) {
  const total = a + b
  const pct = total > 0 ? Math.round((a / total) * 100) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint">{label}</span>
        <span className="text-[11px] text-dim tnum tabular-nums">{a} {aLabel} · {b} {bLabel}</span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden flex"
        role="img"
        aria-label={`${label}: ${a} ${aLabel} (${pct}%), ${b} ${bLabel}`}
        style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}
      >
        <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: 'var(--gradient-accent)' }} />
      </div>
    </div>
  )
}

export function CompositionPanel() {
  const { coverages } = useProductCtx()
  if (coverages.length === 0) return null

  const mandatory = coverages.filter(c => c.requirement === 'MANDATORY').length
  const rated = coverages.filter(c => c.premiumGenerating).length
  const subs = coverages.filter(c => c.parentId).length

  return (
    <PanelShell title="Coverage composition" icon={<IconCoverage size={14} className="text-accent" aria-hidden="true" />}>
      <div className="flex flex-col gap-4">
        <SplitBar label="Requirement" a={mandatory} b={coverages.length - mandatory} aLabel="included" bLabel="optional" />
        <SplitBar label="Rating" a={rated} b={coverages.length - rated} aLabel="rated" bLabel="unrated" />
        <div className="flex items-baseline justify-between pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-faint pt-2">Structure</span>
          <span className="text-[11px] text-dim tnum tabular-nums pt-2">
            {coverages.length - subs} top-level · {subs} sub-coverage{subs === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </PanelShell>
  )
}
