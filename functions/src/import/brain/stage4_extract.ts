// functions/src/import/brain/stage4_extract.ts — Row extraction + normalization.
//
// For each content sheet with a confirmed column map:
//   1. Build batches of up to BATCH_ROWS rows (to limit per-call token cost).
//   2. BULK (haiku-4-5, Anthropic) extracts the batch → entities with citations.
//   3. BULK_ALT (gpt-5-mini, OpenAI) extracts the same batch independently.
//   4. Per-entity reconcile: if both agree on all key fields → accept at avg confidence.
//      Otherwise → reviewFlag=true.
//   5. Multi-refId cells: split on whitespace + common separators → one entity per refId.
//   6. Blank/TBD refIds → needsRefIdSynthesis=true; the Line Intelligence Registry
//      provides the synthesized refId in index.ts (brain stage cannot invent refIds).
//   7. Low-confidence entities → escalate to REASONER_A for a second pass.
//
// Families: BULK (Anthropic) + BULK_ALT (OpenAI) → decorrelated extraction.
// VALIDATOR (Stage 5) then checks both outputs with gpt-5.1 (OpenAI, different from BULK).

import { resolveLineArchetypeByPrefix, DEPLOY_HAIKU, DEPLOY_GPT_MINI } from '@pf/shared'
import type { SheetFingerprint, CanonicalEntityKind } from '@pf/shared'
import type { RoutingBudget } from '../../ai/router'
import { BRAIN_BULK, BRAIN_BULK_ALT, BRAIN_REASONER_A, extractFieldsWithRole } from '../../ai/router'
import { STAGE4_EXTRACT_SYSTEM } from './prompts'
import type {
  ClassifiedSheet, SheetColumnMap, BrainEntity, BrainEntityField, BrainCitation,
  HeaderLock, ReviewItem,
} from './types'
import { extractJson, colLetter, CONFIDENCE_REVIEW } from './types'

// ─── Batch size (rows per model call) ─────────────────────────────────────────
const BATCH_ROWS = 20

// ─── Blank / TBD refId patterns ───────────────────────────────────────────────
const BLANK_REFID = /^(tbd|n\/a|na|blank|—|–|-|\?+|x+)$/i

// ─── Multi-refId splitter ──────────────────────────────────────────────────────
// Splits "GL.COV.002 GL.COV.003" → ["GL.COV.002", "GL.COV.003"].
// Pattern must handle all line-style refId schemes:
//   GL: GL.COV.004, GL.COV.004.009, GL.FORM.RU.001 (mixed alpha/digit segments)
//   IM: IM.COV044.00 (alphanumeric second segment), IM.RL.001
//   PR: PR.COV001.0 (single-digit tail), PR.ROC.001
//   HO: PH.COV.003.001 (4-segment)
// LDTable.001 / RTTable.001 are intentionally excluded (>4-char prefix → no match).
const REFID_TOKEN = /[A-Z]{1,4}(?:\.[A-Z0-9]+){2,}/i

function splitMultiRefId(raw: string): string[] {
  const tokens = raw.match(new RegExp(REFID_TOKEN.source, 'gi'))
  return tokens && tokens.length > 1 ? tokens : [raw.trim()]
}

// ─── Server-side parentId derivation ─────────────────────────────────────────
// After all rows for a sheet are extracted, derive parentId for sub-coverages.
// Sub-coverage detection: entity.fields has a non-empty 'subCoverageName' field.
// Parent: the most recent preceding coverage without subCoverageName (top-level).
// This is the row-context approach — more reliable than refId segment-count parsing
// because IM-style refIds (IM.COV044.00 / IM.COV044.01) have the same segment count.

