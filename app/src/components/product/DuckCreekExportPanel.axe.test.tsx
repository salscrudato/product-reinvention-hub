// @vitest-environment jsdom
// Accessibility (axe) checks for the Duck Creek export result panel — both the
// success (downloads + gap summary) and blocked (MISSING alert) renderings.
// Same conventions as app/src/a11y.axe.test.tsx: color-contrast is disabled
// (jsdom has no layout; the token palette is contrast-checked separately) and
// `region` is disabled (isolated component render, no page landmark).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { axe } from 'vitest-axe'
import type { DuckCreekExportResult } from '../../lib/backend/types'

const AXE_OPTS = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } }

async function axeViolations(el: Element): Promise<string[]> {
  const { violations } = await axe(el, AXE_OPTS)
  return violations.map((v) => `${v.id} (${v.nodes.length} node(s)): ${v.help}`)
}

const duckcreek = vi.fn<(productId: string) => Promise<DuckCreekExportResult>>()
vi.mock('../../lib/backend', () => ({
  adapter: { export: { duckcreek: (pid: string) => duckcreek(pid) } },
}))

import { DuckCreekExportPanel } from './DuckCreekExportPanel'

afterEach(() => { cleanup(); duckcreek.mockReset() })

describe('DuckCreekExportPanel a11y', () => {
  it('success rendering has no axe violations', async () => {
    duckcreek.mockResolvedValue({
      ok: true, blocked: false, exportId: 'dc-x', dictionaryRevealed: false,
      gapReport: {
        productRefId: 'PA.PROD.001',
        rows: [
          { specRow: 1, field: 'Base manuscript id', status: 'MAPPED', source: 'spec §1.1', value: 'Carrier_ProductBase_PersonalAuto_1_0_0_0' },
          { specRow: 2, field: 'Version block', status: 'DEFAULTED', rule: 'SPEC §5 row 2', value: '1_0_0_0' },
        ],
        missing: [], blocked: false, counts: { mapped: 1, defaulted: 1, missing: 0 },
      },
      lint: { ok: true, findings: [] },
      artifacts: {
        overlayFileName: 'Hub_PA_PROD_001_1_0_0_0.xml', overlayXml: '<ManuScript />',
        coverageConfigXlsxB64: 'UEsDBA==', tableConfigXlsxB64: 'UEsDBA==', manifest: {},
      },
    })
    render(<DuckCreekExportPanel open onClose={() => {}} productId="PA.PROD.001" productName="Personal Auto Policy" />)
    await waitFor(() => expect(screen.getByText(/Overlay emitted/)).toBeTruthy())
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([])
  })

  it('blocked rendering has no axe violations', async () => {
    const missing = { specRow: 1, field: 'Base manuscript id', status: 'MISSING' as const, detail: 'no spec-pinned base' }
    duckcreek.mockResolvedValue({
      ok: false, blocked: true, error: 'export_blocked_missing_fields',
      gapReport: { productRefId: 'GL.PROD.001', rows: [missing], missing: [missing], blocked: true, counts: { mapped: 0, defaulted: 0, missing: 1 } },
    })
    render(<DuckCreekExportPanel open onClose={() => {}} productId="GL.PROD.001" productName="CGL" />)
    await waitFor(() => expect(screen.getByText(/Export blocked/)).toBeTruthy())
    expect(await axeViolations(screen.getByRole('dialog'))).toEqual([])
  })
})
