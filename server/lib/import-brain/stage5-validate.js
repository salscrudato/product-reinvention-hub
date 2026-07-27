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
const { extractJson, pMap, parseWithRetry, colLetter } = require('./constants')

const MAX_ENTITIES_PER_CALL = 50

// ─── Valid discrepancy kinds ───────────────────────────────────────────────────

const VALID_KINDS = new Set([
  'ungrounded-field', 'refId-mismatch', 'enum-out-of-range',
  'orphan-coverage', 'dropped-row', 'form-number-mismatch',
  'cited-vs-actual-mismatch',
])

// ─── Deterministic citation resolver (P0-6 / ledger F07 + F08) ─────────────────
// Every cited field resolves against the AUTHORITATIVE normalized grid — code, not
// a model. Strict fields (refId / number / parentId) byte-compare against the cited
// cell (containment allowed: a multi-refId cell legitimately contains each id).
// Findings carry a severity; BLOCKING findings (invalid pointer on a strict field,
// fabricated strict id, fabricated relation target) mark the entity so stage 7
// routes it to unresolved instead of auto-accepting. The LLM validator below stays
// semantics-only. Importer-derived citations ('(synthesized)', '(derived from row
// context)', '(deterministic ISO-family parse)') have no source cell — skipped.

const STRICT_FIELDS = new Set(['refId', 'number', 'parentId'])
const DERIVED_VERBATIM = /^\(.*\)$/

function parseCellRef(cell) {
  const m = /^([A-Za-z]{1,3})([0-9]{1,7})$/.exec(String(cell ?? '').trim())
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: Number(m[2]) - 1, col: col - 1 }
}

// Loose canon for non-strict comparisons: numeric formatting and case fold away.
function canonLoose(v) {
  if (v === null || v === undefined) return ''
  const s = String(v).trim()
  const numericish = s.replace(/[$,\s]/g, '')
  if (numericish !== '' && /^-?\d+(\.\d+)?$/.test(numericish)) return String(Number(numericish))
  return s.toLowerCase()
}

function blockEntity(entity, reason) {
  entity.blocked = true
  entity.reviewFlag = true
  if (!Array.isArray(entity.blockReasons)) entity.blockReasons = []
  entity.blockReasons.push(reason)
}