function deriveParentIds(entities: BrainEntity[]): void {
  const coverages = entities
    .filter(e => e.kind === 'coverage')
    .sort((a, b) => a.sourceRowIndex - b.sourceRowIndex)

  let lastTopLevelRefId: string | null = null

  for (const entity of coverages) {
    const subCovField = entity.fields.find(f => f.fieldName === 'subCoverageName')
    const isSub =
      subCovField != null &&
      typeof subCovField.value === 'string' &&
      subCovField.value.trim() !== ''

    const refIdField = entity.fields.find(f => f.fieldName === 'refId')
    const refId = typeof refIdField?.value === 'string' ? refIdField.value : null

    if (!isSub) {
      lastTopLevelRefId = refId
    } else {
      const alreadyHasParent = entity.fields.some(
        f => f.fieldName === 'parentId' || f.fieldName === 'parentRefId',
      )
      if (!alreadyHasParent && lastTopLevelRefId) {
        entity.fields.push({
          fieldName:  'parentId',
          value:      lastTopLevelRefId,
          confidence: 0.90,
          citation:   { sheet: entity.sourceSheet, cell: '', verbatim: '(derived from row context)' },
        })
      }
    }
  }
}

// ─── AI extraction response shape ─────────────────────────────────────────────

interface RawField {
  fieldName:  string
  value:      unknown
  confidence: number
  citation:   { sheet: string; cell: string; verbatim: string }
}

interface RawEntity {
  kind:                string
  sourceRowIndex:      number
  reviewFlag:          boolean
  needsRefIdSynthesis: boolean
  fields:              RawField[]
}

interface ExtractionPayload {
  entities: RawEntity[]
}

function parseExtraction(raw: string): ExtractionPayload | null {
  try {
    const obj = extractJson(raw) as Record<string, unknown>
    if (!Array.isArray(obj['entities'])) return null
    return { entities: obj['entities'] as RawEntity[] }
  } catch { return null }
}

// ─── Build the row batch user-prompt ──────────────────────────────────────────

function buildExtractionPrompt(
  fp:        SheetFingerprint,
  colMap:    SheetColumnMap,
  headerRow: number,
  rows:      unknown[][],   // data rows (each is cells for that row)
  startIdx:  number,        // 0-based row index of the first row in `rows`
): string {
  // Build compact map legend: colIndex → { canonicalField, entityKind }
  const legend = colMap.mappings
    .filter(m => m.canonicalField !== null)
    .map(m => `  ${colLetter(m.colIndex)} → ${m.entityKind ?? '?'}.${m.canonicalField} (confidence ${m.confidence.toFixed(2)})`)
    .join('\n')

  // Serialize rows: one line per row, each cell as Col:value
  const rowLines = rows.map((cells, i) => {
    const rowIdx  = startIdx + i
    const cellStr = cells.map((cell, ci) => {
      const mapped = colMap.mappings.find(m => m.colIndex === ci)
      if (!mapped || mapped.canonicalField === null) return null
      return `${colLetter(ci)}="${String(cell ?? '')}"`
    }).filter(Boolean).join(' | ')
    return `Row ${rowIdx + headerRow + 2} (0-based ${rowIdx}): ${cellStr}`
  }).join('\n')

  return [
    `Sheet: "${fp.sheetName}" | Header row: ${headerRow + 1} (1-based)`,
    `Column map (col letter → canonical field):\n${legend || '  (no mapped columns)'}`,
    `\nRows to extract (${rows.length} rows, 0-based indices ${startIdx}–${startIdx + rows.length - 1}):\n${rowLines}`,
  ].join('\n')
}

// ─── Reconcile two entity arrays for a batch ──────────────────────────────────
// Simple reconcile: if both produced an entity for the same sourceRowIndex and their
// key fields agree → accept; else reviewFlag=true.

