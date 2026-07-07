// PeekPanel — the rightmost pane of the Explorer cascade. It previews the deepest
// selected node: a product summary, or (the headline case) a coverage / sub-coverage
// with its refId, governance status, a limits-&-terms summary, and the attached forms
// as working deep links into the product workspace. Purely presentational + read-only;
// every "open" is a navigate, never a mutation.
import { useNavigate } from 'react-router-dom'
import { Badge, StatusPill, LifecyclePill, RefChip } from '../ui'
import {
  IconLimit, IconDeductible, IconEndorsement, IconForm, IconArrowRight,
  IconStates, IconInfo, type IconType,
} from '../ui/icons'
import type { WithId } from '../../context/ProductContext'
import type { Product, Coverage, Form, CoverageTerm, TermKind } from '@pf/shared'

export type PeekNode =
  | { kind: 'product'; product: WithId<Product>; coverageCount: number; subCount: number }
  | { kind: 'coverage'; cov: WithId<Coverage>; pid: string; forms: WithId<Form>[]; isSub: boolean }

const TERM_ICON: Record<TermKind, IconType> = {
  LIMIT: IconLimit, DEDUCTIBLE: IconDeductible, OPTION: IconEndorsement,
}

// Legacy term defaults are a string ("30% of Coverage A"), a number, or a boolean.
// Render each honestly — line-agnostic, no HO-specific assumption.
function formatTermDefault(t: CoverageTerm): string {
  const d = t.default
  if (typeof d === 'string')  return d || '—'
  if (typeof d === 'boolean') return d ? 'Included' : 'Excluded'
  if (typeof d === 'number') {
    const isPct = t.unit === 'percent' || t.unit === '%' || (t.basis?.toLowerCase().includes('percent') ?? false)
    return isPct ? `${d}%` : `$${d.toLocaleString()}`
  }
  return '—'
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[.09em] text-faint">{label}</p>
      {children}
    </div>
  )
}

