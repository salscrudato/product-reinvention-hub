// CoverageHubCard — a coverage as a hub: identity + governance chips on top, then
// a tile grid for its six related aspects (Limits · Deductibles · States · Forms ·
// Pricing · Rules). Each tile shows a live count drawn from the canonical model
// and drills straight into that aspect's editor or tab — the coverage is the spine
// everything hangs off. (No "clauses" — intentionally dropped.)
import { StatusPill, Badge, RefChip, Tooltip } from '../ui'
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
    <div className="group relative bg-surface rounded-[16px] overflow-hidden flex flex-col hover:shadow-[var(--shadow-card-hover)] transition-all duration-200"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
      <div className="p-4 flex flex-col gap-3.5 flex-1">
        {/* Identity */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5 min-w-0">
            {parentName && (
              <span className="inline-flex items-center gap-1 text-[11px] text-faint">
                <IconEndorsement size={12} /> Endorsement · {parentName}
              </span>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cov.status === 'ACTIVE' ? 'var(--color-good)' : cov.status === 'FUTURE' ? 'var(--color-info)' : 'var(--color-faint)' }} />
              <span className="font-semibold text-[15px] text-text leading-snug truncate">{cov.name}</span>
              {cov.refId && <span className="shrink-0"><RefChip id={cov.refId} /></span>}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge label={cov.requirement === 'MANDATORY' ? 'Mandatory' : 'Optional'} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
              {cov.premiumGenerating && <Badge label="Rated" color="good" />}
              {cov.source === 'PROPRIETARY' && <Badge label="Proprietary" color="warn" />}
              {cov.status !== 'ACTIVE' && <StatusPill status={cov.status} />}
            </div>
          </div>
          {canEdit && (
            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <Tooltip content="Edit coverage"><button onClick={() => onEdit(cov)} aria-label={`Edit ${cov.name}`} className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors"><IconEdit size={15} /></button></Tooltip>
              <Tooltip content="Delete coverage"><button onClick={() => onDelete(cov)} aria-label={`Delete ${cov.name}`} className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[rgba(220,38,38,.08)] transition-colors"><IconTrash size={15} /></button></Tooltip>
            </div>
          )}
        </div>

        {/* Aspect tile grid */}
        <div className="grid grid-cols-3 gap-1.5">
          {ASPECTS.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => onTile(key, cov)} aria-label={`${cov.name} — ${label} (${counts[key]})`}
              className="group/tile flex items-center gap-2 px-2.5 py-2 rounded-[10px] bg-raised hover:bg-accent-soft transition-colors text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ borderLeft: '2px solid transparent' }}>
              <span className="text-dim group-hover/tile:text-accent transition-colors shrink-0"><Icon size={16} /></span>
              <span className="flex flex-col leading-tight min-w-0">
                <span className="text-[11px] font-medium text-dim group-hover/tile:text-text truncate transition-colors">{label}</span>
                <span className="text-[13px] font-semibold text-text tnum">{counts[key]}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
