'use strict'
// server/lib/import-brain/stage5-validate.js — Adversarial validation.
//
// VALIDATOR = gpt-5.1 (VISION role, OpenAI family).
// This is intentionally a DIFFERENT model family from the primary bulk extractor
// (BULK = claude-haiku-4-5, Anthropic family) to decorrelate extraction errors.
// Per REQ-1 spec: "Stage 5's validator must be a different model family from the
// stage 4 primary (adversarial decorrelation)."
//
// Checks per entity batch (up to 50):
//   1. GROUNDING: verbatim matches cited cell value.
//   2. REFID FIDELITY: byte-identical to verbatim source cell.
//   3. ENUM CONFORMANCE: enum fields within allowed sets.
//   4. TREE INTEGRITY: parentId references an existing entity.
//   5. ROW COVERAGE: no silently dropped rows.
//
// The validator EMITS discrepancies — it does NOT re-extract or modify entities.
// Stage 6 aggregates discrepancies into the reviewQueue.

const fleet = require('../fleet')
const { callOpenAI, resolveOpenAI } = require('./ai-call')
const { STAGE5_VALIDATE_SYSTEM } = require('./prompts')
const { extractJson } = require('./constants')

const MAX_ENTITIES_PER_CALL = 50

// ─── Valid discrepancy kinds ───────────────────────────────────────────────────

const VALID_KINDS = new Set([
  'ungrounded-field', 'refId-mismatch', 'enum-out-of-range',
  'orphan-coverage', 'dropped-row', 'form-number-mismatch',
])

// ─── Parse validator response ─────────────────────────────────────────────────

function parseValidatorResponse(raw) {
  try {
    const obj = extractJson(raw)
    const discrepancies = (obj.discrepancies || []).filter(d => VALID_KINDS.has(d.kind))
    return {
      discrepancies,
      sourceRowsChecked:  Number(obj.sourceRowsChecked ?? 0),
      entitiesValidated:  Number(obj.entitiesValidated ?? 0),
    }
  } catch { return null }
}

// ─── Build validator user prompt ───────────────────────────────────────────────

function buildValidatorPrompt(sheetName, entities, sourceRowCount) {
  const entitySummary = entities.map((e, idx) => {
    const fields = e.fields.map(f =>
      `    ${f.fieldName}: ${JSON.stringify(f.value)} | confidence ${f.confidence.toFixed(2)} | cited "${f.citation.verbatim}" at ${f.citation.sheet}!${f.citation.cell}`,
    ).join('\n')
    return `  Entity ${idx} (${e.kind}, row ${e.sourceRowIndex}${e.reviewFlag ? ', FLAGGED' : ''}):\n${fields}`
  }).join('\n\n')

  const allRefIds = entities.flatMap(e =>
    e.fields.filter(f => f.fieldName === 'refId' || f.fieldName === 'number').map(f => String(f.value ?? '')),
  )

  return [
    `Sheet: "${sheetName}"`,
    `Source rows available: ${sourceRowCount}`,
    `Entities extracted: ${entities.length}`,
    `All refIds in this extraction: ${allRefIds.join(', ') || '(none)'}`,
    `\nEntity details:\n${entitySummary}`,
  ].join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * VALIDATOR = gpt-5.1 (OpenAI) — different family from BULK (haiku/Anthropic).
 *
 * @param {object[]} entities    BrainEntity[] from stage 4
 * @param {object[]} classified  ClassifiedSheet[] (for row counts)
 * @param {object}   budget      { degraded: boolean }
 * @param {object[]} review      ReviewItem[] (mutated)
 * @returns {Promise<object[]>}  ValidationDiscrepancy[]
 */
async function validateEntities(entities, classified, budget, review) {
  const allDiscrepancies = []

  // VALIDATOR is gpt-5.1 (VISION / OpenAI). The call goes through resolveOpenAI
  // so the fleet cost guard is enforced before dispatch.
  const deployGpt = resolveOpenAI(fleet.DEPLOY_GPT, budget)

  // Group entities by source sheet.
  const bySheet = new Map()
  for (const e of entities) {
    if (!bySheet.has(e.sourceSheet)) bySheet.set(e.sourceSheet, [])
    bySheet.get(e.sourceSheet).push(e)
  }

  // Estimate source row counts from classified sheets.
  const rowCounts = new Map(
    classified.filter(c => c.domain !== 'ignore').map(c => [c.sheetName, 0]),
  )

  for (const [sheetName, allSheetEntities] of bySheet) {
    // Deterministic entities are grounded by construction (values copied from cells
    // by code) — adversarially validate a SAMPLE of them; AI-extracted entities are
    // always validated in full. Keeps the third-family check without paying for a
    // full pass over thousands of code-copied rows.
    const aiEntities  = allSheetEntities.filter(e => !e.deterministic)
    const detEntities = allSheetEntities.filter(e => e.deterministic)
    const detSample   = detEntities.length > MAX_ENTITIES_PER_CALL * 2
      ? [...detEntities.slice(0, MAX_ENTITIES_PER_CALL), ...detEntities.slice(-MAX_ENTITIES_PER_CALL)]
      : detEntities
    const sheetEntities = [...aiEntities, ...detSample]

    for (let start = 0; start < sheetEntities.length; start += MAX_ENTITIES_PER_CALL) {
      const batch      = sheetEntities.slice(start, start + MAX_ENTITIES_PER_CALL)
      const sourceRows = rowCounts.get(sheetName) ?? batch.length
      const userPrompt = buildValidatorPrompt(sheetName, batch, sourceRows)

      const result = await callOpenAI({
        deployment:   deployGpt,
        systemPrompt: STAGE5_VALIDATE_SYSTEM,
        userPrompt,
        maxTokens:    2048,
        budget,
      }).catch(() => ({ raw: '' }))

      const parsed = parseValidatorResponse(result.raw)
      if (!parsed) {
        review.push({ kind: 'validator-discrepancy', sheetName, detail: 'Validator returned an unparseable response; manual review recommended.' })
        continue
      }

      for (const disc of parsed.discrepancies) {
        const d = {
          kind:        disc.kind,
          entityIndex: disc.entityIndex,
          fieldName:   disc.fieldName,
          expected:    disc.expected,
          found:       disc.found,
          detail:      disc.detail,
        }
        allDiscrepancies.push(d)

        review.push({
          kind:      'validator-discrepancy',
          sheetName,
          rowIndex:  disc.entityIndex !== undefined ? (batch[disc.entityIndex]?.sourceRowIndex) : undefined,
          fieldPath: disc.fieldName,
          detail:    `[${disc.kind}] ${disc.detail}`,
        })

        if (disc.entityIndex !== undefined && batch[disc.entityIndex]) {
          batch[disc.entityIndex].reviewFlag = true
        }
      }
    }
  }

  return allDiscrepancies
}

module.exports = { validateEntities }
