// duckcreek.test.ts — validates the client-side Duck Creek export logic:
//   1. Both products (Personal Home + Personal Auto) produce a passing report.
//   2. Each product's menu item is backed by real lob data (PDM builds without error).
//   3. A forced validation failure (tampered XML) blocks the download path.
//   4. VIEWER role: the export logic is pure (no role check here); role enforcement
//      is on the server (see functions/src/exportDuckCreek.test.ts).
//   5. refIds and form numbers are preserved through the full pipeline.
import { describe, it, expect } from 'vitest'
import {
  PERSONAL_HOME_BUNDLE, PERSONAL_AUTO_BUNDLE,
  buildPdm, serializePdmToDuckCreek, validateDuckCreek,
} from '@pf/shared'
import { buildDuckCreekExport } from './duckcreek'
import type { DuckCreekExportData } from './duckcreek'

// ─── Helpers: turn seed bundles into DuckCreekExportData ────────────────────

function bundleToData(bundle: typeof PERSONAL_HOME_BUNDLE, id: string): DuckCreekExportData {
  const { product, coverages, forms, rules, formRules, ratingProgram, rtTables, ldTables } = bundle
  return {
    product:       { ...product, id },
    coverages,
    forms,
    rules,
    formRules,
    ratingProgram,
    rtTables,
    ldTables,
  }
}

const PH_DATA = bundleToData(PERSONAL_HOME_BUNDLE, 'ph-id')
const PA_DATA = bundleToData(PERSONAL_AUTO_BUNDLE, 'pa-id')

// ─── 1. Both products build, serialize, and validate cleanly ────────────────

describe.each([
  ['Personal Home (HO-3)', PH_DATA],
  ['Personal Auto (PAP)',  PA_DATA],
] as const)('Duck Creek export — %s', (_name, data) => {
  it('builds without throwing', () => {
    expect(() => buildDuckCreekExport(data)).not.toThrow()
  })

  it('produces a passing ValidationReport (ok=true)', () => {
    const { report } = buildDuckCreekExport(data)
    expect(report.ok).toBe(true)
    expect(report.wellFormed).toBe(true)
    expect(report.namespaceDeclared).toBe(true)
    expect(report.idPrefixesValid).toBe(true)
    expect(report.crossRefsValid).toBe(true)
    expect(report.roundTripOk).toBe(true)
  })

  it('all section counts balance (expected === emitted)', () => {
    const { report } = buildDuckCreekExport(data)
    expect(report.counts.length).toBeGreaterThan(0)
    for (const c of report.counts) {
      expect(c.emitted).toBe(c.expected)
    }
    expect(report.missingRefIds).toEqual([])
    expect(report.extraRefIds).toEqual([])
  })

  it('emits a manuScriptID with the correct carrier/line prefix', () => {
    const { manuScriptID } = buildDuckCreekExport(data)
    expect(manuScriptID).toMatch(/^PCG_/)
    const lob = _name.includes('Home') ? 'HO' : 'PA'
    expect(manuScriptID).toContain(`_${lob}_`)
  })

  it('sets a .xml filename based on the product refId', () => {
    const { fileName } = buildDuckCreekExport(data)
    expect(fileName).toMatch(/\.xml$/)
  })

  it('preserves all coverage refIds in the XML', () => {
    const { xml, pdm } = buildDuckCreekExport(data)
    for (const cov of pdm.coverages) {
      expect(xml).toContain(`refId="${cov.refId}"`)
    }
  })

  it('preserves form numbers in the XML', () => {
    const { xml, pdm } = buildDuckCreekExport(data)
    for (const form of pdm.forms.slice(0, 3)) {
      expect(xml).toContain(form.formNumber)
    }
  })
})

// ─── 2. Forced validation failure blocks the download path ──────────────────

describe('validation failure gate', () => {
  it('report.ok is false when XML is tampered — prevents download', () => {
    const pdm     = buildPdm(PERSONAL_HOME_BUNDLE)
    const goodXml = serializePdmToDuckCreek(pdm)
    // Rename a coverage refId so the round-trip check fails.
    const badXml  = goodXml.replace('refId="PH.COV.001"', 'refId="PH.COV.TAMPERED"')
    const report  = validateDuckCreek(pdm, badXml)

    expect(report.ok).toBe(false)
    expect(report.roundTripOk).toBe(false)
    // The download modal gates on report.ok; a consumer must check before downloading.
    expect(report.issues.some(i => i.severity === 'error')).toBe(true)
  })

  it('report.ok is false for a malformed XML document', () => {
    const pdm    = buildPdm(PERSONAL_HOME_BUNDLE)
    const report = validateDuckCreek(pdm, '<manuscript><broken</manuscript>')
    expect(report.ok).toBe(false)
    expect(report.wellFormed).toBe(false)
  })
})

// ─── 3. No-rating-program guard ────────────────────────────────────────────

describe('missing rating program', () => {
  it('throws with a clear message when ratingProgram is null', () => {
    const data: DuckCreekExportData = { ...PH_DATA, ratingProgram: null }
    expect(() => buildDuckCreekExport(data)).toThrow(/No rating program/)
  })
})

// ─── 4. VIEWER role: export logic is pure (no role gating in the lib) ───────
//    The server function enforces that only authenticated users may write the audit
//    event. The client-side lib intentionally has NO role check: export is a READ
//    and VIEWER can read all product data per firestore.rules. Role behavior on the
//    server is tested in functions/src/exportDuckCreek.test.ts.

describe('VIEWER role — export lib is role-agnostic', () => {
  it('buildDuckCreekExport succeeds regardless of caller role', () => {
    // The lib has no adapter calls and no role check — it is a pure computation.
    // Any role can call it; the server audit callable enforces authentication only.
    const { report } = buildDuckCreekExport(PH_DATA)
    expect(report.ok).toBe(true)
  })
})
