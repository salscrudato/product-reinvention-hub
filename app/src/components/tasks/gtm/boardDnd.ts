// boardDnd — the board's drag-and-drop write path, extracted pure (taskEdits.ts pattern:
// injected mutate, node-testable). A drop is ONE atomic update of { column } with the
// optimistic-lock rev — never order, never a batch — behind the same optimistic-overlay +
// rollback contract as the done-toggle. boardDnd.test.ts pins the payload byte-for-byte.
import { MutationConflictError } from '../../../lib/backend/types'
import type { MutationPayload } from '../../../lib/backend/types'
import type { TaskColumn } from '@pf/shared'
import { GTM_COLUMNS, type TaskDoc } from './gtm'

/** The slice of a dnd-kit DragEndEvent this module needs (kept structural for tests). */
export interface DropEventLike {
  active: { id: string | number }
  over: { id: string | number } | null
}

export interface Actor { uid: string; name: string }

/** Resolve a drag-end event to a concrete move, or null for every no-op case:
 *  dropped outside a column, on a non-column id, on its own column, or an unknown task. */
export function resolveDrop(e: DropEventLike, tasks: TaskDoc[]): { task: TaskDoc; toColumn: TaskColumn } | null {
  const toColumn = e.over?.id as TaskColumn | undefined
  if (!toColumn || !GTM_COLUMNS.some(c => c.id === toColumn)) return null
  const task = tasks.find(t => t.id === e.active.id)
  if (!task || task.column === toColumn) return null
  return { task, toColumn }
}

/** EXACTLY the board's historical write: op:'update', data:{ column } ONLY, expectedRev. */
export function moveTaskPayload(task: TaskDoc, toColumn: TaskColumn, actor: Actor): MutationPayload {
  return {
    op: 'update', path: `tasks/${task.id}`, data: { column: toColumn },
    entityType: 'task', productId: task.productId, actor, expectedRev: task.rev,
  }
}

/** Optimistic overlay → mutate → rollback + honest classification on failure.
 *  `setOverride(id, patch)` merges a patch into the board's overlay map; `null` clears
 *  the task's entry (the historical rollback semantics). */
export async function commitMove(args: {
  task: TaskDoc
  toColumn: TaskColumn
  actor: Actor
  mutate: (m: MutationPayload) => Promise<unknown>
  setOverride: (id: string, patch: Partial<TaskDoc> | null) => void
}): Promise<'moved' | 'conflict' | 'error'> {
  const { task, toColumn, actor, mutate, setOverride } = args
  setOverride(task.id, { column: toColumn })
  try {
    await mutate(moveTaskPayload(task, toColumn, actor))
    return 'moved'
  } catch (err) {
    setOverride(task.id, null)
    return err instanceof MutationConflictError ? 'conflict' : 'error'
  }
}
