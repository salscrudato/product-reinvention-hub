// fidelity.test.ts — deterministic fidelity harness for the Excel importer.
//
// Runs mapIsoWorkbook over every XLSX file in samples/iso/ (8 workbooks: 4 GL,
// 2 IM, 2 PR) and emits a machine-parseable JSON report per line under
// docs/audit/fidelity/. Count snapshots serve as regression anchors: every run
// that improves fidelity must update the snapshot intentionally (--update-snapshots).
//
// samples/filings/nj-lemonade-ho/ contains only PDFs (3 files). The Excel
// importer has no PDF read path; those documents are ingested by the separate
// server-side filing pipeline. They are enumerated below for completeness but
// produce no ImportPlan and are NOT a failing case for this harness.
//
// Assertions lock:
//   1. which sheets were RECOGNIZED vs SKIPPED per line workbook group
//   2. entity counts per type (regression anchor; improve by fixing the importer)
//   3. refIds are not mangled (spot-checks per line)
//   4. no orphaned parentIds within any plan
//   5. all coverage.requirement + coverage.source values are canonical

import { describe, it, expect, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import type { IsoCell, IsoGrid, ImportPlan } from '@pf/shared'
import { mapIsoWorkbook } from '@pf/shared'

// ─── Paths ─────────────────────────────────────────────────────────────────────

const __dir    = dirname(fileURLToPath(import.meta.url))
const REPO     = resolve(__dir, '../../../../')
const SAMPLES  = resolve(REPO, 'samples/iso')
const FILINGS  = resolve(REPO, 'samples/filings')
const FIDELITY = resolve(REPO, 'docs/audit/fidelity')

// ─── ExcelJS reader (Node.js mode) ─────────────────────────────────────────────
// Mirrors readWorkbook.ts (browser) but uses wb.xlsx.readFile for Node.js tests.

function flatten(v: ExcelJS.CellValue): IsoCell {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if (Array.isArray(o['richText']))
      return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
    if ('result' in o) { const r = o['result']; return typeof r === 'object' ? null : (r as IsoCell) }
    if ('hyperlink' in o) return String(o['text'] ?? o['hyperlink'] ?? '')
    if ('text' in o) return String(o['text'])
  }
  return null
}

async function readWorkbookNode(filePath: string): Promise<IsoGrid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const grids: IsoGrid[] = []
  wb.eachSheet(ws => {
    const cells: IsoCell[][] = []
    for (let r = 1; r <= ws.rowCount; r++) {
      const rowObj = ws.getRow(r)
      const arr: IsoCell[] = []
      for (let c = 1; c <= ws.columnCount; c++) arr[c - 1] = flatten(rowObj.getCell(c).value)
      cells[r - 1] = arr
    }
    grids.push({ sheet: ws.name, file: filePath, cells })
  })
  return grids
}

// ─── File manifest ──────────────────────────────────────────────────────────────
// All files are in samples/iso/ or samples/filings/. PDFs are enumerated for
// completeness; the harness only processes XLSX files.

const ISO_XLSX: Record<'GL' | 'IM' | 'PR', string[]> = {
  GL: [
    'sample-GL-framework.xlsx',
    'sample-GL-forms.xlsx',
    'sample-GL-rules.xlsx',
    'sample-GL-pricing.xlsx',
  ],
  IM: [
    'sample-IM-framework.xlsx',
    'sample-IM-rules.xlsx',
  ],
  PR: [
    'sample-PR-framework.xlsx',
    'sample-PR-rating.xlsx',
  ],
}

// PDFs are out-of-scope for the Excel importer (separate filing pipeline).
const ISO_PDFS = ['sample-PH-baseform-HO3.pdf']
const FILING_PDFS = [
  'nj-lemonade-ho/LEM 03 05 23 Lemonade Homeowners_FINAL.pdf',
  'nj-lemonade-ho/NJ HO Manual 02.27.24.pdf',
  'nj-lemonade-ho/NJ HO Rate Order of Calculations.pdf',
]

// ─── Report builder ────────────────────────────────────────────────────────────

interface FidelityReport {
  line:             string
  files:            string[]
  sheetsRecognized: string[]
  sheetsSkipped:    string[]
  counts:           Record<string, number>
  warnings:         string[]
  warningCount:     number
  unmappedColumns:  { sheet: string; columns: string[] }[]
  orphanedParents:  string[]
  badRequirement:   string[]
  badSource:        string[]
  spotChecks:       Record<string, boolean>
}

