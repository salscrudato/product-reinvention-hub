// sourceReader.ts — SourceReader interface and content-based file-type detection.
// File type is always detected by content (magic bytes + interior markers),
// never by file extension. This neutralizes mis-named files and macro-enabled
// .xlsm workbooks that share a ZIP magic byte with .xlsx.

import type { StructuralModel } from '@pf/shared'

export type SourceFileType = 'XLSX' | 'XLSM' | 'CSV' | 'PDF' | 'UNKNOWN'

/** Pluggable source reader. Implement for each format: xlsx/xlsm, csv, pdf. */
export interface SourceReader {
  /** Identify the format this reader handles (informational, not used for dispatch). */
  readonly fileType: SourceFileType
  /** Read bytes into a uniform StructuralModel. */
  read(bytes: Uint8Array, sourceName: string): Promise<StructuralModel>
}

// ── Magic-byte constants ───────────────────────────────────────────────────────

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]   // PK\x03\x04 — every ZIP / XLSX / XLSM
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]   // %PDF

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  return magic.every((b, i) => bytes[i] === b)
}

/** Scan up to `limit` bytes for an ASCII substring. */
function containsAscii(bytes: Uint8Array, pattern: string, limit = 65536): boolean {
  const pat = Array.from(pattern).map(c => c.charCodeAt(0))
  const end  = Math.min(bytes.length, limit) - pat.length + 1
  outer: for (let i = 0; i < end; i++) {
    for (let j = 0; j < pat.length; j++) {
      if (bytes[i + j] !== pat[j]) continue outer
    }
    return true
  }
  return false
}

/** Detect file type by content (magic bytes + interior markers).
 *  Never trusts the file extension or the `sourceName` parameter. */
export function detectByMagic(bytes: Uint8Array): SourceFileType {
  if (startsWith(bytes, PDF_MAGIC)) return 'PDF'

  if (startsWith(bytes, ZIP_MAGIC)) {
    // All Excel files (xlsx + xlsm) are ZIP archives containing xl/workbook.xml.
    if (!containsAscii(bytes, 'xl/workbook', 65536)) return 'UNKNOWN'
    // Macro-enabled workbooks additionally contain the VBA project entry.
    if (containsAscii(bytes, 'vbaProject.bin', 65536)) return 'XLSM'
    return 'XLSX'
  }

  // Heuristic: CSV is high-printable-ASCII text with no binary preamble.
  const sample = bytes.slice(0, Math.min(512, bytes.length))
  let printable = 0
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) printable++
  }
  if (sample.length > 0 && printable / sample.length > 0.90) return 'CSV'

  return 'UNKNOWN'
}
