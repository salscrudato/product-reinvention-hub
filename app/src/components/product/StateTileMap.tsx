// StateTileMap — the reusable geographic US tile map, and the single component
// behind all three state-scope surfaces: product footprint, per-coverage scope,
// and per-option applicability. Every state renders at its approximate map
// position; the caller supplies the *footprint* (the selectable denominator, so a
// count can never exceed 100%), the currently in-scope `active` set, and the
// line's `peril` model straight from the LOB registry. Peril overlay is fully
// registry-driven: Homeowners' COASTAL_WIND_HAIL states earn an amber wind/hail
// badge; General Liability's TERRITORY model carries no coastal states, so the
// same component simply renders no badge — no line-specific code lives here.
//
// Interaction: hover to preview, click to toggle, and full keyboard operation —
// roving tabindex + arrow keys (skipping straight to the next selectable state) +
// Space/Enter to toggle, with a focus ring that stays visible on any tile fill.
// Fills are design tokens (no raw hex) and transition smoothly, neutralised under
// prefers-reduced-motion by the global rule in index.css.
import { useId, useState, type KeyboardEvent } from 'react'
import type { PerilRule } from '@pf/shared'
import { US_TILE_GRID as GRID, US_TILE_COLS as COLS } from '../../lib/geo/usTileGrid'

const ALL_STATES = Object.keys(GRID)

type LegendLabels = {
	active: string
	available: string
	inactive: string
	/** Peril overlay label; defaults to the registry peril model's own label. */
	peril: string
}

interface Props {
	/** Selected / in-scope states for the current entity (product, coverage, option). */
	active: Set<string>
	/** The selectable footprint — the denominator for every count. Selection and
	 *  the peril overlay are both clipped to this set, so nothing can exceed 100%. */
	footprint: Set<string>
	/** The line's peril model from the LOB registry (`lob.perilModel`). Drives the
	 *  peril badge + legend: COASTAL_WIND_HAIL badges its eligible states, TERRITORY
	 *  (e.g. GL) carries none and renders badge-free. Never hard-code peril facts. */
	peril: PerilRule
	onToggle?: (state: string) => void
	canEdit?: boolean
	labels?: Partial<LegendLabels>
	/** aria-label override; callers can inject precise counts (e.g. "12 of 15 …"). */
	ariaLabel?: string
}

// Tile + layout geometry (SVG user units).
const CELL = 30
const GAP = 4
const PAD = 12
const LEGEND_ROW = 15   // height of one wrapped legend line
const LEGEND_GAP = 14   // gap between the grid and the legend
const CHAR_W = 5.4      // approx monospace glyph advance at 9px — for legend wrapping
const SW = 12           // legend swatch size
const SW_GAP = 5        // swatch → label gap
const ITEM_GAP = 18     // gap between legend items

const maxRow = Math.max(...Object.values(GRID).map(([, r]) => r))
const gridW = COLS * (CELL + GAP) - GAP
const gridH = (maxRow + 1) * (CELL + GAP) - GAP
const W = gridW + PAD * 2

// The wind/hail bolt badge shown on peril-eligible states (and in the legend).
function PerilBadge({ tx, ty, r = 5 }: { tx: number; ty: number; r?: number }) {
	const s = r / 5 // scale the bolt with the disc
	return (
		<g transform={`translate(${tx} ${ty})`} aria-hidden="true">
			<circle r={r} fill="var(--color-peril)" stroke="var(--color-surface)" strokeWidth={0.75} />
			<path
				d="M0.4 -2.6 L-1.8 0.4 L-0.2 0.4 L-0.6 2.6 L1.8 -0.4 L0.2 -0.4 Z"
				transform={`scale(${s})`}
				fill="var(--color-surface)"
			/>
		</g>
	)
}