function buildReport(line: string, files: string[], plan: ImportPlan): FidelityReport {
  const orphanedParents: string[] = []
  const covRefIds = new Set(plan.coverages.filter(c => c.refId).map(c => c.refId!))
  for (const cov of plan.coverages) {
    const pid = cov.data['parentId'] as string | null
    if (pid && !covRefIds.has(pid)) orphanedParents.push(`${cov.refId} → missing ${pid}`)
  }

  const badRequirement = plan.coverages
    .filter(c => c.data['requirement'] !== 'MANDATORY' && c.data['requirement'] !== 'OPTIONAL')
    .map(c => `${c.refId}: ${c.data['requirement']}`)

  const badSource = plan.coverages
    .filter(c => c.data['source'] !== 'BUREAU' && c.data['source'] !== 'PROPRIETARY')
    .map(c => `${c.refId}: ${c.data['source']}`)

  return {
    line,
    files,
    sheetsRecognized: plan.summary.sheetsRecognized,
    sheetsSkipped:    plan.summary.sheetsSkipped,
    counts:           plan.summary.counts,
    warnings:         plan.summary.warnings,
    warningCount:     plan.summary.warnings.length,
    unmappedColumns:  plan.summary.unmappedColumns,
    orphanedParents,
    badRequirement,
    badSource,
    spotChecks:       {},
  }
}

// ─── Loaded plans ───────────────────────────────────────────────────────────────

let glPlan: ImportPlan
let imPlan: ImportPlan
let prPlan: ImportPlan

beforeAll(async () => {
  const load = async (line: 'GL' | 'IM' | 'PR') => {
    const grids = (
      await Promise.all(ISO_XLSX[line].map(f => readWorkbookNode(resolve(SAMPLES, f))))
    ).flat()
    return mapIsoWorkbook(grids)
  }

  ;[glPlan, imPlan, prPlan] = await Promise.all([load('GL'), load('IM'), load('PR')])

  if (!existsSync(FIDELITY)) mkdirSync(FIDELITY, { recursive: true })

  for (const [line, plan] of [['GL', glPlan], ['IM', imPlan], ['PR', prPlan]] as const) {
    const report = buildReport(line, ISO_XLSX[line], plan)
    // Spot-check known verbatim refIds per line
    if (line === 'GL') {
      report.spotChecks['GL.COV.004.009'] = plan.coverages.some(c => c.refId === 'GL.COV.004.009')
      report.spotChecks['GL.PROD.001']    = plan.product?.refId === 'GL.PROD.001'
      report.spotChecks['GL.RU.001']      = plan.rules.some(r => r.refId === 'GL.RU.001')
      report.spotChecks['LDTable.001']    = plan.ldTables.some(t => t.refId === 'LDTable.001')
      report.spotChecks['form:CG 00 01']  = plan.forms.some(f => f.data['number'] === 'CG 00 01')
    }
    if (line === 'IM') {
      report.spotChecks['IM.COV044.00']   = plan.coverages.some(c => c.refId === 'IM.COV044.00')
      report.spotChecks['IM.RL.001']      = plan.rules.some(r => r.refId === 'IM.RL.001')
    }
    if (line === 'PR') {
      report.spotChecks['PR.COV001.0']    = plan.coverages.some(c => c.refId === 'PR.COV001.0')
      report.spotChecks['form:CP 00 10']  = plan.forms.some(f => f.data['number'] === 'CP 00 10')
    }
    writeFileSync(resolve(FIDELITY, `fidelity-${line.toLowerCase()}.json`), JSON.stringify(report, null, 2))
  }

  // Write PDF enumeration (out-of-scope documentation)
  writeFileSync(resolve(FIDELITY, 'pdfs-out-of-scope.json'), JSON.stringify({
    note: 'These PDF files are not processed by the Excel importer. The filing pipeline (server/lib/import-brain/stage-filing.js) handles them separately.',
    isoPdfs:    ISO_PDFS.map(f => `samples/iso/${f}`),
    filingPdfs: FILING_PDFS.map(f => `samples/filings/${f}`),
  }, null, 2))
}, 60_000)

// ─── File existence ─────────────────────────────────────────────────────────────