export function PeekPanel({ node }: { node: PeekNode | null }) {
  const navigate = useNavigate()

  const shell = (children: React.ReactNode) => (
    <aside
      className="col-in flex flex-col shrink-0 w-[340px] rounded-[14px] bg-surface overflow-hidden"
      style={{ border: '1px solid var(--color-border)' }}
    >
      {children}
    </aside>
  )

  // Idle: nothing selected yet — a prompt, never a dead end.
  if (!node) {
    return shell(
      <div className="flex-1 grid place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-2 max-w-[220px]">
          <IconInfo size={28} className="text-faint" aria-hidden="true" />
          <p className="text-sm font-medium text-dim">Nothing selected</p>
          <p className="text-xs text-faint">Pick a product to start cascading through its coverages.</p>
        </div>
      </div>,
    )
  }

  if (node.kind === 'product') {
    const p = node.product
    return shell(
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-bold text-text leading-tight">{p.name}</h3>
            {p.refId && <RefChip id={p.refId} tone="accent" />}
          </div>
          <p className="text-xs text-dim">{p.lob?.name} · {p.marketSegment}</p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <StatusPill status={p.status} />
            <LifecyclePill lifecycle={p.lifecycle} />
          </div>
        </div>

        {p.description && (
          <Section label="Description">
            <p className="text-sm text-dim leading-relaxed line-clamp-6">{p.description}</p>
          </Section>
        )}

        <Section label="Structure">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-[10px] bg-raised px-3 py-2.5">
              <p className="text-lg font-bold text-text tnum leading-none">{node.coverageCount}</p>
              <p className="text-[11px] text-faint mt-1">Coverages</p>
            </div>
            <div className="rounded-[10px] bg-raised px-3 py-2.5">
              <p className="text-lg font-bold text-text tnum leading-none">{node.subCount}</p>
              <p className="text-[11px] text-faint mt-1">Sub-coverages</p>
            </div>
          </div>
        </Section>

        <button
          onClick={() => navigate(`/app/products/${p.id}/overview`)}
          className="mt-auto inline-flex items-center justify-center gap-1.5 h-9 rounded-[9px] bg-accent-soft text-accent text-sm font-medium hover:bg-accent hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Open product <IconArrowRight size={15} />
        </button>
      </div>,
    )
  }

  // Coverage / sub-coverage.
  const { cov, pid, forms, isSub } = node
  const terms = cov.terms ?? []
  const formNumbers = cov.formNumbers ?? []
  const formByNumber = new Map(forms.map((f) => [f.number, f]))

  const openCoverage = () => navigate(`/app/products/${pid}/coverages?cov=${encodeURIComponent(cov.refId ?? cov.id)}`)
  const openForm = (num: string) => navigate(`/app/products/${pid}/forms?form=${encodeURIComponent(num)}`)

  return shell(
    <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-5">
      {/* Identity — name + refId chip (load-bearing) + governance pills. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-bold text-text leading-tight">{cov.name}</h3>
          {cov.refId && <RefChip id={cov.refId} tone="accent" />}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          <StatusPill status={cov.status} />
          <LifecyclePill lifecycle={cov.lifecycle} />
          <Badge label={cov.requirement} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
          {isSub && <Badge label="Sub-coverage" color="blue" />}
          {cov.premiumGenerating && <Badge label="Premium" color="good" />}
        </div>
        {cov.claimsBasis && <p className="text-xs text-faint">{cov.claimsBasis} · {cov.source}</p>}
      </div>

      {/* Limits & terms summary. */}
      <Section label="Limits & terms">
        {terms.length === 0 ? (
          <p className="text-sm text-faint">No limit terms defined.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {terms.map((t) => {
              const TermIcon = TERM_ICON[t.kind] ?? IconLimit
              return (
                <div key={t.id} className="flex items-start gap-2.5 rounded-[10px] bg-raised px-3 py-2">
                  <TermIcon size={16} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate">{t.label}</p>
                    {t.basis && <p className="text-[11px] text-faint truncate">{t.basis}</p>}
                  </div>
                  <span className="text-sm font-semibold text-text tnum shrink-0">{formatTermDefault(t)}</span>
                </div>
              )
            })}
          </div>
        )}
      </Section>

      {/* Attached forms — every number is a deep link into the product's Forms tab. */}
      <Section label={`Attached forms${formNumbers.length ? ` (${formNumbers.length})` : ''}`}>
        {formNumbers.length === 0 ? (
          <p className="text-sm text-faint">No forms attached.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {formNumbers.map((num) => {
              const f = formByNumber.get(num)
              return (
                <button
                  key={num}
                  onClick={() => openForm(num)}
                  title={`Open ${num} in Forms`}
                  className="flex items-center gap-2 text-left px-2.5 py-2 rounded-[9px] bg-raised hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                >
                  <IconForm size={15} className="text-faint shrink-0" aria-hidden="true" />
                  <RefChip id={num} tone="accent" />
                  <span className="text-sm text-dim truncate flex-1">{f?.name ?? 'Form'}</span>
                  <IconArrowRight size={14} className="text-faint shrink-0" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}
      </Section>

      {/* Geographic scope — line-agnostic (drawn straight from the coverage's StateScope). */}
      <Section label="States">
        <p className="flex items-center gap-2 text-sm text-dim">
          <IconStates size={15} className="text-faint shrink-0" aria-hidden="true" />
          {cov.allStates ? 'All states' : cov.states?.length ? `${cov.states.length} states` : 'None'}
        </p>
      </Section>

      <button
        onClick={openCoverage}
        className="mt-auto inline-flex items-center justify-center gap-1.5 h-9 rounded-[9px] bg-accent-soft text-accent text-sm font-medium hover:bg-accent hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Open in coverages <IconArrowRight size={15} />
      </button>
    </div>,
  )
}
