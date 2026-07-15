// Export bundle assembly (spec §0 "one paragraph of truth", XE-04): one export =
// overlay.xml + CoverageConfig + TableConfig + export-manifest.json, gated by the
// gap report (MISSING blocks — X3) and the OVERLAY-DELTA LINT (hard gate — X1).

import type { ExportBundle, ExportManifest, ExportProvenance, GapReport } from './types'
import type { ExportInput } from './types'
import { buildGapReport } from './gap'
import { buildOverlay, coverageConfigIds } from './overlay'
import { buildCoverageConfig } from './coverageConfig'
import { buildTableConfig } from './tableConfig'
import { manifestTables } from './tables'
import { runOverlayLint } from './lint'
import { getCell } from './cells'
import { coverageDisplayName, manuscriptFileName, pascalCase } from './ids'
import { LOB_BASE_MANUSCRIPTS, SCAFFOLD_CHAIN } from './spec'

export interface BuildBundleOptions {
  /** Who triggered the export — the provenance actor (P4 envelope, authoredBy 'human'). */
  actorName?: string
}

export function buildExportBundle(input: ExportInput, _opts: BuildBundleOptions = {}): ExportBundle {
  const gapReport: GapReport = buildGapReport(input)
  if (gapReport.blocked) {
    // Flagged-not-dropped: the gap list IS the result; no artifacts are produced.
    return { blocked: true, gapReport }
  }
  const base = LOB_BASE_MANUSCRIPTS[input.product.lob.refId]!

  const overlay = buildOverlay(input, base)
  const coverageConfig = buildCoverageConfig(input, base)
  const tables = manifestTables(input.rtTables)
  const tableConfig = buildTableConfig({
    tables: Object.values(input.rtTables),
    baseManuscriptId: base,
    statesJoined: input.product.states.join(', '),
  })

  // L3 cross-artifact coherence (spec §6): every workbook ManuscriptID cell must
  // equal the file-name form of properties@inherited — one setting, three forms.
  const fileName = manuscriptFileName(base)
  const coherence: string[] = []
  if (getCell(coverageConfig, 'Config', 3, 3) !== fileName) {
    coherence.push(`CoverageConfig Config!C3 !== ${fileName}`)
  }
  for (let r = 2; r <= 1 + tables.length; r++) {
    if (getCell(tableConfig, 'Config', r, 5) !== fileName) coherence.push(`TableConfig Config!E${r} !== ${fileName}`)
  }
  if (coherence.length > 0) {
    throw new Error(`L3 cross-artifact coherence failed: ${coherence.join('; ')}`)
  }

  // The OVERLAY-DELTA LINT is a HARD GATE: a failing overlay is never delivered.
  const lint = runOverlayLint(overlay.xml, {
    baseIds: new Set<string>(SCAFFOLD_CHAIN),
    generatedIds: coverageConfigIds(input),
    tables,
    manifestIds: overlay.ids,
  })
  if (!lint.ok) {
    return { blocked: true, gapReport, lint }
  }

  // Every emitted value traces to a Hub entity or a documented spec default:
  // citations = the refIds this export drew from (P4 provenance envelope shape).
  const provenance: ExportProvenance = {
    authoredBy: 'human',
    citations: [
      input.product.refId ?? '(unsaved product)',
      ...input.coverages.map((c) => c.refId).filter((r): r is string => !!r),
      ...(input.ratingProgram ? [input.ratingProgram.refId] : []),
      ...Object.keys(input.rtTables),
      ...Object.keys(input.ldTables),
      ...input.forms.map((f) => f.number),
    ],
    confidence: 1,
  }

  const manifest: ExportManifest = {
    manuscriptID: overlay.manuscriptID,
    base: {
      inherited: base,
      fileNameForm: fileName,
      physicalPath: getCell(tableConfig, tableConfig.sheets[1]?.name ?? '', 4, 1) as string ?? '',
    },
    product: { refId: input.product.refId ?? '(unsaved product)', name: input.product.name },
    ids: {
      // The bundle also creates every CoverageConfig coverage via Express — the
      // manifest maps ALL coverage identities (dc object id = PascalCase display
      // name, the id Express generates) so the two-way proof can score identity
      // fidelity even for coverages the overlay never restates (spec §2: the
      // manifest is not optional). Overlay ids come second so re-declared
      // coverage objects keep their (identical) mapping.
      ...Object.fromEntries(input.coverages
        .filter((c) => !!c.refId)
        .map((c) => [pascalCase(coverageDisplayName(c.name)), c.refId as string])),
      ...overlay.ids,
    },
    tables,
    hitl: overlay.hitl,
    gapReport,
    provenance,
    generatedAt: input.now.toISOString(),
  }

  return {
    blocked: false,
    gapReport,
    overlayXml: overlay.xml,
    overlayFileName: overlay.fileName,
    coverageConfig,
    tableConfig,
    manifest,
    lint,
  }
}
