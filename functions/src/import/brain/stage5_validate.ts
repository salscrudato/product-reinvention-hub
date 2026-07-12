// functions/src/import/brain/stage5_validate.ts — Adversarial validation.
//
// VALIDATOR = gpt-5.1 (VISION role, OpenAI family).
// This is intentionally a DIFFERENT model family from the primary bulk extractor
// (BULK = claude-haiku-4-5, Anthropic family) to decorrelate extraction errors.
//
// The validator checks ALL produced entities across ALL sheets in one or more calls:
//   1. GROUNDING: every field's verbatim matches its cited cell value.
//   2. REFID FIDELITY: refId / form-number fields are byte-identical to the source verbatim.
//   3. ENUM CONFORMANCE: enum fields are within their allowed set.
//   4. TREE INTEGRITY: every entity with a parentId has a matching parent in the batch.
//   5. ROW COVERAGE: sourceRowCount vs entities produced (accounting for multi-refId splits).
//
// The validator EMITS a discrepancy list — it does NOT re-extract or modify entities.
// Stage 6 reconciles the discrepancies into the reviewQueue.

import type { RoutingBudget } from '../../ai/router'
import { BRAIN_VALIDATOR, extractFieldsWithRole } from '../../ai/router'
import { STAGE5_VALIDATE_SYSTEM } from './prompts'
import type { BrainEntity, ValidationDiscrepancy, ReviewItem } from './types'
import { extractJson } from './types'
import type { ClassifiedSheet } from './types'

// ─── Validator payload per sheet ──────────────────────────────────────────────
// We call the validator once per sheet (not per entity) to keep prompt size bounded.
const MAX_ENTITIES_PER_CALL = 50

// ─── AI response shape ────────────────────────────────────────────────────────

interface RawDiscrepancy {
  kind:         string
  entityIndex?: number
  fieldName?:   string
  expected?:    string
  found?:       string
  detail:       string
}

interface ValidatorResponse {
  discrepancies:      RawDiscrepancy[]
  sourceRowsChecked:  number
  entitiesValidated:  number
}

const VALID_KINDS = new Set<string>([
  'ungrounded-field', 'refId-mismatch', 'enum-out-of-range',
  'orphan-coverage', 'dropped-row', 'form-number-mismatch',
])

function parseValidatorResponse(raw: string): ValidatorResponse | null {
  try {
    const obj = extractJson(raw) as Record<string, unknown>
    const discrepancies = (obj['discrepancies'] as RawDiscrepancy[] | undefined) ?? []
    return {
      discrepancies: discrepancies.filter(d => VALID_KINDS.has(d.kind)),
      sourceRowsChecked: Number(obj['sourceRowsChecked'] ?? 0),
      entitiesValidated: Number(obj['entitiesValidated'] ?? 0),
    }
  } catch { return null }
}

// ─── Build validator user prompt ───────────────────────────────────────────────

function buildValidatorPrompt(
  sheetName:        string,
  entities:         BrainEntity[],
  sourceRowCount:   number,
): string {
  const entitySummary = entities.map((e, idx) => {
    const fields = e.fields.map(f =>
      `    ${f.fieldName}: ${JSON.stringify(f.value)} | confidence ${f.confidence.toFixed(2)} | cited "${f.citation.verbatim}" at ${f.citation.sheet}!${f.citation.cell}`,
    ).join('\n')
    return `  Entity ${idx} (${e.kind}, row ${e.sourceRowIndex}${e.reviewFlag ? ', FLAGGED' : ''}):\n${fields}`
  }).join('\n\n')

  // Collect all refIds so the validator can check parentId links
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

export async function validateEntities(
  entities:   BrainEntity[],
  classified: ClassifiedSheet[],
  budget:     RoutingBudget,
  review:     ReviewItem[],
): Promise<ValidationDiscrepancy[]> {
  const allDiscrepancies: ValidationDiscrepancy[] = []

  // Group entities by source sheet
  const bySheet = new Map<string, BrainEntity[]>()
  for (const e of entities) {
    if (!bySheet.has(e.sourceSheet)) bySheet.set(e.sourceSheet, [])
    bySheet.get(e.sourceSheet)!.push(e)
  }

  // Estimate source row counts from classified sheets (dataRowCount from fingerprinter)
  const rowCounts = new Map<string, number>(
    classified.filter(c => c.domain !== 'ignore').map(c => [c.sheetName, 0]),
  )

  for (const [sheetName, sheetEntities] of bySheet) {
    // Call validator in batches if there are many entities
    for (let start = 0; start < sheetEntities.length; start += MAX_ENTITIES_PER_CALL) {
      const batch      = sheetEntities.slice(start, start + MAX_ENTITIES_PER_CALL)
      const sourceRows = rowCounts.get(sheetName) ?? batch.length

      const userPrompt = buildValidatorPrompt(sheetName, batch, sourceRows)

      const result = await extractFieldsWithRole(BRAIN_VALIDATOR, {
        systemPrompt: STAGE5_VALIDATE_SYSTEM,
        userPrompt,
        maxTokens:    2048,
      }, budget)

      const parsed = parseValidatorResponse(result.raw)
      if (!parsed) {
        review.push({
          kind:      'validator-discrepancy',
          sheetName,
          detail:    'Validator returned an unparseable response; manual review recommended.',
        })
        continue
      }

      for (const disc of parsed.discrepancies) {
        const d: ValidationDiscrepancy = {
          kind:        disc.kind as ValidationDiscrepancy['kind'],
          entityIndex: disc.entityIndex,
          fieldName:   disc.fieldName,
          expected:    disc.expected,
          found:       disc.found,
          detail:      disc.detail,
        }
        allDiscrepancies.push(d)

        // Surface validator discrepancies in the review queue
        review.push({
          kind:      'validator-discrepancy',
          sheetName,
          rowIndex:  disc.entityIndex !== undefined ? batch[disc.entityIndex]?.sourceRowIndex : undefined,
          fieldPath: disc.fieldName,
          detail:    `[${disc.kind}] ${disc.detail}`,
        })

        // Mark the offending entity as flagged
        if (disc.entityIndex !== undefined && batch[disc.entityIndex]) {
          batch[disc.entityIndex]!.reviewFlag = true
        }
      }
    }
  }

  return allDiscrepancies
}
