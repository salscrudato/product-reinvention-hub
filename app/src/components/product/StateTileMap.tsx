// StateTileMap — the reusable geographic US tile map. Renders every state at its
// approximate map position; selected states fill with the brand violet, coastal
// wind/hail states get an amber bolt badge. Click to toggle when editable. Used
// for the product footprint and per-coverage state scope.
import { useId, useState, type KeyboardEvent } from 'react'
import { US_TILE_GRID as GRID, US_TILE_COLS as COLS } from '../../lib/geo/usTileGrid'

const ALL_STATES = Object.keys(GRID)

type LegendLabels = {
	active: string
	available: string
	inactive: string
	coastal?: string
}

interface Props {
	/** Selected / in-scope states for the current entity (product, coverage, option). */
	active: Set<string>
	/** States where the line's special peril applies (HO coastal wind/hail, GL territory). */
	coastal: Set<string>
	/** States in the applicable footprint; selection is restricted to this subset. Defaults to all 50. */
	footprint?: Set<string>
	onToggle?: (state: string) => void
	canEdit?: boolean
	labels?: Partial<LegendLabels>
	/** Optional aria-label override; callers can inject precise counts (e.g. "12 of 15 states selected"). */
	ariaLabel?: string
}

export function StateTileMap({ active, coastal, footprint, onToggle, canEdit = false, labels, ariaLabel }: Props) {
	const id = useId()
	const L: LegendLabels = {
		active: 'In scope',
		available: 'Available in footprint',
		inactive: 'Out of scope',
		coastal: 'Coastal wind/hail',
		...labels,
	}
	const CELL = 30
	const GAP = 4
	const PAD = 12
	const LEGEND = 26
	const maxRow = Math.max(...Object.values(GRID).map(([, r]) => r)) + 1
	const W = COLS * (CELL + GAP) - GAP + PAD * 2
	const H = maxRow * (CELL + GAP) - GAP + PAD * 2 + LEGEND

		const footprintSet = footprint ?? new Set(ALL_STATES)

	// Roving focus index for keyboard navigation across the grid.
	const [focused, setFocused] = useState<string | null>(() => {
		const firstInFootprint = ALL_STATES.find(st => footprintSet.has(st))
		return firstInFootprint ?? ALL_STATES[0]
	})

	const describeStatus = (st: string, isActive: boolean, inFootprint: boolean, isCoastal: boolean) => {
		if (!inFootprint) return `${st} — ${L.inactive}`
		if (isActive && isCoastal && L.coastal) return `${st} — ${L.active}; ${L.coastal}`
		if (isActive) return `${st} — ${L.active}`
		return `${st} — ${L.available}`
	}

	const maxRowIndex = maxRow
	const getNeighbor = (from: string, dx: number, dy: number): string => {
		const [col, row] = GRID[from]!
		let c = col + dx
		let r = row + dy
		while (r >= 0 && c >= 0 && c < COLS && r <= maxRowIndex) {
			const candidate = ALL_STATES.find(st => {
				const [sc, sr] = GRID[st]!
				return sc === c && sr === r
			})
			if (candidate) return candidate
			c += dx
			r += dy
		}
		return from
	}

	const handleKeyDown = (e: KeyboardEvent<SVGGElement>, st: string, inFootprint: boolean) => {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault()
			if (canEdit && inFootprint) onToggle?.(st)
			return
		}
		const key = e.key
		if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return
		e.preventDefault()
		const next = key === 'ArrowUp' ? getNeighbor(st, 0, -1)
			: key === 'ArrowDown' ? getNeighbor(st, 0, 1)
			: key === 'ArrowLeft' ? getNeighbor(st, -1, 0)
			: getNeighbor(st, 1, 0)
		setFocused(next)
		const el = document.querySelector<SVGGElement>(`[data-state-tile="${next}"]`)
		el?.focus()
	}

		const aria = ariaLabel ?? `United States tile map — ${active.size} of ${footprintSet.size} states selected.`

	return (
		<svg
			width="100%"
			viewBox={`0 0 ${W} ${H}`}
			style={{ maxWidth: W, height: 'auto', fontFamily: 'JetBrains Mono Variable, monospace' }}
			role="img"
			aria-label={aria}
		>
			<defs>
				<linearGradient id={`${id}-c`} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stopColor="var(--color-accent-bright)" />
					<stop offset="100%" stopColor="var(--color-accent-strong)" />
				</linearGradient>
			</defs>
			{ALL_STATES.map(st => {
				const [col, row] = GRID[st]!
				const x = PAD + col * (CELL + GAP)
				const y = PAD + row * (CELL + GAP)
				const inFootprint = footprintSet.has(st)
				const isActive = active.has(st) && inFootprint
				const isCoastal = coastal.has(st) && inFootprint

				const fill = !inFootprint
					? '#E4E4EB'  // no token — sits between raised and hover intentionally
					: isActive
						? (isCoastal ? `url(#${id}-c)` : 'var(--color-accent)')
						: 'var(--color-raised)'

				const textFill = isActive ? 'var(--color-surface)' : 'var(--color-dim)'
				const statusLabel = describeStatus(st, isActive, inFootprint, isCoastal)
				const isFocused = focused === st

				return (
					<g
						key={st}
						data-state-tile={st}
						onClick={() => canEdit && inFootprint && onToggle?.(st)}
						style={{ cursor: canEdit && inFootprint ? 'pointer' : 'default' }}
						className={canEdit && inFootprint ? 'transition-opacity hover:opacity-90' : ''}
						tabIndex={canEdit && inFootprint ? (isFocused ? 0 : -1) : -1}
						role={canEdit && inFootprint ? 'button' : 'img'}
						aria-label={statusLabel}
						aria-pressed={canEdit && inFootprint ? isActive : undefined}
						onKeyDown={e => handleKeyDown(e, st, inFootprint)}
						onFocus={() => setFocused(st)}
					>
						<title>{statusLabel}</title>
						<rect
							x={x}
							y={y}
							width={CELL}
							height={CELL}
							rx={7}
							fill={fill}
							stroke={isActive ? 'rgba(19,19,26,.10)' : 'rgba(19,19,26,.05)'}
							strokeWidth={1}
						/>
						<text
							x={x + CELL / 2}
							y={y + CELL / 2 + 3.5}
							textAnchor="middle"
							fontSize={9}
							fontWeight={600}
							fill={textFill}
						>
							{st}
						</text>
						{isCoastal && L.coastal && (
							<g transform={`translate(${x + CELL - 6} ${y + 6})`} aria-hidden="true">
								<circle r={5} fill="#F59E0B" stroke="var(--color-surface)" strokeWidth={0.75} />
								<path d="M0.4 -2.6 L-1.8 0.4 L-0.2 0.4 L-0.6 2.6 L1.8 -0.4 L0.2 -0.4 Z" fill="var(--color-surface)" />
							</g>
						)}
					</g>
				)
			})}
			{/* Legend */}
			<g transform={`translate(${PAD} ${H - 12})`} fontSize={9} fill="var(--color-dim)">
				<rect x={0} y={-9} width={12} height={12} rx={3} fill="var(--color-accent)" />
				<text x={17} y={0}>{L.active}</text>

				<rect x={120} y={-9} width={12} height={12} rx={3} fill="var(--color-raised)" />
				<text x={137} y={0}>{L.available}</text>

				<rect x={248} y={-9} width={12} height={12} rx={3} fill="#E4E4EB" />
				<text x={265} y={0}>{L.inactive}</text>

				{L.coastal && (
					<>
						<rect x={376} y={-9} width={12} height={12} rx={3} fill={`url(#${id}-c)`} />
						<circle cx={385.5} cy={-6.5} r={3} fill="#F59E0B" stroke="var(--color-surface)" strokeWidth={0.5} />
						<text x={394} y={0}>{L.coastal}</text>
					</>
				)}
			</g>
		</svg>
	)
}
