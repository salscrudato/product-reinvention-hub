// X4 — ROUND-TRIP VALIDATION HARNESS (spec §6.1, ledger XE-05/XE-06).
//
// The smallest re-import seam the spec recommends: the stage-0 sniff clause
// (behind the validation-only flag) + the deterministic mapManuscriptOverlay,
// used to re-import the emitted overlay and score fidelity against the spec's
// NUMERIC bar — §6.1: "export seeded PA.PROD.001 → re-import → identity-join
// F1 = 1.0 on coverages/forms/tables". The workbook half is NOT scored here and
// says so honestly (it rides the existing workbook import path; two-way plug as
// a user-facing import source stays BACKLOG — XE-10).
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildExportBundle } from '../../shared/src/export/duckcreek/bundle'
import { paExportInput } from '../../shared/src/export/duckcreek/paFixture'
import { mapManuscriptOverlay, sniffManuscriptXml } from '../../shared/src/insurance/manuscriptImport'

// Fail-fast Foundry endpoint: the flag-OFF control run exercises the LEGACY
// CSV/AI-assist path, whose fetch must reject immediately (ECONNREFUSED) instead
// of hanging — the assertion is about routing, not about the model call.
process.env.AZURE_FOUNDRY_ENDPOINT ??= 'http://127.0.0.1:9'
process.env.AZURE_FOUNDRY_KEY ??= 'test-dummy'

const _require = createRequire(import.meta.url)
const stage0 = _require('../../server/lib/import-brain/stage0-router.js') as {
  routeArtifacts: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>
  isManuscriptXml: (text: string) => boolean
}

function f1(expected: Set<string>, actual: Set<string>): { f1: number; extras: number; missing: string[] } {
  const tp = [...actual].filter((x) => expected.has(x)).length
  const precision = actual.size === 0 ? 0 : tp / actual.size
  const recall = expected.size === 0 ? 0 : tp / expected.size
  const f = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { f1: f, extras: actual.size - tp, missing: [...expected].filter((x) => !actual.has(x)) }
}

