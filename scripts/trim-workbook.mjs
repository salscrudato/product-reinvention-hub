// scripts/trim-workbook.mjs — build a row-capped / sheet-filtered copy of a workbook
// for FAST import-brain iteration probes. A 60-row slice exercises the same stage
// 0-7 code paths as the full file at ~1/10 the wall-clock and spend; run the full
// file only as final confirmation.
//
// Usage:
//   node scripts/trim-workbook.mjs <in.xlsx> <out.xlsx> [--rows 60] [--sheets "A|B|C"]
//
//   --rows N      keep the header region + first N data rows of every sheet (default 60)
//   --sheets S    keep only these sheet names (pipe-separated); others removed entirely
//
// Hidden sheets are preserved as-is up to the same row cap (the deterministic ISO
// mapper reads them; dropping them silently would change mapper behavior).
import ExcelJS from 'exceljs'

const args = process.argv.slice(2)
const files = args.filter(a => !a.startsWith('--'))
const [inFile, outFile] = files
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
if (!inFile || !outFile) {
  console.error('usage: node scripts/trim-workbook.mjs <in.xlsx> <out.xlsx> [--rows 60] [--sheets "A|B"]')
  process.exit(2)
}
const ROWS = Number(flag('rows', 60))
const SHEETS = flag('sheets', null)
const keep = SHEETS ? new Set(SHEETS.split('|')) : null

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(inFile)

for (const ws of [...wb.worksheets]) {
  if (keep && !keep.has(ws.name)) { wb.removeWorksheet(ws.id); continue }
  let lastRow = 0
  ws.eachRow({ includeEmpty: false }, (row) => { if (row.number > lastRow) lastRow = row.number })
  if (lastRow > ROWS) ws.spliceRows(ROWS + 1, lastRow - ROWS)
  console.log(`${keep ? 'kept' : 'trimmed'} ${ws.name}: ${Math.min(lastRow, ROWS)} rows (was ${lastRow})`)
}
await wb.xlsx.writeFile(outFile)
console.log(`→ ${outFile} (${wb.worksheets.length} sheet(s), row cap ${ROWS})`)