function resolveCitationsDeterministic(entities, fpByName, review) {
  const findings = []
  if (!fpByName || typeof fpByName.get !== 'function') return findings

  // Every extracted strict id (for relation-target resolution).
  const refIdSet = new Set()
  for (const e of entities) {
    for (const f of e.fields ?? []) {
      if ((f.fieldName === 'refId' || f.fieldName === 'number') && typeof f.value === 'string' && f.value.trim()) refIdSet.add(f.value.trim())
    }
  }

  // Lazy per-sheet string-value index (only built when a relation target misses).
  const sheetValues = new Map()
  const sheetHasToken = (fp, token) => {
    if (!fp || !Array.isArray(fp.cells)) return true  // no grid → cannot judge; benefit of the doubt
    let vals = sheetValues.get(fp)
    if (!vals) {
      vals = []
      for (const row of fp.cells) for (const c of row ?? []) { if (typeof c === 'string' && c) vals.push(c) }
      sheetValues.set(fp, vals)
    }
    return vals.some(s => s === token || s.includes(token))
  }

  const push = (kind, severity, e, fieldName, detail) => {
    findings.push({ kind, severity, sheetName: e.sourceSheet, sourceRowIndex: e.sourceRowIndex, fieldName, detail })
    review.push({ kind: severity === 'BLOCKING' ? 'citation-blocked' : 'citation-mismatch', sheetName: e.sourceSheet, rowIndex: e.sourceRowIndex, fieldPath: fieldName, detail: `[${kind}] ${detail}` })
  }

  for (const e of entities) {
    // No layout gets a softer severity. The stacked exemption that used to live here
    // ("stacked-table layouts have no absolute grid rows — row labels are approximate,
    // so mismatches there warn instead of block") was true only because gatherRows
    // returned gridRows:null for stacked sheets and every row label below the first
    // sub-table was genuinely wrong. Sub-tables now carry an absolute cellsStartRow,
    // so a stacked citation is exactly as resolvable as a flat one — and a mismatch
    // is a real fabrication signal, not an artifact of unanchored rows.
    const entityFp = fpByName.get(e.sourceSheet)

    for (const f of e.fields ?? []) {
      const cit = f.citation
      const strict = STRICT_FIELDS.has(f.fieldName)
      if (cit && DERIVED_VERBATIM.test(String(cit.verbatim ?? ''))) continue
      // CITATIONS-OR-DISCARDED gate. A model that omits a citation does not leave `citation`
      // undefined — stage 4's toEntityFields backfills {sheet:'',cell:'',verbatim:''} — so
      // "no pointer" is NOT "nothing to check", it is a claim with no source. Skipping here
      // let a FABRICATED strict id past the byte-compare below purely by omitting its cell.
      // Every legitimate uncited value returned already: importer synthesis carries a
      // '(synthesized)' verbatim (DERIVED_VERBATIM, above) and the deterministic extractor
      // always emits a real cell ref. So a value reaching this point is ungrounded.
      if (!cit || !cit.cell) {
        const vs = String(f.value ?? '').trim()
        if (vs && strict) {
          push('uncited-strict-id', 'BLOCKING', e, f.fieldName,
            `strict id "${vs.slice(0, 80)}" carries no citation cell — an uncited id cannot be byte-compared against the source, so it cannot be distinguished from a fabricated one`)
          blockEntity(e, `uncited strict id on ${f.fieldName}: "${vs.slice(0, 80)}"`)
        } else if (vs && String(cit?.verbatim ?? '').trim() !== '') {
          push('uncited-field', 'WARN', e, f.fieldName,
            `verbatim "${String(cit.verbatim).slice(0, 60)}" carries no citation cell — there is nothing to ground it against`)
          e.reviewFlag = true
        }
        continue
      }
      const citFp = (cit.sheet && fpByName.get(cit.sheet)) || entityFp
      if (!citFp || !Array.isArray(citFp.cells) || citFp.cells.length === 0) continue  // legacy fingerprint — nothing authoritative to resolve against
      const ref = parseCellRef(cit.cell)
      if (!ref || ref.row < 0 || ref.row >= citFp.cells.length || ref.col < 0) {
        const sev = strict ? 'BLOCKING' : 'WARN'
        push('invalid-citation-pointer', sev, e, f.fieldName, `citation "${cit.sheet}!${cit.cell}" does not resolve to a cell in the source grid (${citFp.cells.length} rows)`)
        if (sev === 'BLOCKING') blockEntity(e, `invalid citation pointer on ${f.fieldName} (${cit.sheet}!${cit.cell})`)
        else e.reviewFlag = true
        continue
      }
      const actual = citFp.cells[ref.row]?.[ref.col]
      const actualStr = actual === null || actual === undefined ? '' : String(actual)
      if (strict) {
        const vs = String(f.value ?? '').trim()
        if (vs && actualStr !== vs && !actualStr.includes(vs)) {
          push('fabricated-strict-id', 'BLOCKING', e, f.fieldName, `cited cell ${cit.sheet}!${cit.cell} contains "${actualStr.slice(0, 80)}", not "${vs}" — strict ids must be byte-for-byte from the source`)
          blockEntity(e, `fabricated strict id on ${f.fieldName}: "${vs}" not in cited cell ${cit.sheet}!${cit.cell}`)
        }
      } else if (String(cit.verbatim ?? '').trim() !== '' && actualStr !== '') {
        if (canonLoose(actualStr) !== canonLoose(cit.verbatim)) {
          push('ungrounded-field', 'WARN', e, f.fieldName, `verbatim "${String(cit.verbatim).slice(0, 60)}" does not match cited cell ${cit.sheet}!${cit.cell} ("${actualStr.slice(0, 60)}")`)
          e.reviewFlag = true
        }
      }
    }

    // Relation target: a model-cited parentId must exist among extracted ids, or at
    // least appear somewhere in the source sheet (extraction gap the ISO join /
    // orphan promotion can still repair → WARN). Absent from both → fabricated.
    const pf = (e.fields ?? []).find(f => f.fieldName === 'parentId')
    if (pf && typeof pf.value === 'string' && pf.value.trim() && pf.citation && pf.citation.cell && !DERIVED_VERBATIM.test(String(pf.citation.verbatim ?? ''))) {
      const target = pf.value.trim()
      if (!refIdSet.has(target)) {
        const fpp = (pf.citation.sheet && fpByName.get(pf.citation.sheet)) || entityFp
        if (!sheetHasToken(fpp, target)) {
          push('unresolvable-relation-target', 'BLOCKING', e, 'parentId', `parentId "${target}" matches no extracted entity and appears nowhere in the source sheet — fabricated relation target`)
          blockEntity(e, `unresolvable relation target parentId="${target}"`)
        } else {
          push('unresolvable-relation-target', 'WARN', e, 'parentId', `parentId "${target}" matches no extracted entity (present in the source sheet — may resolve via the deterministic join)`)
          e.reviewFlag = true
        }
      }
    }
  }
  return findings
}

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
// The validator's grounding check is only as real as the evidence it is handed.
// The pre-fix prompt shipped each field's value + claimed verbatim and NOTHING
// from the source — so "does the value match its cited verbatim" was the model
// comparing the extractor's claim against itself, and an internally consistent
// mis-extraction with a fabricated matching verbatim passed with zero
// discrepancies. Every citation now RESOLVES against the authoritative grids
// (already in scope) and the actual cell content rides beside the claim, plus
// one row of source context per entity — capped so a 50-entity batch stays
// well inside the input window.

