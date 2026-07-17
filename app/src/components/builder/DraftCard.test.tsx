// @vitest-environment jsdom
// P3 — Builder console truth, locked. Identity (displayName / legacy fallback / the
// "nine bare Cores" regression), labeled telemetry with thousands separators, the
// zero-forms amber diagnostic, the server-verdict-armed Promote, the trash-free
// action row, and the keyboard-complete overflow menu.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { DraftRow } from './DraftCard'

const h = vi.hoisted(() => ({
  fnsCall: vi.fn(),
}))

vi.mock('../../lib/backend', () => ({
  adapter: { fns: { call: h.fnsCall } },
}))

import { DraftCard } from './DraftCard'

const IDENTITY = {
  displayName: 'HO3_Countrywide_2026 - PH - Jul 15',
  sourceFileName: 'HO3_Countrywide_2026.xlsx',
  importedAt: '2026-07-15T14:30:00.000Z',
  contentHash: 'sha256:abc12345',
}
const READY_OK = {
  citations: { accepted: 1359, unresolved: 0 }, blockers: [],
  validation: 'pass', promotable: true, source: 'summary',
} as DraftRow['readiness']
const READY_BLOCKED = {
  citations: { accepted: 10, unresolved: 2 },
  blockers: ['Coverage "CA-EQ" cites sheet row 44 which was dropped', 'Rating step 9: ungrounded-field factor'],
  validation: 'fail', promotable: false, source: 'summary',
} as DraftRow['readiness']

function draft(over: Record<string, unknown> = {}): DraftRow {
  return {
    id: 'draft-ho-1', name: 'Core', refId: 'PH.PROD.001', lifecycle: 'DRAFT',
    lob: { refId: 'PH', name: 'Personal Home' },
    owner: { uid: 'u1', name: 'Admin' },
    lineage: {
      kind: 'IMPORT', summary: 'Imported from 1 ISO workbook',
      sources: [{ type: 'file', ref: 'HO3_Countrywide_2026.xlsx' }],
      by: { uid: 'u1', name: 'Admin' }, at: '2026-07-15T14:30:00.000Z',
    },
    identity: IDENTITY, readiness: READY_OK, rev: 1,
    ...over,
  } as unknown as DraftRow
}

function renderCard(p: DraftRow, extra: Partial<Parameters<typeof DraftCard>[0]> = {}) {
  const onOpen = vi.fn(); const onPromote = vi.fn(); const onDelete = vi.fn()
  render(<DraftCard p={p} covCount={12} formCount={1359} canEdit
    onOpen={onOpen} onPromote={onPromote} onDelete={onDelete} {...extra} />)
  return { onOpen, onPromote, onDelete }
}

afterEach(() => { cleanup(); h.fnsCall.mockReset() })

describe('DraftCard — identity (task 1)', () => {
  it('titles the card with the server-derived displayName, never the placeholder "Core"', () => {
    renderCard(draft())
    expect(screen.getByText('HO3_Countrywide_2026 - PH - Jul 15')).toBeTruthy()
    expect(screen.queryByText('Core')).toBeNull()
    expect(screen.getByText('HO3_Countrywide_2026.xlsx')).toBeTruthy()   // source chip
    expect(screen.getByText(/Imported .*ago|Imported Jul/)).toBeTruthy() // relative timestamp
    expect(screen.getByText('Personal Home')).toBeTruthy()               // LOB badge stays
  })

  it('nine imported drafts can never render nine bare "Core" cards', () => {
    for (let i = 0; i < 9; i++) {
      render(<DraftCard p={draft({ id: `d${i}` })} canEdit={false}
        onOpen={vi.fn()} onPromote={vi.fn()} onDelete={vi.fn()} />)
    }
    expect(screen.queryAllByText('Core')).toHaveLength(0)
  })

  it('a legacy placeholder-named draft without a source file renders the honest Untitled fallback', () => {
    renderCard(draft({ identity: undefined, readiness: undefined, lineage: undefined, updatedAt: '2026-07-01T00:00:00Z' }))
    expect(screen.getByText(/^Untitled draft – Jul 1$/)).toBeTruthy()
    expect(screen.queryByText('Core')).toBeNull()
  })

  it('a real hand-given name is preserved', () => {
    renderCard(draft({ name: 'Homeowners Special', identity: undefined }))
    expect(screen.getByText('Homeowners Special')).toBeTruthy()
  })
})

