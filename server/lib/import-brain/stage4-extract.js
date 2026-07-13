'use strict'
// server/lib/import-brain/stage4-extract.js — Row extraction + ensemble consensus.
//
// For each content sheet with a confirmed column map:
//   1. Gather REAL data rows (SheetFingerprint.cells when present — the server-side
//      parse embeds the actual normalized grid; distinctSample reconstruction is the
//      legacy fallback for fingerprints built by older clients).
//   2. BULK (haiku-4-5, Anthropic) + BULK_ALT (gpt-5-mini, OpenAI) extract in parallel
//      — two decorrelated votes per field.
//   3. Field-level consensus: values that agree (numeric-canonicalized) are accepted at
//      boosted confidence. Fields that DISAGREE enter the escalation ladder:
//        haiku/gpt-mini votes → sonnet re-extract → opus re-extract → LLM judge.
//      The judge (gpt-5.1, OpenAI — decorrelated family) picks only a candidate that is
//      grounded in the source cells; verdict "none" → importWarning + reviewFlag.
//      Nothing is silently dropped: unresolved fields keep the best candidate FLAGGED.
//   4. Multi-refId cells → split, one entity per refId.
//   5. Blank/TBD refIds → needsRefIdSynthesis=true; synthesize a SYNTH placeholder
//      (prefix derived from the LOB registry hint — never invented).
//   6. After all batches for a sheet: deriveParentIds for sub-coverages.
//
// Temperature is omitted on all calls (deprecated / rejected by these models); path
// decorrelation comes from different model families and tiers, not sampling.

const fleet = require('../fleet')
const { callAnthropic, callOpenAI, resolveAnthropic, resolveOpenAI } = require('./ai-call')
const { STAGE4_EXTRACT_SYSTEM, STAGE4_JUDGE_SYSTEM } = require('./prompts')
const {
  extractJson, colLetter,
  BLANK_REFID, splitMultiRefId, CONFIDENCE_REVIEW,
} = require('./constants')

const BATCH_ROWS = 20

// Deterministic fast path: when the locked column map is confident and the REAL
// grid is embedded, rows are extracted by CODE (byte-perfect values, guaranteed
// sheet!cell citations, zero extraction cost) and the AI ensemble shifts to a
// sampled cross-check of the MAP. AI extraction remains the path for ambiguous
// maps, stacked/irregular layouts, and legacy fingerprints without cells.
const DET_MAP_CONFIDENCE = 0.80   // per-column floor for deterministic extraction
const DET_SHEET_FRACTION = 0.60   // fraction of mapped columns that must clear the floor
const DET_SAMPLE_BATCHES = 2      // AI cross-check batches per deterministic sheet

// ─── Parse extraction response ─────────────────────────────────────────────────

function parseExtraction(raw) {
  try {
    const obj = extractJson(raw)
    if (!Array.isArray(obj.entities)) return null
    return { entities: obj.entities }
  } catch { return null }
}

// ─── Value canonicalization for consensus comparison ──────────────────────────
// "1,528", "$1,528.00", 1528 → the same numeric token; strings compare trimmed.

function canonicalValue(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null
  if (typeof v === 'boolean') return String(v)
  const s = String(v).trim()
  if (s === '') return null
  const numericish = s.replace(/[$,\s]/g, '')
  if (/^-?\d+(\.\d+)?%?$/.test(numericish)) {
    const n = Number(numericish.replace('%', ''))
    if (Number.isFinite(n)) return numericish.endsWith('%') ? `${n}%` : String(n)
  }
  return s
}

function valuesAgree(a, b) {
  const ca = canonicalValue(a)
  const cb = canonicalValue(b)
  if (ca === null || cb === null) return ca === cb
  if (ca === cb) return true
  // Strings: case-insensitive trimmed match still counts as agreement.
  return typeof a === 'string' && typeof b === 'string' && ca.toLowerCase() === cb.toLowerCase()
}

function isNumericValue(v) {
  const c = canonicalValue(v)
  return c !== null && /^-?\d+(\.\d+)?%?$/.test(c)
}

