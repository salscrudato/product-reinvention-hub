/**
 * hardening-fidelity-zip-declaration.test.ts — regression lock for ledger #9.
 *
 * parser-armor.test.ts locks the DECLARED-size ceilings, and its fixtures deliberately
 * carry no real file data ("the inspector never reads local file data"). That is exactly
 * the gap: every ceiling — totalUncompressedBytes, sheetXmlBytes/24, and the per-entry
 * ratio guard — derives from the central directory, which the ATTACKER WRITES.
 *
 * Under-declaring one entry's uncompressed size keeps it under RATIO_FLOOR_BYTES, so the
 * ratio guard is skipped ENTIRELY, and keeps the declared total tiny — while the shipped
 * deflate stream still inflates to hundreds of MB once ExcelJS runs. compressedBytes is the
 * one field the attacker cannot fake (those bytes are physically in the upload), so the
 * budget is derived from it and the entry is inflated under that budget before ExcelJS sees
 * anything. These fixtures ship REAL deflate streams.
 */
import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'zlib'

/* eslint-disable @typescript-eslint/no-require-imports */
const { inspectOoxmlContainer, verifyDeclaredSizes, importZipLimits } = require('../../server/lib/import-brain/workbook.js')
/* eslint-enable @typescript-eslint/no-require-imports */

// ── Real zip builder: genuine deflate streams, with a settable size DECLARATION ──
interface RealEntry { name: string; data: Buffer; declareUncompressed?: number }

function realZip(entries: RealEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const comp = deflateRawSync(e.data)
    // The LIE lives here: what the headers claim the entry inflates to.
    const declared = e.declareUncompressed ?? e.data.length
    const name = Buffer.from(e.name, 'utf8')

    const lh = Buffer.alloc(30 + name.length)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8)  // deflate
    lh.writeUInt32LE(0, 14)                     // crc (unread by the armor)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(declared, 22)
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28)
    name.copy(lh, 30)

    const cen = Buffer.alloc(46 + name.length)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0, 8)
    cen.writeUInt16LE(8, 10)                    // deflate
    cen.writeUInt32LE(0, 16)                    // crc
    cen.writeUInt32LE(comp.length, 20)
    cen.writeUInt32LE(declared, 24)
    cen.writeUInt16LE(name.length, 28); cen.writeUInt16LE(0, 30); cen.writeUInt16LE(0, 32)
    cen.writeUInt32LE(offset, 42)               // relative offset of the local header
    name.copy(cen, 46)

    locals.push(lh, comp)
    centrals.push(cen)
    offset += lh.length + comp.length
  }

  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

// Small fixtures: the verify floor is lowered rather than shipping a 64 MB bomb.
const LIMITS = { ...importZipLimits(), verifyFloorCompressedBytes: 256, perEntryCompressionRatio: 400 }

// ~1.6 MB of zeros deflates to roughly 1.6 KB — a ~1000:1 ratio, comfortably past the
// 400:1 ceiling, and its compressed size clears the lowered verify floor.
const HIGH_RATIO = Buffer.alloc(1_600_000, 0)

describe('#9 zip ceilings must key off physical bytes, not the attacker-written declaration', () => {
  it('REJECTS an entry that under-declares its size to duck the ratio guard', async () => {
    // The attack: declare 1 KB (below RATIO_FLOOR_BYTES, so the declared-ratio check is
    // skipped) while shipping a stream that really inflates ~1000x.
    const buf = realZip([{ name: 'xl/worksheets/sheet1.xml', data: HIGH_RATIO, declareUncompressed: 1000 }])

    // The declared-size armor sees nothing wrong — that is the whole point.
    const inspected = inspectOoxmlContainer(buf, { limits: LIMITS })
    expect(inspected.totalUncompressedBytes).toBe(1000)

    await expect(verifyDeclaredSizes(buf, inspected, LIMITS)).rejects.toMatchObject({
      code: 'IMPORT_413',
      reason: 'perEntryCompressionRatio',
    })
  })

  it('names the declaration it caught lying, so the notice is actionable', async () => {
    const buf = realZip([{ name: 'xl/worksheets/sheet1.xml', data: HIGH_RATIO, declareUncompressed: 1000 }])
    await expect(verifyDeclaredSizes(buf, inspectOoxmlContainer(buf, { limits: LIMITS }), LIMITS))
      .rejects.toThrow(/declared only 1000 bytes/)
  })

  it('lets an HONEST workbook-shaped entry through untouched', async () => {
    // Realistic sheet XML: compresses well, but nowhere near the ceiling.
    const xml = Buffer.from('<row r="1"><c r="A1" t="s"><v>12</v></c></row>'.repeat(4000), 'utf8')
    const buf = realZip([{ name: 'xl/worksheets/sheet1.xml', data: xml }])
    const inspected = inspectOoxmlContainer(buf, { limits: LIMITS })
    await expect(verifyDeclaredSizes(buf, inspected, LIMITS)).resolves.toMatchObject({
      totalActualBytes: xml.length,
    })
  })

  it('an honest declaration is verified against reality, not just trusted', async () => {
    // Same physical stream, truthfully declared: still inflates past the ratio ceiling, so
    // it is still rejected. The guard tracks bytes, not honesty.
    const buf = realZip([{ name: 'xl/worksheets/sheet1.xml', data: HIGH_RATIO }])
    await expect(verifyDeclaredSizes(buf, inspectOoxmlContainer(buf, { limits: LIMITS }), LIMITS))
      .rejects.toMatchObject({ code: 'IMPORT_413' })
  })

  it('enforces the TOTAL against real inflated bytes across entries', async () => {
    const modest = Buffer.alloc(300_000, 0)
    const buf = realZip([
      { name: 'xl/worksheets/sheet1.xml', data: modest, declareUncompressed: 500 },
      { name: 'xl/worksheets/sheet2.xml', data: modest, declareUncompressed: 500 },
    ])
    const tight = { ...LIMITS, perEntryCompressionRatio: 100000, totalUncompressedBytes: 400_000 }
    await expect(verifyDeclaredSizes(buf, inspectOoxmlContainer(buf, { limits: tight }), tight))
      .rejects.toMatchObject({ code: 'IMPORT_413', reason: 'totalUncompressedBytes' })
  })

  it('skips entries too small to matter (the floor keys off COMPRESSED size)', async () => {
    const tiny = Buffer.alloc(50_000, 0)   // deflates to well under the 256-byte floor
    const buf = realZip([{ name: 'xl/worksheets/sheet1.xml', data: tiny, declareUncompressed: 10 }])
    await expect(verifyDeclaredSizes(buf, inspectOoxmlContainer(buf, { limits: LIMITS }), LIMITS))
      .resolves.toMatchObject({ totalActualBytes: 0 })
  })
})
