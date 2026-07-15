// CoverageTree — slim-card branching tree view for the Coverages tab.
// Each coverage node is a standalone rounded card (not a full-width row) connected
// to its children by CSS branch lines (vertical rail + horizontal tick). Parent cards
// are slightly more prominent; child cards are lighter and indented. Cycle-safe.
import { RefChip, Badge, Tooltip } from '../ui'
import { IconEdit, IconTrash } from '../ui/icons'
import { COVERAGE_ASPECTS as ASPECTS, useCoverageCounts, type CoverageAspect } from './coverageAspects'
import type { Coverage } from '@pf/shared'
import type { WithId } from '../../context/ProductContext'

// ─── Single card ────────────────────────────────────────────────────────────────
// Slim, self-contained card for one coverage node. Appearance scales with depth:
//   depth 0 → stronger border, shadow, slightly taller label
//   depth 1+ → lighter border, no shadow, compact

function TreeCard({ cov, depth, canEdit, onTile, onEdit, onDelete }: {
  cov: WithId<Coverage>
  depth: number
  canEdit: boolean
  onTile: (aspect: CoverageAspect, cov: WithId<Coverage>) => void
  onEdit: (cov: WithId<Coverage>) => void
  onDelete: (cov: WithId<Coverage>) => void
}) {
  const counts = useCoverageCounts(cov)
  const isRoot = depth === 0
  const statusColor = cov.status === 'ACTIVE' ? 'var(--color-good)' : cov.status === 'FUTURE' ? 'var(--color-accent)' : 'var(--color-faint)'

  return (
    <div
      className="group flex items-center gap-2.5 bg-surface transition-colors hover:bg-raised"
      style={{
        padding: isRoot ? '8px 14px' : '6px 12px',
        borderRadius: isRoot ? '10px' : '8px',
        border: isRoot
          ? '1.5px solid var(--color-border-strong)'
          : '1px solid var(--color-border)',
        boxShadow: isRoot
          ? 'var(--shadow-chip)'
          : 'none',
      }}
    >
      {/* Status dot */}
      <span
        className="shrink-0 rounded-full"
        style={{ width: isRoot ? 8 : 6, height: isRoot ? 8 : 6, background: statusColor }}
        title={cov.status}
      />

      {/* Identity */}
      <div className="min-w-0 flex items-center gap-2 flex-1">
        <span className={`font-medium text-text truncate ${isRoot ? 'text-[13.5px]' : 'text-[12.5px]'}`}>
          {cov.name}
        </span>
        {cov.refId && (
          <span className="hidden md:inline shrink-0">
            <RefChip id={cov.refId} />
          </span>
        )}
        <span className="hidden lg:flex items-center gap-1 shrink-0">
          <Badge
            label={cov.requirement === 'MANDATORY' ? 'Mandatory' : cov.requirement === 'UNKNOWN' ? 'Req. unknown' : 'Optional'}
            color={cov.requirement === 'MANDATORY' ? 'purple' : 'default'}
          />
          {cov.premiumGenerating && <Badge label="Rated" color="good" />}
        </span>
      </div>

      {/* Aspect count buttons */}
      <div className="flex items-center gap-0 shrink-0">
        {ASPECTS.map(({ key, label, Icon }) => (
          <Tooltip key={key} content={`${label}: ${counts[key]}`}>
            <button
              onClick={() => onTile(key, cov)}
              aria-label={`${cov.name} — ${label} (${counts[key]})`}
              className="flex items-center gap-0.5 rounded-[6px] text-faint hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ height: isRoot ? 28 : 24, padding: '0 6px' }}
            >
              <Icon size={13} />
              <span className="text-[10.5px] font-semibold tnum text-dim">{counts[key]}</span>
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Edit / delete (hover-only) */}
      {canEdit && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(cov)}
            aria-label={`Edit ${cov.name}`}
            className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft transition-colors"
          >
            <IconEdit size={13} />
          </button>
          <button
            onClick={() => onDelete(cov)}
            aria-label={`Delete ${cov.name}`}
            className="w-7 h-7 rounded-[7px] flex items-center justify-center text-faint hover:text-danger hover:bg-[var(--color-danger-hover)] transition-colors"
          >
            <IconTrash size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Tree ───────────────────────────────────────────────────────────────────────

const byOrder = (a: WithId<Coverage>, b: WithId<Coverage>) => (a.order ?? 0) - (b.order ?? 0)

export function CoverageTree({ coverages, canEdit, onTile, onEdit, onDelete }: {
  coverages: WithId<Coverage>[]
  canEdit: boolean
  onTile: (aspect: CoverageAspect, cov: WithId<Coverage>) => void
  onEdit: (cov: WithId<Coverage>) => void
  onDelete: (cov: WithId<Coverage>) => void
}) {
  const cardProps = { canEdit, onTile, onEdit, onDelete }

  const childrenOf = (cov: WithId<Coverage>) =>
    coverages.filter(c => c.parentId && c.parentId === cov.refId).sort(byOrder)

  const roots = coverages
    .filter(c => !c.parentId || !coverages.some(p => p.refId === c.parentId))
    .sort(byOrder)

  const seen = new Set<string>()

  const renderNode = (cov: WithId<Coverage>, depth: number): React.ReactNode => {
    if (seen.has(cov.id)) return null
    seen.add(cov.id)
    const children = childrenOf(cov)

    return (
      <div key={cov.id}>
        <TreeCard cov={cov} depth={depth} {...cardProps} />

        {children.length > 0 && (
          // Branch rail: left border = the vertical connector line
          <div
            className="flex flex-col"
            style={{
              marginTop: 6,
              marginLeft: depth === 0 ? 20 : 16,
              paddingLeft: 16,
              borderLeft: '1.5px solid var(--color-border)',
              // Gap between children is handled via margin on each child row
            }}
          >
            {children.map((child, idx) => (
              <div
                key={child.id}
                className="relative"
                style={{ marginTop: idx === 0 ? 0 : 6 }}
              >
                {/* Horizontal tick from the vertical rail to the child card */}
                <span
                  aria-hidden="true"
                  className="absolute"
                  style={{
                    left: -16,
                    top: '50%',
                    width: 16,
                    height: 1.5,
                    background: 'var(--color-border)',
                    transform: 'translateY(-0.75px)',
                  }}
                />
                {renderNode(child, depth + 1)}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {roots.map(root => renderNode(root, 0))}
    </div>
  )
}