// refId-ish fields must match byte-for-byte — no normalization forgiveness.
function isStrictField(fieldName) {
  return fieldName === 'refId' || fieldName === 'number' || fieldName === 'parentId'
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

// ─── Field-level reconcile of two extractor votes ─────────────────────────────
// Returns { entities, conflicts } — conflicts carry both candidates for the ladder.

function reconcileEntities(aEntities, bEntities, sheetName, review) {
  const aByRow = new Map()
  const bByRow = new Map()
  for (const e of (aEntities || [])) aByRow.set(e.sourceRowIndex, e)
  for (const e of (bEntities || [])) bByRow.set(e.sourceRowIndex, e)

  const allRowIdxs = [...new Set([...aByRow.keys(), ...bByRow.keys()])].sort((x, y) => x - y)
  const result = []
  const conflicts = []

  for (const rowIdx of allRowIdxs) {
    const ea = aByRow.get(rowIdx)
    const eb = bByRow.get(rowIdx)
    const primary = ea ?? eb

    const aFields = ea ? toEntityFields(ea) : []
    const bFields = eb ? toEntityFields(eb) : []
    const bByName = new Map(bFields.map(f => [f.fieldName, f]))
    const seen = new Set()
    const fields = []

    for (const fa of aFields) {
      seen.add(fa.fieldName)
      const fb = bByName.get(fa.fieldName)
      if (!fb) {
        // Single-vote field: accept at a small penalty.
        fields.push({ ...fa, confidence: fa.confidence * 0.9 })
        continue
      }
      const strict = isStrictField(fa.fieldName)
      const agree = strict ? String(fa.value ?? '') === String(fb.value ?? '') : valuesAgree(fa.value, fb.value)
      if (agree) {
        // Two independent votes agree → boost toward the max.
        const conf = Math.min(1, Math.max(fa.confidence, fb.confidence) * 1.05)
        fields.push({ ...(fa.confidence >= fb.confidence ? fa : fb), confidence: conf })
      } else {
        // Conflict — keep the higher-confidence candidate for now; ladder resolves.
        const kept = fa.confidence >= fb.confidence ? fa : fb
        fields.push({ ...kept, conflicted: true })
        conflicts.push({
          rowIdx, fieldName: fa.fieldName,
          candidates: [
            { key: 'a', value: fa.value, confidence: fa.confidence, citation: fa.citation, source: 'BULK' },
            { key: 'b', value: fb.value, confidence: fb.confidence, citation: fb.citation, source: 'BULK_ALT' },
          ],
        })
      }
    }
    for (const fb of bFields) {
      if (!seen.has(fb.fieldName)) fields.push({ ...fb, confidence: fb.confidence * 0.9 })
    }

    const minConf = fields.length > 0 ? Math.min(...fields.map(f => f.confidence)) : 0
    let reviewFlag = Boolean(primary.reviewFlag) || Boolean(ea && eb && conflicts.some(c => c.rowIdx === rowIdx))
    let needsSynth = Boolean(primary.needsRefIdSynthesis)

    // Detect blank/TBD refIds
    const refIdField = fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
    if (refIdField && (refIdField.value == null || (typeof refIdField.value === 'string' && BLANK_REFID.test(refIdField.value)))) {
      needsSynth = true; reviewFlag = true
    }

    if (minConf < CONFIDENCE_REVIEW && !reviewFlag) {
      reviewFlag = true
      review.push({ kind: 'low-confidence-map', sheetName, rowIndex: rowIdx, detail: `Row ${rowIdx} entity has low min-field confidence (${minConf.toFixed(2)}).` })
    }

    result.push({ kind: primary.kind, fields, overallConfidence: minConf, sourceSheet: sheetName, sourceRowIndex: rowIdx, reviewFlag, needsRefIdSynthesis: needsSynth })
  }

  return { entities: result, conflicts }
}

// ─── Weighted-majority vote over candidate values ─────────────────────────────
// Groups candidates by canonical value; a group with >= 2 votes wins outright,
// otherwise the top confidence-weighted group wins only if it clearly dominates.

function weightedMajority(candidates, strict) {
  const groups = new Map()
  for (const c of candidates) {
    if (c.value === null || c.value === undefined) continue
    const key = strict ? String(c.value) : (canonicalValue(c.value) ?? '')
    if (key === '') continue
    const g = groups.get(key) || { votes: 0, weight: 0, best: c }
    g.votes += 1
    g.weight += Math.max(0, Math.min(1, c.confidence))
    if (c.confidence > g.best.confidence) g.best = c
    groups.set(key, g)
  }
  if (groups.size === 0) return { consensus: false, winner: null }
  const ranked = [...groups.values()].sort((x, y) => (y.votes - x.votes) || (y.weight - x.weight))
  const top = ranked[0]
  if (top.votes >= 2) return { consensus: true, winner: top.best }
  if (ranked.length === 1 && top.best.confidence >= 0.9) return { consensus: true, winner: top.best }
  return { consensus: false, winner: top.best }
}

// ─── Consensus ladder: sonnet → opus votes, then LLM judge ────────────────────

function fieldsFromExtraction(payload, rowIdx) {
  const ent = payload?.entities?.find(e => e.sourceRowIndex === rowIdx)
  return ent ? toEntityFields(ent) : []
}

async function resolveConflicts({ conflicts, entities, fp, colMap, headerRow, rows, batchStart, sheetName, budget, review, deployJudge }) {
  if (conflicts.length === 0) return

  const conflictRowIdxs = [...new Set(conflicts.map(c => c.rowIdx))]
  const rowSlice = conflictRowIdxs
    .filter(idx => idx >= batchStart && idx < batchStart + rows.length)
    .map(idx => ({ idx, cells: rows[idx - batchStart] }))

  // ── Ladder votes: MID_REASONER (sonnet) first, GROUNDED_CITED (opus) second ──
  // A missing sonnet deployment (Foundry 4xx) is skipped — ladder degrades to opus.
  const ladderPayloads = []
  for (const role of ['MID_REASONER', 'GROUNDED_CITED']) {
    // Stop climbing once every conflict already has a 2-vote consensus.
    const unresolved = conflicts.filter(c => !c.resolved)
    if (unresolved.length === 0) break
    let deployment
    try { deployment = resolveAnthropic(role, budget) } catch { continue }
    const targetIdxs = [...new Set(unresolved.map(c => c.rowIdx))]
    const escUser = [
      buildExtractionPrompt(fp, colMap, headerRow, rowSlice.filter(r => targetIdxs.includes(r.idx)).map(r => r.cells), 0, rowSlice.filter(r => targetIdxs.includes(r.idx)).map(r => r.idx)),
      `\nIndependent extractors disagreed on some fields in these rows. Re-extract every row above with maximum care and exact citations.`,
    ].join('\n')
    let payload = null
    try {
      const res = await callAnthropic({ deployment, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt: escUser, maxTokens: 4096, budget })
      payload = parseExtraction(res.raw)
    } catch { payload = null }
    if (!payload) continue
    ladderPayloads.push({ role, payload })

    for (const conflict of unresolved) {
      const tierFields = fieldsFromExtraction(payload, conflict.rowIdx)
      const tf = tierFields.find(f => f.fieldName === conflict.fieldName)
      if (tf) {
        conflict.candidates.push({ key: role === 'MID_REASONER' ? 'c' : 'd', value: tf.value, confidence: tf.confidence, citation: tf.citation, source: role })
      }
      const strict = isStrictField(conflict.fieldName)
      const vote = weightedMajority(conflict.candidates, strict)
      if (vote.consensus) {
        conflict.resolved = { ...vote.winner, method: `majority@${role}` }
      }
    }
  }

  // Final majority pass for conflicts that gained votes but were checked mid-ladder.
  for (const conflict of conflicts) {
    if (conflict.resolved) continue
    const vote = weightedMajority(conflict.candidates, isStrictField(conflict.fieldName))
    if (vote.consensus) conflict.resolved = { ...vote.winner, method: 'majority' }
  }

  // ── LLM judge (gpt-5.1, decorrelated family) for still-unresolved fields ─────
  for (const conflict of conflicts) {
    if (conflict.resolved) continue
    const row = rowSlice.find(r => r.idx === conflict.rowIdx)
    const rowCells = row ? row.cells.map((c, i) => `${colLetter(i)}${conflict.rowIdx + headerRow + 2}="${String(c ?? '')}"`).join(' | ') : '(row unavailable)'
    const candLines = conflict.candidates.slice(0, 3).map((c, i) =>
      `Candidate ${String.fromCharCode(97 + i)} (${c.source}, confidence ${Number(c.confidence).toFixed(2)}): ${JSON.stringify(c.value)}`).join('\n')
    const judgeUser = [
      `Sheet: "${sheetName}" | Field: "${conflict.fieldName}" | Row (0-based data index ${conflict.rowIdx})`,
      `Source cells: ${rowCells}`,
      candLines,
    ].join('\n')

    let judged = null
    try {
      const res = await callOpenAI({ deployment: deployJudge, systemPrompt: STAGE4_JUDGE_SYSTEM, userPrompt: judgeUser, maxTokens: 400, budget })
      judged = extractJson(res.raw)
    } catch { judged = null }

    if (judged && judged.verdict && judged.verdict !== 'none') {
      const pick = conflict.candidates['abc'.indexOf(judged.verdict)] ?? null
      if (pick) {
        conflict.resolved = { ...pick, confidence: Math.min(Number(judged.confidence ?? pick.confidence), 1), method: 'judge' }
        continue
      }
    }
    // Judge could not ground any candidate → importWarning; keep best candidate FLAGGED.
    review.push({
      kind: 'consensus-failure', sheetName, rowIndex: conflict.rowIdx, fieldPath: conflict.fieldName,
      detail: `No grounded consensus for "${conflict.fieldName}" (candidates: ${conflict.candidates.map(c => JSON.stringify(c.value)).slice(0, 4).join(' vs ')}). Kept highest-confidence candidate flagged for review.`,
    })
  }

  // ── Write resolved values back into the entities ──────────────────────────
  const byRow = new Map(entities.map(e => [e.sourceRowIndex, e]))
  for (const conflict of conflicts) {
    const entity = byRow.get(conflict.rowIdx)
    if (!entity) continue
    const field = entity.fields.find(f => f.fieldName === conflict.fieldName)
    if (!field) continue
    if (conflict.resolved) {
      field.value      = conflict.resolved.value
      field.confidence = Math.max(field.confidence, Math.min(1, conflict.resolved.confidence))
      if (conflict.resolved.citation) field.citation = conflict.resolved.citation
      field.consensus  = conflict.resolved.method
      delete field.conflicted
    } else {
      field.confidence = Math.min(field.confidence, 0.5)
      entity.reviewFlag = true
    }
  }
  for (const entity of entities) {
    const confs = entity.fields.map(f => f.confidence)
    entity.overallConfidence = confs.length ? Math.min(...confs) : 0
  }
}

// ─── RefId synthesis ──────────────────────────────────────────────────────────
// Blanks/TBD get a prefixed SYNTH placeholder. Prefix comes from the LOB registry
// hint (derived, never invented); never fabricates a real-looking refId.

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

// ─── Multi-refId expansion + blank detection (post-consensus) ─────────────────

function expandMultiRefIds(entities, sheetName) {
  const out = []
  for (const entity of entities) {
    const refField = entity.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
    if (refField && typeof refField.value === 'string' && !entity.needsRefIdSynthesis) {
      const refIds = splitMultiRefId(refField.value)
      if (refIds.length > 1) {
        for (const rid of refIds) {
          const updatedFields = entity.fields.map(f =>
            f.fieldName === refField.fieldName
              ? { ...f, value: rid, citation: { ...f.citation, verbatim: rid } }
              : f,
          )
          out.push({ ...entity, fields: updatedFields, sourceSheet: sheetName })
        }
        continue
      }
    }
    out.push(entity)
  }
  return out
}

// ─── Build row extraction user prompt ─────────────────────────────────────────
// `rowIdxOverride` lets ladder calls present non-contiguous conflict rows with
// their ORIGINAL 0-based data indices so citations stay stable.

function buildExtractionPrompt(fp, colMap, headerRow, rows, startIdx, rowIdxOverride) {
  const legend = (colMap.mappings || [])
    .filter(m => m.canonicalField !== null)
    .map(m => `  ${colLetter(m.colIndex)} -> ${m.entityKind ?? '?'}.${m.canonicalField} (confidence ${m.confidence.toFixed(2)})`)
    .join('\n')

  const rowLines = rows.map((cells, i) => {
    const rowIdx  = rowIdxOverride ? rowIdxOverride[i] : startIdx + i
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
    `\nRows to extract (${rows.length} rows):\n${rowLines}`,
  ].join('\n')
}

// ─── Deterministic row extraction (code, not model) ───────────────────────────
// Values come straight from the embedded grid: byte-perfect, cited by construction.
// Per-row entity kind: refId shape wins (.PROD. → product, .LOB. → skip — the LOB
// is registry-derived, not a plan entity), else the sheet's dominant mapped kind.

function rowKind(refIdValue, dominantKind) {
  if (typeof refIdValue === 'string') {
    if (/\.PROD\b|\.PROD\./i.test(refIdValue)) return 'product'
    if (/\.LOB\b|\.LOB\./i.test(refIdValue)) return null   // registry-owned; skip row
  }
  return dominantKind
}

function dominantEntityKind(colMap) {
  const tally = new Map()
  for (const m of colMap.mappings || []) {
    if (!m.canonicalField || !m.entityKind) continue
    tally.set(m.entityKind, (tally.get(m.entityKind) ?? 0) + 1)
  }
  let best = null; let bestN = 0
  for (const [k, n] of tally) if (n > bestN) { best = k; bestN = n }
  return best
}

function sheetIsDeterministic(fp, colMap) {
  if (!Array.isArray(fp.cells) || fp.cells.length === 0) return false
  if (fp.layoutShape === 'STACKED_TABLES') return false
  const mapped = (colMap.mappings || []).filter(m => m.canonicalField !== null)
  if (mapped.length === 0) return false
  const confident = mapped.filter(m => m.confidence >= DET_MAP_CONFIDENCE)
  return confident.length / mapped.length >= DET_SHEET_FRACTION
}

function deterministicExtract(fp, colMap, headerRow, rows, sheetName) {
  const mapped = (colMap.mappings || []).filter(m => m.canonicalField !== null && m.confidence >= DET_MAP_CONFIDENCE)
  const dominant = dominantEntityKind(colMap)
  const entities = []

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i]
    const fields = []
    for (const m of mapped) {
      const v = cells[m.colIndex]
      if (v === null || v === undefined) continue
      fields.push({
        fieldName:  m.canonicalField,
        value:      v,
        confidence: m.confidence,
        citation:   { sheet: sheetName, cell: `${colLetter(m.colIndex)}${i + headerRow + 2}`, verbatim: String(v) },
        deterministic: true,
      })
    }
    if (fields.length === 0) continue

    const refField = fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
    const kind = rowKind(refField?.value, dominant)
    if (!kind) continue

    const minConf = Math.min(...fields.map(f => f.confidence))
    let needsSynth = false
    if (!refField || refField.value == null || (typeof refField.value === 'string' && BLANK_REFID.test(refField.value))) {
      needsSynth = true
    }
    entities.push({
      kind, fields, overallConfidence: minConf,
      sourceSheet: sheetName, sourceRowIndex: i,
      reviewFlag: false, needsRefIdSynthesis: needsSynth,
      deterministic: true,
    })
  }
  return entities
}

