// @vitest-environment jsdom
// RiskReportDialog (E6): axe-clean in the ready state; the Dialog contract holds
// (Escape closes); every "Ask the copilot" affordance is ALWAYS tabbable (revealed
// on focus, never display:none) and fires with the composed question; loading and
// error states carry role=status / role=alert.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { RISK_REPORT_VERSION } from '../../lib/claims/riskReport'
import type { BaseForm } from './BaseFormsLibrary'

let nextReport: Record<string, unknown> | null = null
let failWith: string | null = null
const call = vi.fn(async (_n: string, _d: unknown) => {
  if (failWith) throw new Error(failWith)
  return { report: nextReport, cached: false }
})
vi.mock('../../lib/backend', () => ({ adapter: { fns: { call: (n: string, d: unknown) => call(n, d) } } }))

import { RiskReportDialog } from './RiskReportDialog'

const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }

const form = (over: Partial<BaseForm> = {}): BaseForm => ({
  id: 'f1', title: 'Homeowners 3 — Special Form', formNumber: 'HO 00 03', edition: '10 00',
  lob: 'HO', fileName: 'ho3.pdf', storagePath: 'x', url: '', mediaType: 'application/pdf',
  status: 'READY', uploadedBy: 'u1', uploadedByName: 'Pat',
  ...over,
} as BaseForm)

const v2 = {
  reportVersion: RISK_REPORT_VERSION,
  plainSummary: 'You are covered for sudden water damage to your home.',
  protections: ['Burst-pipe water damage [Section I – Perils]'],
  watchouts: ['Flood is excluded [Section I – Exclusions]'],
  actions: ['Ask your agent about flood coverage [Section I – Exclusions]'],
  generatedAt: '2026-07-15T09:00:00.000Z',
}

afterEach(() => { cleanup(); call.mockClear(); nextReport = null; failWith = null })

describe('RiskReportDialog', () => {
  it('renders the insured-centric sections and passes axe', async () => {
    nextReport = v2
    render(<RiskReportDialog form={form()} onClose={() => {}} onAsk={() => {}} />)
    await screen.findByText(/covered for sudden water damage/i)
    expect(screen.getByText("What you're covered for")).toBeTruthy()
    expect(screen.getByText('What to watch out for')).toBeTruthy()
    expect(screen.getByText('Questions to ask')).toBeTruthy()
    expect(document.body.textContent).not.toContain("insurer's lens")
    expect((await axe(document.body, AXE_OPTS)).violations).toEqual([])
  })

  it('a STALE cached shape on the form never renders — the dialog fetches fresh', async () => {
    nextReport = v2
    const stale = form({ id: 'f-stale', riskReport: { overview: 'v1', riskHighlights: ['x [a]'], watchFor: [], insurerLens: [] } })
    render(<RiskReportDialog form={stale} onClose={() => {}} onAsk={() => {}} />)
    await screen.findByText(/covered for sudden water damage/i)
    expect(call).toHaveBeenCalledWith('formRiskReport', { formKey: 'f-stale' })
    expect(document.body.textContent).not.toContain('v1')
  })

  it('Escape closes (the Dialog focus contract)', async () => {
    nextReport = v2
    const onClose = vi.fn()
    render(<RiskReportDialog form={form({ id: 'f-esc' })} onClose={onClose} onAsk={() => {}} />)
    await screen.findByText(/covered for sudden water damage/i)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('every report item exposes an always-tabbable ask affordance that fires the composed question', async () => {
    nextReport = v2
    const onAsk = vi.fn()
    render(<RiskReportDialog form={form({ id: 'f-ask' })} onClose={() => {}} onAsk={onAsk} />)
    await screen.findByText(/covered for sudden water damage/i)
    const asks = screen.getAllByRole('button', { name: /ask the copilot about/i })
    expect(asks).toHaveLength(3)
    fireEvent.click(asks[1]!)
    expect(onAsk).toHaveBeenCalledTimes(1)
    const [f, q] = onAsk.mock.calls[0] as [BaseForm, string]
    expect(f.id).toBe('f-ask')
    expect(q).toContain('Flood is excluded [Section I – Exclusions]')
  })

  it('loading state is role=status; a failure is role=alert with Retry', async () => {
    failWith = 'boom'
    render(<RiskReportDialog form={form({ id: 'f-err' })} onClose={() => {}} onAsk={() => {}} />)
    expect(screen.getByRole('status')).toBeTruthy()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('boom')
    failWith = null
    nextReport = v2
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await screen.findByText(/covered for sudden water damage/i)
  })
})