describe('fidelity harness — file existence', () => {
  it('all 8 XLSX files exist in samples/iso/', () => {
    for (const files of Object.values(ISO_XLSX)) {
      for (const f of files) {
        expect(existsSync(resolve(SAMPLES, f)), `missing: ${f}`).toBe(true)
      }
    }
  })

  it('samples/filings PDFs exist (out-of-scope for Excel importer)', () => {
    for (const f of FILING_PDFS) {
      expect(existsSync(resolve(FILINGS, f)), `missing filing PDF: ${f}`).toBe(true)
    }
  })
})

// ─── GL — golden baseline ───────────────────────────────────────────────────────
// GL is already covered in depth by isoFixture.test.ts and glRobustness.test.ts.
// We snapshot counts here as a regression anchor for the fidelity harness itself.

describe('fidelity — GL (4 workbooks)', () => {
  it('counts snapshot', () => {
    expect(glPlan.summary.counts).toMatchSnapshot()
  })

  it('all 8 GL sheets recognized', () => {
    expect(glPlan.summary.sheetsRecognized).toMatchSnapshot()
  })

  it('spot-checks: load-bearing refIds preserved verbatim', () => {
    expect(glPlan.coverages.some(c => c.refId === 'GL.COV.004.009')).toBe(true)
    expect(glPlan.product?.refId).toBe('GL.PROD.001')
    expect(glPlan.rules.some(r => r.refId === 'GL.RU.001')).toBe(true)
    expect(glPlan.ldTables.some(t => t.refId === 'LDTable.001')).toBe(true)
    expect(glPlan.forms.some(f => f.data['number'] === 'CG 00 01')).toBe(true)
  })

  it('zero orphaned parentIds', () => {
    const covRefIds = new Set(glPlan.coverages.filter(c => c.refId).map(c => c.refId!))
    const orphans = glPlan.coverages.filter(
      c => (c.data['parentId'] as string | null) != null && !covRefIds.has(c.data['parentId'] as string),
    )
    expect(orphans).toHaveLength(0)
  })

  it('all coverage.requirement values canonical', () => {
    const bad = glPlan.coverages.filter(
      c => c.data['requirement'] !== 'MANDATORY' && c.data['requirement'] !== 'OPTIONAL',
    )
    expect(bad).toHaveLength(0)
  })

  it('all coverage.source values canonical', () => {
    const bad = glPlan.coverages.filter(
      c => c.data['source'] !== 'BUREAU' && c.data['source'] !== 'PROPRIETARY',
    )
    expect(bad).toHaveLength(0)
  })
})

// ─── IM — Inland Marine (2 workbooks) ──────────────────────────────────────────
// sample-IM-framework.xlsx: "Product Component Model" + "Forms Library"
// sample-IM-rules.xlsx:     "Rules Repository"
// Phase 0 locks CURRENT behavior; improvements will update the snapshot.

describe('fidelity — IM (2 workbooks)', () => {
  it('counts snapshot (regression anchor)', () => {
    expect(imPlan.summary.counts).toMatchSnapshot()
  })

  it('recognized + skipped sheets snapshot', () => {
    expect({
      recognized: imPlan.summary.sheetsRecognized,
      skipped:    imPlan.summary.sheetsSkipped,
    }).toMatchSnapshot()
  })

  it('zero orphaned parentIds', () => {
    const covRefIds = new Set(imPlan.coverages.filter(c => c.refId).map(c => c.refId!))
    const orphans = imPlan.coverages.filter(
      c => (c.data['parentId'] as string | null) != null && !covRefIds.has(c.data['parentId'] as string),
    )
    expect(orphans).toHaveLength(0)
  })

  it('all coverage.requirement values canonical', () => {
    const bad = imPlan.coverages.filter(
      c => c.data['requirement'] !== 'MANDATORY' && c.data['requirement'] !== 'OPTIONAL',
    )
    expect(bad).toHaveLength(0)
  })

  it('all coverage.source values canonical', () => {
    const bad = imPlan.coverages.filter(
      c => c.data['source'] !== 'BUREAU' && c.data['source'] !== 'PROPRIETARY',
    )
    expect(bad).toHaveLength(0)
  })

  it('IM.COV044.00 spot-check (present when framework sheet found)', () => {
    const found = imPlan.coverages.some(c => c.refId === 'IM.COV044.00')
    // Snapshot current state — if the framework sheet is recognized, this will be true.
    expect(found).toMatchSnapshot()
  })

  it('IM.RL.001 spot-check (present when rules sheet found)', () => {
    const found = imPlan.rules.some(r => r.refId === 'IM.RL.001')
    // Snapshot current state — if the rules sheet is recognized, this will be true.
    expect(found).toMatchSnapshot()
  })

  it('IM forms spot-check (present when Forms Library sheet found)', () => {
    const formCount = imPlan.forms.length
    // Snapshot current count — 0 means Forms Library not recognized (unmapped-sheet defect).
    expect(formCount).toMatchSnapshot()
  })
})

