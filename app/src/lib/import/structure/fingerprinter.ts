// fingerprinter.ts — top-level entry point for structural extraction.
// Selects the correct SourceReader from the file bytes (magic-byte detection),
// delegates reading, and returns a StructuralModel. This is the only function
// the rest of the app needs to call.

import type { StructuralModel } from '@pf/shared'
import { detectByMagic } from './sourceReader'
import type { SourceReader } from './sourceReader'
import { XlsxSourceReader, CsvSourceReader } from './xlsxReader'
import { PdfSourceReader } from './pdfStub'

/** Read bytes into a uniform StructuralModel.
 *  File type is detected from content (magic bytes), never from sourceName. */
export async function readStructure(
  bytes: Uint8Array,
  sourceName: string,
): Promise<StructuralModel> {
  const reader = selectReader(bytes)
  return reader.read(bytes, sourceName)
}

function selectReader(bytes: Uint8Array): SourceReader {
  const type = detectByMagic(bytes)
  switch (type) {
    case 'XLSX':    return new XlsxSourceReader('XLSX')
    case 'XLSM':    return new XlsxSourceReader('XLSM')
    case 'CSV':     return new CsvSourceReader()
    case 'PDF':     return new PdfSourceReader()
    default:        return new XlsxSourceReader('XLSX')  // best-effort for UNKNOWN
  }
}
