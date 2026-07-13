// subCoverageGroundTruth.test.ts — SEEDED PRODUCTION GROUND TRUTH for coverage/sub-coverage
// extraction, grounded in the REAL sample workbooks in samples/iso.
//
// This is the deterministic regression guard for the bug that motivated the coverage-hierarchy
// resolver: the importer produced coverages but no sub-coverages for the SECURA "Product Component
// Model" books (Property, Inland Marine). It reads each real workbook (true-data-region reader,
// robust to the 1,048,576-row phantom sheets), runs mapIsoWorkbook, and asserts:
//   * headline parent/child relationships that a human verified from the source (the "ground truth")
//   * structural invariants (every parent resolves, parents precede children, sub-coverages exist)
// The live-AI judge in scripts/import-judge.ts is the exploratory oracle; THIS test is the pinned,
// offline contract that must stay green in the gate.
import { describe, it, expect, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { existsSync } from 'fs'
import type { IsoCell, IsoGrid, ImportPlan, PlannedEntity } from '@pf/shared'
import { mapIsoWorkbook } from '@pf/shared'

const __dir = dirname(fileURLToPath(import.meta.url))
const SAMPLES = resolve(__dir, '../../../../samples/iso')

// ─── true-data-region reader (mirrors readWorkbook.ts; skips styling-only phantom rows) ──────────
function flatten(v: ExcelJS.CellValue): IsoCell {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>
    if (Array.isArray(o['richText'])) return (o['richText'] as { text?: string }[]).map(t => t.text ?? '').join('')
    if ('result' in o) { const r = o['result']; return typeof r === 'object' ? null : (r as IsoCell) }
    if ('text' in o) return String(o['text'])
  }
  return null
}
async function readWorkbook(path: string): Promise<IsoGrid[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const grids: IsoGrid[] = []
  wb.eachSheet(ws => {
    let maxRow = 0, maxCol = 0
    ws.eachRow({ includeEmpty: false }, (rowObj, rowNumber) => {
      let lastCol = 0
      rowObj.eachCell({ includeEmpty: false }, (_c, colNumber) => { if (colNumber > lastCol) lastCol = colNumber })
      if (lastCol > 0) { if (rowNumber > maxRow) maxRow = rowNumber; if (lastCol > maxCol) maxCol = lastCol }
    })
    const cells: IsoCell[][] = []
    for (let r = 1; r <= maxRow; r++) {
      const rowObj = ws.getRow(r)
      const arr: IsoCell[] = []
      for (let c = 1; c <= maxCol; c++) arr[c - 1] = flatten(rowObj.getCell(c).value)
      cells[r - 1] = arr
    }
    grids.push({ sheet: ws.name, file: path, cells })
  })
  return grids
}

// ─── The seeded ground truth (human-verified from the real source rows) ─────────────────────────
interface GroundTruth {
  file: string
  productPrefix: string
  minTopLevel: number
  minSubs: number
  // [childName, expectedParentName] pairs a reviewer confirmed from the workbook.
  pairs: [string, string][]
}
const GROUND_TRUTH: GroundTruth[] = [
  {
    file: '20-ISO-Framework-GL.xlsx', productPrefix: 'GL', minTopLevel: 15, minSubs: 80,
    pairs: [
      ['Terrorism Coverage', 'Wrongful Acts Coverage'],
      ['Watercraft Liability Coverage', 'Bodily Injury (Premises Operations) Coverage'],
    ],
  },
  {
    file: 'Product Framework - SECURA - Inland Marine.xlsx', productPrefix: 'IM', minTopLevel: 50, minSubs: 400,
    pairs: [
      ['Debris Removal', 'Signs'],                         // the headline SECURA case
    ],
  },
  {
    file: 'Product Framework - SECURA - Property RF.xlsm', productPrefix: 'PR', minTopLevel: 60, minSubs: 400,
    pairs: [
      ['Debris Removal', 'Building'],                      // the user's headline example
      ['Preservation Of Property', 'Building'],
    ],
  },
]

function nameOf(covs: PlannedEntity[], refId: string | null): string | null {
  if (!refId) return null
  return (covs.find(c => c.refId === refId)?.data['name'] as string | undefined) ?? null
}

describe('seeded ground truth — coverage/sub-coverage tree from the real sample workbooks', () => {
  const plans = new Map<string, ImportPlan>()

  beforeAll(async () => {
    for (const gt of GROUND_TRUTH) {
      const path = resolve(SAMPLES, gt.file)
      if (!existsSync(path)) continue
      plans.set(gt.file, mapIsoWorkbook(await readWorkbook(path)))
    }
  }, 60_000)

  for (const gt of GROUND_TRUTH) {
    describe(gt.file, () => {
      it('produces a product and a populated coverage tree with sub-coverages', () => {
        const plan = plans.get(gt.file)
        expect(plan, `sample ${gt.file} present`).toBeTruthy()
        const covs = plan!.coverages
        const top = covs.filter(c => !c.data['parentId'])
        const sub = covs.filter(c => c.data['parentId'])
        expect(plan!.product).toBeTruthy()
        expect(plan!.summary.productRefId?.startsWith(gt.productPrefix)).toBe(true)
        expect(top.length).toBeGreaterThanOrEqual(gt.minTopLevel)
        expect(sub.length).toBeGreaterThanOrEqual(gt.minSubs)   // the bug was sub.length === 0
      })

      it('every sub-coverage parent resolves (no dangling parentId)', () => {
        const covs = plans.get(gt.file)!.coverages
        const ids = new Set(covs.map(c => c.refId))
        for (const c of covs) {
          const pid = c.data['parentId'] as string | null
          if (pid) expect(ids.has(pid), `${c.refId} parent ${pid} exists`).toBe(true)
        }
      })

      it('coverages are ordered parent-before-child', () => {
        const covs = plans.get(gt.file)!.coverages
        const idx = new Map(covs.map((c, i) => [c.refId, i]))
        for (const c of covs) {
          const pid = c.data['parentId'] as string | null
          if (pid) expect(idx.get(pid)!).toBeLessThan(idx.get(c.refId)!)
        }
      })

      it('matches the human-verified parent/child ground truth', () => {
        const covs = plans.get(gt.file)!.coverages
        for (const [childName, parentName] of gt.pairs) {
          // At least one coverage with childName must resolve to a parent named parentName.
          const matches = covs.filter(c => String(c.data['name']).trim() === childName && c.data['parentId'])
          expect(matches.length, `a sub-coverage named "${childName}" exists`).toBeGreaterThan(0)
          const ok = matches.some(c => nameOf(covs, c.data['parentId'] as string) === parentName)
          expect(ok, `"${childName}" is a sub-coverage of "${parentName}"`).toBe(true)
        }
      })
    })
  }
})
