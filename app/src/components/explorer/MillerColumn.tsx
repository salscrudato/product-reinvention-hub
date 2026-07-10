// MillerColumn — one column of the Explorer's left-to-right cascade. A generic,
// line-agnostic listbox: it knows nothing about products vs. coverages, only about
// the minimal `ColumnItem` shape. Selection + keyboard focus are driven entirely by
// the parent (Explorer.tsx) so the whole cascade shares one nav model; this component
// just renders items, the per-column loading / empty states, and registers each
// option's element for roving-focus management.
import { Skeleton, EmptyState } from '../ui'
import type { IconType } from '../ui/icons'
import { IconChevronRight, IconSearch } from '../ui/icons'

export interface ColumnItem {
  id:           string          // Firestore doc id — the stable key + selection value
  refId?:       string | null   // human ref (HO.COV.001) — load-bearing, shown as a chip
  title:        string
  meta?:        string          // small trailing note (requirement, term count, …)
  hasChildren?: boolean         // draws the descend chevron
}

interface MillerColumnProps {
  label:      string            // column header (Products / Coverages / Sub-coverages)
  icon:       IconType
  colKind:    string            // 'product' | 'coverage' | 'sub' — namespaces option ids
  items:      ColumnItem[]      // already filtered by the active query
  totalCount: number            // unfiltered size, for the "n of m" header read-out
  selectedId: string | null
  focused:    boolean           // is this the keyboard-focused column?
  loading?:   boolean
  query:      string            // for match highlighting + empty-state copy
  emptyTitle: string
  emptyHint?: string
  onSelect:   (id: string) => void   // single click — select (reveals downstream)
  onActivate: (id: string) => void   // Enter / double click — descend or open
  registerRef: (key: string, el: HTMLButtonElement | null) => void
}

// Highlight the query substring inside a title so search hits are scannable.
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-accent-soft text-accent not-italic rounded-[2px]">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

export function MillerColumn({
  label, icon: Icon, colKind, items, totalCount, selectedId, focused,
  loading, query, emptyTitle, emptyHint, onSelect, onActivate, registerRef,
}: MillerColumnProps) {
  const listId = `explorer-col-${colKind}`

  return (
    <section
      className="col-in flex flex-col flex-1 min-w-[240px] rounded-[14px] bg-surface overflow-hidden"
      style={{ border: `1px solid ${focused ? 'var(--color-accent-line)' : 'var(--color-border)'}` }}
    >
      {/* Header — icon, label, and a filtered/total count so the state is legible. */}
      <header
        className="flex items-center gap-2 px-3 py-2.5 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)', background: focused ? 'var(--color-accent-soft)' : 'var(--color-raised)' }}
      >
        <Icon size={15} className={focused ? 'text-accent' : 'text-faint'} aria-hidden="true" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[.09em] text-dim flex-1 truncate">{label}</h2>
        <span className="text-[11px] text-faint tnum shrink-0">
          {query && !loading ? `${items.length}/${totalCount}` : totalCount}
        </span>
      </header>

      {/* Body — one of: loading skeletons, empty state, or the option list. */}
      {/* Roving-tabindex listbox: real DOM focus moves to the selected option (managed
          by Explorer), so we deliberately don't also use aria-activedescendant. */}
      <div
        role="listbox"
        aria-label={label}
        className="flex-1 min-h-0 overflow-y-auto p-1.5 flex flex-col gap-0.5"
      >
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-2 py-2">
              <Skeleton className="h-3.5 w-3/4 mb-1.5" />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex-1 grid place-items-center p-3">
            <EmptyState
              icon={<IconSearch size={26} />}
              title={query ? `No matches for "${query}"` : emptyTitle}
              description={query ? undefined : emptyHint}
              compact
            />
          </div>
        ) : (
          items.map((item) => {
            const selected = item.id === selectedId
            return (
              <button
                key={item.id}
                id={`${listId}-opt-${item.id}`}
                ref={(el) => registerRef(`${colKind}:${item.id}`, el)}
                role="option"
                aria-selected={selected}
                tabIndex={focused && selected ? 0 : -1}
                onClick={() => onSelect(item.id)}
                onDoubleClick={() => onActivate(item.id)}
                className={`group w-full text-left rounded-[9px] px-2.5 py-2 flex items-center gap-2 transition-colors outline-none
                  focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent
                  ${selected && focused ? 'bg-accent text-on-accent'
                    : selected ? 'bg-accent-soft text-accent'
                    : 'text-text hover:bg-raised'}`}
              >
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-sm font-medium truncate leading-snug">
                    <Highlight text={item.title} query={query} />
                  </span>
                  {item.meta && (
                    <span className={`text-[11px] truncate ${selected && focused ? 'text-on-accent/85' : 'text-faint'}`}>
                      {item.meta}
                    </span>
                  )}
                </span>
                {item.hasChildren && (
                  <IconChevronRight
                    size={15}
                    className={`shrink-0 ${selected && focused ? 'text-on-accent/80' : 'text-faint group-hover:text-dim'}`}
                    aria-hidden="true"
                  />
                )}
              </button>
            )
          })
        )}
      </div>
    </section>
  )
}
