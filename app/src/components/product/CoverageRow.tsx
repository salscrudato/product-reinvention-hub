// CoverageRow — the list-view counterpart to CoverageHubCard: one dense row with
// identity, governance chips and the per-aspect counts as compact icon buttons
// that drill into the same editors/tabs.
import { RefChip, Badge, Tooltip } from '../ui'
import { IconEdit, IconTrash } from '../ui/icons'
import { COVERAGE_ASPECTS as ASPECTS, useCoverageCounts, type CoverageAspect } from './coverageAspects'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

export function CoverageRow({ cov, isEndorsement, canEdit, onTile, onEdit, onDelete }: {
  cov: WithId<Coverage>
  isEndorsement?: boolean
  canEdit: boolean
  onTile: (aspect: CoverageAspect, cov: WithId<Coverage>) => void
  onEdit: (cov: WithId<Coverage>) => void
  onDelete: (cov: WithId<Coverage>) => void
}) {
  const counts = useCoverageCounts(cov)
  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 bg-surface hover:bg-raised transition-colors" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cov.status === 'ACTIVE' ? 'var(--color-good)' : cov.status === 'FUTURE' ? 'var(--color-info)' : 'var(--color-faint)' }} title={cov.status} />
      <div className={`min-w-0 flex items-center gap-2 flex-1 ${isEndorsement ? 'pl-3' : ''}`}>
        <span className="font-medium text-sm text-text truncate">{cov.name}</span>
        {cov.refId && <span className="hidden md:inline shrink-0"><RefChip id={cov.refId} /></span>}
        <span className="hidden lg:flex items-center gap-1.5 shrink-0">
          <Badge label={cov.requirement === 'MANDATORY' ? 'Mandatory' : cov.requirement === 'UNKNOWN' ? 'Req. unknown' : 'Optional'} color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'} />
          {cov.premiumGenerating && <Badge label="Rated" color="good" />}
        </span>
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {ASPECTS.map(({ key, label, Icon }) => (
          <Tooltip key={key} content={`${label}: ${counts[key]}`}>
            <button onClick={() => onTile(key, cov)} aria-label={`${cov.name} — ${label} (${counts[key]})`}
              className="flex items-center gap-1 h-7 px-1.5 rounded-[7px] text-faint hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
              <Icon size={15} /><span className="text-[11px] font-semibold tnum text-dim">{counts[key]}</span>
            </button>
          </Tooltip>
        ))}
      </div>

      {canEdit && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onEdit(cov)} aria-label={`Edit ${cov.name}`} className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors"><IconEdit size={15} /></button>
          <button onClick={() => onDelete(cov)} aria-label={`Delete ${cov.name}`} className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[var(--color-danger-hover)] transition-colors"><IconTrash size={15} /></button>
        </div>
      )}
    </div>
  )
}
