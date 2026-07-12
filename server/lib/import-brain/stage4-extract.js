'use strict'
// server/lib/import-brain/stage4-extract.js — Row extraction + normalization.
//
// For each content sheet with a confirmed column map:
//   1. Gather data rows from SheetFingerprint.
//   2. BULK (haiku-4-5, Anthropic) + BULK_ALT (gpt-5-mini, OpenAI) extract in parallel.
//   3. Reconcile: agree on key fields → accept at avg confidence; else reviewFlag=true.
//   4. Multi-refId cells → split, one entity per refId.
//   5. Blank/TBD refIds → needsRefIdSynthesis=true; synthesize a placeholder.
//   6. Low-confidence entities → escalate to REASONER_A (opus) for a second pass.
//   7. After all batches for a sheet: deriveParentIds for sub-coverages.
//
// BULK (Anthropic) + BULK_ALT (OpenAI) → decorrelated extraction.
// Stage 5 then validates with gpt-5.1 (a third, independent perspective).
// Temperature 0 on all Claude calls.

const fleet = require('../fleet')
const { callAnthropic, callOpenAI, resolveAnthropic, resolveOpenAI } = require('./ai-call')
const { STAGE4_EXTRACT_SYSTEM } = require('./prompts')
const {
  extractJson, colLetter,
  BLANK_REFID, splitMultiRefId, CONFIDENCE_REVIEW,
} = require('./constants')

const BATCH_ROWS = 20

// ─── Parse extraction response ─────────────────────────────────────────────────

function parseExtraction(raw) {
  try {
    const obj = extractJson(raw)
    if (!Array.isArray(obj.entities)) return null
    return { entities: obj.entities }
  } catch { return null }
}

// ─── Normalize raw field to BrainEntityField ──────────────────────────────────

function toEntityFields(rawEntity) {
  return (rawEntity.fields ?? []).map(f => {
    const cit = f.citation ?? { sheet: '', cell: '', verbatim: '' }
    return {
      fieldName:  f.fieldName,
      value:      f.value,
      confidence: Number(f.confidence ?? 0),
      citation:   { sheet: cit.sheet ?? '', cell: cit.cell ?? '', verbatim: cit.verbatim ?? '' },
    }
  })
}

// ─── Reconcile two entity arrays for a batch ──────────────────────────────────

function reconcileEntities(aEntities, bEntities, sheetName, review) {
  const aByRow = new Map()
  const bByRow = new Map()
  for (const e of (aEntities || [])) aByRow.set(e.sourceRowIndex, e)
  for (const e of (bEntities || [])) bByRow.set(e.sourceRowIndex, e)

  const allRowIdxs = new Set([...aByRow.keys(), ...bByRow.keys()])
  const result = []

  for (const rowIdx of allRowIdxs) {
    const ea = aByRow.get(rowIdx)
    const eb = bByRow.get(rowIdx)
    const primary = ea ?? eb

    const fields  = toEntityFields(primary)
    const minConf = fields.length > 0 ? Math.min(...fields.map(f => f.confidence)) : 0

    let reviewFlag = Boolean(primary.reviewFlag)
    let needsSynth = Boolean(primary.needsRefIdSynthesis)

    // Detect blank/TBD refIds
    const refIdField = fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
    if (refIdField && typeof refIdField.value === 'string' && BLANK_REFID.test(refIdField.value)) {
      needsSynth = true; reviewFlag = true
    }

    // Disagreement check on refId
    if (ea && eb) {
      const refA = ea.fields && ea.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
      const refB = eb.fields && eb.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
      if (refA && refB && refA.value !== refB.value) {
        reviewFlag = true
        review.push({ kind: 'disagreement', sheetName, rowIndex: rowIdx, detail: `BULK extracted refId "${String(refA.value ?? '')}" but BULK_ALT extracted "${String(refB.value ?? '')}".` })
      }
    }

    if (minConf < CONFIDENCE_REVIEW && !reviewFlag) {
      reviewFlag = true
      review.push({ kind: 'low-confidence-map', sheetName, rowIndex: rowIdx, detail: `Row ${rowIdx} entity has low min-field confidence (${minConf.toFixed(2)}).` })
    }

    // Multi-refId expansion
    const refField = fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
    if (refField && typeof refField.value === 'string' && !needsSynth) {
      const refIds = splitMultiRefId(refField.value)
      if (refIds.length > 1) {
        for (const rid of refIds) {
          result.push(makeEntity(primary, fields, rid, refField, minConf, reviewFlag, needsSynth, sheetName, rowIdx))
        }
        continue
      }
    }

    result.push({ kind: primary.kind, fields, overallConfidence: minConf, sourceSheet: sheetName, sourceRowIndex: rowIdx, reviewFlag, needsRefIdSynthesis: needsSynth })
  }

  return result
}

