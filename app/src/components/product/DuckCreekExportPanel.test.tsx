// @vitest-environment jsdom
// X3 — the export RESULT panel: read-only gap-report summary (no inputs, no
// capture — the HITL surface is cut scope), blocked vs success rendering, and
// artifact downloads present only on success.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import type { DuckCreekExportResult } from '../../lib/backend/types'

const duckcreek = vi.fn<(productId: string) => Promise<DuckCreekExportResult>>()
vi.mock('../../lib/backend', () => ({
  adapter: { export: { duckcreek: (pid: string) => duckcreek(pid) } },
}))

import { DuckCreekExportPanel } from './DuckCreekExportPanel'

afterEach(() => { cleanup(); duckcreek.mockReset() })

const GAP_BASE = {
  productRefId: 'PA.PROD.001',
  rows: [
    { specRow: 1, field: 'Base manuscript id', status: 'MAPPED' as const, source: 'spec §1.1 MUST', value: 'Carrier_ProductBase_PersonalAuto_1_0_0_0' },
    { specRow: 2, field: 'Manuscript version block', status: 'DEFAULTED' as const, rule: 'SPEC §5 row 2: version block defaults to 1_0_0_0 / export date', value: '1_0_0_0 / 2026-07-15' },
  ],
}

function successResult(): DuckCreekExportResult {
  return {
    ok: true, blocked: false, exportId: 'dc-x', dictionaryRevealed: true,
    gapReport: { ...GAP_BASE, missing: [], blocked: false, counts: { mapped: 1, defaulted: 1, missing: 0 } },
    lint: { ok: true, findings: [] },
    artifacts: {
      overlayFileName: 'Hub_PA_PROD_001_1_0_0_0.xml',
      overlayXml: '<ManuScript />',
      coverageConfigXlsxB64: 'UEsDBA==',
      tableConfigXlsxB64: 'UEsDBA==',
      manifest: { manuscriptID: 'Hub_PA_PROD_001_1_0_0_0' },
    },
  }
}

function blockedResult(): DuckCreekExportResult {
  const missing = { specRow: 1, field: 'Base manuscript id', status: 'MISSING' as const, detail: 'no spec-pinned base manuscript for LOB GL.LOB.001' }
  return {
    ok: false, blocked: true, error: 'export_blocked_missing_fields',
    gapReport: { productRefId: 'GL.PROD.001', rows: [missing], missing: [missing], blocked: true, counts: { mapped: 0, defaulted: 0, missing: 1 } },
  }
}

describe('DuckCreekExportPanel', () => {
  it('renders the success outcome: green banner, gap summary with the NAMED spec rule, 4 downloads', async () => {
    duckcreek.mockResolvedValue(successResult())
    render(<DuckCreekExportPanel open onClose={() => {}} productId="PA.PROD.001" productName="Personal Auto Policy" />)
    await waitFor(() => expect(screen.getByText(/Overlay emitted/)).toBeTruthy())
    expect(duckcreek).toHaveBeenCalledWith('PA.PROD.001')
    expect(screen.getByText(/Data Dictionary revealed/)).toBeTruthy()
    // The DEFAULTED row carries its named spec rule, verbatim.
    expect(screen.getByText('SPEC §5 row 2: version block defaults to 1_0_0_0 / export date')).toBeTruthy()
    expect(screen.getByText(/1 mapped · 1 defaulted · 0 missing/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Hub_PA_PROD_001_1_0_0_0\.xml/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /CoverageConfig\.xlsx/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /TableConfig\.xlsx/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /export-manifest\.json/ })).toBeTruthy()
  })

  it('renders the blocked outcome: alert banner, MISSING row, and NO artifact downloads', async () => {
    duckcreek.mockResolvedValue(blockedResult())
    render(<DuckCreekExportPanel open onClose={() => {}} productId="GL.PROD.001" productName="CGL" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText(/Export blocked/)).toBeTruthy()
    expect(screen.getByText('MISSING')).toBeTruthy()
    expect(screen.getByText(/no spec-pinned base manuscript/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /CoverageConfig\.xlsx/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /\.xml/ })).toBeNull()
  })

  it('is read-only: no text inputs, no comboboxes, no capture affordances (cut HITL scope)', async () => {
    duckcreek.mockResolvedValue(successResult())
    const { container } = render(<DuckCreekExportPanel open onClose={() => {}} productId="PA.PROD.001" productName="Personal Auto Policy" />)
    await waitFor(() => expect(screen.getByText(/Overlay emitted/)).toBeTruthy())
    expect(container.querySelectorAll('input, textarea, select')).toHaveLength(0)
  })

  it('surfaces a transport failure honestly', async () => {
    duckcreek.mockRejectedValue(new Error('forbidden'))
    render(<DuckCreekExportPanel open onClose={() => {}} productId="PA.PROD.001" productName="Personal Auto Policy" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText(/Export failed: forbidden/)).toBeTruthy()
  })

  it('runs the export once per open, not on re-render', async () => {
    duckcreek.mockResolvedValue(successResult())
    const { rerender } = render(<DuckCreekExportPanel open onClose={() => {}} productId="PA.PROD.001" productName="P" />)
    await waitFor(() => expect(screen.getByText(/Overlay emitted/)).toBeTruthy())
    rerender(<DuckCreekExportPanel open onClose={() => {}} productId="PA.PROD.001" productName="P" />)
    expect(duckcreek).toHaveBeenCalledTimes(1)
  })
})
