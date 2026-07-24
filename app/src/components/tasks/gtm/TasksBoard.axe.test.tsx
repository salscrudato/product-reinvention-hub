// @vitest-environment jsdom
// Accessibility (axe) checks for the redesigned Tasks board (E1): the card variants
// (seeded with checklist + runway bar + all chips, overdue, ongoing, adhoc) and the full
// route render (project-accent recast switcher, column headers, metrics, Completed sink).
// jsdom can't compute layout, so color-contrast is disabled (the proj-token AA math is
// documented + validated in index.css); `region` is off for isolated component renders.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'vitest-axe'
import { TaskCard } from './TaskCard'
import type { ProjectDoc, TaskDoc } from './gtm'

vi.mock('../../../lib/backend', () => {
  class MutationConflictError extends Error {}
  return {
    MutationConflictError,
    adapter: { db: { mutate: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(null) } },
  }
})
vi.mock('../../../context/useUser', () => ({
  useUser: () => ({
    user: { uid: 'u1', name: 'PM', email: 'pm@example.com', role: 'EDITOR' },
    profile: { role: 'EDITOR' },
  }),
}))

const project = {
  id: 'project-1', refId: 'PRJ.001', name: 'PA National launch', description: 'Personal auto',
  productId: null, targetLaunchDate: '2099-12-31', status: 'active',
  owner: { uid: 'u1', name: 'PM' }, rev: 1,
} as unknown as ProjectDoc

const t = (over: Partial<TaskDoc> & { id: string }): TaskDoc => ({
  title: 'Define coverage grants', column: 'IDEATION', order: 1, checklist: [], rev: 1,
  projectId: 'project-1', origin: 'seeded', phaseL2: 'Product Design', groupL3: 'Coverage design',
  phaseOrder: 2, ownerRole: 'Product Manager', typeOfWork: 'Differentiating', disposition: 'Embrace',
  startDate: '2026-07-01', dueAt: '2099-01-01', slaDays: 5, done: false,
  ...over,
} as unknown as TaskDoc)

const TASKS: TaskDoc[] = [
  t({ id: 'a1', checklist: [{ t: 'Draft', done: true }, { t: 'Review', done: false }] }),
  t({ id: 'a2', column: 'BUILD_FILE', dueAt: '2020-01-01', disposition: 'Elevate' }),         // overdue
  t({ id: 'a3', column: 'TEST_APPROVE', ongoing: true, dueAt: null, phaseOrder: 5, phaseL2: 'Product Governance & Monitoring' }),
  t({ id: 'a4', column: 'LAUNCH_MONITOR', origin: 'adhoc', phaseL2: undefined, groupL3: undefined, disposition: undefined }),
  t({ id: 'a5', done: true, completedAt: '2026-07-10T12:00:00.000Z' }),                        // completed sink
]

vi.mock('../../../lib/useLiveCollection', () => ({
  combineStatus: (...s: string[]) => (s.includes('error') ? 'error' : s.includes('loading') ? 'loading' : 'ready'),
  useLiveCollection: (path: string) => ({
    status: 'ready',
    retry: () => {},
    items: path === 'projects' ? [project] : path === 'tasks' ? TASKS : [],
  }),
}))

const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }
async function axeViolations(el: Element): Promise<string[]> {
  const { violations } = await axe(el, AXE_OPTS)
  return violations.map(v => `${v.id} (${v.nodes.length} node(s)): ${v.help}`)
}

afterEach(cleanup)

describe('TaskCard — axe across variants', () => {
  const noop = () => {}
  it('a seeded card with checklist progress, runway bar and every chip has no violations', async () => {
    const { container } = render(
      <TaskCard task={TASKS[0]!} canEdit todayIso="2026-07-15" onToggle={noop} onOpen={noop} />,
    )
    expect(await axeViolations(container)).toEqual([])
  })
  it('an overdue card has no violations', async () => {
    const { container } = render(
      <TaskCard task={TASKS[1]!} canEdit todayIso="2026-07-15" onToggle={noop} onOpen={noop} />,
    )
    expect(await axeViolations(container)).toEqual([])
  })
  it('an ongoing governance card has no violations', async () => {
    const { container } = render(
      <TaskCard task={TASKS[2]!} canEdit todayIso="2026-07-15" onToggle={noop} onOpen={noop} />,
    )
    expect(await axeViolations(container)).toEqual([])
  })
  it('a one-off (adhoc) card, VIEWER read-only, has no violations', async () => {
    const { container } = render(
      <TaskCard task={TASKS[3]!} canEdit={false} todayIso="2026-07-15" onToggle={noop} onOpen={noop} />,
    )
    expect(await axeViolations(container)).toEqual([])
  })
})

describe('Tasks route — axe on the full recast board', () => {
  it('the ready board (columns, metrics, runway, Completed sink) has no violations', async () => {
    const { default: Tasks } = await import('../../../routes/Tasks')
    render(<MemoryRouter><Tasks /></MemoryRouter>)
    expect(await axeViolations(document.body)).toEqual([])
  }, 15000)
})