export function StateTileMap({ active, footprint, peril, onToggle, canEdit = false, labels, ariaLabel }: Props) {
	const id = useId()
	const grad = `${id}-grad`
	const L: LegendLabels = {
		active: 'In scope',
		available: 'Available in footprint',
		inactive: 'Out of scope',
		peril: peril.label,
		...labels,
	}

	// Peril-eligible states, clipped to the footprint — a coastal state outside the
	// footprint earns no badge. Empty for TERRITORY / NONE lines (e.g. GL), so the
	// overlay and its legend entry simply don't render.
	const perilSet = new Set(peril.eligibleStates.filter(st => footprint.has(st)))
	const showPeril = perilSet.size > 0

	// The selected count, always intersected with the footprint — this is what keeps
	// a count from ever exceeding 100%, regardless of what the caller passes as
	// `active`.
	let selectedInScope = 0
	for (const st of active) if (footprint.has(st)) selectedInScope++

	// Roving focus index for keyboard navigation. Always an in-footprint (i.e.
	// selectable) state so exactly one tile is tab-reachable.
	const [focused, setFocused] = useState<string | null>(
		() => ALL_STATES.find(st => footprint.has(st)) ?? null,
	)

	const describeStatus = (st: string, isActive: boolean, inFootprint: boolean, isPeril: boolean) => {
		if (!inFootprint) return `${st} — ${L.inactive}`
		const perilNote = isPeril ? `; ${L.peril}` : ''
		return `${st} — ${isActive ? L.active : L.available}${perilNote}`
	}

	// Next selectable (in-footprint) state in a direction — arrow keys skip straight
	// past empty cells and out-of-scope tiles so keyboard users only land on tiles
	// they can actually toggle.
	const getNeighbor = (from: string, dx: number, dy: number): string => {
		const [col, row] = GRID[from]!
		let c = col + dx
		let r = row + dy
		while (r >= 0 && c >= 0 && c < COLS && r <= maxRow) {
			const candidate = ALL_STATES.find(st => {
				const [sc, sr] = GRID[st]!
				return sc === c && sr === r
			})
			if (candidate && footprint.has(candidate)) return candidate
			c += dx
			r += dy
		}
		return from
	}

	const handleKeyDown = (e: KeyboardEvent<SVGGElement>, st: string) => {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault()
			onToggle?.(st)
			return
		}
		const k = e.key
		if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'ArrowLeft' && k !== 'ArrowRight') return
		e.preventDefault()
		const next = k === 'ArrowUp' ? getNeighbor(st, 0, -1)
			: k === 'ArrowDown' ? getNeighbor(st, 0, 1)
			: k === 'ArrowLeft' ? getNeighbor(st, -1, 0)
			: getNeighbor(st, 1, 0)
		setFocused(next)
		document.querySelector<SVGGElement>(`[data-state-tile="${next}"]`)?.focus()
	}

	// Legend items, laid out left-to-right and wrapped to new rows when they would
	// overflow — robust to any label length or a hidden peril entry.
	const legendItems: { kind: 'active' | 'available' | 'inactive' | 'peril'; label: string }[] = [
		{ kind: 'active', label: L.active },
		{ kind: 'available', label: L.available },
		{ kind: 'inactive', label: L.inactive },
	]
	if (showPeril) legendItems.push({ kind: 'peril', label: L.peril })

	let lx = 0
	let lrow = 0
	const placed = legendItems.map(it => {
		const w = SW + SW_GAP + it.label.length * CHAR_W
		if (lx > 0 && lx + w > gridW) { lx = 0; lrow += 1 }
		const pos = { ...it, x: lx, row: lrow }
		lx += w + ITEM_GAP
		return pos
	})
	const legendTop = PAD + gridH + LEGEND_GAP
	const H = legendTop + (lrow + 1) * LEGEND_ROW

	const interactiveMap = canEdit
	const aria = ariaLabel ?? `United States state map — ${selectedInScope} of ${footprint.size} states selected.`

	return (
		<svg
			width="100%"
			viewBox={`0 0 ${W} ${H}`}
			style={{ maxWidth: W, height: 'auto', fontFamily: 'JetBrains Mono Variable, monospace' }}
			role={interactiveMap ? 'group' : 'img'}
			aria-label={aria}
		>
			<defs>
				<linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stopColor="var(--color-accent-bright)" />
					<stop offset="100%" stopColor="var(--color-accent-strong)" />
				</linearGradient>
			</defs>

			{ALL_STATES.map(st => {
				const [col, row] = GRID[st]!
				const x = PAD + col * (CELL + GAP)
				const y = PAD + row * (CELL + GAP)
				const inFootprint = footprint.has(st)
				const isActive = active.has(st) && inFootprint
				const isPeril = perilSet.has(st)
				const interactive = canEdit && inFootprint

				const fill = !inFootprint
					? 'var(--color-tile-oos)'
					: isActive
						? (isPeril ? `url(#${grad})` : 'var(--color-accent)')
						: 'var(--color-raised)'
				// Out-of-scope tiles also get a dashed border so they read as unavailable
				// without relying on colour alone (colour-blind / low-vision safe).
				const strokeColor = isActive ? 'var(--color-border-strong)' : 'var(--color-border)'
				const textFill = isActive ? 'var(--color-surface)' : 'var(--color-dim)'
				const statusLabel = describeStatus(st, isActive, inFootprint, isPeril)

				return (
					<g
						key={st}
						className="state-tile"
						data-state-tile={st}
						data-interactive={interactive ? 'true' : undefined}
						onClick={() => interactive && onToggle?.(st)}
						style={{ cursor: interactive ? 'pointer' : 'default' }}
						tabIndex={interactive ? (focused === st ? 0 : -1) : -1}
						role={interactive ? 'button' : undefined}
						aria-label={interactive ? statusLabel : undefined}
						aria-pressed={interactive ? isActive : undefined}
						onKeyDown={interactive ? e => handleKeyDown(e, st) : undefined}
						onFocus={() => interactive && setFocused(st)}
					>
						<title>{statusLabel}</title>
						{interactive && (
							// Base `opacity=0` is a presentation attribute (lower priority than the
							// `:focus-visible` CSS rule that reveals it), so the ring stays hidden even
							// when the stylesheet is absent — e.g. in the serialised SVG export.
							<rect
								className="state-tile__ring"
								x={x - 3}
								y={y - 3}
								width={CELL + 6}
								height={CELL + 6}
								rx={10}
								fill="none"
								stroke="var(--color-accent)"
								strokeWidth={2}
								opacity={0}
							/>
						)}
						<rect
							className="state-tile__cell"
							x={x}
							y={y}
							width={CELL}
							height={CELL}
							rx={7}
							fill={fill}
							stroke={strokeColor}
							strokeWidth={1}
							strokeDasharray={inFootprint ? undefined : '3 2'}
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
						{isPeril && <PerilBadge tx={x + CELL - 6} ty={y + 6} />}
					</g>
				)
			})}

			{/* Legend — wraps across rows as needed. */}
			<g transform={`translate(${PAD} ${legendTop})`} fontSize={9} fill="var(--color-dim)">
				{placed.map((p, i) => (
					<g key={i} transform={`translate(${p.x} ${p.row * LEGEND_ROW})`}>
						{p.kind === 'peril' ? (
							<>
								<rect x={0} y={0} width={SW} height={SW} rx={3} fill={`url(#${grad})`} />
								<PerilBadge tx={SW - 2.5} ty={2.5} r={3} />
							</>
						) : (
							<rect
								x={0}
								y={0}
								width={SW}
								height={SW}
								rx={3}
								fill={
									p.kind === 'active' ? 'var(--color-accent)'
										: p.kind === 'available' ? 'var(--color-raised)'
											: 'var(--color-tile-oos)'
								}
								stroke={p.kind === 'active' ? 'var(--color-border-strong)' : 'var(--color-border)'}
								strokeWidth={1}
								strokeDasharray={p.kind === 'inactive' ? '3 2' : undefined}
							/>
						)}
						<text x={SW + SW_GAP} y={9.5}>{p.label}</text>
					</g>
				))}
			</g>
		</svg>
	)
}