function reconcileEntities(
  aEntities: RawEntity[],
  bEntities: RawEntity[],
  bulkModel:    string,
  bulkAltModel: string,
  review:       ReviewItem[],
  sheetName:    string,
): BrainEntity[] {
  const aByRow = new Map<number, RawEntity>()
  const bByRow = new Map<number, RawEntity>()
  for (const e of aEntities) aByRow.set(e.sourceRowIndex, e)
  for (const e of bEntities) bByRow.set(e.sourceRowIndex, e)

  const allRowIdxs = new Set([...aByRow.keys(), ...bByRow.keys()])
  const result: BrainEntity[] = []

  for (const rowIdx of allRowIdxs) {
    const ea = aByRow.get(rowIdx)
    const eb = bByRow.get(rowIdx)

    const primary = ea ?? eb!

    const fields = toEntityFields(primary)
    const minConf = fields.length > 0
      ? Math.min(...fields.map(f => f.confidence))
      : 0

    let reviewFlag = primary.reviewFlag
    let needsSynth = primary.needsRefIdSynthesis

    // Check for refId-needing-synthesis via BLANK_REFID pattern
    const refIdField = fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
    if (refIdField && typeof refIdField.value === 'string' && BLANK_REFID.test(refIdField.value)) {
      needsSynth = true
      reviewFlag = true
    }

    // Disagreement check: compare refId field values
    if (ea && eb) {
      const refA = ea.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
      const refB = eb.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
      const disagree = refA?.value !== refB?.value
      if (disagree) {
        reviewFlag = true
        review.push({
          kind: 'disagreement', sheetName,
          rowIndex: rowIdx,
          detail: `BULK extracted refId "${String(refA?.value ?? '')}" but BULK_ALT extracted "${String(refB?.value ?? '')}".`,
        })
      }
    }

    if (minConf < CONFIDENCE_REVIEW && !reviewFlag) {
      reviewFlag = true
      review.push({
        kind: 'low-confidence-map', sheetName,
        rowIndex: rowIdx,
        detail: `Row ${rowIdx} entity has low min-field confidence (${minConf.toFixed(2)}).`,
      })
    }

    // Multi-refId expansion
    const refField = fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
    if (refField && typeof refField.value === 'string' && !needsSynth) {
      const refIds = splitMultiRefId(refField.value)
      if (refIds.length > 1) {
        for (const rid of refIds) {
          result.push(makeEntity(primary, fields, rid, refField, minConf, reviewFlag, needsSynth, bulkModel, bulkAltModel, sheetName, rowIdx))
        }
        continue
      }
    }

    result.push({
      kind:                primary.kind as CanonicalEntityKind,
      fields,
      overallConfidence:   minConf,
      sourceSheet:         sheetName,
      sourceRowIndex:      rowIdx,
      reviewFlag,
      needsRefIdSynthesis: needsSynth,
    })
  }

  return result
}

function makeEntity(
  primary:      RawEntity,
  fields:       BrainEntityField[],
  refId:        string,
  refField:     BrainEntityField,
  minConf:      number,
  reviewFlag:   boolean,
  needsSynth:   boolean,
  _bulkModel:    string,
  _bulkAltModel: string,
  sheetName:    string,
  rowIdx:       number,
): BrainEntity {
  const updatedFields = fields.map(f =>
    (f.fieldName === refField.fieldName)
      ? { ...f, value: refId, citation: { ...f.citation, verbatim: refId } }
      : f,
  )
  return {
    kind:                primary.kind as CanonicalEntityKind,
    fields:              updatedFields,
    overallConfidence:   minConf,
    sourceSheet:         sheetName,
    sourceRowIndex:      rowIdx,
    reviewFlag,
    needsRefIdSynthesis: needsSynth,
  }
}

function toEntityFields(raw: RawEntity): BrainEntityField[] {
  return (raw.fields ?? []).map(f => {
    const cit = f.citation ?? { sheet: '', cell: '', verbatim: '' }
    const citation: BrainCitation = {
      sheet:    cit.sheet ?? '',
      cell:     cit.cell ?? '',
      verbatim: cit.verbatim ?? '',
    }
    return {
      fieldName:  f.fieldName,
      value:      f.value,
      confidence: Number(f.confidence ?? 0),
      citation,
    }
  })
}

// ─── RefId synthesis via Line Intelligence Registry ───────────────────────────
// When needsRefIdSynthesis=true and a lobRefIdHint is available, resolve the
// archetype for that line and use its refId prefix to generate a placeholder.
// The synthesized id is clearly marked so downstream import can prompt the user.

