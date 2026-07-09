// PriorityRail — the Home cockpit's task rail. Shows open tasks due within a Daily
// (today + overdue) or Weekly (≤ 7 days + overdue) window, ordered due date →
// lifecycle stage → stable remainder. Read-only everywhere: rows only navigate to the
// Tasks board, so a VIEWER sees the same inquiry surface as anyone.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconTasks, IconArrowRight, IconWarning, IconCheckCircle } from '../ui/icons'
import { Badge } from '../ui'
import { prioritize, withinHorizon, toMillis, daysUntil, type Horizon } from '../../lib/homePriorities'
import type { LoadStatus } from '../../lib/useLiveCollection'
import type { Task, Product } from '@pf/shared'

type TaskDoc    = Task & { id: string }
type ProductDoc = Product & { id: string }

interface Props {
  status:   LoadStatus
  tasks:    TaskDoc[]
  products: ProductDoc[]
  now:      number
}

type BadgeColor = 'default' | 'warn' | 'danger'

// The rail surfaces only the most urgent handful; the long tail collapses into a
// single "view more" link to the board, so a big backlog never becomes a wall.
const MAX_VISIBLE = 5

/** Human due label + urgency colour from a day-bucketed offset. */
function dueBadge(dueMs: number | null, now: number): { label: string; color: BadgeColor } {
  if (dueMs == null) return { label: 'No date', color: 'default' }
  const d = daysUntil(dueMs, now)
  if (d < 0)   return { label: `${-d}d overdue`, color: 'danger' }
  if (d === 0) return { label: 'Due today', color: 'warn' }
  if (d === 1) return { label: 'Tomorrow', color: 'warn' }
  if (d <= 3)  return { label: `In ${d}d`, color: 'warn' }
  return { label: `In ${d}d`, color: 'default' }
}

export function PriorityRail({ status, tasks, products, now }: Props) {
  const navigate = useNavigate()
  const [horizon, setHorizon] = useState<Horizon>('weekly')

  // Product lookup for the row's product-name caption.
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])

  // Filter to the active window, then order. Undated tasks fall outside any window
  // (they live on the full board) — the rail is strictly deadline-driven.
  const ranked = useMemo(() => {
    const inWindow = tasks.filter(t => withinHorizon(toMillis(t.dueAt), horizon, now))
    return prioritize(inWindow)   // absolute due-date order — no `now` needed
  }, [tasks, horizon, now])

  const windowLabel = horizon === 'daily' ? 'Due today & overdue' : 'Next 7 days & overdue'

  return (
    <section aria-labelledby="rail-priorities" aria-busy={status === 'loading'}
      className="bg-surface rounded-[14px] p-4 flex flex-col gap-3"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 id="rail-priorities" className="flex items-center gap-2 text-sm font-semibold text-text">
          <IconTasks size={15} className="text-accent" aria-hidden="true" /> Priorities
        </h2>
        <button onClick={() => navigate('/app/tasks')}
          className="inline-flex items-center gap-0.5 text-xs text-dim hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
          All tasks <IconArrowRight size={12} aria-hidden="true" />
        </button>
      </div>

      {/* Daily / Weekly window toggle */}
      <div className="flex items-center justify-between gap-2">
        <div role="group" aria-label="Priority window" className="flex items-center rounded-[9px] p-0.5 bg-raised">
          {(['daily', 'weekly'] as const).map(h => (
            <button key={h} aria-pressed={horizon === h} onClick={() => setHorizon(h)}
              className={`px-2.5 py-1 rounded-[7px] text-xs font-medium capitalize transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
                ${horizon === h ? 'bg-surface text-text shadow-sm' : 'text-dim hover:text-text'}`}>
              {h}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-dim">{windowLabel}</span>
      </div>

      {/* Body: loading / error / empty / list */}
      {status === 'loading' ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2].map(i => <div key={i} className="h-11 rounded-[10px] bg-raised animate-pulse" />)}
        </div>
      ) : status === 'error' ? (
        <div className="flex items-center gap-2 text-xs text-danger py-3">
          <IconWarning size={14} aria-hidden="true" /> Couldn't load tasks. Refresh to try again.
        </div>
      ) : ranked.length === 0 ? (
        <div className="flex flex-col items-center text-center gap-1.5 py-6">
          <IconCheckCircle size={22} className="text-good" aria-hidden="true" />
          <p className="text-xs text-dim">
            {horizon === 'daily' ? 'Nothing due today.' : 'Nothing due in the next 7 days.'}
          </p>
          {horizon === 'daily' && (
            <button onClick={() => setHorizon('weekly')}
              className="text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
              See the week →
            </button>
          )}
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {ranked.slice(0, MAX_VISIBLE).map(t => {
              const due = dueBadge(toMillis(t.dueAt), now)
              const product = t.productId ? productById.get(t.productId) : undefined
              return (
                <li key={t.id}>
                  <button onClick={() => navigate('/app/tasks')}
                    className="w-full text-left flex flex-col gap-1 rounded-[10px] px-2.5 py-2 hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-sm text-text truncate">{t.title}</span>
                      <Badge label={due.label} color={due.color} />
                    </div>
                    {product && (
                      <span className="text-[11px] text-dim truncate pl-0.5">{product.name}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {ranked.length > MAX_VISIBLE && (
            <button onClick={() => navigate('/app/tasks')}
              className="w-full inline-flex items-center justify-center gap-1 rounded-[9px] px-2.5 py-2 text-xs font-medium text-dim hover:text-accent hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              View {ranked.length - MAX_VISIBLE} more in Tasks <IconArrowRight size={12} aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </section>
  )
}