// AI cross-check of a deterministic sheet: sample batches through the cheap
// decorrelated pair; per-column disagreement above threshold → map-suspect warning
// (the deterministic VALUES are ground truth by construction — only the MAP can be
// wrong, so disagreement indicts columns, not cells).

async function sampleVerifyMap({ fp, colMap, headerRow, rows, detEntities, deployBulk, deployGptMini, budget, review }) {
  const batches = []
  if (rows.length > 0) batches.push(0)
  if (rows.length > BATCH_ROWS * 2) batches.push(Math.floor(rows.length / (2 * BATCH_ROWS)) * BATCH_ROWS)
  const detByRow = new Map(detEntities.map(e => [e.sourceRowIndex, e]))
  const disagreeByField = new Map()
  let checkedRows = 0

  for (const batchStart of batches.slice(0, DET_SAMPLE_BATCHES)) {
    const batch = rows.slice(batchStart, batchStart + BATCH_ROWS)
    const userPrompt = buildExtractionPrompt(fp, colMap, headerRow, batch, batchStart)
    const [aRes, bRes] = await Promise.all([
      callAnthropic({ deployment: deployBulk, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 8192, budget }).catch(() => ({ raw: '' })),
      callOpenAI({ deployment: deployGptMini, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 8192, budget }).catch(() => ({ raw: '' })),
    ])
    for (const payload of [parseExtraction(aRes.raw), parseExtraction(bRes.raw)]) {
      if (!payload) continue
      for (const rawEnt of payload.entities) {
        const det = detByRow.get(rawEnt.sourceRowIndex)
        if (!det) continue
        checkedRows++
        for (const f of toEntityFields(rawEnt)) {
          const detField = det.fields.find(d => d.fieldName === f.fieldName)
          if (!detField) continue
          if (!valuesAgree(detField.value, f.value)) {
            disagreeByField.set(f.fieldName, (disagreeByField.get(f.fieldName) ?? 0) + 1)
          }
        }
      }
    }
  }

  for (const [fieldName, n] of disagreeByField) {
    if (checkedRows > 0 && n / checkedRows > 0.3) {
      review.push({ kind: 'map-suspect', sheetName: fp.sheetName, fieldPath: fieldName, detail: `AI cross-check disagreed with the deterministic column map on "${fieldName}" in ${n}/${checkedRows} sampled row-reads — verify the column mapping.` })
      for (const e of detEntities) {
        const f = e.fields.find(x => x.fieldName === fieldName)
        if (f) { f.confidence = Math.min(f.confidence, 0.6); e.reviewFlag = true }
      }
    }
  }
}

