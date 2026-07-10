// genGtmProcess.ts — DETERMINISTIC generator for the GTM process seed. Reads the Process
// Value Explorer "Report" sheet, (re)writes the committed fixture at
// samples/process-value-explorer.xlsx, runs the pure converter (shared/src/gtm/processExplorer),
// and emits shared/src/seed/gtmProcess.ts. Run offline whenever the process asset changes:
//
//   pnpm tsx scripts/genGtmProcess.ts
//
// Source of truth is the committed workbook reference_tasks/Insurance_Product___Process Value
// Explorer Export.xlsx (Level 1 "Product Manufacture" rows); the fixture is a faithful, minimal
// re-export the converter test + a fresh clone can rely on. Nothing here runs in the gate — the
// converter itself is unit-tested in shared/src/gtm/processExplorer.test.ts.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { convertProcessExplorer, dispositionCounts, type ProcessExplorerRow } from '../shared/src/gtm/processExplorer'

// exceljs is a dependency of the app workspace; resolve it from there.
const require = createRequire(new URL('../app/package.json', import.meta.url))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ExcelJS: any = require('exceljs')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REF     = path.join(ROOT, 'reference_tasks', 'Insurance_Product___Process Value Explorer Export.xlsx')
const FIXTURE = path.join(ROOT, 'samples', 'process-value-explorer.xlsx')
const OUT     = path.join(ROOT, 'shared', 'src', 'seed', 'gtmProcess.ts')

const HEADERS = [
  'Level 1 Name', 'Level 2 Name', 'Level 3 Name', 'Level 4 Name',
  'Level 1 Description', 'Level 2 Description', 'Level 3 Description', 'Level 4 Description',
  'Point of Contact', 'SLA (in Days)', 'Type of Work', 'Value of Work',
  'ERP Future Platform Applicability (4E)', 'Complex', 'Simple',
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flat(v: any): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t: { text?: string }) => t.text ?? '').join('')
    if ('result' in v) return String(v.result ?? '')
    if ('text' in v) return String(v.text ?? '')
    return ''
  }
  return String(v)
}

async function readReportRows(file: string): Promise<ProcessExplorerRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet('Report')
  if (!ws) throw new Error(`No "Report" sheet in ${file}`)

  // Find the header row (contains "Level 4 Name") and map header text → column index.
  let headerRow = -1
  for (let r = 1; r <= 6 && headerRow < 0; r++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.getRow(r).eachCell({ includeEmpty: true }, (c: any) => { if (flat(c.value).trim() === 'Level 4 Name') headerRow = r })
  }
  if (headerRow < 0) throw new Error(`No header row (with "Level 4 Name") in ${file}`)
  const col: Record<string, number> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws.getRow(headerRow).eachCell({ includeEmpty: true }, (c: any, i: number) => { col[flat(c.value).trim()] = i })

  const rows: ProcessExplorerRow[] = []
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const at = (name: string) => row.getCell(col[name] ?? 1e9).value
    const cell = (name: string) => flat(at(name)).trim()
    if (cell('Level 1 Name') !== 'Product Manufacture' || !cell('Level 4 Name')) continue   // skip type-hint + blanks
    const slaRaw = at('SLA (in Days)')
    rows.push({
      level1: cell('Level 1 Name'), level2: cell('Level 2 Name'), level3: cell('Level 3 Name'), level4: cell('Level 4 Name'),
      level1Desc: cell('Level 1 Description'), level2Desc: cell('Level 2 Description'),
      level3Desc: cell('Level 3 Description'), level4Desc: cell('Level 4 Description'),
      pointOfContact: cell('Point of Contact'),
      sla: typeof slaRaw === 'number' ? slaRaw : flat(slaRaw).trim(),
      typeOfWork: cell('Type of Work'), valueOfWork: cell('Value of Work'),
      disposition: cell('ERP Future Platform Applicability (4E)'),
      complexFlow: cell('Complex'), simpleFlow: cell('Simple'),
    })
  }
  return rows
}

