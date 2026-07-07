// CoverageHubCard — a coverage as a hub: identity + governance chips on top, then
// a tile grid for its related aspects (Limits · Deductibles · Options · States ·
// Forms · Pricing · Rules). Each tile shows a live count drawn from the canonical model
// and drills straight into that aspect's editor or tab — the coverage is the spine
// everything hangs off. Zero-count tiles show a dimmed "Add first" invite so a PM
// always knows what's missing without leaving the collection.
import { StatusPill, Badge, Tooltip } from '../ui'
import { IconEdit, IconTrash, IconEndorsement } from '../ui/icons'
import { COVERAGE_ASPECTS as ASPECTS, useCoverageCounts, type CoverageAspect } from './coverageAspects'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

// Labels shown on a zero-count tile inviting the PM to add the first item.
const ZERO_INVITE: Record<CoverageAspect, string> = {
  limits:      'Add limit',
  deductibles: 'Add ded.',
  options:     'Add option',
  states:      'Set scope',
  forms:       'Add form',
  pricing:     'View steps',
  rules:       'View rules',
}

export function CoverageHubCard({ cov, parentName, canEdit, onTile, onEdit, onDelete }: {
  cov: WithId<Coverage>
  parentName?: string
  canEdit: boolean
  onTile: (aspect: CoverageAspect, cov: WithId<Coverage>) => void
  onEdit: (cov: WithId<Coverage>) => void
  onDelete: (cov: WithId<Coverage>) => void
}) {
  const counts = useCoverageCounts(cov)

  return (
    <div className="group relative h-full bg-surface rounded-[16px] overflow-hidden flex flex-col border border-[color:var(--color-border)] shadow-[var(--shadow-card)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:var(--color-accent-line)] hover:shadow-[0_18px_40px_-14px_var(--glow-accent)]">
      {/* Top brand gradient — subtle, brightens on hover */}
      <span aria-hidden="true" className="block h-[3px] w-full opacity-80 group-hover:opacity-100 transition-opacity"
        style={{ background: 'linear-gradient(90deg, var(--color-accent-bright) 0%, var(--color-accent-strong) 55%, transparent 100%)' }} />
      {/* Subtle gradient wash + glow on hover */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        style={{ background: 'var(--gradient-accent-soft)' }} />
      <div className="relative p-4 flex flex-col gap-3.5 flex-1">
        {/* Identity */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5 min-w-0">
            {parentName && (
              <span className="inline-flex items-center gap-1 text-[11px] text-faint">
                <IconEndorsement size={12} /> Sub-coverage · {parentName}
              </span>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0"
                style={{ background: cov.status === 'ACTIVE' ? 'var(--color-good)' : cov.status === 'FUTURE' ? 'var(--color-info)' : 'var(--color-faint)' }} />
              <span className="font-semibold text-[15px] text-text leading-snug truncate">{cov.name}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge label={cov.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional'} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
              {cov.premiumGenerating && <Badge label="Rated" color="good" />}
              {cov.source === 'PROPRIETARY' && <Badge label="Proprietary" color="warn" />}
              {cov.status !== 'ACTIVE' && <StatusPill status={cov.status} />}
            </div>
          </div>
          {canEdit && (
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <Tooltip content="Edit coverage">
                <button onClick={() => onEdit(cov)} aria-label={`Edit ${cov.name}`}
                  className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors">
                  <IconEdit size={15} />
                </button>
              </Tooltip>
              <Tooltip content="Delete coverage">
                <button onClick={() => onDelete(cov)} aria-label={`Delete ${cov.name}`}
                  className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[rgba(220,38,38,.08)] transition-colors">
                  <IconTrash size={15} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Aspect tile grid — zero-count tiles use dashed borders + invite copy.
            'Options' is intentionally excluded — options live inside the limits/terms editor. */}
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECTS.filter(a => a.key !== 'options').map(({ key, label, Icon }, i) => {
            const count = counts[key]
            const isEmpty = count === 0
            return (
              <button key={key} onClick={() => onTile(key, cov)}
                aria-label={`${cov.name} — ${label} (${count})`}
                className="rise-in group/tile flex items-center gap-2 px-2.5 py-2 rounded-[10px] transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent hover:bg-accent-soft"
                style={{
                  '--rise-delay': `${i * 30}ms`,
                  background: isEmpty ? 'transparent' : 'var(--color-raised)',
                  border: isEmpty ? '1px dashed var(--color-border-strong)' : '1px solid transparent',
                } as React.CSSProperties}>
                <span className={`transition-colors shrink-0 group-hover/tile:text-accent ${isEmpty ? 'text-faint' : 'text-dim'}`}>
                  <Icon size={16} />
                </span>
                <span className="flex flex-col leading-tight min-w-0">
                  <span className={`text-[11px] font-medium truncate transition-colors group-hover/tile:text-text ${isEmpty ? 'text-faint' : 'text-dim'}`}>
                    {label}
                  </span>
                  {isEmpty ? (
                    <span className="text-[11px] font-medium text-faint group-hover/tile:text-accent transition-colors">
                      {ZERO_INVITE[key]}
                    </span>
                  ) : (
                    <span className="text-[13px] font-semibold text-text tnum">{count}</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
