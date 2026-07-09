// ActiveFilters — the removable pills above the results, plus Clear all. Entity-agnostic:
// it renders whatever chips the engine produced. A visually-hidden live region announces
// the result count to screen readers as filters change.

import { IconClose } from '../../components/ui/icons'
import type { ActiveChip } from './facetTypes'

interface ActiveFiltersProps {
  chips: ActiveChip[]
  onRemove: (chip: ActiveChip) => void
  onClearAll: () => void
  resultCount: number
  total: number
}

export function ActiveFilters({ chips, onRemove, onClearAll, resultCount, total }: ActiveFiltersProps) {
  const announcement = `${resultCount} of ${total} result${resultCount === 1 ? '' : 's'}${chips.length ? ', filtered' : ''}`

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* SR-only live count — announced whenever results change. */}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>

      <span className="text-xs text-faint tnum shrink-0" aria-hidden="true">
        {resultCount} of {total}
      </span>

      {chips.length > 0 && (
        <>
          <span className="w-px h-4 self-center" style={{ background: 'var(--color-border-strong)' }} aria-hidden="true" />
          <ul className="flex items-center gap-1.5 flex-wrap m-0 p-0 list-none">
            {chips.map((chip) => (
              <li key={`${chip.facetId}:${chip.role}:${chip.value}`} className="chip-in">
                <button
                  onClick={() => onRemove(chip)}
                  className="group inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  style={{ background: 'var(--color-accent-soft)' }}
                  aria-label={`Remove filter ${chip.label}`}
                >
                  <span>{chip.label}</span>
                  <IconClose size={12} className="opacity-60 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={onClearAll}
            className="text-xs font-medium text-dim hover:text-text transition-colors ml-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent rounded-[4px] px-1"
          >
            Clear all
          </button>
        </>
      )}
    </div>
  )
}
