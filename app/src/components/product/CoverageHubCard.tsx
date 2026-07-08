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
      {/* Top brand gradient — subtle, brightens on hover (no full-card fill) */}
      <span aria-hidden="true" className="block h-[3px] w-full opacity-80 group-hover:opacity-100 transition-opacity"
        style={{ background: 'linear-gradient(90deg, var(--color-accent-bright) 0%, var(--color-accent-strong) 55%, transparent 100%)' }} />
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
                  className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[var(--color-danger-hover)] transition-colors">
                  <IconTrash size={15} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Aspect strip — compact, single-line drill-ins into each editor. Calmer
            than a heavy tile grid: label + count, faint dash when empty. 'Options'
            is intentionally excluded — options live inside the limits/terms editor. */}
        <div className="mt-auto grid grid-cols-2 sm:grid-cols-3 gap-x-1 gap-y-0.5 pt-1"
          style={{ borderTop: '1px solid var(--color-border)' }}>
          {ASPECTS.filter(a => a.key !== 'options').map(({ key, label, Icon }) => {
            const count = counts[key]
            const isEmpty = count === 0
            return (
              <button key={key} onClick={() => onTile(key, cov)}
                aria-label={`${cov.name} — ${label} (${count})`}
                className="group/tile flex items-center gap-1.5 h-8 px-1.5 rounded-[7px] text-left transition-colors hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
                <Icon size={13} className={`shrink-0 transition-colors group-hover/tile:text-accent ${isEmpty ? 'text-faint' : 'text-dim'}`} />
                <span className={`text-[11px] flex-1 truncate transition-colors group-hover/tile:text-text ${isEmpty ? 'text-faint' : 'text-dim'}`}>{label}</span>
                <span className={`text-[12px] font-semibold tnum shrink-0 ${isEmpty ? 'text-faint' : 'text-text'}`}>{isEmpty ? '–' : count}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
