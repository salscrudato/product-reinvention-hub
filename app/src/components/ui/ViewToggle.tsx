// ViewToggle — a compact segmented control for switching a collection between
// card and list layouts. Used on every browse surface (products, coverages) so
// the "cards ⇄ list" affordance looks and behaves identically everywhere.
import { IconCards, IconList } from './icons'

export type ViewMode = 'cards' | 'list'

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const opt = (m: ViewMode, label: string, Icon: typeof IconCards) => {
    const active = mode === m
    return (
      <button
        type="button"
        onClick={() => onChange(m)}
        aria-pressed={active}
        aria-label={`${label} view`}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent
          ${active ? 'bg-surface text-accent shadow-[0_1px_2px_rgba(19,19,26,.06)]' : 'text-dim hover:text-text'}`}
        style={active ? { border: '1px solid var(--color-border)' } : undefined}
      >
        <Icon size={15} strokeWidth={active ? 1.9 : 1.6} />
        <span className="hidden sm:inline">{label}</span>
      </button>
    )
  }
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-[10px] bg-raised" role="group" aria-label="View mode">
      {opt('cards', 'Cards', IconCards)}
      {opt('list', 'List', IconList)}
    </div>
  )
}
