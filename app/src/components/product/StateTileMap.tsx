// StateTileMap — the reusable geographic US tile map. Renders every state at its
// approximate map position; selected states fill with the brand violet, coastal
// wind/hail states get an amber bolt badge. Click to toggle when editable. Used
// for the product footprint and per-coverage state scope.
import { useId } from 'react'
import { US_TILE_GRID as GRID, US_TILE_COLS as COLS } from '../../lib/geo/usTileGrid'

const ALL_STATES = Object.keys(GRID)

interface Props {
  active: Set<string>
  coastal: Set<string>
  onToggle?: (state: string) => void
  canEdit?: boolean
  labels?: { active: string; coastal: string; inactive: string }
}

export function StateTileMap({ active, coastal, onToggle, canEdit = false, labels }: Props) {
  const id = useId()
  const L = labels ?? { active: 'In footprint', coastal: 'Coastal wind/hail', inactive: 'Not filed' }
  const CELL = 30, GAP = 4, PAD = 12, LEGEND = 22
  const maxRow = Math.max(...Object.values(GRID).map(([, r]) => r)) + 1
  const W = COLS * (CELL + GAP) - GAP + PAD * 2
  const H = maxRow * (CELL + GAP) - GAP + PAD * 2 + LEGEND

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: W, height: 'auto', fontFamily: 'JetBrains Mono Variable, monospace' }}
      role="img" aria-label={`United States tile map — ${active.size} states selected; coastal wind/hail states marked.`}>
      <defs>
        <linearGradient id={`${id}-c`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#A100FF" /><stop offset="100%" stopColor="#7A00E6" />
        </linearGradient>
      </defs>
      {ALL_STATES.map(st => {
        const [col, row] = GRID[st]!
        const x = PAD + col * (CELL + GAP), y = PAD + row * (CELL + GAP)
        const isActive = active.has(st), isCoastal = coastal.has(st) && isActive
        const fill = isCoastal ? `url(#${id}-c)` : isActive ? '#8B1FE0' : '#F0F0F5'
        const textFill = isActive ? '#fff' : '#9A9CAC'
        return (
          <g key={st} onClick={() => canEdit && onToggle?.(st)} style={{ cursor: canEdit ? 'pointer' : 'default' }}
            className={canEdit ? 'hover:opacity-85 transition-opacity' : ''}>
            <title>{st}{isCoastal ? ` · ${L.coastal.toLowerCase()}` : isActive ? ` · ${L.active.toLowerCase()}` : ''}</title>
            <rect x={x} y={y} width={CELL} height={CELL} rx={7} fill={fill}
              stroke={isActive ? 'rgba(19,19,26,.10)' : 'rgba(19,19,26,.05)'} strokeWidth={1} />
            <text x={x + CELL / 2} y={y + CELL / 2 + 3.5} textAnchor="middle" fontSize={9} fontWeight={600} fill={textFill}>{st}</text>
            {isCoastal && (
              <g transform={`translate(${x + CELL - 6} ${y + 6})`}>
                <circle r={5} fill="#F59E0B" stroke="#fff" strokeWidth={0.75} />
                <path d="M0.4 -2.6 L-1.8 0.4 L-0.2 0.4 L-0.6 2.6 L1.8 -0.4 L0.2 -0.4 Z" fill="#fff" />
              </g>
            )}
          </g>
        )
      })}
      {/* Legend */}
      <g transform={`translate(${PAD} ${H - 10})`} fontSize={9} fill="#5B5C6B">
        <rect x={0} y={-9} width={12} height={12} rx={3} fill="#8B1FE0" /><text x={17} y={0}>{L.active}</text>
        <rect x={92} y={-9} width={12} height={12} rx={3} fill={`url(#${id}-c)`} />
        <circle cx={101.5} cy={-6.5} r={3} fill="#F59E0B" stroke="#fff" strokeWidth={0.5} /><text x={109} y={0}>{L.coastal}</text>
        <rect x={228} y={-9} width={12} height={12} rx={3} fill="#F0F0F5" /><text x={245} y={0}>{L.inactive}</text>
      </g>
    </svg>
  )
}
