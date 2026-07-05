// Overview — a single-column, focused reading experience: the product's coverages
// presented as a logically-grouped collection (ISO Section I / II), with generous
// spacing and elegant refId + limit typography. Health lives in the workspace
// header pill; the single most important finding (if any) surfaces here as one
// quiet, dismissible inline banner — never a panel.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProductCtx } from '../../context/useProductCtx'
import { Skeleton } from '../../components/ui'
import { IconWarning, IconAlertCircle, IconArrowRight, IconClose } from '../../components/ui/icons'
import { CoverageCollection } from '../../components/product/CoverageCollection'
import { computeProductFindings, type Finding } from '../../lib/productHealth'

// ─── Quiet inline finding banner ───────────────────────────────────────────────

function FindingBanner({ top, more, onReview, onDismiss }: {
  top: Finding; more: number; onReview: () => void; onDismiss: () => void
}) {
  const isError = top.severity === 'error'
  const Icon = isError ? IconAlertCircle : IconWarning
  const tint = isError ? 'rgba(220,38,38,' : 'rgba(180,83,9,'
  return (
    <div className="flex items-center gap-3 rounded-[12px] px-4 py-2.5 text-sm rise-in"
      style={{ background: `${tint}.05)`, border: `1px solid ${tint}.18)` }}>
      <Icon size={15} className={isError ? 'text-danger shrink-0' : 'text-warn shrink-0'} aria-hidden="true" />
      <span className="text-dim flex-1 min-w-0 truncate">{top.message}</span>
      {more > 0 && <span className="text-xs text-faint shrink-0 hidden sm:inline">+{more} more</span>}
      <button onClick={onReview}
        className="text-accent font-medium inline-flex items-center gap-1 shrink-0 rounded-[6px] px-1 hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
        Review <IconArrowRight size={13} aria-hidden="true" />
      </button>
      <button onClick={onDismiss} aria-label="Dismiss" className="text-faint hover:text-text shrink-0 rounded-[6px] p-0.5 transition-colors">
        <IconClose size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

// ─── Overview route ───────────────────────────────────────────────────────────

export default function ProductOverview() {
  const navigate = useNavigate()
  const ctx = useProductCtx()
  const { pid, coverages, loading } = ctx
  const [dismissed, setDismissed] = useState(false)

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-40 rounded-[14px]" />)}
        </div>
      </div>
    )
  }

  const findings = computeProductFindings({
    pid, coverages, rules: ctx.rules, ratingProgram: ctx.ratingProgram,
    ldTables: ctx.ldTables, rtTables: ctx.rtTables, formRules: ctx.formRules,
  })
  const top = findings[0]

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      {top && !dismissed && (
        <FindingBanner
          top={top}
          more={findings.length - 1}
          onReview={() => navigate(top.route)}
          onDismiss={() => setDismissed(true)}
        />
      )}

      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-text tracking-tight">Coverages</h2>
        <span className="text-xs text-dim tnum">
          {coverages.length} total{findings.length ? ` · ${findings.length} finding${findings.length !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      <CoverageCollection coverages={coverages} onOpen={id => navigate(`/app/products/${pid}/coverages?cov=${id}`)} />
    </div>
  )
}