// ─── PR — Commercial Property (2 workbooks) ────────────────────────────────────
// sample-PR-framework.xlsx: "Product Component Model" + "Forms Library" + "PROPERTY ROC" + "Rules Repository"
// sample-PR-rating.xlsx:    "PROPERTY ROC" + "ROC"
// Phase 0 locks CURRENT behavior; improvements will update the snapshot.

describe('fidelity — PR (2 workbooks)', () => {
  it('counts snapshot (regression anchor)', () => {
    expect(prPlan.summary.counts).toMatchSnapshot()
  })

  it('recognized + skipped sheets snapshot', () => {
    expect({
      recognized: prPlan.summary.sheetsRecognized,
      skipped:    prPlan.summary.sheetsSkipped,
    }).toMatchSnapshot()
  })

  it('zero orphaned parentIds', () => {
    const covRefIds = new Set(prPlan.coverages.filter(c => c.refId).map(c => c.refId!))
    const orphans = prPlan.coverages.filter(
      c => (c.data['parentId'] as string | null) != null && !covRefIds.has(c.data['parentId'] as string),
    )
    expect(orphans).toHaveLength(0)
  })

  it('all coverage.requirement values canonical', () => {
    const bad = prPlan.coverages.filter(
      c => c.data['requirement'] !== 'MANDATORY' && c.data['requirement'] !== 'OPTIONAL',
    )
    expect(bad).toHaveLength(0)
  })

  it('all coverage.source values canonical', () => {
    const bad = prPlan.coverages.filter(
      c => c.data['source'] !== 'BUREAU' && c.data['source'] !== 'PROPRIETARY',
    )
    expect(bad).toHaveLength(0)
  })

  it('PR.COV001.0 spot-check (present when framework sheet found)', () => {
    const found = prPlan.coverages.some(c => c.refId === 'PR.COV001.0')
    expect(found).toMatchSnapshot()
  })

  it('CP 00 10 form spot-check (present when Forms Library sheet found)', () => {
    const found = prPlan.forms.some(f => f.data['number'] === 'CP 00 10')
    // Snapshot current state — 0 forms means Forms Library not recognized.
    expect(found).toMatchSnapshot()
  })

  it('rating steps present (present when ROC sheet found)', () => {
    const steps = prPlan.summary.counts['ratingSteps'] ?? 0
    // Snapshot current count — 0 means rating sheet not recognized.
    expect(steps).toMatchSnapshot()
  })

  it('PR rules present (present when Rules Repository sheet found)', () => {
    const ruleCount = prPlan.rules.length
    // Snapshot current count — 0 means Rules Repository not recognized.
    expect(ruleCount).toMatchSnapshot()
  })
})

// ─── Cross-line invariants ──────────────────────────────────────────────────────

describe('fidelity — cross-line invariants', () => {
  it('GL has ≥105 coverages (golden baseline)', () => {
    expect(glPlan.summary.counts['coverages']).toBeGreaterThanOrEqual(105)
  })

  it('GL has ≥795 forms (golden baseline)', () => {
    expect(glPlan.summary.counts['forms']).toBeGreaterThanOrEqual(795)
  })

  it('GL has ≥146 rules (golden baseline)', () => {
    expect(glPlan.summary.counts['rules']).toBeGreaterThanOrEqual(146)
  })

  it('no line produces a product with a null or empty refId (when product row found)', () => {
    for (const [line, plan] of [['GL', glPlan], ['IM', imPlan], ['PR', prPlan]] as const) {
      if (plan.product) {
        expect(plan.product.refId, `${line} product refId null/empty`).toBeTruthy()
      }
    }
  })
})
