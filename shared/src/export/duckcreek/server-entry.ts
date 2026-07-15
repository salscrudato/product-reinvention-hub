// esbuild entry for server/lib/export-duckcreek-shared.cjs (rule 5: the server
// runs the bundle, not this TS). Built by `pnpm build:export`.

export { buildExportBundle } from './bundle'
export { buildGapReport } from './gap'
export { buildOverlay, coverageConfigIds } from './overlay'
export { buildCoverageConfig } from './coverageConfig'
export { buildTableConfig } from './tableConfig'
export { manifestTables } from './tables'
export { runOverlayLint, PLATFORM_IDREF_TARGETS } from './lint'
export { safeCellValue } from './cells'
export { LOB_BASE_MANUSCRIPTS, SCAFFOLD_CHAIN } from './spec'
export {
  bareManuscriptId, manuscriptFileName, manuscriptPhysicalPath, pascalCase,
  coverageDisplayName, fieldId, tableDcId, tableSheetName,
} from './ids'
export { parseXml, serialize, XmlParseError, DEFAULT_PARSE_LIMITS } from './xml'

// The rating kit seam supplies the per-LOB rating input spec (the canonical
// driver-input inventory the overlay's net-new inputs trace to). The kit lives
// in shared code, not in Cosmos — the server reaches it through this bundle.
import { resolveRatingKit } from '../../rating/kits'
import type { RatingInputField } from '../../types'

export function resolveExportRatingInputSpec(lobPrefix: string): RatingInputField[] {
  try {
    return resolveRatingKit(lobPrefix).inputSpec ?? []
  } catch {
    return []
  }
}
