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
const brainShared = require('../import-brain-shared.cjs')
const { callAnthropic, callOpenAI, resolveAnthropic, resolveOpenAI } = require('./ai-call')
const { cachedCall, PROMPT_VERSION, contentHashOf } = require('./extract-cache')
const { STAGE4_EXTRACT_SYSTEM, STAGE4_JUDGE_SYSTEM } = require('./prompts')
const {
  extractJson, colLetter,
  BLANK_REFID, splitMultiRefId, CONFIDENCE_REVIEW, pMap,
  parseWithRetry, sanitizeEntities, recordVote,
  parseCellRef, canonLoose, DERIVED_VERBATIM,
  TRUNCATED_STOP_REASONS, REFUSAL_STOP_REASONS,
} = require('./constants')

const BATCH_ROWS = 20

// Width-aware batch sizing (ledger F10): a batch's OUTPUT scales with cells,
// not rows — budget cells so wide sheets never discover the token ceiling the
// hard way. Shared by the main extraction path AND the blind map cross-check:
// the first participation-instrumented Core run measured the cross-check at
// 0/10 cast on BOTH families — every sample truncated, because it sampled a
// fixed 20 rows x EVERY column on 40+-column sheets. The map verification had
// been silently absent on wide books; batches are now sized by their actual
// cell payload everywhere.
const CELL_BUDGET = 480

function widthAwareRowCount(rows, startIdx, cellsPerRowFloor) {
  const probe = rows.slice(startIdx, startIdx + BATCH_ROWS)
  if (probe.length === 0) return 1
  const totalCells = probe.reduce((n, r) => n + (r ?? []).filter(c => c !== null && c !== undefined && String(c) !== '').length, 0)
  const avg = Math.max(cellsPerRowFloor || 1, Math.round(totalCells / probe.length))
  return Math.max(1, Math.min(BATCH_ROWS, Math.floor(CELL_BUDGET / avg)))
}

// Character-aware sizing for the BLIND cross-check: it emits every non-empty
// cell VERBATIM and the extraction response roughly doubles that content
// (value + citation verbatim), so the budget unit is characters, not cells —
// a 10-row sample of long rating-formula text still blew 8192 output tokens
// after cell-count sizing (second instrumented Core run: 17/20 samples
// truncated). ~24 chars/cell of JSON envelope is charged on top of content.
const CROSSCHECK_CHAR_BUDGET = 10_000
const CELL_JSON_OVERHEAD = 24

function rowContentChars(row) {
  let n = 0
  for (const c of row ?? []) {
    if (c === null || c === undefined) continue
    const s = String(c)
    if (s === '') continue
    n += s.length + CELL_JSON_OVERHEAD
  }
  return n
}

function charAwareRowCount(rows, startIdx) {
  let used = 0
  let count = 0
  for (let i = startIdx; i < rows.length && count < BATCH_ROWS; i++) {
    used += rowContentChars(rows[i])
    if (count > 0 && used > CROSSCHECK_CHAR_BUDGET) break
    count++
  }
  return Math.max(1, count)
}

// Judge completion budget. Both judges (gpt-5.1 + the DeepSeek tail) are
// OpenAI-family reasoning-class models: reasoning spends completion budget
// before the verdict is emitted, and a starved judge is a silently absent
// conflict-resolution leg. Verdict output stays schema-bounded; only reasoning
// headroom grows (was 400).
const JUDGE_MAX_TOKENS = 2048

// Deterministic fast path: when the locked column map is confident and the REAL
// grid is embedded, rows are extracted by CODE (byte-perfect values, guaranteed
// sheet!cell citations, zero extraction cost) and the AI ensemble shifts to a
// sampled cross-check of the MAP. AI extraction remains the path for ambiguous
// maps, stacked/irregular layouts, and legacy fingerprints without cells.
const DET_MAP_CONFIDENCE = 0.80   // per-column floor for deterministic extraction
const DET_SHEET_FRACTION = 0.60   // fraction of mapped columns that must clear the floor
const DET_SAMPLE_BATCHES = 2      // AI cross-check batches per deterministic sheet

// SUB-THRESHOLD RECOVERY. The two constants above are not the same threshold: a
// sheet QUALIFIES for the code path at DET_SHEET_FRACTION confident columns, but
// the code reader only READS columns at DET_MAP_CONFIDENCE — so up to 40% of a
// qualifying sheet's MAPPED columns used to be read by nothing at all. No entity,
// no review item, no ledger entry: a whole real column could vanish while the run
// reported success. Stage 3 multiplies confidence by 0.7 on mapper disagreement,
// which puts every DISPUTED column under the read floor by construction — and the
// disputed columns are precisely the drift columns between the two sample books
// (shifted rating columns, swapped dynamic-data keys, duplicate headers).
//
// The fix routes those columns through the AI extraction path instead of skipping
// them (rather than raising qualification to 100%, which would send the WHOLE
// sheet — confident columns included — to the models: strictly more expensive than
// this, and a fidelity regression, since it replaces byte-perfect code reads with
// model transcription on the columns that were never in doubt).
//
// A column that still yields nothing after the recovery pass, and that actually
// has content in the grid, becomes a named `unread-column` review item.

function columnHasContent(rows, colIndex) {
  for (const r of rows) {
    const v = (r ?? [])[colIndex]
    if (v !== null && v !== undefined && String(v).trim() !== '') return true
  }
  return false
}

// ─── Parse extraction response ─────────────────────────────────────────────────

