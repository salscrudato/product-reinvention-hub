// @vitest-environment jsdom
// Accessibility (axe) checks for the surfaces added/updated in recent work:
//   • DisagreementHeatmap  — ensemble divergence table (th scope fix)
//   • UnifiedImportModal    — the import-review surface
//   • HomeCheck             — the guest /home-check consumer surface
//   • CommandPalette        — ⌘K fuzzy search + actions palette
//   • PromoteDraftDialog    — typed-confirmation promotion gate
//   • ConflictDiffDialog    — 409 conflict diff UI (new in S4)
// jsdom can't compute layout, so the color-contrast rule (which needs real rendering) is
// disabled here; the design-token palette is contrast-checked separately. Every structural rule
// (accessible names, roles, form labels, table scope, list nesting, …) runs. The `region`
// best-practice rule is disabled because these are isolated component renders with no page-level
// <main> landmark — not a defect of the components themselves.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'vitest-axe'

// Assert directly on axe's typed `violations` array (avoids vitest-axe's type-only matcher export).
// A failure lists each violated rule id + node count + help text.
async function axeViolations(el: Element): Promise<string[]> {
  const { violations } = await axe(el, AXE_OPTS)
  return violations.map((v) => `${v.id} (${v.nodes.length} node(s)): ${v.help}`)
}

// The modals read useUser at render and the adapter only on an ACTION (never at render).
vi.mock('./lib/backend', () => {
  class MutationConflictError extends Error {}
  return {
    MutationConflictError,
    adapter: {
      db: {
        mutate: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn(() => () => {}),
      },
      fns: { call: vi.fn().mockResolvedValue({ ok: true }), stream: vi.fn().mockResolvedValue(undefined) },
      presence: {
        join: vi.fn(() => () => {}),
        watch: vi.fn(() => () => {}),
      },
    },
  }
})
vi.mock('./context/useUser', () => ({
  useUser: () => ({ user: { uid: 'u1', name: 'PM', email: 'pm@example.com', role: 'EDITOR' } }),
}))

import { DisagreementHeatmap } from './import/DisagreementHeatmap'
import { AgentVisualizer } from './import/AgentVisualizer'
import type { UnifiedStageEvent } from './import/unifiedImportClient'
import { UnifiedImportModal } from './import/UnifiedImportModal'
import HomeCheck from './routes/HomeCheck'
import { CommandPalette } from './components/palette/CommandPalette'
import { PromoteDraftDialog } from './components/product/PromoteDraftDialog'
import { ConflictDiffDialog } from './components/product/ConflictDiffDialog'
import { PH_PRODUCT } from '@pf/shared'
import type { FieldDisagreement } from '@pf/shared'

const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }

beforeEach(() => {
  // Stub fetch so nothing escapes jsdom.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const DISAGREEMENTS: FieldDisagreement[] = [
  { fieldPath: 'baseLossCost', fieldLabel: 'Base loss cost', opusValue: '456.93', gptValue: '456.90', adjudicatedValue: '456.93', calibratedConfidence: 0.62 },
  { fieldPath: 'lcm', fieldLabel: 'Loss cost multiplier', opusValue: '1.727', gptValue: '1.73', adjudicatedValue: '1.727', calibratedConfidence: 0.4 },
]

const MOCK_ACTOR = { uid: 'u1', name: 'PM' }

describe('a11y (axe) — new/updated surfaces', () => {
  it('DisagreementHeatmap has no accessibility violations', async () => {
    const { container } = render(<DisagreementHeatmap disagreements={DISAGREEMENTS} />)
    expect(await axeViolations(container)).toEqual([])
  })

  it('UnifiedImportModal (import review) has no accessibility violations', async () => {
    render(<UnifiedImportModal onClose={() => {}} onImported={() => {}} />)
    await screen.findByRole('dialog')
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('HomeCheck (/home-check guest surface) has no accessibility violations', async () => {
    const { container } = render(<MemoryRouter><HomeCheck /></MemoryRouter>)
    expect(await axeViolations(container)).toEqual([])
  })

  it('CommandPalette (open state) has no accessibility violations', async () => {
    render(
      <MemoryRouter>
        <CommandPalette open={true} onClose={() => {}} />
      </MemoryRouter>,
    )
    // CommandPalette renders via createPortal into document.body.
    await screen.findByRole('dialog', { name: /command palette/i })
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('PromoteDraftDialog has no accessibility violations', async () => {
    const ph = PH_PRODUCT
    render(
      <PromoteDraftDialog
        product={{ ...ph, id: 'PH.PROD.001', lifecycle: 'DRAFT', rev: 1 } as unknown as Parameters<typeof PromoteDraftDialog>[0]['product']}
        actor={MOCK_ACTOR}
        onClose={() => {}}
        onPromoted={() => {}}
      />,
    )
    await screen.findByRole('dialog')
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('AgentVisualizer (mid-run, inline) has no accessibility violations', async () => {
    const events: UnifiedStageEvent[] = [
      { kind: 'tool', name: 'brain:stage0:route', phase: 'end', summary: '1 workbook', at: 1 },
      { kind: 'json', key: 'brain:input', value: { sourceName: 'GL.xlsx', sheetCount: 2, sheetNames: ['A', 'B'] }, at: 2 },
      { kind: 'tool', name: 'brain:stage1:classify', phase: 'start', summary: 'Classifying 2 sheet(s)', at: 3 },
      { kind: 'tool', name: 'brain:stage1:classify', phase: 'end', summary: '2 content sheet(s)', at: 4 },
      { kind: 'tool', name: 'brain:stage4:extract', phase: 'progress', summary: 'batch 1/2', at: 5 },
      { kind: 'json', key: 'brain:spend', value: { spendUsd: 0.5, calls: 3, noCap: true, byDeployment: { 'claude-haiku-4-5': { calls: 3, inputTokens: 1000, outputTokens: 200, usd: 0.5 } } }, at: 6 },
    ]
    const { container } = render(
      <AgentVisualizer events={events} streaming expanded={false} onToggleExpand={() => {}} />,
    )
    expect(await axeViolations(container)).toEqual([])
  })

  it('AgentVisualizer (expanded overlay dialog) has no accessibility violations', async () => {
    render(
      <AgentVisualizer events={[]} streaming expanded={true} onToggleExpand={() => {}} />,
    )
    await screen.findByRole('dialog', { name: /agent pipeline/i })
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('ConflictDiffDialog has no accessibility violations', async () => {
    render(
      <ConflictDiffDialog
        path="products/PH.PROD.001"
        localData={{ name: 'New Name' }}
        onClose={() => {}}
      />,
    )
    await screen.findByRole('dialog')
    expect(await axeViolations(document.body)).toEqual([])
  })
})