async function writeFixture(file: string, rows: ProcessExplorerRow[]): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const readme = wb.addWorksheet('README')
  readme.getCell('A1').value = 'FIXTURE — not the original vendor export.'
  readme.getCell('A2').value = 'Recreated from reference_tasks/Insurance Product & Process Value Explorer Export.xlsx (Report sheet, Level 1 "Product Manufacture" rows).'
  readme.getCell('A3').value = 'Consumed by shared/src/gtm/processExplorer + scripts/genGtmProcess.ts to (re)generate shared/src/seed/gtmProcess.ts.'
  readme.getCell('A4').value = 'Regenerate: pnpm tsx scripts/genGtmProcess.ts'

  const ws = wb.addWorksheet('Report')
  ws.addRow([...HEADERS])
  for (const r of rows) {
    ws.addRow([
      r.level1, r.level2, r.level3, r.level4,
      r.level1Desc ?? '', r.level2Desc ?? '', r.level3Desc ?? '', r.level4Desc ?? '',
      r.pointOfContact, r.sla, r.typeOfWork, r.valueOfWork, r.disposition,
      r.complexFlow ?? '', r.simpleFlow ?? '',
    ])
  }
  await wb.xlsx.writeFile(file)
}

// Single-quoted JS string literal (escape backslash + quote).
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function emitSeed(template: ReturnType<typeof convertProcessExplorer>): string {
  const line = (t: (typeof template)[number]) =>
    `  { globalOrder: ${t.globalOrder}, phaseL2: ${q(t.phaseL2)}, groupL3: ${q(t.groupL3)}, taskL4: ${q(t.taskL4)}, ` +
    `boardColumn: ${q(t.boardColumn)}, phaseOrder: ${t.phaseOrder}, slaDays: ${t.slaDays}, ongoing: ${t.ongoing}, ` +
    `owner: ${q(t.owner)}, typeOfWork: ${q(t.typeOfWork)}, valueOfWork: ${q(t.valueOfWork)}, disposition: ${q(t.disposition)} },`
  return `// GENERATED by scripts/genGtmProcess.ts from the Process Value Explorer fixture
// (samples/process-value-explorer.xlsx) via the pure converter shared/src/gtm/processExplorer.
// DO NOT hand-edit — re-run \`pnpm tsx scripts/genGtmProcess.ts\`. The generic insurance L1
// "Product Manufacture" go-to-market process: the ${template.length} L4 tasks that survive the
// 4E screen (rows disposed **Exclude** are dropped — the platform automates Embrace/Elevate/
// Enhance work and drops Exclude work). Each task carries its board column, phase order
// (1..5; ≤4 pre-launch), business-day SLA (group-deduped so it drives the backward schedule
// once), owner role, and the 4E disposition + Value-of-Work chips. Zero platform imports.
import type { GtmTemplateTask } from '../gtm/types'

/** The ordered ${template.length} template tasks. Do not invent tasks — this is the approved process. */
export const GTM_PROCESS_TEMPLATE: GtmTemplateTask[] = [
${template.map(line).join('\n')}
]

/** Total critical-path business days = Σ pre-launch (phaseOrder ≤ 4) slaDays. */
export const GTM_CRITICAL_PATH_DAYS = GTM_PROCESS_TEMPLATE
  .filter((t) => t.phaseOrder <= 4)
  .reduce((sum, t) => sum + t.slaDays, 0)
`
}

async function main() {
  const source = fs.existsSync(REF) ? REF : FIXTURE
  console.log(`Reading Process Value Explorer rows from ${path.relative(ROOT, source)}`)
  const rows = await readReportRows(source)
  console.log(`  ${rows.length} data rows · disposition counts: ${JSON.stringify(dispositionCounts(rows))}`)

  await writeFixture(FIXTURE, rows)
  console.log(`Wrote fixture ${path.relative(ROOT, FIXTURE)} (${rows.length} rows)`)

  const template = convertProcessExplorer(rows)
  fs.writeFileSync(OUT, emitSeed(template), 'utf8')
  const criticalPath = template.filter(t => t.phaseOrder <= 4).reduce((s, t) => s + t.slaDays, 0)
  console.log(`Wrote ${path.relative(ROOT, OUT)}: ${template.length} tasks · critical path ${criticalPath} business days · ${template.filter(t => t.ongoing).length} ongoing`)
}

main().catch(err => { console.error(err); process.exit(1) })
