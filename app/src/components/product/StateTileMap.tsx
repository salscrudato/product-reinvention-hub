// StateTileMap — the reusable geographic US map, and the single component behind
// all three state-scope surfaces: product footprint, per-coverage scope, and
// per-option applicability. Every state renders as its real outline in the d3
// albersUsa projection (Alaska & Hawaii as compact lower-left insets); the caller
// supplies the *footprint* (the selectable denominator, so a count can never exceed
// 100%), the currently in-scope `active` set, and the line's `peril` model straight
// from the LOB registry. The crowded north-eastern seaboard + DC are labelled with
// external leaders so their codes never collide (the pill doubles as a large hit
// target for shapes too small to click).
//
// Peril overlay is fully registry-driven: Homeowners' COASTAL_WIND_HAIL states earn
// an amber wind/hail badge; Personal Auto's TERRITORY model carries no coastal
// states, so the same component renders no badge — no line-specific code lives here.
//
// Interaction: hover to preview (native <title>), click to toggle, and full keyboard
// operation — roving tabindex + arrow keys (stepping to the nearest selectable state
// in that direction) + Space/Enter to toggle, with a focus ring that stays visible on
// any fill. Fills are design tokens (no raw hex) and transition smoothly, neutralised
// under prefers-reduced-motion by the global rule in index.css.
import { useId, useState, type KeyboardEvent } from 'react'
import type { PerilRule } from '@pf/shared'
import {
	US_STATE_PATHS as PATHS,
	US_STATE_ANCHORS as ANCHORS,
	US_EXTERNAL_LABEL_STATES,
} from '../../lib/geo/usStatePaths'

const ALL_STATES = Object.keys(PATHS)

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
	/** Optional peril model; omit to suppress the coastal overlay and legend entry entirely. */
	peril?: PerilRule
	onToggle?: (state: string) => void
	canEdit?: boolean
	labels?: Partial<LegendLabels>
	/** aria-label override; callers can inject precise counts (e.g. "12 of 15 …"). */
	ariaLabel?: string
}

// ─── Layout geometry (SVG user units, in the projection's 0 0 959 593 frame) ────
const MAP_W = 959
const MAP_H = 593
const PILL_W = 32          // external-label pill
const PILL_H = 18
const PILL_X = 982         // left edge of the external-label column (right gutter)
const COL_TOP = 60         // first external pill's top
const COL_GAP = 30         // vertical stride between external pills
const RIGHT_EDGE = PILL_X + PILL_W + 8
const MINX = -4
const MINY = -4
const LEGEND_GAP = 18      // map bottom → legend
const LEGEND_ROW = 15
const CHAR_W = 5.4         // approx glyph advance at 9px — for legend wrapping
const SW = 12              // legend swatch size
const SW_GAP = 5
const ITEM_GAP = 18