const ACTUAL_CELL_CAP = 80    // chars of actual cell content per field line
const CONTEXT_ROW_CAP = 320   // chars of the one source-row context line per entity
const CONTEXT_CELL_CAP = 40   // chars per cell inside the context line

function buildValidatorPrompt(sheetName, entities, sourceRowCount, fpByName) {
  const gridOf = (sheet) => {
    const fp = fpByName && typeof fpByName.get === 'function' ? fpByName.get(sheet) : null
    return fp && Array.isArray(fp.cells) && fp.cells.length > 0 ? fp.cells : null
  }
  const resolveActual = (sheet, cellRef) => {
    const grid = gridOf(sheet)
    if (!grid) return null
    const ref = parseCellRef(cellRef)
    if (!ref || ref.row < 0 || ref.row >= grid.length || ref.col < 0) return null
    const v = grid[ref.row]?.[ref.col]
    return v === null || v === undefined ? '' : String(v)
  }

  const entitySummary = entities.map((e, idx) => {
    const fields = e.fields.map(f => {
      const base = `    ${f.fieldName}: ${JSON.stringify(f.value)} | confidence ${f.confidence.toFixed(2)} | cited "${f.citation.verbatim}" at ${f.citation.sheet}!${f.citation.cell}`
      if (!f.citation.cell || DERIVED_VERBATIM.test(String(f.citation.verbatim ?? ''))) return base
      const actual = resolveActual(f.citation.sheet || e.sourceSheet, f.citation.cell)
      if (actual === null) return base
      return `${base} | ACTUAL cell content: ${JSON.stringify(actual.slice(0, ACTUAL_CELL_CAP))}`
    }).join('\n')

    // One row of source context per entity: the first resolvable cited row.
    let contextLine = ''
    const anchor = e.fields.find(f => f.citation && f.citation.cell && !DERIVED_VERBATIM.test(String(f.citation.verbatim ?? '')))
    if (anchor) {
      const sheet = anchor.citation.sheet || e.sourceSheet
      const grid = gridOf(sheet)
      const ref = grid ? parseCellRef(anchor.citation.cell) : null
      if (grid && ref && ref.row >= 0 && ref.row < grid.length) {
        const pieces = []
        let used = 0
        for (const [c, v] of (grid[ref.row] ?? []).entries()) {
          if (v === null || v === undefined || String(v) === '') continue
          const piece = `${colLetter(c)}${ref.row + 1}=${JSON.stringify(String(v).slice(0, CONTEXT_CELL_CAP))}`
          if (used + piece.length > CONTEXT_ROW_CAP) { pieces.push('…'); break }
          pieces.push(piece)
          used += piece.length + 3
        }
        if (pieces.length > 0) contextLine = `\n    SOURCE ROW (${sheet}): ${pieces.join(' | ')}`
      }
    }
    return `  Entity ${idx} (${e.kind}, row ${e.sourceRowIndex}${e.reviewFlag ? ', FLAGGED' : ''}):\n${fields}${contextLine}`
  }).join('\n\n')

  const allRefIds = entities.flatMap(e =>
    e.fields.filter(f => f.fieldName === 'refId' || f.fieldName === 'number').map(f => String(f.value ?? '')),
  )

  return [
    `Sheet: "${sheetName}"`,
    `Source rows available: ${sourceRowCount}`,
    `Entities extracted: ${entities.length}`,
    `All refIds in this extraction: ${allRefIds.join(', ') || '(none)'}`,
    `\nEntity details ("ACTUAL cell content" lines are resolved by CODE from the authoritative source grid — they are the ground truth to check claims against):\n${entitySummary}`,
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
 * @param {Map<string,object>} [fpByName]  sheetName → SheetFingerprint (authoritative grids)
 * @returns {Promise<object[]>}  ValidationDiscrepancy[]
 */
async function validateEntities(entities, classified, budget, review, fpByName) {
  const allDiscrepancies = []

  // Deterministic pass FIRST (P0-6): resolve citations against the real grids;
  // BLOCKING findings mark entities so stage 7 cannot auto-accept them.
  allDiscrepancies.push(...resolveCitationsDeterministic(entities, fpByName, review))

  // VALIDATOR is gpt-5.1 (VISION / OpenAI). The call goes through resolveOpenAI
  // so the fleet cost guard is enforced before dispatch.
  const deployGpt = resolveOpenAI(fleet.DEPLOY_GPT, budget)

  // Group entities by source sheet.
  const bySheet = new Map()
  for (const e of entities) {
    if (!bySheet.has(e.sourceSheet)) bySheet.set(e.sourceSheet, [])
    bySheet.get(e.sourceSheet).push(e)
  }

  // Real source row counts from the fingerprints (ledger F07: these initialized to
  // zero and never updated, so the dropped-row check could never fire).
  const rowCounts = new Map(
    classified.filter(c => c.domain !== 'ignore').map(c => {
      const fp = fpByName && typeof fpByName.get === 'function' ? fpByName.get(c.sheetName) : null
      return [c.sheetName, Number(fp?.dataRowCount ?? 0)]
    }),
  )

  // Sheet groups validate independently — 3 in flight (batches inside stay serial).
  await pMap([...bySheet.entries()], async ([sheetName, allSheetEntities]) => {
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
      const userPrompt = buildValidatorPrompt(sheetName, batch, sourceRows, fpByName)

      const parsed = await parseWithRetry({
        call: () => callOpenAI({
          deployment:   deployGpt,
          systemPrompt: STAGE5_VALIDATE_SYSTEM,
          userPrompt,
          // 8192 (was 4096): arming the prompt with actual cells + context rows
          // grew the input, and the o-series validator spends completion budget
          // on reasoning scaled to it — a 50-entity batch measurably truncated
          // at 4096 on the Core book. Output stays discrepancies-only.
          maxTokens:    8192,
          budget,
        }),
        parse: parseValidatorResponse, review, stage: 'stage5', sheetName, what: `validator batch @${start}`,
        vote: { budget, site: 'stage5-validate', family: 'openai' },
      })
      if (!parsed) {
        review.push({ kind: 'validator-discrepancy', sheetName, detail: 'Validator returned an unparseable response (after one retry); manual review recommended.' })
        continue
      }

      for (const disc of parsed.discrepancies) {
        const d = {
          kind:        disc.kind,
          // LLM findings are semantic advisories — WARN only (P0-6/F08); the
          // deterministic resolver above owns the BLOCKING severities.
          severity:    'WARN',
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
  }, 3)

  return allDiscrepancies
}

module.exports = { validateEntities, resolveCitationsDeterministic, buildValidatorPrompt }