function makeEntity(primary, fields, refId, refField, minConf, reviewFlag, needsSynth, sheetName, rowIdx) {
  const updatedFields = fields.map(f =>
    f.fieldName === refField.fieldName
      ? { ...f, value: refId, citation: { ...f.citation, verbatim: refId } }
      : f,
  )
  return { kind: primary.kind, fields: updatedFields, overallConfidence: minConf, sourceSheet: sheetName, sourceRowIndex: rowIdx, reviewFlag, needsRefIdSynthesis: needsSynth }
}

// ─── RefId synthesis ──────────────────────────────────────────────────────────
// Blanks/TBD get a prefixed SYNTH placeholder. Never invents a real refId.

function synthesizeRefId(entity, lobRefIdHint, sheetCounter) {
  if (!entity.needsRefIdSynthesis) return
  const prefix = typeof lobRefIdHint === 'string' ? (lobRefIdHint.split('.')[0] || 'XX') : 'XX'
  const kindSuffix = { product: 'PROD', coverage: 'COV', form: 'FORM', rule: 'RULE', ratingProgram: 'PROG', ratingStep: 'STEP', rtTable: 'RT', ldTable: 'LD', dynamicField: 'DF', formRule: 'FR' }
  const suffix = kindSuffix[entity.kind] ?? 'ENT'
  const key = `${prefix}.${suffix}`
  const n   = (sheetCounter.get(key) ?? 0) + 1
  sheetCounter.set(key, n)
  const synth = `${prefix}.${suffix}.SYNTH${String(n).padStart(3, '0')}`
  const existing = entity.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
  if (existing) { existing.value = synth; existing.citation.verbatim = '(synthesized)' }
  else {
    entity.fields.unshift({ fieldName: entity.kind === 'form' ? 'number' : 'refId', value: synth, confidence: 0.5, citation: { sheet: entity.sourceSheet, cell: '', verbatim: '(synthesized)' } })
  }
}

// ─── Derive parentIds for sub-coverages from row context ──────────────────────

function deriveParentIds(entities) {
  const coverages = entities
    .filter(e => e.kind === 'coverage')
    .sort((a, b) => a.sourceRowIndex - b.sourceRowIndex)

  let lastTopLevelRefId = null

  for (const entity of coverages) {
    const subCovField = entity.fields.find(f => f.fieldName === 'subCoverageName')
    const isSub = subCovField != null && typeof subCovField.value === 'string' && subCovField.value.trim() !== ''
    const refIdField = entity.fields.find(f => f.fieldName === 'refId')
    const refId = typeof refIdField?.value === 'string' ? refIdField.value : null

    if (!isSub) {
      lastTopLevelRefId = refId
    } else {
      const alreadyHasParent = entity.fields.some(f => f.fieldName === 'parentId' || f.fieldName === 'parentRefId')
      if (!alreadyHasParent && lastTopLevelRefId) {
        entity.fields.push({ fieldName: 'parentId', value: lastTopLevelRefId, confidence: 0.90, citation: { sheet: entity.sourceSheet, cell: '', verbatim: '(derived from row context)' } })
      }
    }
  }
}

// ─── Build row extraction user prompt ─────────────────────────────────────────

function buildExtractionPrompt(fp, colMap, headerRow, rows, startIdx) {
  const legend = (colMap.mappings || [])
    .filter(m => m.canonicalField !== null)
    .map(m => `  ${colLetter(m.colIndex)} -> ${m.entityKind ?? '?'}.${m.canonicalField} (confidence ${m.confidence.toFixed(2)})`)
    .join('\n')

  const rowLines = rows.map((cells, i) => {
    const rowIdx  = startIdx + i
    const cellStr = cells.map((cell, ci) => {
      const mapped = (colMap.mappings || []).find(m => m.colIndex === ci)
      if (!mapped || mapped.canonicalField === null) return null
      return `${colLetter(ci)}="${String(cell ?? '')}"`
    }).filter(Boolean).join(' | ')
    return `Row ${rowIdx + headerRow + 2} (0-based ${rowIdx}): ${cellStr}`
  }).join('\n')

  return [
    `Sheet: "${fp.sheetName}" | Header row: ${headerRow + 1} (1-based)`,
    `Column map (col letter -> canonical field):\n${legend || '  (no mapped columns)'}`,
    `\nRows to extract (${rows.length} rows, 0-based indices ${startIdx}–${startIdx + rows.length - 1}):\n${rowLines}`,
  ].join('\n')
}

// ─── Gather rows from SheetFingerprint ────────────────────────────────────────

