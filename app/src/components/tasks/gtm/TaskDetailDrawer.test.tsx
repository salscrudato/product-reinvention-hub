// @vitest-environment jsdom
// DOM-behaviour tests for the task-detail slide-over: it opens on click, traps into the
// panel, closes on Esc and restores focus to the trigger; the contextual lens renders ONLY
// when the project links a product (else the honest empty state); and a VIEWER sees the
// panel with no writable controls and no reachable save. The backend adapter is mocked so
// nothing touches Firebase and mutate() can be asserted.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import type { TaskDoc, ProjectDoc } from './gtm'

const PID = 'PH.PROD.001'

// Mock the adapter: no Firebase, spyable mutate, and a subscribe that resolves the product
// context so the lens can render when a product is linked.
vi.mock('../../../lib/backend', () => {
  class MutationConflictError extends Error {}
  return {
    MutationConflictError,
    adapter: {
      db: {
        mutate: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn((pathOrQuery: unknown, cb: (d: unknown) => void) => {
          const p = String(pathOrQuery)
          if (p === `products/${PID}`) {
            cb({ id: PID, name: 'Personal Home HO-3', lob: { refId: 'PH', name: 'Homeowners' }, allStates: true, states: [], lifecycle: 'LAUNCHED' })
          } else {
            cb([])   // every sub-collection + global collection resolves empty
          }
          return () => {}
        }),
      },
      fns: { stream: vi.fn().mockResolvedValue(undefined) },
    },
  }
})

import { adapter, MutationConflictError } from '../../../lib/backend'

const actor = { uid: 'u1', name: 'PM' }

function makeTask(overrides: Partial<TaskDoc> = {}): TaskDoc {
  return {
    id: 't1', title: 'Develop rating plan', column: 'BUILD_FILE',
    productId: PID, projectId: 'P1', origin: 'seeded',
    phaseL2: 'Product Design', groupL3: 'Product Pricing', taskL4: 'Develop rating plan',
    phaseOrder: 2, slaDays: 5, ownerRole: 'Product Mgr.', typeOfWork: 'Analytical',
    dueAt: '2027-01-15', startDate: '2027-01-08', ongoing: false, order: 42,
    checklist: [], done: false, rev: 3,
    status: 'ACTIVE', lifecycle: 'DRAFT', reviewStatus: 'NOT_STARTED',
    createdAt: null, updatedAt: null, updatedBy: 'u1',
    ...overrides,
  } as TaskDoc
}
const project = (productId: string | null): ProjectDoc => ({
  id: 'P1', refId: 'PRJ.001', name: 'HO-3 Launch', description: '', productId,
  targetLaunchDate: '2027-03-01', status: 'active', owner: actor,
  createdAt: null, updatedAt: null, rev: 1,
} as ProjectDoc)

// A trigger button that opens the drawer — the real board wiring in miniature.
function Harness({ task, proj, canEdit }: { task: TaskDoc; proj: ProjectDoc; canEdit: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <MemoryRouter>
      <button data-testid="trigger" onClick={() => setOpen(true)}>Open task</button>
      {open && <TaskDetailDrawer task={task} project={proj} canEdit={canEdit} actor={actor} onClose={() => setOpen(false)} />}
    </MemoryRouter>
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('TaskDetailDrawer — a11y', () => {
  it('opens on click, moves focus into the panel, Esc closes and focus returns to the trigger', async () => {
    render(<Harness task={makeTask()} proj={project(null)} canEdit />)
    const trigger = screen.getByTestId('trigger')
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeTruthy()
    // Focus moved off the trigger and into the panel (or onto the panel itself).
    expect(dialog.contains(document.activeElement) || document.activeElement === dialog).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
})

describe('TaskDetailDrawer — contextual enrichment gating', () => {
  it('NO productId → honest empty state, no lens', () => {
    render(<Harness task={makeTask()} proj={project(null)} canEdit />)
    fireEvent.click(screen.getByTestId('trigger'))
    expect(screen.getByText('No product linked')).toBeTruthy()
    expect(screen.queryByText('Rating & premium')).toBeNull()
  })

  it('WITH productId + a pricing task → the rating lens renders (not the empty state)', async () => {
    render(<Harness task={makeTask({ groupL3: 'Product Pricing' })} proj={project(PID)} canEdit />)
    fireEvent.click(screen.getByTestId('trigger'))
    expect(await screen.findByText('Rating & premium')).toBeTruthy()
    expect(screen.queryByText('No product linked')).toBeNull()
    // The product context subscription was opened for the linked product.
    expect(adapter.db.subscribe).toHaveBeenCalled()
  })

  it('WITH productId + a forms task → the forms lens renders', async () => {
    render(<Harness task={makeTask({ groupL3: 'Regulatory Filings & State Approvals' })} proj={project(PID)} canEdit />)
    fireEvent.click(screen.getByTestId('trigger'))
    expect(await screen.findByText('Forms & filing')).toBeTruthy()
  })
})

describe('TaskDetailDrawer — rev conflict surfaces, never overwrites', () => {
  it('a stale save (MutationConflictError) shows the conflict banner, reloads, and issues no second write', async () => {
    vi.mocked(adapter.db.mutate).mockRejectedValueOnce(new MutationConflictError())
    render(<Harness task={makeTask()} proj={project(null)} canEdit />)
    fireEvent.click(screen.getByTestId('trigger'))

    // Make a change so Save is enabled, then save into the conflict.
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Edited title' } })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/changed since you opened it/i)).toBeTruthy()
    // Exactly one write attempt — the conflict stops it; no silent retry/overwrite.
    expect(adapter.db.mutate).toHaveBeenCalledTimes(1)
    // It reloaded the latest rather than forcing the write through.
    expect(adapter.db.get).toHaveBeenCalledWith('tasks/t1')
    // The panel stays open (never a silent close-on-overwrite).
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('TaskDetailDrawer — VIEWER is read-only', () => {
  it('renders no writable controls, no Save, and never reaches mutate()', () => {
    render(<Harness task={makeTask()} proj={project(PID)} canEdit={false} />)
    fireEvent.click(screen.getByTestId('trigger'))

    // Title shows as static text, not an editable field.
    expect(screen.getByRole('heading', { name: 'Develop rating plan' })).toBeTruthy()
    expect(screen.queryByLabelText('Task status')).toBeNull()   // no status <select>
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
    expect(screen.getByText(/read-only/i)).toBeTruthy()

    // No editable text inputs anywhere in the panel.
    expect(screen.queryAllByRole('textbox').length).toBe(0)
    expect(adapter.db.mutate).not.toHaveBeenCalled()
  })
})
