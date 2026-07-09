// ProductVitals — the deterministic "vital signs" strip at the top of the Overview.
// Where ProductSummaryDashboard is the *generative* read (an AI narrative), this is the
// *factual* one: hard counts computed straight from the loaded product context — no model
// call, always exact. Each tile doubles as a shortcut into the tab that owns that facet, so
// the Overview stops being a dead-end read and becomes the workspace's command centre.
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProductCtx } from '../../context/useProductCtx'
import {
  IconCoverage, IconForm, IconPricing, IconStates, IconRule, IconChevronRight, type IconType,
} from '../ui/icons'

interface Vital {
  tab: string
  icon: IconType
  value: string
  label: string
  hint?: string
}

export function ProductVitals() {
  const { pid, product, coverages, rules, forms, ratingProgram } = useProductCtx()
  const navigate = useNavigate()

  const vitals = useMemo<Vital[]>(() => {
    if (!product) return []
    const rated = coverages.filter(c => c.premiumGenerating).length
    const stateCount = product.states?.length ?? 0
    return [
      {
        tab: 'coverages', icon: IconCoverage, value: String(coverages.length),
        label: coverages.length === 1 ? 'Coverage' : 'Coverages',
        hint: rated > 0 ? `${rated} rated` : undefined,
      },
      {
        tab: 'forms', icon: IconForm, value: String(forms.length),
        label: forms.length === 1 ? 'Form' : 'Forms',
      },
      {
        tab: 'pricing', icon: IconPricing,
        value: String(ratingProgram?.steps?.length ?? 0),
        label: 'Rating steps',
        hint: ratingProgram ? undefined : 'Not set up',
      },
      {
        tab: 'states', icon: IconStates,
        value: product.allStates ? 'All' : String(stateCount),
        label: product.allStates || stateCount !== 1 ? 'States' : 'State',
      },
      {
        tab: 'rules', icon: IconRule, value: String(rules.length),
        label: rules.length === 1 ? 'Rule' : 'Rules',
      },
    ]
  }, [product, coverages, rules, forms, ratingProgram])

  if (!product) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5" role="group" aria-label="Product vital signs">
      {vitals.map(v => (
        <button
          key={v.tab}
          onClick={() => navigate(`/app/products/${pid}/${v.tab}`)}
          aria-label={`${v.value} ${v.label}${v.hint ? `, ${v.hint}` : ''} — open ${v.tab} tab`}
          className="group relative flex flex-col gap-2 rounded-[14px] bg-surface p-3.5 text-left border border-[color:var(--color-border)] shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--color-accent-line)] hover:shadow-[var(--shadow-card-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex items-center justify-between">
            <span className="w-8 h-8 rounded-[9px] flex items-center justify-center bg-accent-soft text-accent transition-colors duration-200 group-hover:bg-accent group-hover:text-white">
              <v.icon size={16} aria-hidden="true" />
            </span>
            <IconChevronRight
              size={15}
              className="text-faint opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-accent"
              aria-hidden="true"
            />
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-[22px] font-bold text-text leading-none tnum">{v.value}</span>
            {v.hint && <span className="text-[11px] text-faint">· {v.hint}</span>}
          </span>
          <span className="text-[12px] font-medium text-dim">{v.label}</span>
        </button>
      ))}
    </div>
  )
}
