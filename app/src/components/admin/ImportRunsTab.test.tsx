// @vitest-environment jsdom
// ImportRunsTab — the admin import-telemetry surface renders the run log, drills
// into a run's pipeline flow, and opens the stage inspector with the stage's
// business-rendered output. Adapter fully mocked; axe pass on both views.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { axe } from 'vitest-axe'
import type { ImportRunSummary, ImportRunTrace } from '../../lib/backend/types'

const listImportRuns = vi.fn()
const getImportRun = vi.fn()

vi.mock('../../lib/backend', () => ({
  adapter: { tenancy: { listImportRuns: (...a: unknown[]) => listImportRuns(...a), getImportRun: (...a: unknown[]) => getImportRun(...a) } },
}))

import ImportRunsTab from './ImportRunsTab'

const SUMMARY: ImportRunSummary = {
  runId: 'run-fixture-01',
  tenantId: 'testco',
  actor: { uid: 'u1', name: 'Sal', role: 'SUPER_ADMIN' },
  sourceName: 'hagerty-core.xlsx',
  documents: [{ name: 'hagerty-core.xlsx', sizeKB: 412, mediaType: 'application/xlsx' }],
  startedAt: new Date(Date.now() - 120_000).toISOString(),
  finishedAt: new Date().toISOString(),
  durationMs: 95_000,
  status: 'succeeded',
  needsReview: true,
  path: 'workbook',
  spendUsd: 1.42,
  calls: 38,
  escalations: 1,
  stages: [
    { name: 'brain:stage0:route', stage: 0, status: 'done', durationMs: 900 },
    { name: 'brain:stage1:classify', stage: 1, status: 'done', durationMs: 12_000 },
    { name: 'brain:stage4:extract', stage: 4, status: 'done', durationMs: 61_000 },
  ],
  noticeCounts: { info: 0, warn: 1, error: 0 },
  outcome: {
    productId: 'PH.PROD.001', coverages: 42, forms: 12, rules: 7, rtTables: 3, ldTables: 2,
    proposed: 60, accepted: 55, unresolved: 5, reviewItems: 9,
    completeness: 'PARTIAL', importWarnings: 3, detectedFormat: 'ISO_WORKBOOK',
  },
  error: null,
}

const TRACE: ImportRunTrace = {
  runId: SUMMARY.runId,
  tenantId: SUMMARY.tenantId,
  actor: SUMMARY.actor,
  sourceName: SUMMARY.sourceName,
  documents: SUMMARY.documents,
  startedAt: SUMMARY.startedAt,
  finishedAt: SUMMARY.finishedAt,
  durationMs: SUMMARY.durationMs,
  status: 'succeeded',
  needsReview: true,
  path: 'workbook',
  outcome: SUMMARY.outcome,
  error: null,
  resultPersisted: null,
  steps: [
    { name: 'brain:stage0:route', stage: 0, status: 'done', durationMs: 900, startedAt: SUMMARY.startedAt, endedAt: SUMMARY.startedAt, detail: 'Routing 1 document(s) by content', result: '1 workbook(s), 0 filing PDF(s), 0 unrecognized', progress: [] },
    { name: 'brain:stage1:classify', stage: 1, status: 'done', durationMs: 12_000, startedAt: SUMMARY.startedAt, endedAt: SUMMARY.startedAt, detail: 'Classifying 3 sheet(s)', result: '2 content sheet(s), 1 ignored', progress: [] },
    { name: 'brain:stage4:extract', stage: 4, status: 'done', durationMs: 61_000, startedAt: SUMMARY.startedAt, endedAt: SUMMARY.finishedAt, detail: 'Extracting rows', result: '120 entities extracted, 4 flagged', progress: ['batch 1/4', 'batch 2/4'] },
  ],
  outputs: {
    'brain:input': { value: { sourceName: 'hagerty-core.xlsx', sheetCount: 3 }, truncated: false, bytes: 80 },
    'brain:stage0': { value: { workbooks: ['hagerty-core.xlsx'], filingDocs: [], unknown: [], lobRefIdHint: 'PH.LOB.001', lobSource: 'content', edition: null, warnings: [] }, truncated: false, bytes: 150 },
    'brain:stage1': { value: [{ sheetName: 'Coverages', domain: 'product-framework', confidence: 0.97 }], truncated: false, bytes: 90 },
    'brain:stage4': { value: { entityCount: 120, flagged: 4 }, truncated: false, bytes: 40 },
    importWarnings: { value: [{ kind: 'duplicate-refId', sheet: 'Coverages', detail: 'PH.COV.001 appears twice' }], truncated: false, bytes: 90 },
  },
  notices: [{ level: 'warn', kind: 'incomplete-product', message: 'Forms-only upload — rating data likely missing.', at: SUMMARY.startedAt }],
  escalations: [{ fromRole: 'BULK_VERIFY', toRole: 'MID_REASONER', deployment: 'sonnet-x', at: SUMMARY.startedAt }],
  spend: {
    spendUsd: 1.42, calls: 38, noCap: true,
    byDeployment: { 'claude-haiku-4-5': { calls: 30, inputTokens: 120_000, outputTokens: 9_000, usd: 0.4 }, 'claude-opus-4-8': { calls: 8, inputTokens: 30_000, outputTokens: 4_000, usd: 1.02 } },
  },
}