function parseExtraction(raw) {
  try {
    const obj = extractJson(raw)
    if (!Array.isArray(obj.entities)) return null
    // Runtime shape validation (P0-7 / ledger F16): malformed entities/fields are
    // dropped AND counted; a wholly-malformed payload reads as a parse failure so
    // the caller's telemetry + targeted retry fire instead of a silent empty vote.
    const { entities, dropped } = sanitizeEntities(obj.entities)
    if (entities.length === 0 && obj.entities.length > 0) return null
    return { entities, dropped }
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
  // Group each vote's entities per source row, PRESERVING same-row multiplicity.
  // (P0-1 / ledger F01: keying a Map by sourceRowIndex alone let same-row entities
  // overwrite each other whenever a model split a multi-refId cell; candidates now
  // pair by occurrence within the row, and expansion is downstream-only.)
  const aByRow = new Map()
  const bByRow = new Map()
  for (const e of (aEntities || [])) { const l = aByRow.get(e.sourceRowIndex) ?? []; l.push(e); aByRow.set(e.sourceRowIndex, l) }
  for (const e of (bEntities || [])) { const l = bByRow.get(e.sourceRowIndex) ?? []; l.push(e); bByRow.set(e.sourceRowIndex, l) }

  const allRowIdxs = [...new Set([...aByRow.keys(), ...bByRow.keys()])].sort((x, y) => x - y)
  const result = []
  const conflicts = []

  for (const rowIdx of allRowIdxs) {
    const aList = aByRow.get(rowIdx) ?? []
    const bList = bByRow.get(rowIdx) ?? []
    const multiplicity = Math.max(aList.length, bList.length)
    if (multiplicity > 1) {
      review.push({ kind: 'row-multiplicity', sheetName, rowIndex: rowIdx, detail: `Row ${rowIdx}: a model returned ${multiplicity} entities for one source row (multi-refId cells must stay unsplit) — occurrences kept separately and flagged.` })
    }

    for (let occ = 0; occ < multiplicity; occ++) {
    const ea = aList[occ]
    const eb = bList[occ]
    const primary = ea ?? eb
    let rowConflicted = false

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
        rowConflicted = true
        conflicts.push({
          rowIdx, occurrence: occ, fieldName: fa.fieldName,
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

    // Entity-kind disagreement is a conflict, not a silent adoption (P0-2 / ledger
    // F02): it climbs the same ladder as field conflicts under the reserved
    // '__kind' field name; the write-back sets entity.kind from the winner.
    if (ea && eb && ea.kind !== eb.kind) {
      const sideConf = (fs) => fs.length ? fs.reduce((s, f) => s + f.confidence, 0) / fs.length : 0.5
      rowConflicted = true
      conflicts.push({
        rowIdx, occurrence: occ, fieldName: '__kind',
        candidates: [
          { key: 'a', value: ea.kind, confidence: sideConf(aFields), citation: aFields[0]?.citation ?? null, source: 'BULK' },
          { key: 'b', value: eb.kind, confidence: sideConf(bFields), citation: bFields[0]?.citation ?? null, source: 'BULK_ALT' },
        ],
      })
      review.push({ kind: 'kind-disagreement', sheetName, rowIndex: rowIdx, detail: `Row ${rowIdx}: extractors disagree on entity kind ("${ea.kind}" vs "${eb.kind}") — routed to the conflict ladder.` })
    }

    const minConf = fields.length > 0 ? Math.min(...fields.map(f => f.confidence)) : 0
    let reviewFlag = Boolean(primary.reviewFlag) || rowConflicted || multiplicity > 1
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

    result.push({ kind: primary.kind, fields, overallConfidence: minConf, sourceSheet: sheetName, sourceRowIndex: rowIdx, occurrence: occ, reviewFlag, needsRefIdSynthesis: needsSynth })
    }
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

// Occurrence-aware: ladder re-extractions return unsplit rows (one entity per row
// under the P0-1 contract), so occurrence 0 is the norm; if a tier still splits,
// occurrences pair positionally.
function entityFromExtraction(payload, rowIdx, occurrence = 0) {
  const ents = (payload?.entities ?? []).filter(e => e.sourceRowIndex === rowIdx)
  return ents[occurrence] ?? ents[0] ?? null
}

function fieldsFromExtraction(payload, rowIdx, occurrence = 0) {
  const ent = entityFromExtraction(payload, rowIdx, occurrence)
  return ent ? toEntityFields(ent) : []
}

// Stable per-entity key: source row + occurrence within the row (P0-1).
function entityKey(rowIdx, occurrence) {
  return `${rowIdx}#${occurrence ?? 0}`
}

// Called ONCE per sheet with every batch's conflicts pooled (was per-batch: each
// conflicted 20-row batch paid its own sonnet+opus re-extraction — 40 opus calls /
// 2059 s of a 2292 s forms-library run). Pooled conflicts regroup into DENSE chunks
// of ≤ BATCH_ROWS conflicted rows (buildExtractionPrompt addresses rows by explicit
// index, so chunks need not be contiguous), chunks run 3-wide, and each chunk climbs
// the same sonnet→opus ladder. Chunks stay ≤ BATCH_ROWS so the 4096-token escalation
// output can hold every re-extracted row — oversized chunks under-fill silently
// (the filing rate-order bug class).
async function resolveConflicts({ conflicts, entities, fp, colMap, headerRow, rows, gridRows, batchStart, sheetName, budget, review, deployJudge }) {
  if (conflicts.length === 0) return

  const conflictRowIdxs = [...new Set(conflicts.map(c => c.rowIdx))]
  const rowSlice = conflictRowIdxs
    .filter(idx => idx >= batchStart && idx < batchStart + rows.length)
    .map(idx => ({ idx, cells: rows[idx - batchStart] }))

  // ── Ladder votes: MID_REASONER (sonnet) first, GROUNDED_CITED (opus) second ──
  // A missing sonnet deployment (Foundry 4xx) is skipped — ladder degrades to opus.
  const chunks = []
  for (let i = 0; i < rowSlice.length; i += BATCH_ROWS) chunks.push(rowSlice.slice(i, i + BATCH_ROWS))
  const conflictsByRow = new Map()
  for (const c of conflicts) {
    if (!conflictsByRow.has(c.rowIdx)) conflictsByRow.set(c.rowIdx, [])
    conflictsByRow.get(c.rowIdx).push(c)
  }
  await pMap(chunks, async (chunk) => {
    const chunkConflicts = chunk.flatMap(r => conflictsByRow.get(r.idx) ?? [])
    for (const role of ['MID_REASONER', 'GROUNDED_CITED']) {
      // Stop climbing once every conflict in this chunk has a 2-vote consensus.
      const unresolved = chunkConflicts.filter(c => !c.resolved)
      if (unresolved.length === 0) break
      let deployment
      try { deployment = resolveAnthropic(role, budget) } catch { continue }
      const targetIdxs = [...new Set(unresolved.map(c => c.rowIdx))]
      const target = chunk.filter(r => targetIdxs.includes(r.idx))
      const escUser = [
        buildExtractionPrompt(fp, colMap, headerRow, target.map(r => r.cells), 0, target.map(r => r.idx), gridRows),
        `\nIndependent extractors disagreed on some fields in these rows. Re-extract every row above with maximum care and exact citations.`,
      ].join('\n')
      const payload = await parseWithRetry({
        call: () => callAnthropic({ deployment, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt: escUser, maxTokens: 4096, budget }),
        parse: parseExtraction, review, stage: 'stage4', sheetName, what: `${role} conflict re-extraction`,
        vote: { budget, site: 'stage4-ladder', family: 'anthropic' },
      })
      if (!payload) continue

      for (const conflict of unresolved) {
        // '__kind' conflicts take the tier's entity KIND as its vote (P0-2/F02);
        // ordinary conflicts take the re-extracted field.
        let tf = null
        if (conflict.fieldName === '__kind') {
          const ent = entityFromExtraction(payload, conflict.rowIdx, conflict.occurrence)
          if (ent && ent.kind) tf = { value: ent.kind, confidence: 0.85, citation: null }
        } else {
          const tierFields = fieldsFromExtraction(payload, conflict.rowIdx, conflict.occurrence)
          tf = tierFields.find(f => f.fieldName === conflict.fieldName) ?? null
        }
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
  }, 3)

  // Final majority pass for conflicts that gained votes but were checked mid-ladder.
  for (const conflict of conflicts) {
    if (conflict.resolved) continue
    const vote = weightedMajority(conflict.candidates, isStrictField(conflict.fieldName))
    if (vote.consensus) conflict.resolved = { ...vote.winner, method: 'majority' }
  }

  // ── LLM judge (gpt-5.1, decorrelated family) for still-unresolved fields ─────
  // Judge calls are independent per field — 4-wide (was sequential; 118 unresolved
  // fields at ~1.5 s each is 3 minutes of avoidable serialization).
  //
  // SCHEMA-FORCED VERDICTS: the verdict comes back through a forced tool whose
  // `verdict` field is enum-constrained to exactly the candidate letters that
  // exist (+ "none") — probe-verified on gpt-5.1 AND DeepSeek-V4-Pro
  // (finish_reason tool_calls, 2026-07-27). Selection is by VALIDATED
  // MEMBERSHIP, never first-character arithmetic: pre-fix, a verdict reading
  // "candidate b" silently selected candidate c via charCodeAt(0)-97 whenever
  // three or more candidates existed — on the one path where confidence can
  // only ratchet upward. A non-member now burns the single targeted retry,
  // then falls through to the next lineage.
  const judgeToolFor = (letters) => ({
    name: 'judge_verdict',
    description: 'Pick the winning candidate letter exactly as listed, or "none" when no candidate is grounded in the source cells. Call this tool exactly once.',
    input_schema: {
      type: 'object',
      properties: {
        verdict:    { type: 'string', enum: [...letters, 'none'] },
        value:      { description: 'The chosen value, verbatim from the source, or null.' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        rationale:  { type: 'string', description: 'One sentence citing the source cell that grounds the choice.' },
      },
      required: ['verdict', 'confidence', 'rationale'],
    },
  })
  const parseJudgeFor = (letters) => (raw) => {
    try {
      const j = extractJson(raw)
      if (!j || typeof j.verdict !== 'string') return null
      const v = j.verdict.trim().toLowerCase()
      if (v !== 'none' && !letters.includes(v)) return null
      return { ...j, verdict: v }
    } catch { return null }
  }

  const rowByIdx = new Map(rowSlice.map(r => [r.idx, r]))
  await pMap(conflicts.filter(c => !c.resolved), async (conflict) => {
    const row = rowByIdx.get(conflict.rowIdx)
    const rowCells = row ? row.cells.map((c, i) => `${colLetter(i)}${excelRowOf(conflict.rowIdx, headerRow, gridRows)}="${String(c ?? '')}"`).join(' | ') : '(row unavailable)'
    // EVERY live candidate reaches the judge (P0-2 / ledger F03) — the ladder can
    // produce up to four (a=BULK, b=BULK_ALT, c=sonnet, d=opus).
    const letters = conflict.candidates.map((_, i) => String.fromCharCode(97 + i))
    const candLines = conflict.candidates.map((c, i) =>
      `Candidate ${letters[i]} (${c.source}, confidence ${Number(c.confidence).toFixed(2)}): ${JSON.stringify(c.value)}`).join('\n')
    const judgeUser = [
      `Sheet: "${sheetName}" | Field: "${conflict.fieldName}" | Row (0-based data index ${conflict.rowIdx})`,
      `Source cells: ${rowCells}`,
      candLines,
    ].join('\n')

    const judgeTool = judgeToolFor(letters)
    const parseJudge = parseJudgeFor(letters)
    const judged = await parseWithRetry({
      call: () => callOpenAI({ deployment: deployJudge, systemPrompt: STAGE4_JUDGE_SYSTEM, userPrompt: judgeUser, maxTokens: JUDGE_MAX_TOKENS, budget, tools: [judgeTool], toolName: judgeTool.name }),
      parse: parseJudge, review, stage: 'stage4', sheetName, what: `judge verdict for "${conflict.fieldName}" row ${conflict.rowIdx}`,
      vote: { budget, site: 'stage4-judge', family: 'openai' },
    })

    if (judged && judged.verdict !== 'none') {
      const pick = conflict.candidates[letters.indexOf(judged.verdict)] ?? null
      if (pick) {
        conflict.resolved = { ...pick, confidence: Math.min(Number(judged.confidence ?? pick.confidence), 1), method: 'judge' }
        return
      }
    }

    // ── CE3 Step 3(c): third-lineage escalation — ONE deepseek pass before
    // needs_review. The gpt-5.1 judge could not ground a verdict (three-way
    // disagreement); VERIFY_DEEPSEEK (the post-grok third judge family) gets one
    // look. Deployment comes from the fleet registry bridge; the call rides
    // callOpenAI so IMPORT_CONTEXT no-cap + spend telemetry hold; a missing
    // deployment (404 skip-set) degrades silently to the review path.
    try {
      const ext = require('../fleet-shared.cjs').EXTENDED_DEPLOYMENTS
      const dsDeployment = ext && ext.VERIFY_DEEPSEEK && ext.VERIFY_DEEPSEEK.deploymentName
      if (dsDeployment) {
        const dsJudged = await parseWithRetry({
          call: () => callOpenAI({ deployment: dsDeployment, systemPrompt: STAGE4_JUDGE_SYSTEM, userPrompt: judgeUser, maxTokens: JUDGE_MAX_TOKENS, budget, tools: [judgeTool], toolName: judgeTool.name }),
          parse: parseJudge, review, stage: 'stage4', sheetName, what: `deepseek tail verdict for "${conflict.fieldName}" row ${conflict.rowIdx}`,
          vote: { budget, site: 'stage4-judge-tail', family: 'openai' },
        })
        if (dsJudged && dsJudged.verdict !== 'none') {
          const pick = conflict.candidates[letters.indexOf(dsJudged.verdict)] ?? null
          if (pick) {
            conflict.resolved = { ...pick, confidence: Math.min(Number(dsJudged.confidence ?? pick.confidence), 1), method: 'judge-deepseek' }
            return
          }
        }
      }
    } catch { /* third lineage unavailable — fall through to review */ }

    // No judge lineage could ground a candidate → importWarning; keep best candidate FLAGGED.
    review.push({
      kind: 'consensus-failure', sheetName, rowIndex: conflict.rowIdx, fieldPath: conflict.fieldName,
      detail: `No grounded consensus for "${conflict.fieldName}" (candidates: ${conflict.candidates.map(c => JSON.stringify(c.value)).slice(0, 4).join(' vs ')}). Kept highest-confidence candidate flagged for review.`,
    })
  }, 4)

  // ── Write resolved values back into the entities ──────────────────────────
  // Keyed by row + occurrence (P0-1): a row-only Map silently collided whenever
  // one row produced more than one entity.
  const byRow = new Map(entities.map(e => [entityKey(e.sourceRowIndex, e.occurrence), e]))
  for (const conflict of conflicts) {
    const entity = byRow.get(entityKey(conflict.rowIdx, conflict.occurrence))
    if (!entity) continue
    if (conflict.fieldName === '__kind') {
      // Kind conflicts resolve onto the entity itself (P0-2/F02) — there is no
      // '__kind' entry in entity.fields, so this runs before the field lookup.
      if (conflict.resolved && typeof conflict.resolved.value === 'string') {
        entity.kind = conflict.resolved.value
        entity.kindConsensus = conflict.resolved.method
      } else {
        entity.reviewFlag = true
      }
      continue
    }
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

function synthesizeRefId(entity, lobRefIdHint, sheetCounter, sourcePrefix) {
  if (!entity.needsRefIdSynthesis) return
  // Prefix priority (ledger F30): the router's line hint, else the workbook's OWN
  // scheme prefix read from sibling rows' real ids (a CORE workbook's blank-id
  // rows synthesize CORE.RULE.SYNTH###), else the obviously-fake XX last resort.
  // Derived, never invented — the first completed CORE live run minted 345
  // XX-prefixed ids because the line was unregistered and the source's own
  // prefix was ignored.
  const prefix = (typeof lobRefIdHint === 'string' && lobRefIdHint.split('.')[0])
    || sourcePrefix
    || 'XX'
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

// The ONE place multi-refId cells expand (P0-1 / ledger F01): models return the
// unsplit cell; expansion happens here, exactly once, post-consensus. Each expanded
// entity carries an occurrence key and PRESERVES the original cell text as its
// citation verbatim — the evidence is the real cell, never a fabricated fragment.
function expandMultiRefIds(entities, sheetName) {
  const out = []
  for (const entity of entities) {
    const refField = entity.fields.find(f => f.fieldName === 'refId' || f.fieldName === 'number')
    if (refField && typeof refField.value === 'string' && !entity.needsRefIdSynthesis) {
      const refIds = splitMultiRefId(refField.value)
      if (refIds.length > 1) {
        refIds.forEach((rid, i) => {
          const updatedFields = entity.fields.map(f =>
            f.fieldName === refField.fieldName
              ? { ...f, value: rid, citation: { ...f.citation } }
              : f,
          )
          out.push({ ...entity, fields: updatedFields, sourceSheet: sheetName, occurrence: i, expandedFrom: refField.value })
        })
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

function buildExtractionPrompt(fp, colMap, headerRow, rows, startIdx, rowIdxOverride, gridRows) {
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
    return `Row ${excelRowOf(rowIdx, headerRow, gridRows)} (0-based ${rowIdx}): ${cellStr}`
  }).join('\n')

  return [
    `Sheet: "${fp.sheetName}" | Header row: ${headerRow + 1} (1-based)`,
    `Column map (col letter -> canonical field):\n${legend || '  (no mapped columns)'}`,
    `\nRows to extract (${rows.length} rows):\n${rowLines}`,
  ].join('\n')
}

// BLIND prompt for the map cross-check. buildExtractionPrompt above both STATES the
// column map and filters each row down to the columns that map — so a voter reading it
// cannot contradict the map, it can only echo it. That made the cross-check structurally
// incapable of catching the confident-but-wrong map it exists to catch. This variant hands
// over the header row and EVERY cell with no canonical mapping attached, so the model
// assigns fields from the source alone and a genuine mis-map shows up as disagreement.
function buildBlindExtractionPrompt(fp, headerRow, rows, startIdx, gridRows) {
  const headerCells = (fp.cells || [])[headerRow] || []
  const headers = headerCells
    .map((h, ci) => { const s = String(h ?? '').trim(); return s ? `  ${colLetter(ci)} = "${s}"` : null })
    .filter(Boolean).join('\n')

  const rowLines = rows.map((cells, i) => {
    const rowIdx = startIdx + i
    const cellStr = cells
      .map((cell, ci) => { const s = String(cell ?? ''); return s === '' ? null : `${colLetter(ci)}="${s}"` })
      .filter(Boolean).join(' | ')
    return `Row ${excelRowOf(rowIdx, headerRow, gridRows)} (0-based ${rowIdx}): ${cellStr}`
  }).join('\n')

  return [
    `Sheet: "${fp.sheetName}" | Header row: ${headerRow + 1} (1-based)`,
    `Column headers as they appear in the source:\n${headers || '  (no header labels)'}`,
    '\nDecide for yourself which column holds which canonical field — no mapping is supplied.',
    `\nRows to extract (${rows.length} rows):\n${rowLines}`,
  ].join('\n')
}

// ─── Deterministic row extraction (code, not model) ───────────────────────────
// Values come straight from the embedded grid: byte-perfect, cited by construction.
// Per-row entity kind: refId shape wins (.PROD. → product, .LOB. → skip — the LOB
// is registry-derived, not a plan entity), else the sheet's dominant mapped kind.

function rowKind(refIdValue, dominantKind) {
  // Routed through the shared LOB-registry identifier parser (P0-4 / ledger F05):
  // the old /\.PROD\./ regex missed real scheme variants like "PR.PROD001",
  // "IM.PROD044" and "CORE.PRD.001", misclassifying product rows as the sheet's
  // dominant kind.
  //
  // Ledger F18: trust the full refId signal, not just product/lob.
  // CORE.COV.001 → refIdSegmentKind returns 'coverage' → must extract as coverage.
  // Without this, 'coverage' fell through to dominantKind; on a tie (product vs
  // coverage tally 1:1) the Map-insertion-order winner (product) took all COV rows.
  const kind = typeof brainShared.refIdSegmentKind === 'function' ? brainShared.refIdSegmentKind(refIdValue) : null
  if (kind === 'lob') return null   // registry-owned; skip row
  if (kind !== null) return kind    // trust specific signal: product, coverage, rule, form, rating
  return dominantKind               // no kind signal → sheet's dominant mapped kind
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
  if (confident.length / mapped.length >= DET_SHEET_FRACTION) return true
  // Force deterministic for structured kinds whose rows follow a fixed schema:
  // form / rule / ratingStep sheets have well-defined columns; AI extraction adds
  // latency with no quality gain (the confident anchor columns are enough).
  // State-applicability matrices have many low-confidence columns that drag the
  // fraction below the threshold — the deterministic path ignores low-confidence
  // columns and uses only the ones that cleared DET_MAP_CONFIDENCE.
  const dominant = dominantEntityKind(colMap)
  return confident.length >= 2 && (dominant === 'form' || dominant === 'rule' || dominant === 'ratingStep')
}

function deterministicExtract(fp, colMap, headerRow, rows, sheetName, gridRows) {
  const mapped = (colMap.mappings || []).filter(m => m.canonicalField !== null && m.confidence >= DET_MAP_CONFIDENCE)
  const stateColumns = Array.isArray(colMap.stateColumns) ? colMap.stateColumns : []
  const dominant = dominantEntityKind(colMap)
  const entities = []

  // Section-header forward-fill (dynamic-data continuation rows). A "Forms Dynamic Data"
  // sheet states the FORM NUMBER once per form and leaves it blank on each continuation
  // field-row; without carry-down those fields lose their parent-form link and orphan at
  // the stage7 join (E+: 198/1830 rows surfaced as "no form number"). We carry the last
  // non-blank `formNumber` down, KEEPING the original cell's citation so the value stays
  // grounded to the header that actually stated it (faithful extraction of a section
  // header, never invention). Only the singular `formNumber` linkage key is carried —
  // it exists on the dynamic-data sheet alone, so per-row fields are never touched.
  const CARRY_FIELDS = new Set(['formNumber'])
  const carried = new Map()   // fieldName -> { value, colIndex, excelRow }

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i]
    const excelRow = excelRowOf(i, headerRow, gridRows)
    const fields = []
    for (const m of mapped) {
      let v = cells[m.colIndex]
      let citation = null
      if (CARRY_FIELDS.has(m.canonicalField)) {
        const blank = v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
        if (!blank) {
          carried.set(m.canonicalField, { value: v, colIndex: m.colIndex, excelRow })
        } else {
          const prev = carried.get(m.canonicalField)
          if (prev) {
            v = prev.value
            citation = { sheet: sheetName, cell: `${colLetter(prev.colIndex)}${prev.excelRow}`, verbatim: String(prev.value) }
          }
        }
      }
      if (v === null || v === undefined) continue
      fields.push({
        fieldName:  m.canonicalField,
        value:      v,
        confidence: m.confidence,
        citation:   citation ?? { sheet: sheetName, cell: `${colLetter(m.colIndex)}${excelRow}`, verbatim: String(v) },
        deterministic: true,
      })
    }
    // State-applicability matrix → states[]/allStates derived from X-marked columns
    // (the cross-cutting dimension from first principles — data, not an entity).
    if (fields.length > 0) {
      const allIdx = colMap.allStatesColIndex
      const allMarked = allIdx != null && String(cells[allIdx] ?? '').trim().toUpperCase() === 'X'
      if (allIdx != null) {
        fields.push({
          fieldName: 'allStates', value: allMarked, confidence: 0.98,
          citation: { sheet: sheetName, cell: `${colLetter(allIdx)}${excelRow}`, verbatim: String(cells[allIdx] ?? '') },
          deterministic: true,
        })
      }
      if (stateColumns.length > 0 && !allMarked) {
        const states = stateColumns
          .filter(sc => String(cells[sc.colIndex] ?? '').trim().toUpperCase() === 'X')
          .map(sc => sc.stateCode)
        if (states.length > 0) {
          const first = stateColumns.find(sc => String(cells[sc.colIndex] ?? '').trim().toUpperCase() === 'X')
          fields.push({
            fieldName: 'states', value: states, confidence: 0.98,
            citation: { sheet: sheetName, cell: `${colLetter(first.colIndex)}${excelRow}`, verbatim: 'X' },
            deterministic: true,
          })
        }
      }
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

async function sampleVerifyMap({ fp, colMap, headerRow, rows, gridRows, detEntities, deployBulk, deployGptMini, budget, review }) {
  const batches = []
  if (rows.length > 0) batches.push(0)
  if (rows.length > BATCH_ROWS * 2) batches.push(Math.floor(rows.length / (2 * BATCH_ROWS)) * BATCH_ROWS)
  const detByRow = new Map(detEntities.map(e => [e.sourceRowIndex, e]))

  // JOIN BY COLUMN CITATION, not by field name. Joining by field name could only
  // ever see "the map and the blind reader disagree about the VALUE of field F" —
  // but the failure this check exists to catch is the map pointing field F at the
  // WRONG COLUMN, and under a field-name join a reassignment is invisible: the
  // blind reader's `name` (read from column C) is compared against the map's
  // `name` (read from column B) and they simply differ, or the field is absent on
  // one side and skipped. Anchoring on the cited column makes the actual wrong-map
  // signature — "the map says column D is `requirement`, the blind reader reading
  // column D calls it `claimsBasis`" — a first-class, countable observation.
  const mappedByCol = new Map()
  for (const m of colMap.mappings || []) if (m.canonicalField !== null) mappedByCol.set(m.colIndex, m)
  const perCol = new Map()   // colIndex -> { seen, reassigned, disagreed, sawField }
  const bump = (col, key, value) => {
    const s = perCol.get(col) ?? { seen: 0, reassigned: 0, disagreed: 0, sawField: null }
    s[key] += 1
    if (value !== undefined && s.sawField === null) s.sawField = value
    perCol.set(col, s)
  }
  let checkedRows = 0
  let joinedFields = 0

  // Cross-check legs are votes too — a leg that stops voting must show in
  // telemetry. Terminal outcomes only: a truncation that HALVES successfully
  // is superseded by its halves (same participation semantics as the main
  // path); only an unrecoverable truncation (1-row batch) is a missing vote.
  const crossVote = (res, family, recoverable) => {
    const site = 'stage4-crosscheck'
    if (!res) { recordVote(budget, site, family, 'empty'); return null }
    if (TRUNCATED_STOP_REASONS.has(res.stopReason)) {
      if (!recoverable) recordVote(budget, site, family, 'truncated')
      return 'TRUNCATED'
    }
    if (REFUSAL_STOP_REASONS.has(res.stopReason)) { recordVote(budget, site, family, 'refused'); return null }
    if (!res.raw) { recordVote(budget, site, family, 'empty'); return null }
    const parsed = parseExtraction(res.raw)
    recordVote(budget, site, family, parsed ? 'cast' : 'malformed')
    return parsed
  }

  const scorePayload = (payload) => {
    if (!payload || payload === 'TRUNCATED') return
    for (const rawEnt of payload.entities) {
      const det = detByRow.get(rawEnt.sourceRowIndex)
      if (!det) continue
      checkedRows++
      for (const f of toEntityFields(rawEnt)) {
        const ref = parseCellRef(f.citation && f.citation.cell)
        if (!ref) continue                                   // uncited read — nothing to anchor on
        const mapped = mappedByCol.get(ref.col)
        if (!mapped) continue                                // column the map never claimed
        joinedFields++
        bump(ref.col, 'seen')
        if (f.fieldName !== mapped.canonicalField) {
          // REASSIGNMENT: the map and the blind reader disagree about what this
          // column IS. Comparing their values would be comparing two different
          // fields, so the value check is skipped — the indictment is the point.
          bump(ref.col, 'reassigned', f.fieldName)
          continue
        }
        const detField = det.fields.find(d => d.fieldName === mapped.canonicalField)
        if (!detField) continue
        if (!valuesAgree(detField.value, f.value)) bump(ref.col, 'disagreed')
      }
    }
  }

  // Sized by CHARACTERS and halved on truncation (F10, both mechanisms):
  // sizing alone under-estimated on long-formula rating sheets.
  const sampleBatch = async (batch, batchStart) => {
    const recoverable = batch.length > 1
    const userPrompt = buildBlindExtractionPrompt(fp, headerRow, batch, batchStart, gridRows)
    const [aRes, bRes] = await Promise.all([
      callAnthropic({ deployment: deployBulk, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 8192, budget }).catch(() => null),
      callOpenAI({ deployment: deployGptMini, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 8192, budget }).catch(() => null),
    ])
    const a = crossVote(aRes, 'anthropic', recoverable)
    const b = crossVote(bRes, 'openai', recoverable)
    if ((a === 'TRUNCATED' || b === 'TRUNCATED') && recoverable) {
      const mid = Math.ceil(batch.length / 2)
      await sampleBatch(batch.slice(0, mid), batchStart)
      await sampleBatch(batch.slice(mid), batchStart + mid)
      return
    }
    scorePayload(a)
    scorePayload(b)
  }

  for (const batchStart of batches.slice(0, DET_SAMPLE_BATCHES)) {
    const sampleRows = charAwareRowCount(rows, batchStart)
    // BLIND: the voters must not be handed the very map they are cross-checking.
    await sampleBatch(rows.slice(batchStart, batchStart + sampleRows), batchStart)
  }

  // A DEAD CHECKER IS NOT A CLEAN CHECK. Every leg here swallows its errors to
  // null, so when both voters die `checkedRows` stayed 0, the indictment loop
  // below could not fire, and the sheet reported exactly what a verified-clean
  // sheet reports. The deterministic path's ONLY AI check was therefore
  // indistinguishable from no check at all. One retry (the legs are independent
  // calls, so a transport blip is genuinely recoverable), then a named item.
  if (checkedRows === 0 && batches.length > 0 && rows.length > 0) {
    const retryStart = batches[0]
    await sampleBatch(rows.slice(retryStart, retryStart + charAwareRowCount(rows, retryStart)), retryStart)
  }
  if (checkedRows === 0 || joinedFields === 0) {
    review.push({
      kind: 'map-unverified', sheetName: fp.sheetName,
      detail: checkedRows === 0
        ? `The blind cross-check of "${fp.sheetName}" produced ZERO usable row-reads across ${batches.length} sampled batch(es) plus one retry — both voters failed, so the column map behind ${detEntities.length} code-extracted entit(y|ies) is UNVERIFIED. This is not a clean check; it is an absent one.`
        : `The blind cross-check of "${fp.sheetName}" read ${checkedRows} row(s) but none of its field reads carried a resolvable source cell, so nothing could be joined to a mapped column — the column map is UNVERIFIED.`,
    })
    return
  }

  // Indict COLUMNS (the deterministic VALUES are byte-perfect by construction —
  // only the map can be wrong).
  for (const [col, s] of perCol) {
    const wrong = s.reassigned + s.disagreed
    if (s.seen === 0 || wrong / s.seen <= 0.3) continue
    const mapped = mappedByCol.get(col)
    const what = s.reassigned >= s.disagreed
      ? `read column ${colLetter(col)} as "${s.sawField}" where the map says "${mapped.canonicalField}" (${s.reassigned} reassignment(s), ${s.disagreed} value disagreement(s))`
      : `disagreed with the value the map's "${mapped.canonicalField}" produced from column ${colLetter(col)} (${s.disagreed} value disagreement(s), ${s.reassigned} reassignment(s))`
    review.push({
      kind: 'map-suspect', sheetName: fp.sheetName, colIndex: col, colLabel: mapped.headerLabel ?? null,
      fieldPath: mapped.canonicalField,
      detail: `Blind AI cross-check ${what} in ${wrong}/${s.seen} sampled reads of that column — verify the column mapping.`,
    })
    for (const e of detEntities) {
      const f = e.fields.find(x => x.fieldName === mapped.canonicalField)
      if (f) { f.confidence = Math.min(f.confidence, 0.6); e.reviewFlag = true }
    }
  }
}

// ─── Cited-cell verification (conservation-ledger gate) ───────────────────────
// Resolve a citation against the AUTHORITATIVE grid and decide whether the cell
// actually carries what was claimed. Returns:
//   { ok: true }            — verified, or unverifiable for a legitimate reason
//                             (importer-derived verbatim, legacy fingerprint with
//                             no grid, empty claim) — absence of evidence is not
//                             evidence of mis-citation.
//   { ok: false, actual }   — the cell resolves and contradicts the claim.
// Containment, both directions, on the loose canon: a multi-refId cell legitimately
// CONTAINS each id, and a normalized number ("$1,528.00" → 1528) is faithful.

function verifyCitedCell(cit, value, fpByName) {
  if (!cit || !cit.cell) return { ok: true }
  if (DERIVED_VERBATIM.test(String(cit.verbatim ?? ''))) return { ok: true }
  const fp = fpByName && typeof fpByName.get === 'function' ? fpByName.get(cit.sheet) : null
  if (!fp || !Array.isArray(fp.cells) || fp.cells.length === 0) return { ok: true }
  const ref = parseCellRef(cit.cell)
  if (!ref || ref.row < 0 || ref.row >= fp.cells.length || ref.col < 0) {
    return { ok: false, actual: '(citation does not resolve to a cell in the grid)' }
  }
  const raw = fp.cells[ref.row]?.[ref.col]
  const actual = raw === null || raw === undefined ? '' : String(raw)
  const cell = canonLoose(actual)
  const claims = [cit.verbatim, value]
    .map(v => (Array.isArray(v) ? v.join(' ') : v))
    .map(canonLoose)
    .filter(s => s !== '')
  if (claims.length === 0) return { ok: true }            // nothing claimed → nothing to contradict
  if (cell === '') return { ok: false, actual }           // a claim against an empty cell IS a mis-citation
  for (const c of claims) if (cell.includes(c) || c.includes(cell)) return { ok: true }
  return { ok: false, actual }
}

// ─── Gather rows from SheetFingerprint ────────────────────────────────────────
// Prefers the REAL embedded grid (fp.cells) sliced below the locked header row.
// Legacy fallback reconstructs synthetic rows from distinctSample (lossy — only
// used for fingerprints from older clients that carry no cells).

// Returns { rows, gridRows }: gridRows[i] is row i's ABSOLUTE 0-based index in the
// embedded grid (P0-6 / ledger F07 adjunct): blank interior rows are filtered out
// of `rows`, so the old `i + headerRow + 2` cell references drifted below the first
// gap — every citation after it pointed at the wrong row. gridRows is null only for
// the legacy synthetic-row fallback, where no absolute grid exists at all.
function gatherRows(fp, headerRowIndex) {
  if (fp.layoutShape === 'STACKED_TABLES' && fp.subTables && fp.subTables.length > 0) {
    // Every sub-table anchors its own rows. `sub.cells[k]` is absolute grid row
    // `sub.cellsStartRow + k`, so concatenating sub-tables no longer destroys the
    // row identity: previously this returned gridRows:null and excelRowOf fell back
    // to `rowIdx + headerRow + 2`, which counts a FLAT sheet from ONE header. On a
    // stacked sheet that formula is right only inside the first sub-table and drifts
    // by the size of every preceding block thereafter — so every citation below the
    // first sub-table pointed at the wrong Excel row.
    const rows = []
    const gridRows = []
    for (const sub of fp.subTables) {
      const cells = sub.cells || []
      // Fall back to headerRowIndex for fingerprints built before cellsStartRow existed.
      const startRow = sub.cellsStartRow ?? sub.headerRowIndex ?? 0
      for (let k = 1; k < cells.length; k++) {          // k=0 is the sub-table's own header row
        const row = cells[k]
        if (!row || !row.some(c => c !== null)) continue // blank interior row, same rule as the flat path
        rows.push(row)
        gridRows.push(startRow + k)
      }
    }
    return { rows, gridRows }
  }
  if (Array.isArray(fp.cells) && fp.cells.length > 0) {
    const start = Math.max(0, (headerRowIndex ?? fp.bestHeaderRow ?? -1) + 1)
    const rows = []
    const gridRows = []
    for (let r = start; r < fp.cells.length; r++) {
      const row = fp.cells[r]
      if (!row || !row.some(c => c !== null)) continue
      rows.push(row)
      gridRows.push(r)
    }
    return { rows, gridRows }
  }
  // Legacy fallback: column-major distinctSample → row-major synthetic rows.
  const maxRows = Math.max(...(fp.columnProfiles || []).map(c => (c.distinctSample || []).length), 0)
  if (maxRows === 0) return { rows: [], gridRows: null }
  const rows = []
  for (let r = 0; r < maxRows; r++) {
    rows.push((fp.columnProfiles || []).map(c => (c.distinctSample || [])[r] ?? null))
  }
  return { rows, gridRows: null }
}

// 1-based Excel row for data row `rowIdx` (0-based data index): absolute from the
// grid when known, else the contiguous-rows fallback formula.
function excelRowOf(rowIdx, headerRow, gridRows) {
  if (Array.isArray(gridRows) && gridRows[rowIdx] != null) return gridRows[rowIdx] + 1
  return rowIdx + headerRow + 2
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
async function extractRows(classified, locks, colMaps, fpByName, budget, review, lobRefIdHint, onProgress, extras = {}) {
  const progress = typeof onProgress === 'function' ? onProgress : () => {}
  const allEntities = []
  const lockMap  = new Map()
  const colMapOf = new Map()
  for (const l of locks)   lockMap.set(l.sheetName, l)
  for (const m of colMaps) colMapOf.set(m.sheetName, m)
  // CE3 Step 3: census table regions + the accounting ledger ride in via extras
  // ({ censusBySheet?: Map, accounting?: Map<sheet, SheetAccounting>, tenantId? }).
  const censusBySheet = extras.censusBySheet instanceof Map ? extras.censusBySheet : new Map()
  // Per-sheet column-coverage ledger (mapped / below-read-threshold / recovered /
  // unread / empty). The orchestrator supplies the array and reports the rollup:
  // "how many mapped columns did nothing read this run" becomes a measured number
  // instead of an assumption.
  const coverageSink = Array.isArray(extras.columnCoverage) ? extras.columnCoverage : null

  const deployBulk    = resolveAnthropic('BULK_VERIFY', budget)
  const deployGptMini = resolveOpenAI(fleet.DEPLOY_GPT_MINI, budget)  // BULK_ALT
  const deployJudge   = resolveOpenAI(fleet.DEPLOY_GPT, budget)       // gpt-5.1 judge

  const contentSheets = classified.filter(c => c.domain !== 'ignore' && c.domain !== 'definitions')
  const synthCounter  = new Map()

  // Sheets extract 2-wide (batches inside each run 3-wide). Workers return
  // PRE-SYNTHESIS entities; the SYNTH pass runs afterwards over the ordered
  // results so placeholder numbering stays deterministic across runs.
  async function extractSheet(sheet) {
    // (No `::` guard — see stage3-column-map.js: compound pseudo-names never enter
    // `classified`, only `locks`.)
    const fp     = fpByName.get(sheet.sheetName)
    const lock   = lockMap.get(sheet.sheetName)
    const colMap = colMapOf.get(sheet.sheetName)
    if (!fp || !lock || !colMap) {
      // This bail used to be silent, which is how a whole stacked sheet could vanish
      // from a run with nothing to show for it. A sheet that reaches extraction and
      // produces nothing is a reportable loss, not a no-op.
      if (fp) {
        review.push({
          kind: 'unmapped-sheet', sheetName: sheet.sheetName,
          detail: `"${sheet.sheetName}" (${fp.layoutShape}) reached extraction with no ${!lock ? 'header lock' : 'column map'} — zero rows extracted from it.`,
        })
      }
      return null
    }

    // ── CE3 Step 7: per-sheet resume — a checkpointed sheet is NEVER re-extracted.
    if (extras.completedSheets instanceof Map && extras.completedSheets.has(sheet.sheetName)) {
      progress(`${fp.sheetName}: restored from checkpoint (resume)`)
      return { fp, entities: extras.completedSheets.get(sheet.sheetName), resumed: true }
    }

    let { rows, gridRows } = gatherRows(fp, lock.headerRowIndex)
    if (rows.length === 0) return null

    // ── CE3 Step 3(a): census TableRegion windows — a stacked sheet whose census
    // segments MULTIPLE regions extracts the region the locked header governs;
    // the other regions' cells stay unaccounted so the stage-4.5 sweeper (which
    // classifies with citations, never a naive row batch) surfaces them as FACT
    // proposals or review items instead of being extracted under the WRONG map.
    const censusSheet = censusBySheet.get(sheet.sheetName)
    const regions = censusSheet && Array.isArray(censusSheet.tables) ? censusSheet.tables : []
    if (regions.length > 1 && fp.layoutShape !== 'STACKED_TABLES' && Array.isArray(gridRows)) {
      const headerAbs = lock.headerRowIndex ?? -1
      const primary = regions.find(rg => headerAbs >= rg.rowStart && headerAbs <= rg.rowEnd) || regions[0]
      const kept = []
      const keptGrid = []
      for (let i = 0; i < rows.length; i++) {
        const abs = gridRows[i]
        if (abs >= primary.rowStart && abs <= primary.rowEnd) { kept.push(rows[i]); keptGrid.push(abs) }
      }
      if (kept.length > 0 && kept.length < rows.length) {
        review.push({ kind: 'census-region-window', sheetName: fp.sheetName, detail: `"${fp.sheetName}" segments into ${regions.length} census table regions — extracted rows ${primary.rowStart + 1}-${primary.rowEnd + 1} under the locked header; the other region(s) go to the sweeper (never extracted under the wrong column map).` })
        rows = kept
        gridRows = keptGrid
      }
    }

    // A sheet with ZERO mapped columns cannot be extracted meaningfully — skip it
    // with an importWarning instead of asking models to extract from nothing
    // (which produces junk entities that all discard).
    const mappedColumns = (colMap.mappings || []).filter(m => m.canonicalField !== null)
    const mappedColumnCount = mappedColumns.length
    if (mappedColumnCount === 0) {
      review.push({ kind: 'unmapped-sheet', sheetName: fp.sheetName, detail: `No columns could be mapped on "${fp.sheetName}" (${(colMap.mappings || []).length} columns examined) — sheet skipped; map the columns manually or check the canonical dictionary.` })
      return null
    }

    // Width-aware batch size (ledger F10): the prompt embeds one line per row ×
    // mapped column, so the OUTPUT scales with cells, not rows — budget cells so
    // wide sheets (state matrices, forms libraries) start small instead of
    // discovering the token ceiling the hard way. Typical sheets (≤24 mapped
    // columns) keep the historical 20-row batches.
    const rowsPerBatch  = Math.max(1, Math.min(BATCH_ROWS, Math.floor(CELL_BUDGET / Math.max(1, mappedColumnCount))))

    // Truncation sentinel: a vote whose output hit the token ceiling is not a
    // malformed vote — it is a batch that is too big. Split in half and
    // re-extract (recursion floor: 1 row); rows are never dropped for size.
    const TRUNCATED = Symbol('stage4-truncated')

    // `view` narrows the column map the prompt states (sub-threshold recovery
    // asks for ONLY the columns the code reader skipped); `tag` names the pass in
    // telemetry so a recovery vote is never mistaken for a main-path vote.
    async function extractBatch(batch, batchStart, view, tag) {
      const mapView = view || colMap
      const userPrompt = buildExtractionPrompt(fp, mapView, lock.headerRowIndex, batch, batchStart, null, gridRows)

      // Two decorrelated extraction votes in parallel: BULK (haiku) + BULK_ALT
      // (gpt-mini). Malformed output = structured telemetry + one targeted retry
      // per side (P0-7 / ledger F16) — never a silent missing vote. Truncation
      // short-circuits to the sentinel (no identical retry — it re-truncates).
      const rowsWhat = `${tag ? `${tag} ` : ''}rows ${batchStart}-${batchStart + batch.length - 1}`
      const onTruncation = () => TRUNCATED
      // CE3 Step 3(d) — extraction cache (backlog item 8): keyed by deployment +
      // prompt version + an EXPLICIT content hash of the window cells (belt and
      // suspenders beside the verbatim window inside userPrompt). A hit returns
      // {raw, stopReason} byte-for-byte — parsing, consensus, truncation
      // detection and ledger posting run identically; only the model call is
      // skipped. Writes are gated on parse success + a clean stop reason, and
      // parseWithRetry's targeted retry passes bypassCache so it can never
      // replay the bytes it is retrying.
      const windowHash = contentHashOf(batch)
      const cached = (deployment, call, callOpts) => cachedCall({
        deployment, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt,
        promptVersion: PROMPT_VERSION, contentHash: windowHash,
        budget, tenantId: extras.tenantId, call,
        validate: (raw) => parseExtraction(raw) != null,
      }, callOpts)
      const [aVote, bVote] = await Promise.all([
        parseWithRetry({ call: (callOpts) => cached(deployBulk, () => callAnthropic({ deployment: deployBulk, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 8192, budget }), callOpts), parse: parseExtraction, review, stage: 'stage4', sheetName: fp.sheetName, what: `BULK extraction ${rowsWhat}`, onTruncation, vote: { budget, site: 'stage4-extract', family: 'anthropic' } }),
        parseWithRetry({ call: (callOpts) => cached(deployGptMini, () => callOpenAI({ deployment: deployGptMini, systemPrompt: STAGE4_EXTRACT_SYSTEM, userPrompt, maxTokens: 8192, budget }), callOpts), parse: parseExtraction, review, stage: 'stage4', sheetName: fp.sheetName, what: `BULK_ALT extraction ${rowsWhat}`, onTruncation, vote: { budget, site: 'stage4-extract', family: 'openai' } }),
      ])

      if ((aVote === TRUNCATED || bVote === TRUNCATED) && batch.length > 1) {
        review.push({ kind: 'truncated-batch-split', sheetName: fp.sheetName, detail: `${rowsWhat}: model output hit the token ceiling — batch split in half and re-extracted (no rows dropped).` })
        const mid = Math.ceil(batch.length / 2)
        const [left, right] = await Promise.all([
          extractBatch(batch.slice(0, mid), batchStart, view, tag),
          extractBatch(batch.slice(mid), batchStart + mid, view, tag),
        ])
        return { entities: [...left.entities, ...right.entities], conflicts: [...left.conflicts, ...right.conflicts] }
      }
      const truncatedAtOneRow = aVote === TRUNCATED || bVote === TRUNCATED
      const aPayload = aVote === TRUNCATED ? null : aVote
      const bPayload = bVote === TRUNCATED ? null : bVote
      for (const [side, payload] of [['BULK', aPayload], ['BULK_ALT', bPayload]]) {
        if (payload && payload.dropped > 0) {
          review.push({ kind: 'malformed-model-output', sheetName: fp.sheetName, detail: `stage4: ${side} ${rowsWhat} — ${payload.dropped} malformed entit(y|ies)/field(s) dropped by shape validation.` })
        }
      }

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
          review.push({ kind: 'dropped-batch', sheetName: fp.sheetName, detail: `Rows ${batchStart}-${batchStart + batch.length - 1}: ${truncatedAtOneRow ? 'a single row exceeds the output token ceiling on every tier' : 'every extractor tier failed to parse'} — rows require manual review.` })
          return { entities: [], conflicts: [] }
        }
        const { entities } = reconcileEntities(recovered.entities, [], fp.sheetName, review)
        return { entities, conflicts: [] }
      }

      const { entities, conflicts } = reconcileEntities(
        aPayload?.entities ?? [],
        bPayload?.entities ?? [],
        fp.sheetName,
        review,
      )

      progress(`${fp.sheetName}: rows ${batchStart}-${batchStart + batch.length - 1} of ${rows.length} extracted`)
      return { entities, conflicts }
    }

    // ── Deterministic fast path: confident map + real grid → code extracts ────
    // Columns BELOW the read floor do not vanish here any more: they are routed
    // through the AI extraction path over the same rows, and whatever it reads is
    // merged onto the code-extracted entities (code wins on any field both
    // produced — a confident column's byte-perfect value is never overwritten).
    if (sheetIsDeterministic(fp, colMap)) {
      progress(`${fp.sheetName}: deterministic extraction (${rows.length} rows)`)
      const detEntities = deterministicExtract(fp, colMap, lock.headerRowIndex, rows, fp.sheetName, gridRows)
      await sampleVerifyMap({ fp, colMap, headerRow: lock.headerRowIndex, rows, gridRows, detEntities, deployBulk, deployGptMini, budget, review })

      const subThreshold = mappedColumns.filter(m => m.confidence < DET_MAP_CONFIDENCE)
      const coverage = {
        sheet: fp.sheetName, path: 'deterministic', mappedColumns: mappedColumnCount,
        belowReadThreshold: subThreshold.length, recovered: 0, unread: 0, empty: 0,
      }
      if (subThreshold.length > 0) {
        progress(`${fp.sheetName}: recovering ${subThreshold.length} sub-threshold mapped column(s) via the AI path`)
        const view = { ...colMap, mappings: subThreshold, stateColumns: [], allStatesColIndex: null }
        const perBatch = Math.max(1, Math.min(BATCH_ROWS, Math.floor(CELL_BUDGET / Math.max(1, subThreshold.length))))
        const starts = []
        for (let b = 0; b < rows.length; b += perBatch) starts.push(b)
        const recResults = await pMap(starts, (s) =>
          extractBatch(rows.slice(s, s + perBatch), s, view, 'sub-threshold recovery'), 3)
        const recEntities  = recResults.flatMap(r => r.entities)
        const recConflicts = recResults.flatMap(r => r.conflicts)
        if (recConflicts.length > 0) {
          await resolveConflicts({
            conflicts: recConflicts, entities: recEntities, fp, colMap: view,
            headerRow: lock.headerRowIndex, rows, gridRows, batchStart: 0,
            sheetName: fp.sheetName, budget, review, deployJudge,
          })
        }
        // Merge: only the fields the recovery pass was ASKED for, only where the
        // code reader produced nothing. Recovered fields keep their own (model)
        // confidence and are marked, so provenance stays honest downstream.
        const wanted  = new Set(subThreshold.map(m => m.canonicalField))
        const detByRow = new Map(detEntities.map(e => [e.sourceRowIndex, e]))
        const readFields = new Set()
        for (const rec of recEntities) {
          const det = detByRow.get(rec.sourceRowIndex)
          if (!det) continue
          const have = new Set(det.fields.map(f => f.fieldName))
          for (const f of rec.fields || []) {
            if (!wanted.has(f.fieldName) || have.has(f.fieldName)) continue
            if (f.value === null || f.value === undefined || String(f.value).trim() === '') continue
            det.fields.push({ ...f, recoveredColumn: true })
            have.add(f.fieldName)
            readFields.add(f.fieldName)
          }
        }
        for (const m of subThreshold) {
          if (readFields.has(m.canonicalField)) { coverage.recovered++; continue }
          // A column with no content in any row is EMPTY, not unread — flagging it
          // would be a manufactured finding.
          if (!columnHasContent(rows, m.colIndex)) { coverage.empty++; continue }
          coverage.unread++
          review.push({
            kind: 'unread-column', sheetName: fp.sheetName, colIndex: m.colIndex, colLabel: m.headerLabel ?? null,
            detail: `Column ${colLetter(m.colIndex)} ("${m.headerLabel ?? ''}") maps to ${m.entityKind ?? '?'}.${m.canonicalField} at confidence ${m.confidence.toFixed(2)} — below the ${DET_MAP_CONFIDENCE.toFixed(2)} deterministic read floor, and the AI recovery pass returned no value for it on any of ${rows.length} row(s). The column has content and was NOT read.`,
          })
        }
      }
      if (coverageSink) coverageSink.push(coverage)
      return { fp, entities: [detEntities] }
    }

    // Batches extract independently — up to 3 in flight (pMap keeps batch order;
    // synthesis/flagging runs after collection so SYNTH numbering stays stable).
    const batchStarts = []
    for (let b = 0; b < rows.length; b += rowsPerBatch) batchStarts.push(b)

    const batchResults = await pMap(batchStarts, (batchStart) =>
      extractBatch(rows.slice(batchStart, batchStart + rowsPerBatch), batchStart), 3)

    // Consensus ladder + judge ONCE per sheet over the pooled conflicts — dense
    // chunks of conflicted rows instead of one ladder climb per conflicted batch.
    const sheetConflicts = batchResults.flatMap(r => r.conflicts)
    const sheetEntities  = batchResults.flatMap(r => r.entities)
    if (sheetConflicts.length > 0) {
      progress(`${fp.sheetName}: resolving ${sheetConflicts.length} conflicted field(s) across ${new Set(sheetConflicts.map(c => c.rowIdx)).size} row(s)`)
      await resolveConflicts({
        conflicts: sheetConflicts, entities: sheetEntities, fp, colMap,
        headerRow: lock.headerRowIndex, rows, gridRows, batchStart: 0,
        sheetName: fp.sheetName, budget, review, deployJudge,
      })
    }

    // Column coverage on the AI path: every mapped column IS stated in the prompt,
    // so nothing is skipped by construction — but a column the extractors never
    // returned a value for, on a column that has content, is still an unread
    // column and gets the same named review item.
    if (coverageSink) {
      const produced = new Set()
      for (const e of sheetEntities) for (const f of e.fields || []) produced.add(f.fieldName)
      const coverage = {
        sheet: fp.sheetName, path: 'ai', mappedColumns: mappedColumnCount,
        belowReadThreshold: 0, recovered: 0, unread: 0, empty: 0,
      }
      for (const m of mappedColumns) {
        if (produced.has(m.canonicalField)) continue
        if (!columnHasContent(rows, m.colIndex)) { coverage.empty++; continue }
        coverage.unread++
        review.push({
          kind: 'unread-column', sheetName: fp.sheetName, colIndex: m.colIndex, colLabel: m.headerLabel ?? null,
          detail: `Column ${colLetter(m.colIndex)} ("${m.headerLabel ?? ''}") maps to ${m.entityKind ?? '?'}.${m.canonicalField} at confidence ${m.confidence.toFixed(2)} and has content, but no extractor returned a value for it on any of ${rows.length} row(s). The column was NOT read.`,
        })
      }
      coverageSink.push(coverage)
    }

    return { fp, entities: batchResults.map(r => r.entities) }
  }

  const extractAndCheckpoint = async (sheet) => {
    const result = await extractSheet(sheet)
    // CE3 Step 7: per-sheet stage-4 checkpoint (skipped for resumed sheets — their
    // artifact already exists). Best-effort; never fails extraction.
    if (result && !result.resumed && typeof extras.onSheetComplete === 'function') {
      try { await extras.onSheetComplete(sheet.sheetName, result.entities) } catch { /* checkpoint only */ }
    }
    return result
  }

  const sheetResults = await pMap(contentSheets, extractAndCheckpoint, 2)

  // Source-evidenced synthesis fallback (ledger F30): the workbook's own scheme
  // prefix, read from the first real refId any sheet extracted — used when no
  // LOB hint exists, so minted placeholders stay in the source's own scheme.
  let sourcePrefix = null
  for (const result of sheetResults) {
    if (sourcePrefix || !result) continue
    for (const entities of result.entities) {
      for (const e of entities) {
        if (e.needsRefIdSynthesis) continue
        const rid = e.fields.find((f) => f.fieldName === 'refId')?.value
        const m = typeof rid === 'string' ? rid.trim().match(/^([A-Za-z]{2,6})[.\-_ ]/) : null
        if (m) { sourcePrefix = m[1].toUpperCase(); break }
      }
      if (sourcePrefix) break
    }
  }

  // Sequential post-pass in sheet order: synthesis (stable SYNTH numbering),
  // review flagging, multi-refId expansion, parent derivation.
  for (const result of sheetResults) {
    if (!result) continue
    const { fp, entities: batches } = result
    const sheetEntities = []
    for (const entities of batches) {
      for (const entity of entities) {
        if (entity.needsRefIdSynthesis) {
          synthesizeRefId(entity, lobRefIdHint, synthCounter, sourcePrefix)
          review.push({ kind: 'refid-synthesis-needed', sheetName: fp.sheetName, rowIndex: entity.sourceRowIndex, detail: `Row ${entity.sourceRowIndex} had no refId; synthesized placeholder — human review required.` })
        }
        if (entity.overallConfidence < CONFIDENCE_REVIEW) entity.reviewFlag = true
      }
      sheetEntities.push(...expandMultiRefIds(entities, fp.sheetName))
    }
    // After all batches: derive parentId for sub-coverages from row context.
    deriveParentIds(sheetEntities)
    allEntities.push(...sheetEntities)
  }

  // ── CE3 Step 3(b): post consumed cells to the AccountingLedger as FACTs ──────
  // Every extraction result — the deterministic CODE fast path AND the AI vote
  // paths — accounts the exact cells its citations name. UNACCOUNTED residue is
  // the stage-4.5 sweeper's work queue; conservation is measured, never assumed.
  // A FACT is posted only when the CITED CELL ACTUALLY SAYS IT. The ledger used to
  // accept whatever cell a model named, unverified — so a mis-citation did double
  // damage: it marked an innocent cell accounted (it never was), and it left the
  // cell the value truly came from sitting in the UNACCOUNTED residue where the
  // sweeper would re-classify it from scratch. The honesty ledger was being written
  // from unaudited claims. Containment (not equality) is the test, for the same
  // reason stage 5 uses it: a multi-refId cell legitimately contains each id, and a
  // faithful type normalization ("$1,528.00" → 1528) is not a mis-citation. Code
  // citations are constructed from the grid and pass by construction; this bites
  // model citations, which is where the risk is.
  const accounting = extras.accounting instanceof Map ? extras.accounting : null
  if (accounting && typeof brainShared.post === 'function') {
    let miscited = 0
    const miscitedSample = []
    for (const e of allEntities) {
      const factRef = `${e.kind}:${e.sourceSheet}:${e.sourceRowIndex}:${e.occurrence ?? 0}`
      for (const f of e.fields || []) {
        const cit = f.citation
        if (!cit || !cit.sheet || !cit.cell) continue
        const acc = accounting.get(cit.sheet)
        if (!acc) continue
        const verdict = verifyCitedCell(cit, f.value, fpByName)
        if (verdict.ok === false) {
          miscited++
          if (miscitedSample.length < 8) miscitedSample.push(`${cit.sheet}!${cit.cell} (${e.kind}.${f.fieldName}): cited "${String(cit.verbatim).slice(0, 40)}" / value ${JSON.stringify(f.value)} vs cell "${verdict.actual.slice(0, 40)}"`)
          review.push({
            kind: 'miscited-field', sheetName: e.sourceSheet, rowIndex: e.sourceRowIndex, fieldPath: f.fieldName,
            detail: `${e.kind}.${f.fieldName} cites ${cit.sheet}!${cit.cell}, but that cell reads "${verdict.actual.slice(0, 60)}" — neither the cited verbatim "${String(cit.verbatim ?? '').slice(0, 60)}" nor the extracted value ${JSON.stringify(f.value)} appears in it. NOT posted to the conservation ledger: a mis-citation would mark this cell accounted and hide the cell the value really came from.`,
          })
          e.reviewFlag = true
          continue
        }
        brainShared.post(acc, `${cit.sheet}!${String(cit.cell).toUpperCase()}`, 'FACT', f.deterministic ? 'code' : 'model', 'stage4-extract', factRef, [])
      }
    }
    if (miscited > 0) {
      console.log(`[import-brain] conservation ledger: ${miscited} mis-cited field(s) refused a FACT post — ${miscitedSample.join(' | ')}`)
    }
  }

  return allEntities
}

module.exports = {
  extractRows,
  // Test seams (hardening fixtures — pure helpers, no AI):
  reconcileEntities, expandMultiRefIds, resolveConflicts, rowKind, parseExtraction, synthesizeRefId,
  deterministicExtract, buildExtractionPrompt, buildBlindExtractionPrompt,
  gatherRows, excelRowOf, widthAwareRowCount, verifyCitedCell, sampleVerifyMap,
}
