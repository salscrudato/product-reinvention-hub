// @vitest-environment jsdom
// Accessibility (axe) checks for the surfaces added/updated in recent work:
//   • DisagreementHeatmap  — ensemble divergence table (th scope fix)
//   • UnifiedImportModal    — the import-review surface
//   • DuckCreekExportModal  — the Duck Creek "Author" export UI
//   • HomeCheck             — the guest /home-check consumer surface
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
      db: { mutate: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(null), subscribe: vi.fn(() => () => {}) },
      fns: { call: vi.fn().mockResolvedValue({ ok: true }), stream: vi.fn().mockResolvedValue(undefined) },
    },
  }
})
vi.mock('./context/useUser', () => ({
  useUser: () => ({ user: { uid: 'u1', name: 'PM', email: 'pm@example.com', role: 'EDITOR' } }),
}))

import { DisagreementHeatmap } from './import/DisagreementHeatmap'
import { UnifiedImportModal } from './import/UnifiedImportModal'
import { DuckCreekExportModal } from './components/product/DuckCreekExportModal'
import HomeCheck from './routes/HomeCheck'
import { PERSONAL_HOME_BUNDLE } from '@pf/shared'
import type { DuckCreekExportData } from './lib/export/duckcreek'
import type { FieldDisagreement } from '@pf/shared'

const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }

beforeEach(() => {
  // HomeCheck / clipboard etc. may be referenced; stub network so nothing escapes jsdom.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function phExportData(): DuckCreekExportData {
  const { product, coverages, forms, rules, formRules, ratingProgram, rtTables, ldTables } = PERSONAL_HOME_BUNDLE
  return { product: { ...product, id: 'ph-id' }, coverages, forms, rules, formRules, ratingProgram, rtTables, ldTables }
}

const DISAGREEMENTS: FieldDisagreement[] = [
  { fieldPath: 'baseLossCost', fieldLabel: 'Base loss cost', opusValue: '456.93', gptValue: '456.90', adjudicatedValue: '456.93', calibratedConfidence: 0.62 },
  { fieldPath: 'lcm', fieldLabel: 'Loss cost multiplier', opusValue: '1.727', gptValue: '1.73', adjudicatedValue: '1.727', calibratedConfidence: 0.4 },
]

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

  it('DuckCreekExportModal (Author export) has no accessibility violations', async () => {
    render(<DuckCreekExportModal data={phExportData()} onClose={() => {}} />)
    await screen.findByRole('dialog')
    expect(await axeViolations(document.body)).toEqual([])
  })

  it('HomeCheck (/home-check guest surface) has no accessibility violations', async () => {
    const { container } = render(<MemoryRouter><HomeCheck /></MemoryRouter>)
    expect(await axeViolations(container)).toEqual([])
  })
})