// ─── Gather rows from SheetFingerprint ────────────────────────────────────────
// Prefers the REAL embedded grid (fp.cells) sliced below the locked header row.
// Legacy fallback reconstructs synthetic rows from distinctSample (lossy — only
// used for fingerprints from older clients that carry no cells).

function gatherRows(fp, headerRowIndex) {
  if (fp.layoutShape === 'STACKED_TABLES' && fp.subTables && fp.subTables.length > 0) {
    return fp.subTables.flatMap(sub => (sub.cells || []).slice(1))  // skip sub-header row
  }
  if (Array.isArray(fp.cells) && fp.cells.length > 0) {
    const start = Math.max(0, (headerRowIndex ?? fp.bestHeaderRow ?? -1) + 1)
    return fp.cells.slice(start).filter(row => row.some(c => c !== null))
  }
  // Legacy fallback: column-major distinctSample → row-major synthetic rows.
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
 * @param {object}             budget        brain budget
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

  const deployBulk    = resolveAnthropic('BULK_VERIFY', budget)
  const deployGptMini = resolveOpenAI(fleet.DEPLOY_GPT_MINI, budget)  // BULK_ALT
  const deployJudge   = resolveOpenAI(fleet.DEPLOY_GPT, budget)       // gpt-5.1 judge

  const contentSheets = classified.filter(c => c.domain !== 'ignore' && c.domain !== 'definitions')
  const synthCounter  = new Map()

  for (const sheet of contentSheets) {
    if (sheet.sheetName.includes('::')) continue
    const fp     = fpByName.get(sheet.sheetName)
    const lock   = lockMap.get(sheet.sheetName)
    const colMap = colMapOf.get(sheet.sheetName)
    if (!fp || !lock || !colMap) continue

    const rows = gatherRows(fp, lock.headerRowIndex)
    if (rows.length === 0) continue

    const sheetEntities = []

    // ── Deterministic fast path: confident map + real grid → code extracts ────
    if (sheetIsDeterministic(fp, colMap)) {
      const detEntities = deterministicExtract(fp, colMap, lock.headerRowIndex, rows, fp.sheetName)
      await sampleVerifyMap({ fp, colMap, headerRow: lock.headerRowIndex, rows, detEntities, deployBulk, deployGptMini, budget, review })
      for (const entity of detEntities) {
        if (entity.needsRefIdSynthesis) {
          synthesizeRefId(entity, lobRefIdHint, synthCounter)
          review.push({ kind: 'refid-synthesis-needed', sheetName: fp.sheetName, rowIndex: entity.sourceRowIndex, detail: `Row ${entity.sourceRowIndex} had no refId; synthesized placeholder — human review required.` })
        }
        if (entity.overallConfidence < CONFIDENCE_REVIEW) entity.reviewFlag = true
      }
      sheetEntities.push(...expandMultiRefIds(detEntities, fp.sheetName))
      deriveParentIds(sheetEntities)
      allEntities.push(...sheetEntities)
      continue
    }

    for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_ROWS) {
      const batch      = rows.slice(batchStart, batchStart + BATCH_ROWS)
      const userPrompt = buildExtractionPrompt(fp, colMap, lock.headerRowIndex, batch, batchStart)

      // Two decorrelated extraction votes in parallel: BULK (haiku) + BULK_ALT (gpt-mini).
      const [bulkRes, bulkAltRes] = await Promise.all([
        callAnthropic({ deployment: deployBulk, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 8192, budget }).catch(() => ({ raw: '' })),
        callOpenAI({ deployment: deployGptMini, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 8192, budget }).catch(() => ({ raw: '' })),
      ])

      const aPayload = parseExtraction(bulkRes.raw)
      const bPayload = parseExtraction(bulkAltRes.raw)

      // Both extractors failed → escalate the whole batch up the ladder instead of dropping.
      if (!aPayload && !bPayload) {
        let recovered = null
        for (const role of ['MID_REASONER', 'GROUNDED_CITED']) {
          let deployment
          try { deployment = resolveAnthropic(role, budget) } catch { continue }
          try {
            const res = await callAnthropic({ deployment, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 8192, budget })
            recovered = parseExtraction(res.raw)
            if (recovered) break
          } catch { /* next rung */ }
        }
        if (!recovered) {
          review.push({ kind: 'dropped-batch', sheetName: fp.sheetName, detail: `Rows ${batchStart}-${batchStart + batch.length - 1}: every extractor tier failed to parse — rows require manual review.` })
          continue
        }
        const { entities } = reconcileEntities(recovered.entities, [], fp.sheetName, review)
        sheetEntities.push(...expandMultiRefIds(entities, fp.sheetName))
        continue
      }

      const { entities, conflicts } = reconcileEntities(
        aPayload?.entities ?? [],
        bPayload?.entities ?? [],
        fp.sheetName,
        review,
      )

      // Consensus ladder + judge for conflicted fields.
      await resolveConflicts({
        conflicts, entities, fp, colMap,
        headerRow: lock.headerRowIndex, rows: batch, batchStart,
        sheetName: fp.sheetName, budget, review, deployJudge,
      })

      // RefId synthesis for blank/TBD cells.
      for (const entity of entities) {
        if (entity.needsRefIdSynthesis) {
          synthesizeRefId(entity, lobRefIdHint, synthCounter)
          review.push({ kind: 'refid-synthesis-needed', sheetName: fp.sheetName, rowIndex: entity.sourceRowIndex, detail: `Row ${entity.sourceRowIndex} had no refId; synthesized placeholder — human review required.` })
        }
      }

      for (const entity of entities) {
        if (entity.overallConfidence < CONFIDENCE_REVIEW) entity.reviewFlag = true
      }

      sheetEntities.push(...expandMultiRefIds(entities, fp.sheetName))
    }

    // After all batches: derive parentId for sub-coverages from row context.
    deriveParentIds(sheetEntities)
    allEntities.push(...sheetEntities)
  }

  return allEntities
}

module.exports = { extractRows }
