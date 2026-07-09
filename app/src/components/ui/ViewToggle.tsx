// ViewToggle — a compact segmented control for switching a collection between card,
// list and (opt-in) hierarchy layouts. Used on every browse surface (products,
// coverages) so the "cards ⇄ list ⇄ tree" affordance looks and behaves identically
// everywhere. `modes` selects which options to show (default: cards + list).
import { IconCards, IconList, IconLayers, type IconType } from './icons'

export type ViewMode = 'cards' | 'list' | 'tree'

const META: Record<ViewMode, { label: string; Icon: IconType }> = {
  cards: { label: 'Cards', Icon: IconCards },
  list:  { label: 'List',  Icon: IconList },
  tree:  { label: 'Tree',  Icon: IconLayers },
}

export function ViewToggle({ mode, onChange, modes = ['cards', 'list'] }: {
  mode: ViewMode
  onChange: (m: ViewMode) => void
  modes?: ViewMode[]
}) {
  const opt = (m: ViewMode) => {
    const { label, Icon } = META[m]
    const active = mode === m
    return (
      <button
        key={m}
        type="button"
        onClick={() => onChange(m)}
        aria-pressed={active}
        aria-label={`${label} view`}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent
          ${active ? 'bg-surface text-accent shadow-[var(--shadow-chip)]' : 'text-dim hover:text-text'}`}
        style={active ? { border: '1px solid var(--color-border)' } : undefined}
      >
        <Icon size={15} strokeWidth={active ? 1.9 : 1.6} />
        <span className="hidden sm:inline">{label}</span>
      </button>
    )
  }
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-[10px] bg-raised" role="group" aria-label="View mode">
      {modes.map(opt)}
    </div>
  )
}