// The wind/hail bolt badge shown on peril-eligible states (and in the legend).
function PerilBadge({ tx, ty, r = 5 }: { tx: number; ty: number; r?: number }) {
	const s = r / 5
	return (
		<g transform={`translate(${tx} ${ty})`} aria-hidden="true" style={{ pointerEvents: 'none' }}>
			<circle r={r} fill="var(--color-peril)" stroke="var(--color-surface)" strokeWidth={0.9} />
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
		peril: peril?.label ?? '',
		...labels,
	}

	const perilSet = new Set(peril ? peril.eligibleStates.filter(st => footprint.has(st)) : [])
	const showPeril = perilSet.size > 0

	// The selected count, always intersected with the footprint — this keeps a count
	// from ever exceeding 100%, regardless of what the caller passes as `active`.
	let selectedInScope = 0
	for (const st of active) if (footprint.has(st)) selectedInScope++

	// External-label column (crowded NE seaboard + DC), ordered north→south so the
	// leaders never cross. Only footprint membership decides interactivity; the pill
	// is a generous hit target for shapes too small to click (RI, DE, DC…).
	const externalOrder = US_EXTERNAL_LABEL_STATES
		.filter(st => ALL_STATES.includes(st))
		.slice()
		.sort((a, b) => ANCHORS[a]![1] - ANCHORS[b]![1])
	const externalPos = new Map<string, number>() // state → pill top y
	externalOrder.forEach((st, i) => externalPos.set(st, COL_TOP + i * COL_GAP))

	// Roving focus index — always an in-footprint (selectable) state so exactly one
	// element is tab-reachable, matching the tile-map's a11y model.
	const [focused, setFocused] = useState<string | null>(
		() => ALL_STATES.find(st => footprint.has(st)) ?? null,
	)
	const focusFallback = focused && footprint.has(focused) ? focused : (ALL_STATES.find(st => footprint.has(st)) ?? null)

	const describeStatus = (st: string, isActive: boolean, inFootprint: boolean) => {
		if (!inFootprint) return `${st} — ${L.inactive}`
		return `${st} — ${isActive ? L.active : L.available}`
	}

	// Nearest selectable state in a direction, by anchor geometry — so arrow keys
	// step across the irregular map to the visually-nearest toggleable neighbour.
	const step = (from: string, dir: 'up' | 'down' | 'left' | 'right'): string => {
		const [fx, fy] = ANCHORS[from]!
		let best = from
		let bestScore = Infinity
		for (const st of ALL_STATES) {
			if (st === from || !footprint.has(st)) continue
			const [x, y] = ANCHORS[st]!
			const dx = x - fx
			const dy = y - fy
			let primary: number
			let cross: number
			if (dir === 'left') { if (dx >= -1) continue; primary = -dx; cross = Math.abs(dy) }
			else if (dir === 'right') { if (dx <= 1) continue; primary = dx; cross = Math.abs(dy) }
			else if (dir === 'up') { if (dy >= -1) continue; primary = -dy; cross = Math.abs(dx) }
			else { if (dy <= 1) continue; primary = dy; cross = Math.abs(dx) }
			const score = primary + cross * 2 // weight alignment so we track a row/column
			if (score < bestScore) { bestScore = score; best = st }
		}
		return best
	}

	const handleKeyDown = (e: KeyboardEvent<SVGGElement>, st: string) => {
		if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle?.(st); return }
		const k = e.key
		if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'ArrowLeft' && k !== 'ArrowRight') return
		e.preventDefault()
		const next = k === 'ArrowUp' ? step(st, 'up')
			: k === 'ArrowDown' ? step(st, 'down')
				: k === 'ArrowLeft' ? step(st, 'left')
					: step(st, 'right')
		setFocused(next)
		document.querySelector<SVGGElement>(`[data-state-tile="${next}"]`)?.focus()
	}

	// Legend items, laid out left-to-right and wrapped to new rows on overflow.
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
		if (lx > 0 && lx + w > MAP_W) { lx = 0; lrow += 1 }
		const pos = { ...it, x: lx, row: lrow }
		lx += w + ITEM_GAP
		return pos
	})
	const legendTop = MAP_H + LEGEND_GAP
	const bottom = legendTop + (lrow + 1) * LEGEND_ROW
	const VBW = RIGHT_EDGE - MINX
	const VBH = bottom - MINY

	const interactiveMap = canEdit
	const aria = ariaLabel ?? `United States map — ${selectedInScope} of ${footprint.size} states selected.`

	// Per-state fills, shared by the shape and its external pill.
	const shapeFill = (isActive: boolean, inFootprint: boolean, isPeril: boolean) =>
		!inFootprint ? 'var(--color-tile-oos)'
			: isActive ? (isPeril ? `url(#${grad})` : 'var(--color-accent)')
				: 'var(--color-raised)'

	return (
		<svg
			width="100%"
			viewBox={`${MINX} ${MINY} ${VBW} ${VBH}`}
			style={{ maxWidth: VBW, height: 'auto', fontFamily: 'JetBrains Mono Variable, monospace' }}
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
				const [ax, ay] = ANCHORS[st]!
				const inFootprint = footprint.has(st)
				const isActive = active.has(st) && inFootprint
				const isPeril = perilSet.has(st)
				const interactive = canEdit && inFootprint
				const fill = shapeFill(isActive, inFootprint, isPeril)
				const stroke = isActive ? 'var(--color-border-strong)' : 'var(--color-border)'
				const textFill = isActive ? 'var(--color-surface)' : 'var(--color-dim)'
				const statusLabel = describeStatus(st, isActive, inFootprint)
				const ext = externalPos.get(st)

				return (
					<g
						key={st}
						className="usmap-state"
						data-state-tile={st}
						data-interactive={interactive ? 'true' : undefined}
						onClick={() => interactive && onToggle?.(st)}
						style={{ cursor: interactive ? 'pointer' : 'default' }}
						tabIndex={interactive ? (focusFallback === st ? 0 : -1) : -1}
						role={interactive ? 'button' : undefined}
						aria-label={interactive ? statusLabel : undefined}
						aria-pressed={interactive ? isActive : undefined}
						onKeyDown={interactive ? e => handleKeyDown(e, st) : undefined}
						onFocus={() => interactive && setFocused(st)}
					>
						<title>{statusLabel}</title>
						<path
							className="usmap-state__shape"
							d={PATHS[st]}
							fill={fill}
							stroke={stroke}
							strokeWidth={0.75}
							strokeLinejoin="round"
							strokeDasharray={inFootprint ? undefined : '2.5 2'}
						/>

						{ext === undefined ? (
							<>
								<text
									x={ax} y={ay + 3} textAnchor="middle" fontSize={11} fontWeight={600}
									fill={textFill} style={{ pointerEvents: 'none' }}
								>
									{st}
								</text>
								{isPeril && <PerilBadge tx={ax + 13} ty={ay - 3} r={4.5} />}
							</>
						) : (
							<ExternalLabel
								st={st} ax={ax} ay={ay} top={ext}
								fill={fill} stroke={stroke} textFill={textFill}
							/>
						)}
					</g>
				)
			})}

			{/* Legend — wraps across rows as needed. */}
			<g transform={`translate(0 ${legendTop})`} fontSize={9} fill="var(--color-dim)">
				{placed.map((p, i) => (
					<g key={i} transform={`translate(${p.x} ${p.row * LEGEND_ROW})`}>
						{p.kind === 'peril' ? (
							<>
								<rect x={0} y={0} width={SW} height={SW} rx={3} fill={`url(#${grad})`} />
								<PerilBadge tx={SW - 2.5} ty={2.5} r={3} />
							</>
						) : (
							<rect
								x={0} y={0} width={SW} height={SW} rx={3}
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

// ─── External leader label (crowded NE states + DC) ─────────────────────────────
// A short leader from the state's anchor to a pill in the right gutter. The pill and
// the leader dot sit inside the state's interactive <g>, so clicking the pill toggles
// the state even when its outline is too small to hit.
function ExternalLabel({ st, ax, ay, top, fill, stroke, textFill }: {
	st: string; ax: number; ay: number; top: number; fill: string; stroke: string; textFill: string
}) {
	const cy = top + PILL_H / 2
	return (
		<>
			<line
				x1={ax} y1={ay} x2={PILL_X} y2={cy}
				stroke="var(--color-border-strong)" strokeWidth={0.75}
				style={{ pointerEvents: 'none' }}
			/>
			<circle cx={ax} cy={ay} r={1.6} fill="var(--color-border-strong)" style={{ pointerEvents: 'none' }} />
			<rect
				className="usmap-state__pill"
				x={PILL_X} y={top} width={PILL_W} height={PILL_H} rx={5}
				fill={fill} stroke={stroke} strokeWidth={1}
			/>
			<text
				x={PILL_X + PILL_W / 2} y={cy + 3} textAnchor="middle"
				fontSize={10} fontWeight={600} fill={textFill} style={{ pointerEvents: 'none' }}
			>
				{st}
			</text>
		</>
	)
}
