// X3 — gap-report classifier + bundle gating (spec §5; ledger XE-04).
import { describe, expect, it } from 'vitest'
import { buildGapReport } from './gap'
import { buildExportBundle } from './bundle'
import { paExportInput } from './paFixture'
import { RULES } from './spec'

describe('X3 gap report — MAPPED / DEFAULTED / MISSING over the 17-row spec inventory', () => {
  it('classifies all 17 rows for the PA product and does not block', () => {
    const report = buildGapReport(paExportInput())
    expect(report.rows).toHaveLength(17)
    expect(new Set(report.rows.map((r) => r.specRow)).size).toBe(17)
    expect(report.blocked).toBe(false)
    expect(report.missing).toEqual([])
    expect(report.counts.mapped + report.counts.defaulted + report.counts.missing).toBe(17)
  })

  it('row 1 is MAPPED from the spec per-LOB binding, with the source named', () => {
    const report = buildGapReport(paExportInput())
    const row1 = report.rows.find((r) => r.specRow === 1)!
    expect(row1.status).toBe('MAPPED')
    expect(row1.value).toBe('Carrier_ProductBase_PersonalAuto_1_0_0_0')
    expect(row1.source).toContain('spec §1.1')
  })

  it('every DEFAULTED row NAMES its spec default rule — a DEFAULTED value can never appear without one', () => {
    const report = buildGapReport(paExportInput())
    const defaulted = report.rows.filter((r) => r.status === 'DEFAULTED')
    expect(defaulted.length).toBeGreaterThanOrEqual(10)
    const knownRules = new Set<string>(Object.values(RULES))
    for (const row of defaulted) {
      expect(row.rule, `spec row ${row.specRow} must name its rule`).toBeTruthy()
      expect(knownRules.has(row.rule!), `spec row ${row.specRow} rule must be a documented SPEC §5 rule, got: ${row.rule}`).toBe(true)
    }
    // And every MAPPED row names its canonical source.
    for (const row of report.rows.filter((r) => r.status === 'MAPPED')) {
      expect(row.source, `spec row ${row.specRow} must name its source`).toBeTruthy()
    }
  })

  it('a LOB with no spec-pinned base manuscript yields MISSING on row 1 and BLOCKS', () => {
    const input = paExportInput()
    input.product = { ...input.product, lob: { refId: 'GL.LOB.001', name: 'General Liability' } }
    const report = buildGapReport(input)
    const row1 = report.rows.find((r) => r.specRow === 1)!
    expect(row1.status).toBe('MISSING')
    expect(report.blocked).toBe(true)
    expect(report.missing).toEqual([row1])
  })
})

describe('X3 bundle gating — MISSING blocks, lint gates, provenance rides', () => {
  it('a blocked export produces the gap list and NO artifacts (flagged-not-dropped)', () => {
    const input = paExportInput()
    input.product = { ...input.product, lob: { refId: 'GL.LOB.001', name: 'General Liability' } }
    const bundle = buildExportBundle(input)
    expect(bundle.blocked).toBe(true)
    expect(bundle.gapReport.missing).toHaveLength(1)
    expect(bundle.overlayXml).toBeUndefined()
    expect(bundle.coverageConfig).toBeUndefined()
    expect(bundle.tableConfig).toBeUndefined()
    expect(bundle.manifest).toBeUndefined()
  })

  it('a successful PA export delivers all four artifacts with a green lint', () => {
    const bundle = buildExportBundle(paExportInput())
    expect(bundle.blocked).toBe(false)
    expect(bundle.lint?.ok).toBe(true)
    expect(bundle.overlayXml).toContain('<ManuScript>')
    expect(bundle.overlayFileName).toBe('Hub_PA_PROD_001_1_0_0_0.xml')
    expect(bundle.coverageConfig?.sheets.map((s) => s.name)).toEqual(['Coverage', 'Config', 'InputFields'])
    expect(bundle.tableConfig?.sheets).toHaveLength(13) // TOC + 11 PA tables + Config
    expect(bundle.manifest?.manuscriptID).toBe('Hub_PA_PROD_001_1_0_0_0')
  })

  it('the manifest id map covers EVERY coverage identity (the two-way proof reads this)', () => {
    const input = paExportInput()
    const bundle = buildExportBundle(input)
    const mappedRefIds = new Set(Object.values(bundle.manifest!.ids))
    for (const cov of input.coverages) {
      expect(mappedRefIds.has(cov.refId!), `coverage ${cov.refId} must be manifest-mapped`).toBe(true)
    }
    // And the table list carries key/value columns for the lint + two-way proof.
    expect(bundle.manifest!.tables).toHaveLength(11)
    expect(bundle.manifest!.tables[0]).toMatchObject({
      tableName: 'Territory Base Rate', dcTableId: 'TerritoryBaseRate',
      sheetName: 'TerritoryBaseRate_1', keyColumns: ['territory'], valueColumn: 'rate', hubRefId: 'PA.RT.001',
    })
  })

  it('carries the P4 provenance envelope: authoredBy human, cited refIds, confidence 1, no model', () => {
    const bundle = buildExportBundle(paExportInput())
    const prov = bundle.manifest!.provenance
    expect(prov.authoredBy).toBe('human')
    expect(prov.model).toBeUndefined()
    expect(prov.confidence).toBe(1)
    expect(prov.citations).toContain('PA.PROD.001')
    expect(prov.citations).toContain('PA.COV.001.001')
    expect(prov.citations).toContain('PA.RAT.1')
    expect(prov.citations).toContain('PA.RT.011')
    expect(prov.citations).toContain('PP 00 01')
  })

  it('workbook ManuscriptID cells cohere with properties@inherited (L3 — one setting, three forms)', () => {
    const bundle = buildExportBundle(paExportInput())
    expect(bundle.manifest!.base.inherited).toBe('Carrier_ProductBase_PersonalAuto_1_0_0_0')
    expect(bundle.manifest!.base.fileNameForm).toBe('Carrier_ProductBase_PersonalAuto_1_0_0_0.xml')
    expect(bundle.overlayXml).toContain('inherited="Carrier_ProductBase_PersonalAuto_1_0_0_0"')
    expect(bundle.overlayXml).not.toContain('inherited="Carrier_ProductBase_PersonalAuto_1_0_0_0.xml"')
  })
})