function gatherRows(fp) {
  if (fp.layoutShape === 'STACKED_TABLES' && fp.subTables) {
    return fp.subTables.flatMap(sub => (sub.cells || []).slice(1))  // skip sub-header row
  }
  // Reconstruct column-major distinctSample → row-major synthetic rows.
  const maxRows = Math.max(...(fp.columnProfiles || []).map(c => (c.distinctSample || []).length), 0)
  if (maxRows === 0) return []
  const rows = []
  for (let r = 0; r < maxRows; r++) {
    rows.push((fp.columnProfiles || []).map(c => (c.distinctSample || [])[r] ?? null))
  }
  return rows
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * @param {object[]}           classified    ClassifiedSheet[]
 * @param {object[]}           locks         HeaderLock[]
 * @param {object[]}           colMaps       SheetColumnMap[]
 * @param {Map<string,object>} fpByName      sheetName -> SheetFingerprint
 * @param {object}             budget        { degraded: boolean }
 * @param {object[]}           review        ReviewItem[] (mutated)
 * @param {string|undefined}   lobRefIdHint  e.g. 'GL.LOB.001'
 * @returns {Promise<object[]>} BrainEntity[]
 */
async function extractRows(classified, locks, colMaps, fpByName, budget, review, lobRefIdHint) {
  const allEntities = []
  const lockMap  = new Map()
  const colMapOf = new Map()
  for (const l of locks)   lockMap.set(l.sheetName, l)
  for (const m of colMaps) colMapOf.set(m.sheetName, m)

  // Resolve deployments once — all go through fleet.guard() via resolvers.
  const deployBulk    = resolveAnthropic('BULK_VERIFY', budget)
  const deployOpus    = resolveAnthropic('GROUNDED_CITED', budget)
  const deployGptMini = resolveOpenAI(fleet.DEPLOY_GPT_MINI, budget)  // BULK_ALT

  const contentSheets = classified.filter(c => c.domain !== 'ignore' && c.domain !== 'definitions')
  const synthCounter  = new Map()

  for (const sheet of contentSheets) {
    if (sheet.sheetName.includes('::')) continue
    const fp     = fpByName.get(sheet.sheetName)
    const lock   = lockMap.get(sheet.sheetName)
    const colMap = colMapOf.get(sheet.sheetName)
    if (!fp || !lock || !colMap) continue

    const rows = gatherRows(fp)
    if (rows.length === 0) continue

    const sheetEntities = []

    for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_ROWS) {
      const batch      = rows.slice(batchStart, batchStart + BATCH_ROWS)
      const userPrompt = buildExtractionPrompt(fp, colMap, lock.headerRowIndex, batch, batchStart)

      // BULK (haiku) + BULK_ALT (gpt-5-mini) in parallel.
      const [bulkRes, bulkAltRes] = await Promise.all([
        callAnthropic({ deployment: deployBulk, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 4096 }).catch(() => ({ raw: '' })),
        callOpenAI({ deployment: deployGptMini, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 4096 }).catch(() => ({ raw: '' })),
      ])

      const aPayload = parseExtraction(bulkRes.raw)
      const bPayload = parseExtraction(bulkAltRes.raw)

      const entities = reconcileEntities(
        aPayload?.entities ?? [],
        bPayload?.entities ?? [],
        fp.sheetName,
        review,
      )

      // RefId synthesis for blank/TBD cells.
      for (const entity of entities) {
        if (entity.needsRefIdSynthesis) {
          synthesizeRefId(entity, lobRefIdHint, synthCounter)
          review.push({ kind: 'refid-synthesis-needed', sheetName: fp.sheetName, rowIndex: entity.sourceRowIndex, detail: `Row ${entity.sourceRowIndex} had no refId; synthesized placeholder — human review required.` })
        }
      }

      // Escalate very low-confidence entities to REASONER_A (opus).
      const escalate = entities.filter(e => e.overallConfidence < CONFIDENCE_REVIEW && !e.reviewFlag)
      if (escalate.length > 0) {
        const escUser = `${userPrompt}\n\nThe bulk extractor flagged these row indices as low-confidence: ${escalate.map(e => e.sourceRowIndex).join(', ')}. Please re-extract them with higher care.`
        const rARes = await callAnthropic({ deployment: deployOpus, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt: escUser, maxTokens: 2048 }).catch(() => ({ raw: '' }))
        const rAPayload = parseExtraction(rARes.raw)
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

      for (const entity of entities) {
        if (entity.overallConfidence < CONFIDENCE_REVIEW) entity.reviewFlag = true
      }

      sheetEntities.push(...entities)
    }

    // After all batches: derive parentId for sub-coverages from row context.
    deriveParentIds(sheetEntities)
    allEntities.push(...sheetEntities)
  }

  return allEntities
}

module.exports = { extractRows }