describe('DraftCard — labeled telemetry (task 3)', () => {
  it('formats counts with units and thousands separators', () => {
    renderCard(draft())
    expect(screen.getByText('1,359 forms')).toBeTruthy()
    expect(screen.getByText('12 coverages')).toBeTruthy()
    expect(screen.getByText('by Admin')).toBeTruthy()
  })

  it('an IMPORTED draft with 0 forms gets the amber diagnostic chip that opens the extraction report', () => {
    renderCard(draft(), { formCount: 0 })
    const chip = screen.getByRole('button', { name: /0 forms — view extraction report/ })
    fireEvent.click(chip)
    expect(screen.getByRole('dialog', { name: /Extraction report/ })).toBeTruthy()
  })

  it('a deliberately empty NON-imported draft keeps a neutral zero', () => {
    renderCard(draft({ lineage: { kind: 'BLANK', summary: 'Created from scratch', sources: [], by: { uid: 'u1', name: 'A' }, at: '2026-07-01T00:00:00Z' }, identity: undefined }), { formCount: 0 })
    expect(screen.queryByRole('button', { name: /view extraction report/ })).toBeNull()
    expect(screen.getByText('0 forms')).toBeTruthy()
  })

  it('an unknown (still loading) count renders an em-dash, not a fake zero or an alarm', () => {
    renderCard(draft(), { formCount: undefined })
    expect(screen.getByText('— forms')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /view extraction report/ })).toBeNull()
  })
})

describe('DraftCard — readiness + armed Promote (task 4)', () => {
  it('renders the three lights with text alternatives', () => {
    renderCard(draft())
    const group = screen.getByRole('group', { name: 'Readiness' })
    expect(group).toBeTruthy()
    expect(screen.getByLabelText(/Citations: 1,359 accepted/)).toBeTruthy()
    expect(screen.getByLabelText('Blockers: none')).toBeTruthy()
    expect(screen.getByLabelText('Validation: pass')).toBeTruthy()
  })

  it('legacy drafts get neutral lights that say "no readiness data" — never a fabricated verdict', () => {
    renderCard(draft({ readiness: undefined }))
    expect(screen.getAllByLabelText(/no readiness data/).length).toBe(3)
  })

  it('Promote is armed on a clean draft and calls through', () => {
    const { onPromote } = renderCard(draft())
    fireEvent.click(screen.getByRole('button', { name: /Promote/ }))
    expect(onPromote).toHaveBeenCalledTimes(1)
  })

  it('Promote is disabled on a blocked draft, with the server blockers VERBATIM in the popover', () => {
    const { onPromote } = renderCard(draft({ readiness: READY_BLOCKED }))
    const promote = screen.getByRole('button', { name: /Promote/ })
    expect(promote.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(promote)
    expect(onPromote).not.toHaveBeenCalled()
    // Verbatim blockers, reachable via aria-describedby.
    expect(screen.getByText('Coverage "CA-EQ" cites sheet row 44 which was dropped')).toBeTruthy()
    expect(screen.getByText('Rating step 9: ungrounded-field factor')).toBeTruthy()
    expect(promote.getAttribute('aria-describedby')).toBeTruthy()
  })
})

describe('DraftCard — delete safety (task 5 / directive 09)', () => {
  it('no trash in the primary action row; Delete lives behind the kebab menu', () => {
    const { onDelete } = renderCard(draft())
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /More actions for/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete draft/ }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('the kebab menu is fully keyboard operable: Enter opens + focuses, arrows rove, Esc restores focus', () => {
    renderCard(draft())
    const trigger = screen.getByRole('button', { name: /More actions for/ })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const items = screen.getAllByRole('menuitem')
    expect(items.length).toBe(2)   // View extraction report + Delete draft
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1]!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
