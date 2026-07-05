// CoverageCollection — the product's coverages presented the way a P&C product
// manager thinks about them: grouped into ISO sections (Section I property,
// Section II liability), each coverage a card with its headline limit, attached
// forms and nested endorsements. Click a card to open it in the Coverages tab.
import { IconChevronRight } from '../ui/icons'
import { Badge, RefChip } from '../ui'
import type { Coverage, CoverageTerm } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

const STATUS_DOT: Record<string, string> = { ACTIVE: 'var(--color-good)', INACTIVE: 'var(--color-faint)', FUTURE: 'var(--color-info)' }

function fmtTerm(t: CoverageTerm): string {
  const v = t.default
  if (typeof v === 'boolean') return v ? 'Included' : '—'
  if (typeof v === 'number') {
    if (t.unit === '%' || t.basis?.toLowerCase().includes('percent')) return `${v}%`
    return `$${v.toLocaleString()}`
  }
  return String(v)
}

/** Range summary from an LD table's options or the term's min/max, e.g. "$1k – $25k". */
function rangeSummary(t: CoverageTerm): string | null {
  const nums = (t.options?.filter(o => typeof o === 'number') as number[] | undefined) ?? []
  const lo = t.min ?? (nums.length ? Math.min(...nums) : undefined)
  const hi = t.max ?? (nums.length ? Math.max(...nums) : undefined)
  if (lo === undefined || hi === undefined || lo === hi) return null
  const pct = t.unit === '%' || t.basis?.toLowerCase().includes('percent')
  const fmt = pct
    ? (n: number) => `${n}%`
    : (n: number) => n >= 1000 ? `$${(n / 1000).toLocaleString()}k` : `$${n}`
  return `${fmt(lo)} – ${fmt(hi)}`
}

function primaryTerm(cov: WithId<Coverage>): CoverageTerm | undefined {
  return cov.terms?.find(t => t.kind === 'LIMIT') ?? cov.terms?.[0]
}

function CoverageCard({ cov, endorsements, onOpen }: {
  cov: WithId<Coverage>; endorsements: WithId<Coverage>[]; onOpen: (id: string) => void
}) {
  const term = primaryTerm(cov)
  const range = term && rangeSummary(term)

  return (
    <div className="bg-surface rounded-[14px] flex flex-col overflow-hidden transition-all duration-200 hover:shadow-[var(--shadow-card-hover)]"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      <button
        onClick={() => onOpen(cov.id)}
        className="group text-left p-4 flex flex-col gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_DOT[cov.status] ?? 'var(--color-faint)' }} />
              <span className="font-semibold text-[14px] text-text leading-snug group-hover:text-accent transition-colors truncate">{cov.name}</span>
            </div>
            {cov.refId && <div><RefChip id={cov.refId} /></div>}
          </div>
          <IconChevronRight size={16} className="text-faint shrink-0 group-hover:text-accent group-hover:translate-x-0.5 transition-all mt-0.5" aria-hidden="true" />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge label={cov.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional'} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
          {cov.premiumGenerating && <Badge label="Rated" color="good" />}
          {cov.source === 'PROPRIETARY' && <Badge label="Proprietary" color="warn" />}
        </div>

        {term && (
          <div className="flex items-baseline justify-between gap-2 pt-1">
            <span className="text-xs text-dim truncate">{term.label}</span>
            <span className="font-mono text-[13px] font-semibold text-text tnum shrink-0">
              {fmtTerm(term)}{range && <span className="text-faint font-normal ml-1.5">· {range}</span>}
            </span>
          </div>
        )}
      </button>

      {(cov.formNumbers?.length > 0 || endorsements.length > 0) && (
        <div className="px-4 pb-3 pt-0 flex flex-col gap-2.5">
          {cov.formNumbers?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {cov.formNumbers.map(fn => <RefChip key={fn} id={fn} tone="accent" />)}
            </div>
          )}
          {endorsements.length > 0 && (
            <div className="flex flex-col gap-1 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-faint pt-1.5">Endorsements</span>
              {endorsements.map(e => (
                <button key={e.id} onClick={() => onOpen(e.id)}
                  className="group flex items-center gap-2 text-left rounded-[8px] px-2 py-1.5 -mx-1 hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_DOT[e.status] ?? 'var(--color-faint)' }} />
                  <span className="text-[13px] text-dim group-hover:text-text truncate flex-1">{e.name}</span>
                  {e.refId && <span className="font-mono text-[10px] text-faint shrink-0">{e.refId.split('.').slice(-1)[0]}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const isLiability = (c: WithId<Coverage>) => /liabilit|medical/i.test(c.name)

export function CoverageCollection({ coverages, onOpen }: { coverages: WithId<Coverage>[]; onOpen: (id: string) => void }) {
  const roots = coverages.filter(c => !c.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const endorsementsOf = (refId: string | null) => refId ? coverages.filter(c => c.parentId === refId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : []

  const sections = [
    { label: 'Section I — Property',  items: roots.filter(c => !isLiability(c)) },
    { label: 'Section II — Liability', items: roots.filter(isLiability) },
  ].filter(s => s.items.length > 0)

  if (!roots.length) return <p className="text-sm text-faint py-8 text-center">No coverages yet.</p>

  return (
    <div className="flex flex-col gap-6">
      {sections.map(section => (
        <section key={section.label} className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[.09em] text-faint">{section.label}</h3>
            <span className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
            <span className="text-[11px] text-faint tnum">{section.items.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {section.items.map(cov => (
              <CoverageCard key={cov.id} cov={cov} endorsements={endorsementsOf(cov.refId)} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