const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ImportRunsTab', () => {
  it('renders the run log with status, spend and outcome, and passes axe', async () => {
    listImportRuns.mockResolvedValue({ runs: [SUMMARY], storage: 'cosmos' })
    const { container } = render(<ImportRunsTab />)

    await waitFor(() => expect(screen.getByText('hagerty-core.xlsx')).toBeTruthy())
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0) // status pill + stat tile
    expect(screen.getByText('Success rate')).toBeTruthy()
    expect(screen.getByText(/55 accepted · 5 unresolved/)).toBeTruthy()

    expect((await axe(container, AXE_OPTS)).violations).toEqual([])
  })

  it('memory-only storage is disclosed, never silent', async () => {
    listImportRuns.mockResolvedValue({ runs: [SUMMARY], storage: 'memory' })
    render(<ImportRunsTab />)
    await waitFor(() => expect(screen.getByText(/held in memory only/)).toBeTruthy())
  })

  it('drills into a run: pipeline flow, waterfall, spend by model, warnings', async () => {
    listImportRuns.mockResolvedValue({ runs: [SUMMARY], storage: 'cosmos' })
    getImportRun.mockResolvedValue(TRACE)
    const { container } = render(<ImportRunsTab />)

    fireEvent.click(await screen.findByRole('button', { name: /Import run hagerty-core\.xlsx/ }))
    await waitFor(() => expect(getImportRun).toHaveBeenCalledWith('run-fixture-01'))

    // Pipeline nodes (observed + expected-but-unreached ghosts).
    await screen.findByRole('button', { name: /Classify sheets — done/ })
    expect(screen.getByRole('button', { name: /Adversarial validation — pending/ })).toBeTruthy()
    // Waterfall + spend panels.
    expect(screen.getByText('Where the time went')).toBeTruthy()
    expect(screen.getByText('claude-opus-4-8')).toBeTruthy()
    // Escalation chip and flag-not-invent warnings.
    expect(screen.getByText('MID_REASONER')).toBeTruthy()
    expect(screen.getByText(/PH\.COV\.001 appears twice/)).toBeTruthy()

    expect((await axe(container, AXE_OPTS)).violations).toEqual([])
  })

  it('opens the stage inspector with the business-rendered output', async () => {
    listImportRuns.mockResolvedValue({ runs: [SUMMARY], storage: 'cosmos' })
    getImportRun.mockResolvedValue(TRACE)
    render(<ImportRunsTab />)

    fireEvent.click(await screen.findByRole('button', { name: /Import run hagerty-core\.xlsx/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Classify sheets — done/ }))

    // Drawer (portal to body): blurb + classification table, scoped to the dialog
    // ("Coverages" also appears as a stat tile behind it).
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Two independent AI readers')
    expect(within(dialog).getByText('Coverages')).toBeTruthy()
    expect(within(dialog).getByText('product-framework')).toBeTruthy()
    expect(within(dialog).getByText('97%')).toBeTruthy()
  })
})
