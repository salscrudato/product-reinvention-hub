// pdfStub.ts — PDF adapter stub implementing SourceReader.
//
// The browser SourceReader detects PDF bytes and routes here. Actual PDF text
// extraction runs server-side in the Node environment (functions/src/pdfText.ts,
// extractPdfText → zlib inflate) because it requires Node's zlib module. This
// stub compiles behind the SourceReader interface so the structural layer can
// accept PDF sources without breaking the browser build; the server-side pipeline
// calls extractPdfText directly and never instantiates this stub.
//
// The returned StructuralModel has a single placeholder sheet tagged '__pdf__'.
// Downstream code that encounters sourceType='PDF' knows to defer to the server
// ingestion pipeline (runFilingPipeline / runUnifiedImportPipeline) for real content.

import type { StructuralModel } from '@pf/shared'
import type { SourceReader, SourceFileType } from './sourceReader'

export class PdfSourceReader implements SourceReader {
  readonly fileType: SourceFileType = 'PDF'

  async read(_bytes: Uint8Array, sourceName: string): Promise<StructuralModel> {
    return {
      sourceName,
      sourceType: 'PDF',
      sheets: [
        {
          sheetName: '__pdf__',
          rawRowCount:   0,
          rawColCount:   0,
          dataRowCount:  0,
          dataColCount:  0,
          mergedCells:   [],
          headerCandidates: [],
          bestHeaderRow: -1,
          layoutShape:   'FLAT_TABLE',
          columnProfiles: [],
          isDefinitionsSheet: false,
        },
      ],
      definitionsBySheet: {},
    }
  }
}
