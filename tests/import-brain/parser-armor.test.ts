/**
 * parser-armor.test.ts — CE1-S3 locks: ZIP pre-inspection (RISK R5 / CRASH_CENSUS
 * F-3) + the L4 used-range pin (BACKLOG_SEED sec 3).
 *
 * The armor reads ONLY the OOXML central directory (declared sizes; nothing is
 * inflated) and rejects bombs BEFORE ExcelJS materializes anything. Bomb fixtures
 * are GENERATED here at test time — a real bomb is never committed. Two-fixture
 * rule: a compression-ratio bomb AND a structurally different entry-count bomb
 * (plus total-bytes and declared-cell variants).
 *
 * Ceilings were validated against the live corpus before locking (2026-07-16,
 * 10 workbooks): worst legitimate ratio 18.1x (ceiling 400), worst declared-cell
 * estimate 286,571 (ceiling 3,000,000), worst total 9.6 MB (ceiling 300 MB).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { createRequire } from 'module'
import { readFileSync, existsSync, readdirSync } from 'fs'
import path from 'path'

const _require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { inspectOoxmlContainer, readWorkbookToStructural, importZipLimits, collectWorkbookSignals } = require('../../server/lib/import-brain/workbook.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { REFID_TOKEN } = require('../../server/lib/import-brain/constants.js')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require('exceljs')

const ROOT = path.resolve(__dirname, '..', '..')
const HAGERTY = path.join(ROOT, 'samples', 'corpus-2026-07', 'hagerty')
const REFERENCE = path.join(ROOT, 'samples', 'corpus-2026-07', 'reference')
const ALL_LINES = path.join(REFERENCE, 'Product_Framework_All_Lines_Master.xlsm')

// ── Synthetic zip builder: central directory + EOCD only ─────────────────────
// The inspector never reads local file data, so bomb fixtures need only DECLARE
// sizes in CEN records. localPad stands in for the (never-read) file data.
interface FakeEntry { name: string; comp: number; uncomp: number }
function fakeZip(entries: FakeEntry[], opts: { localPad?: number; eocdEntryOverride?: number } = {}): Buffer {
  const localPad = opts.localPad ?? 64
  const cenBufs = entries.map(e => {
    const name = Buffer.from(e.name, 'utf8')
    const b = Buffer.alloc(46 + name.length)
    b.writeUInt32LE(0x02014b50, 0)   // CEN signature
    b.writeUInt16LE(20, 4)           // version made by
    b.writeUInt16LE(20, 6)           // version needed
    b.writeUInt16LE(8, 10)           // method: deflate
    b.writeUInt32LE(e.comp, 20)      // compressed size (declared)
    b.writeUInt32LE(e.uncomp, 24)    // uncompressed size (declared)
    b.writeUInt16LE(name.length, 28) // name length
    b.writeUInt32LE(0, 42)           // local header offset (unread)
    name.copy(b, 46)
    return b
  })
  const cd = Buffer.concat(cenBufs)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  const count = opts.eocdEntryOverride ?? entries.length
  eocd.writeUInt16LE(Math.min(count, 0xffff), 8)
  eocd.writeUInt16LE(Math.min(count, 0xffff), 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(localPad, 16)   // cd starts after the pad
  return Buffer.concat([Buffer.alloc(localPad), cd, eocd])
}

const MB = 1024 * 1024

afterEach(() => { delete process.env.IMPORT_PARSE_WALL_CLOCK_MS })

describe('S3 armor: zip bombs are rejected with structured IMPORT_413 (never a crash)', () => {
  it('fixture 1 — high-compression-ratio bomb (repeat-byte sheet xml, declared 200MB from 40KB)', () => {
    const bomb = fakeZip([
      { name: 'xl/workbook.xml', comp: 1000, uncomp: 4000 },
      { name: 'xl/worksheets/sheet1.xml', comp: 40 * 1024, uncomp: 200 * MB },
    ])
    let err: Error & { code?: string; reason?: string; limits?: Record<string, unknown> } | null = null
    try { inspectOoxmlContainer(bomb) } catch (e) { err = e as typeof err }
    expect(err).toBeTruthy()
    expect(err!.code).toBe('IMPORT_413')
    expect(err!.reason).toBe('perEntryCompressionRatio')
    expect(err!.limits).toMatchObject({ perEntryCompressionRatio: 400 })
    expect((err!.limits as { observed: { ratio: number } }).observed.ratio).toBeGreaterThan(400)
  })

  it('fixture 2 (two-fixture rule) — entry-count bomb (EOCD declares 5000 entries)', () => {
    const bomb = fakeZip([], { eocdEntryOverride: 5000 })
    let err: Error & { code?: string; reason?: string } | null = null
    try { inspectOoxmlContainer(bomb) } catch (e) { err = e as typeof err }
    expect(err).toBeTruthy()
    expect(err!.code).toBe('IMPORT_413')
    expect(err!.reason).toBe('entryCount')
  })

  it('total-uncompressed-bytes bomb (4 x 90MB media entries at benign ratios)', () => {
    const bomb = fakeZip([1, 2, 3, 4].map(i => ({ name: `xl/media/image${i}.bin`, comp: 30 * MB, uncomp: 90 * MB })))
    let err: Error & { code?: string; reason?: string } | null = null
    try { inspectOoxmlContainer(bomb) } catch (e) { err = e as typeof err }
    expect(err).toBeTruthy()
    expect(err!.code).toBe('IMPORT_413')
    expect(err!.reason).toBe('totalUncompressedBytes')
  })

  it('declared-cell-count bomb (90MB of sheet XML at benign ratios ~ 3.9M cells)', () => {
    const bomb = fakeZip([1, 2, 3].map(i => ({ name: `xl/worksheets/sheet${i}.xml`, comp: 10 * MB, uncomp: 30 * MB })))
    let err: Error & { code?: string; reason?: string } | null = null
    try { inspectOoxmlContainer(bomb) } catch (e) { err = e as typeof err }
    expect(err).toBeTruthy()
    expect(err!.code).toBe('IMPORT_413')
    expect(err!.reason).toBe('declaredCellCount')
  })

  it('ceilings are env-tunable (a lowered entry ceiling rejects a benign file)', () => {
    const benign = fakeZip([
      { name: 'xl/workbook.xml', comp: 500, uncomp: 2000 },
      { name: 'xl/worksheets/sheet1.xml', comp: 500, uncomp: 2000 },
    ])
    expect(() => inspectOoxmlContainer(benign)).not.toThrow()
    expect(() => inspectOoxmlContainer(benign, { limits: { entryCount: 1 } })).toThrow(/IMPORT_413 entryCount/)
  })

  it('a real ExcelJS-written workbook passes inspection AND parses end-to-end', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    ws.getCell('A1').value = 'refId'
    ws.getCell('A2').value = 'GL.COV.001'
    ws.getCell('B2').value = 42
    const buf = Buffer.from(await wb.xlsx.writeBuffer())
    const report = inspectOoxmlContainer(buf)
    expect(report.entryCount).toBeGreaterThan(3)
    expect(report.totalUncompressedBytes).toBeGreaterThan(0)
    const { structural, isoGrids } = await readWorkbookToStructural(buf, 't.xlsx', 'XLSX')
    expect(structural.sheets).toHaveLength(1)
    expect(isoGrids[0].cells[1][0]).toBe('GL.COV.001')
  }, 60_000)

  it('parseWallClockMs breach surfaces as IMPORT_413, not a hang', async () => {
    process.env.IMPORT_PARSE_WALL_CLOCK_MS = '1'
    const buf = readFileSync(path.join(HAGERTY, 'CO_RV125_Rating_Config_Template.xlsm'))
    await expect(readWorkbookToStructural(buf, 'rv125.xlsm', 'XLSM'))
      .rejects.toMatchObject({ code: 'IMPORT_413', reason: 'parseWallClockMs' })
  })

  it('no false positives: every tracked corpus workbook passes inspection', () => {
    const files = readdirSync(HAGERTY).filter(f => /\.(xlsx|xlsm)$/i.test(f))
    expect(files.length).toBeGreaterThanOrEqual(4)
    for (const f of files) {
      expect(() => inspectOoxmlContainer(readFileSync(path.join(HAGERTY, f))), f).not.toThrow()
    }
  })

  it.skipIf(!existsSync(REFERENCE))('no false positives: reference corpus (local-only, untracked)', () => {
    for (const f of readdirSync(REFERENCE).filter(f => /\.(xlsx|xlsm)$/i.test(f))) {
      expect(() => inspectOoxmlContainer(readFileSync(path.join(REFERENCE, f))), f).not.toThrow()
    }
  })
})

describe('L4 lock: phantom used-range is clamped to the true extent', () => {
  it('synthetic: a sheet REPORTING >1M rows with 1,609 real parses to 1,609 under budget', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Rules Repository')
    for (let r = 1; r <= 1609; r++) {
      ws.getCell(r, 1).value = `RU.${r}`
      ws.getCell(r, 2).value = r
    }
    // Whole-column-formatting stand-in: a far row with structure but NO value.
    ws.getRow(1048400).height = 20
    const buf = Buffer.from(await wb.xlsx.writeBuffer())

    // Fixture precondition: ExcelJS really does REPORT the phantom extent.
    const probe = new ExcelJS.Workbook()
    await probe.xlsx.load(buf)
    expect(probe.worksheets[0].rowCount).toBeGreaterThan(1_000_000)

    const t0 = Date.now()
    const { isoGrids } = await readWorkbookToStructural(buf, 'phantom.xlsx', 'XLSX')
    const elapsed = Date.now() - t0
    expect(isoGrids[0].cells).toHaveLength(1609)      // clamped, not believed
    expect(elapsed).toBeLessThan(60_000)              // time budget: no phantom walk
  }, 120_000)

  it.skipIf(!existsSync(ALL_LINES))('corpus: All Lines "Rules Repository" (reported ~1,048,417 rows) clamps to its real extent', async () => {
    const buf = readFileSync(ALL_LINES)
    const probe = new ExcelJS.Workbook()
    await probe.xlsx.load(buf)
    const reported = probe.worksheets.find((w: { name: string }) => /rules repository/i.test(w.name))
    expect(reported, 'fixture rot: Rules Repository sheet missing').toBeTruthy()
    expect(reported!.rowCount).toBeGreaterThan(1_000_000)

    const { isoGrids } = await readWorkbookToStructural(buf, 'all-lines.xlsm', 'XLSM')
    const grid = isoGrids.find((g: { sheet: string }) => /rules repository/i.test(g.sheet))
    expect(grid).toBeTruthy()
    expect(grid!.cells.length).toBeLessThan(5000)     // real data ends ~1,609
    expect(grid!.cells.length).toBeGreaterThan(1000)
  }, 180_000)
})

describe('collectWorkbookSignals: seam-free export (CRASH_CENSUS F-0 residual)', () => {
  it('harvests refId tokens + sheet names from structural fingerprints (cap 500)', () => {
    const structural = {
      sheets: [
        { sheetName: 'FW', cells: [['GL.COV.001', 'Premises'], ['GL.COV.002', 'Ops'], [42, null]] },
        { sheetName: 'Notes', cells: [['no ids here']] },
      ],
    }
    const sig = collectWorkbookSignals(structural, REFID_TOKEN)
    expect(sig.sheetNames).toEqual(['FW', 'Notes'])
    expect(sig.refIds).toEqual(['GL.COV.001', 'GL.COV.002'])
  })

  it('stays byte-identical to the stage0-router internal twin (sync tripwire)', () => {
    const body = (src: string, fromMarker: string) => {
      const start = src.indexOf('const refIds = []', src.indexOf(fromMarker))
      const end = src.indexOf('return { refIds, sheetNames }', start)
      expect(start).toBeGreaterThan(-1)
      expect(end).toBeGreaterThan(start)
      return src.slice(start, end).replace(/\s+/g, ' ').trim()
    }
    const wbSrc = readFileSync(path.join(ROOT, 'server', 'lib', 'import-brain', 'workbook.js'), 'utf8')
    const routerSrc = readFileSync(path.join(ROOT, 'server', 'lib', 'import-brain', 'stage0-router.js'), 'utf8')
    expect(body(wbSrc, 'function collectWorkbookSignals')).toBe(body(routerSrc, 'function collectWorkbookSignals'))
  })
})