function synthesizeRefId(
  entity:        BrainEntity,
  lobRefIdHint?: string,
  sheetCounter:  Map<string, number> = new Map(),
): void {
  if (!entity.needsRefIdSynthesis) return

  let prefix = 'XX'
  if (lobRefIdHint) {
    try {
      const archetype = resolveLineArchetypeByPrefix(lobRefIdHint.split('.')[0] ?? '')
      // Derive prefix from the archetype's lobRefId (e.g. "GL.LOB.001" → "GL")
      if (archetype) prefix = archetype.lobRefId.split('.')[0] ?? 'XX'
    } catch { /* leave default */ }
  }

  const kindSuffix: Record<string, string> = {
    product:        'PROD',
    coverage:       'COV',
    form:           'FORM',
    rule:           'RULE',
    ratingProgram:  'PROG',
    ratingStep:     'STEP',
    rtTable:        'RT',
    ldTable:        'LD',
    dynamicField:   'DF',
    formRule:       'FR',
  }
  const suffix = kindSuffix[entity.kind] ?? 'ENT'
  const key    = `${prefix}.${suffix}`
  const n      = (sheetCounter.get(key) ?? 0) + 1
  sheetCounter.set(key, n)

  const synth = `${prefix}.${suffix}.SYNTH${String(n).padStart(3, '0')}`

  // Inject / overwrite refId field
  const existing = entity.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
  if (existing) {
    existing.value = synth
    existing.citation.verbatim = '(synthesized)'
  } else {
    entity.fields.unshift({
      fieldName:  entity.kind === 'form' ? 'number' : 'refId',
      value:      synth,
      confidence: 0.5,
      citation:   { sheet: entity.sourceSheet, cell: '', verbatim: '(synthesized)' },
    })
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function extractRows(
  classified:    ClassifiedSheet[],
  locks:         HeaderLock[],
  colMaps:       SheetColumnMap[],
  fpByName:      Map<string, SheetFingerprint>,
  budget:        RoutingBudget,
  review:        ReviewItem[],
  lobRefIdHint?: string,
): Promise<BrainEntity[]> {
  const allEntities: BrainEntity[] = []

  const lockMap  = new Map<string, HeaderLock>()
  const colMapOf = new Map<string, SheetColumnMap>()
  for (const l of locks)   lockMap.set(l.sheetName, l)
  for (const m of colMaps) colMapOf.set(m.sheetName, m)

  const bulkDeploy    = DEPLOY_HAIKU      // claude-haiku-4-5
  const bulkAltDeploy = DEPLOY_GPT_MINI   // gpt-5-mini

  const contentSheets = classified.filter(c => c.domain !== 'ignore' && c.domain !== 'definitions')

  const synthCounter = new Map<string, number>()

  for (const sheet of contentSheets) {
    if (sheet.sheetName.includes('::')) continue
    const fp     = fpByName.get(sheet.sheetName)
    const lock   = lockMap.get(sheet.sheetName)
    const colMap = colMapOf.get(sheet.sheetName)
    if (!fp || !lock || !colMap) continue

    // Gather data rows from the sheet (rows after the header)
    // We use columnProfiles' distinctSample as a proxy; real data comes from the
    // StructuralModel. The fingerprinter gives us the header row but not the actual cells
    // beyond the profiles. For this pipeline the user prompt includes the profile samples;
    // real row-by-row data requires the raw cells array (provided in SubTable.cells for
    // STACKED_TABLES, or the columnProfiles' distinctSample for FLAT_TABLE).
    //
    // Strategy: for STACKED_TABLES use sub-table cells; for flat tables reconstruct
    // synthetic rows from distinctSample values column-by-column.
    const rows: unknown[][] = gatherRows(fp, lock)
    if (rows.length === 0) continue

    // Collect per-sheet entities so deriveParentIds can see the full sheet context
    const sheetEntities: BrainEntity[] = []

    // Batch extraction
    for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_ROWS) {
      const batch = rows.slice(batchStart, batchStart + BATCH_ROWS)
      const userPrompt = buildExtractionPrompt(fp, colMap, lock.headerRowIndex, batch, batchStart)

      const [bulkRes, bulkAltRes] = await Promise.all([
        extractFieldsWithRole(BRAIN_BULK, {
          systemPrompt: STAGE4_EXTRACT_SYSTEM,
          userPrompt,
          maxTokens:    4096,
        }, budget),
        extractFieldsWithRole(BRAIN_BULK_ALT, {
          systemPrompt: STAGE4_EXTRACT_SYSTEM,
          userPrompt,
          maxTokens:    4096,
        }, budget),
      ])

      const aPayload = parseExtraction(bulkRes.raw)
      const bPayload = parseExtraction(bulkAltRes.raw)

      const entities = reconcileEntities(
        aPayload?.entities ?? [],
        bPayload?.entities ?? [],
        bulkDeploy,
        bulkAltDeploy,
        review,
        fp.sheetName,
      )

      // RefId synthesis for blank/TBD cells
      for (const entity of entities) {
        if (entity.needsRefIdSynthesis) {
          synthesizeRefId(entity, lobRefIdHint, synthCounter)
          review.push({
            kind:      'refid-synthesis-needed',
            sheetName: fp.sheetName,
            rowIndex:  entity.sourceRowIndex,
            detail:    `Row ${entity.sourceRowIndex} had no refId; synthesized placeholder — human review required.`,
          })
        }
      }

      // Escalate very low-confidence entities to REASONER_A
      const escalate = entities.filter(e => e.overallConfidence < CONFIDENCE_REVIEW && !e.reviewFlag)
      if (escalate.length > 0) {
        const escUser = `${userPrompt}\n\nThe bulk extractor flagged these row indices as low-confidence: ${escalate.map(e => e.sourceRowIndex).join(', ')}. Please re-extract them with higher care.`
        const rARes = await extractFieldsWithRole(BRAIN_REASONER_A, {
          systemPrompt: STAGE4_EXTRACT_SYSTEM,
          userPrompt:   escUser,
          maxTokens:    2048,
        }, budget)
        const rAPayload = parseExtraction(rARes.raw)
        // Merge REASONER_A results for escalated rows
        if (rAPayload) {
          for (const escalatedEntity of escalate) {
            const rAEntity = rAPayload.entities.find(e => e.sourceRowIndex === escalatedEntity.sourceRowIndex)
            if (rAEntity) {
              const rAFields = toEntityFields(rAEntity)
              const rAConf   = rAFields.length > 0 ? Math.min(...rAFields.map(f => f.confidence)) : 0
              if (rAConf > escalatedEntity.overallConfidence) {
                escalatedEntity.fields            = rAFields
                escalatedEntity.overallConfidence = rAConf
              }
            }
          }
        }
      }

      // Mark review flags on all remaining low-confidence entities
      for (const entity of entities) {
        if (entity.overallConfidence < CONFIDENCE_REVIEW) {
          entity.reviewFlag = true
        }
      }

      sheetEntities.push(...entities)
    }

    // After all batches for this sheet, derive parentId for sub-coverages from row context
    deriveParentIds(sheetEntities)
    allEntities.push(...sheetEntities)
  }

  return allEntities
}

// ─── Gather rows helper ────────────────────────────────────────────────────────
// Reconstructs data rows from the SheetFingerprint for flat tables.
// For STACKED_TABLES uses SubTable.cells directly.

function gatherRows(fp: SheetFingerprint, _lock: HeaderLock): unknown[][] {
  if (fp.layoutShape === 'STACKED_TABLES' && fp.subTables) {
    return fp.subTables.flatMap(sub => sub.cells.slice(1))  // skip the sub-header row
  }

  // For FLAT_TABLE / INDENTED_HIERARCHY / WIDE_MATRIX: reconstruct column-major → row-major.
  // We have distinctSample per column (up to 20 values). We transpose to synthetic rows.
  // This gives the model real cell values for classification even without the full cells array.
  const maxRows = Math.max(...fp.columnProfiles.map(c => c.distinctSample.length), 0)
  if (maxRows === 0) return []

  const rows: unknown[][] = []
  for (let r = 0; r < maxRows; r++) {
    const row: unknown[] = fp.columnProfiles.map(c => c.distinctSample[r] ?? null)
    rows.push(row)
  }
  return rows
}