describe('X4 round-trip validation harness — the spec §6.1 numeric bar', () => {
  it('export seeded PA.PROD.001 → re-import → identity-join F1 = 1.0 on coverages/forms/tables, extras 0', () => {
    const input = paExportInput()
    const bundle = buildExportBundle(input)
    expect(bundle.blocked).toBe(false)

    const plan = mapManuscriptOverlay(bundle.overlayXml!, bundle.manifest!)

    // Product identity restored exactly.
    expect(plan.productId).toBe('PA.PROD.001')
    expect(plan.product?.refId).toBe('PA.PROD.001')

    // Coverages: all 12 identities, F1 = 1.0, zero extras (import-eval discipline).
    const covExpected = new Set(input.coverages.map((c) => c.refId!))
    const covActual = new Set(plan.coverages.map((c) => c.refId).filter((r): r is string => !!r))
    const cov = f1(covExpected, covActual)
    expect(cov.missing).toEqual([])
    expect(cov.extras).toBe(0)
    expect(cov.f1).toBe(1.0)

    // Forms: all 12 numbers, F1 = 1.0.
    const formExpected = new Set(input.forms.map((f) => f.number))
    const formActual = new Set(plan.forms.map((f) => f.refId).filter((r): r is string => !!r))
    const forms = f1(formExpected, formActual)
    expect(forms.missing).toEqual([])
    expect(forms.extras).toBe(0)
    expect(forms.f1).toBe(1.0)

    // Rate tables: all 11 refIds, F1 = 1.0.
    const tableExpected = new Set(Object.keys(input.rtTables))
    const tableActual = new Set(plan.rtTables.map((t) => t.refId).filter((r): r is string => !!r))
    const tables = f1(tableExpected, tableActual)
    expect(tables.missing).toEqual([])
    expect(tables.extras).toBe(0)
    expect(tables.f1).toBe(1.0)
  })

  it('recovers the rating-step skeleton: program refId, step count and REFERENCE-CHAIN order', () => {
    const input = paExportInput()
    const bundle = buildExportBundle(input)
    const plan = mapManuscriptOverlay(bundle.overlayXml!, bundle.manifest!)
    expect(plan.ratingProgram?.refId).toBe('PA.RAT.1')
    const steps = (plan.ratingProgram!.data.steps as { id: string; tableRef: string | null }[])
    const sourceSteps = [...input.ratingProgram!.steps].sort((a, b) => a.order - b.order)
    expect(steps.map((s) => s.id)).toEqual(sourceSteps.map((s) => s.id))
    // Table-lookup steps point at the same DC table ids the manifest names.
    expect(steps[0]!.tableRef).toBe('TerritoryBaseRate')
  })

  it('is honest about the halves: rules/formRules/ldTables are NOT recovered from the XML half', () => {
    const bundle = buildExportBundle(paExportInput())
    const plan = mapManuscriptOverlay(bundle.overlayXml!, bundle.manifest!)
    expect(plan.rules).toEqual([])
    expect(plan.formRules).toEqual([])
    expect(plan.ldTables).toEqual([])
    expect(plan.summary.notices.some((n) => n.code === 'not-recovered')).toBe(true)
  })

  it('stage-0 classifies the overlay as manuscript-xml ONLY behind the validation flag', { timeout: 30_000 }, async () => {
    const bundle = buildExportBundle(paExportInput())
    const doc = { name: 'Hub_PA_PROD_001_1_0_0_0.xml', text: bundle.overlayXml! }

    // Flag ON (the harness): detected + routed to the validation seam.
    const on = await stage0.routeArtifacts({
      documents: [doc], extractPdfText: () => null, budget: { noCap: true }, enableManuscriptXml: true,
    })
    const manuscriptXml = on.manuscriptXml as { name: string; detectedFormat: string }[] | undefined
    expect(manuscriptXml).toHaveLength(1)
    expect(manuscriptXml![0]!.detectedFormat).toBe('manuscript-xml')
    expect((on.workbooks as unknown[])).toHaveLength(0)

    // Flag OFF (every existing caller, incl. HTTP unifiedImport): byte-identical
    // legacy behavior — the XML text falls through to the CSV/TEXT branch and is
    // NEVER routed as an import source.
    const off = await stage0.routeArtifacts({
      documents: [doc], extractPdfText: () => null, budget: { noCap: true },
    })
    expect(off.manuscriptXml).toBeUndefined()
    expect((off.workbooks as { kind: string }[])[0]?.kind).toBe('CSV')
  })

  it('foreign (non-Hub) overlays land as honest PARTIAL: opaque identities, cited notices, no invention', () => {
    // A hand-shaped foreign overlay: valid ManuScript grammar, no manifest, no
    // Hub manuscriptID grammar, logic the mapper cannot attribute.
    const foreign = [
      '<ManuScript>',
      '  <properties manuscriptID="Acme_Widget_Product" inherited="Acme_Base_2_0_0_0" caption="Acme Widget Product">',
      '    <keys><keyInfo name="lob" value="InlandMarine" /></keys>',
      '  </properties>',
      '  <model>',
      '    <object id="data" abstract="1">',
      '      <object id="WidgetCoverage" path="coverage[Type=&quot;Widget Coverage&quot;]">',
      '        <object id="WidgetPrivate">',
      '          <private id="WidgetPrivate.Rate" caption="" type="float">',
      '            <value><lookup><tableRef value="WidgetRates" /><fieldRef value="rate" /><keyRef idref="WidgetInput.Class" type="string" name="class" /></lookup></value>',
      '          </private>',
      '        </object>',
      '      </object>',
      '    </object>',
      '  </model>',
      '</ManuScript>',
    ].join('\n')
    expect(sniffManuscriptXml(foreign)).toBe(true)
    const plan = mapManuscriptOverlay(foreign)
    expect(plan.productId).toBeNull()
    expect(plan.product?.label).toBe('Acme Widget Product')
    expect(plan.summary.notices.some((n) => n.code === 'foreign-overlay')).toBe(true)
    expect(plan.summary.notices.some((n) => n.code === 'opaque-logic')).toBe(true)
    // The coverage surfaces with its display name but NO invented refId.
    expect(plan.coverages).toHaveLength(0)
    expect(plan.summary.notices.some((n) => n.code === 'coverage-unmapped' && n.message.includes('Widget Coverage'))).toBe(true)
    // The referenced table surfaces as opaque.
    expect(plan.rtTables.map((t) => ({ refId: t.refId, label: t.label }))).toEqual([{ refId: null, label: 'WidgetRates' }])
  })

  it('digests the REAL 11,886-line SP3 sample overlay as a foreign document without crashing or inventing', () => {
    const sp3 = readFileSync(
      path.resolve(process.cwd(), 'docs/export-templates/author-xml/DCT_SampleProduct_3_0_0_0.xml'), 'utf8',
    )
    expect(sniffManuscriptXml(sp3)).toBe(true)
    const plan = mapManuscriptOverlay(sp3)
    // No manifest, no Hub grammar → opaque identities, honest PARTIAL.
    expect(plan.productId).toBeNull()
    expect(plan.product?.label).toBe('DCT Sample Product (3.0.0.0)')
    expect(plan.summary.notices.some((n) => n.code === 'foreign-overlay')).toBe(true)
    // Nothing gets an invented refId.
    expect(plan.coverages.every((c) => c.refId !== null)).toBe(true) // only manifest-mapped survive → none
    expect(plan.coverages).toHaveLength(0)
    expect(plan.forms.every((f) => f.refId === null)).toBe(true)
    expect(plan.rtTables.every((t) => t.refId === null)).toBe(true)
  })
})
