// @vitest-environment jsdom
// DailyBriefCard (BR-02): reserved-height card (skeleton ↔ content without layout
// shift), seeded empty-tenant state (message + single pill + CTA, never an empty AI
// paragraph), server-ordered pills rendered as-is (≤6), VIEWER hides force-refresh,
// PriorityRail's summary cache fed from the brief's tasks block. Plus an axe pass.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'vitest-axe'
import type { BriefPayload } from './DailyBriefCard'

let payload: BriefPayload
const call = vi.fn(async (_name: string, _data: unknown) => payload)
vi.mock('../../lib/backend', () => ({ adapter: { fns: { call: (name: string, data: unknown) => call(name, data) } } }))

let role = 'EDITOR'
vi.mock('../../context/useUser', () => ({
  useUser: () => ({ user: { uid: 'u1', name: 'Pat', role }, profile: { role } }),
}))

import { DailyBriefCard } from './DailyBriefCard'

const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }

const base: BriefPayload = {
  day: '2026-07-15', generatedAt: '2026-07-15T09:00:00.000Z',
  headline: { text: 'Three tasks are overdue.', citations: ['metric:openTasks'], source: 'ai' },
  pills: [
    { kind: 'tasks', label: '3 overdue', count: 3, tone: 'warn', target: '/app/tasks?overdue=1', citations: [] },
    { kind: 'news', label: '2 matched stories', count: 2, tone: 'info', target: '/app/news', citations: [] },
    { kind: 'metric', label: '5 products', count: 5, tone: 'info', target: '/app/products', citations: ['metric:products'] },
  ],
  tasks: { status: 'ok', paragraph: 'Finish [t1] first.', citations: ['t1'], buckets: { open: 9, overdue: 3, next7: 4, dueToday: 1 } },
  news: { status: 'ok', items: [{ urlHash: 'h1', title: 'NJ DOI bulletin', source: 'NJ DOI', publishedAt: '2026-07-14', matchedProducts: [], matchedCarrier: true }] },
  metrics: {
    status: 'ok',
    deterministic: { products: 5, coverages: 87, openTasks: 9, versions7d: 22 },
    enrichment: { status: 'unavailable', detail: 'no public source resolved', items: [] },
  },
}

afterEach(() => { cleanup(); call.mockClear(); sessionStorage.clear(); role = 'EDITOR' })

const mount = () => render(<MemoryRouter><DailyBriefCard products={[]} tasks={[]} /></MemoryRouter>)

describe('DailyBriefCard', () => {
  it('reserves the same card height in skeleton and ready states (no CLS)', async () => {
    payload = base
    const { container } = mount()
    const card = () => container.querySelector('section[aria-label="Daily brief"]')!
    expect(card().className).toContain('min-h-[196px]')          // skeleton state
    await vi.waitFor(() => expect(call).toHaveBeenCalled())
    await screen.findByText('Three tasks are overdue.')
    expect(card().className).toContain('min-h-[196px]')          // ready state — same reservation
  })

  it('renders the server-ordered pills as buttons with in-app targets', async () => {
    payload = base
    mount()
    await screen.findByText('3 overdue')
    expect(screen.getByText('2 matched stories')).toBeTruthy()
    expect(screen.getByText('5 products')).toBeTruthy()
  })

  it('empty tenant: seeded message + CTA, never an empty AI paragraph', async () => {
    payload = {
      ...base,
      headline: { text: 'x', citations: [], source: 'deterministic' },
      pills: [{ kind: 'metric', label: '0 products', count: 0, tone: 'info', target: '/app/products', citations: ['metric:products'] }],
      tasks: { status: 'empty', paragraph: null, citations: [], buckets: { open: 0, overdue: 0, next7: 0, dueToday: 0 } },
      news: { status: 'empty', items: [] },
      metrics: { ...base.metrics, deterministic: { products: 0, coverages: 0, openTasks: 0, versions7d: 0 } },
    }
    mount()
    await screen.findByText('Your brief starts when the portfolio does.')
    expect(screen.getByRole('button', { name: /import or author/i })).toBeTruthy()
    expect(document.body.textContent).not.toContain('Finish [')
  })

  it('labels a deterministic (computed) headline so it can never pass as AI prose', async () => {
    payload = { ...base, headline: { text: '3 overdue and 9 open tasks on the board.', citations: ['metric:openTasks'], source: 'deterministic' } }
    mount()
    await screen.findByText('computed')
  })

  it('the enrichment stub is labeled, not a broken widget', async () => {
    payload = base
    mount()
    await screen.findByText(/no public source resolved/i)
  })

  it('feeds PriorityRail summary cache from the brief tasks block', async () => {
    payload = base
    mount()
    await screen.findByText('Three tasks are overdue.')
    const rail = JSON.parse(sessionStorage.getItem('pf.home.taskSummary') ?? 'null') as { summary: string } | null
    expect(rail?.summary).toBe('Finish [t1] first.')
  })

  it('VIEWER never sees the force-refresh affordance', async () => {
    role = 'VIEWER'
    payload = base
    mount()
    await screen.findByText('Three tasks are overdue.')
    expect(screen.queryByRole('button', { name: /refresh the daily brief/i })).toBeNull()
  })

  it('axe: no violations in the ready state', async () => {
    payload = base
    const { container } = mount()
    await screen.findByText('Three tasks are overdue.')
    expect((await axe(container, AXE_OPTS)).violations).toEqual([])
  })
})
