'use strict'
// server/lib/import-brain/stage3-column-map.js — Column → field mapping.
//
// For each content sheet (domain != 'ignore', header confirmed):
//   1. Build a compact canonical dictionary limited to entity kinds for this domain.
//   2. REASONER_A (opus/Anthropic) + REASONER_B (gpt-5.1/OpenAI) map independently.
//   3. Reconcile: per-column, if both agree → accept at avg confidence.
//      Disagreement → lower confidence, route to review queue.
//   4. Low-confidence mappings (< CONFIDENCE_REVIEW) → review queue.
//
// Both reasoners are used to decorrelate mapping errors.
// Temperature 0 on Claude (opus). OpenAI o-series does not accept temperature.

const fleet = require('../fleet')
const { callAnthropic, callOpenAI, resolveAnthropic, resolveOpenAI } = require('./ai-call')
const { STAGE3_MAP_SYSTEM } = require('./prompts')
const { extractJson, DOMAIN_ENTITY_KINDS, CONFIDENCE_REVIEW, colLetter, pMap, parseWithRetry } = require('./constants')

// Load CANONICAL_MAP and SURFACED_COLUMNS from the shared CJS bundle.
const brainShared = require('../import-brain-shared.cjs')
const { CANONICAL_MAP, SURFACED_COLUMNS } = brainShared

// ─── Build compact canonical field dictionary for a domain ────────────────────

function buildDomainDictionary(kinds) {
  if (!kinds || kinds.length === 0) return '(No entity kinds for this domain.)'
  const entries = kinds.flatMap(kind => {
    const def = CANONICAL_MAP[kind]
    if (!def) return []
    return (def.fields || [])
      .filter(f => f.role !== 'system' && f.role !== 'derived')
      .map(f => ({
        entityKind:  kind,
        field:       f.field,
        type:        f.type,
        description: f.description,
        aliases:     f.aliases,
        enumValues:  f.enumValues,
        ambiguous:   f.ambiguous ?? false,
        examples:    (f.examples || []).slice(0, 2),
      }))
  })
  return JSON.stringify(entries, null, 2)
}

// ─── Column metadata serialiser ────────────────────────────────────────────────

function serialiseColumns(fp, headerRow) {
  const colLines = (fp.columnProfiles || []).map(col => {
    const headerCell = `${colLetter(col.colIndex)}${headerRow + 1}`
    const samples = (col.distinctSample || []).slice(0, 5).map(v => JSON.stringify(v)).join(', ')
    return [
      `Column ${col.colIndex} (${colLetter(col.colIndex)}):`,
      `  Header (${fp.sheetName}!${headerCell}): ${col.headerLabel ? `"${col.headerLabel}"` : '(none)'}`,
      `  Type mix: ${JSON.stringify(col.typeMix)}`,
      `  Sample values: ${samples || '(empty)'}`,
      col.isEnumLike ? `  Appears enum-like (${(col.distinctSample || []).length} distinct values)` : '',
    ].filter(Boolean).join('\n')
  })
  return colLines.join('\n\n')
}

// ─── Parse mapping response ────────────────────────────────────────────────────

function parseMappings(raw) {
  try {
    const arr = extractJson(raw)
    if (!Array.isArray(arr)) return null
    const entries = []
    let dropped = 0
    for (const item of arr) {
      // Runtime shape validation (P0-7 / ledger F16): a non-numeric colIndex used
      // to become NaN and flow through; malformed items are dropped and counted.
      if (!item || typeof item !== 'object' || !Number.isFinite(Number(item.colIndex))) { dropped++; continue }
      const citation = item.citation || null
      entries.push({
        colIndex:       Number(item.colIndex),
        canonicalField: typeof item.canonicalField === 'string' ? item.canonicalField : null,
        entityKind:     typeof item.entityKind === 'string' ? item.entityKind : null,
        confidence:     Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0,
        citation:       citation
          ? { sheet: citation.sheet ?? '', cell: citation.cell ?? '', verbatim: citation.verbatim ?? '' }
          : null,
        needsReview: Boolean(item.needsReview ?? false),
      })
    }
    if (entries.length === 0 && arr.length > 0) return null
    return { entries, dropped }
  } catch { return null }
}

// ─── Reconcile two mapping arrays for a single sheet ─────────────────────────

function reconcileMappings(colProfiles, aArr, bArr, sheetName, review) {
  const surfacedLabels = new Set(SURFACED_COLUMNS.map(s => s.column.toUpperCase()))
  const aMap = new Map()
  const bMap = new Map()
  for (const e of aArr ?? []) aMap.set(e.colIndex, e)
  for (const e of bArr ?? []) bMap.set(e.colIndex, e)

  return (colProfiles || []).map(col => {
    const a = aMap.get(col.colIndex) ?? null
    const b = bMap.get(col.colIndex) ?? null

    if (!a && !b) {
      const isSurfaced = col.headerLabel && surfacedLabels.has(col.headerLabel.toUpperCase())
      if (isSurfaced) {
        review.push({ kind: 'unmapped-column', sheetName, colIndex: col.colIndex, colLabel: col.headerLabel, detail: `Surfaced column "${col.headerLabel}" could not be mapped.` })
      }
      return { colIndex: col.colIndex, headerLabel: col.headerLabel, canonicalField: null, entityKind: null, confidence: 0, citation: null, disagreed: false, needsReview: true }
    }

    if (!a || !b) {
      const winner = a ?? b
      const entry = toEntry(col, winner, false)
      if (entry.confidence < CONFIDENCE_REVIEW) {
        review.push({ kind: 'low-confidence-map', sheetName, colIndex: col.colIndex, colLabel: col.headerLabel, detail: `Single-model mapping "${winner.canonicalField ?? 'null'}" at confidence ${winner.confidence.toFixed(2)}.` })
        entry.needsReview = true
      }
      return entry
    }

    if (a.canonicalField === b.canonicalField) {
      const avgConf = (a.confidence + b.confidence) / 2
      const entry = toEntry(col, a.confidence >= b.confidence ? a : b, false)
      entry.confidence = avgConf
      entry.reasonerAField = a.canonicalField
      entry.reasonerBField = b.canonicalField
      if (avgConf < CONFIDENCE_REVIEW && a.canonicalField !== null) {
        review.push({ kind: 'low-confidence-map', sheetName, colIndex: col.colIndex, colLabel: col.headerLabel, detail: `Both agreed on "${a.canonicalField}" but avg confidence is low (${avgConf.toFixed(2)}).` })
        entry.needsReview = true
      }
      return entry
    }

    // Disagreement — lower confidence, route to review
    const avgConf = (a.confidence + b.confidence) / 2 * 0.7
    review.push({ kind: 'disagreement', sheetName, colIndex: col.colIndex, colLabel: col.headerLabel, detail: `Reasoner A: "${a.canonicalField ?? 'unmapped'}", Reasoner B: "${b.canonicalField ?? 'unmapped'}".` })

    return {
      colIndex:       col.colIndex,
      headerLabel:    col.headerLabel,
      canonicalField: a.confidence >= b.confidence ? a.canonicalField : b.canonicalField,
      entityKind:     a.confidence >= b.confidence ? a.entityKind : b.entityKind,
      confidence:     avgConf,
      citation:       a.citation ?? b.citation ?? null,
      reasonerAField: a.canonicalField,
      reasonerBField: b.canonicalField,
      disagreed:      true,
      needsReview:    true,
    }
  })
}

function toEntry(col, raw, disagreed) {
  return {
    colIndex:       col.colIndex,
    headerLabel:    col.headerLabel,
    canonicalField: raw.canonicalField,
    entityKind:     raw.entityKind,
    confidence:     raw.confidence,
    citation:       raw.citation ?? null,
    disagreed,
    needsReview:    raw.needsReview || raw.canonicalField === null,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * @param {object[]}          classified  ClassifiedSheet[]
 * @param {object[]}          locks       HeaderLock[]
 * @param {Map<string,object>} fpByName   sheetName → SheetFingerprint
 * @param {object}            budget      { degraded: boolean }
 * @param {object[]}          review      ReviewItem[] (mutated)
 * @returns {Promise<object[]>} SheetColumnMap[]
 */
async function mapColumns(classified, locks, fpByName, budget, review) {
  const maps = []

  const lockMap = new Map()
  for (const l of locks) lockMap.set(l.sheetName, l)

  // Resolve both deployments through the cost guard before the loop.
  const deployOpus = resolveAnthropic('GROUNDED_CITED', budget)
  const deployGpt  = resolveOpenAI(fleet.DEPLOY_GPT, budget)  // gpt-5.1 REASONER_B

  const contentSheets = classified.filter(c => c.domain !== 'ignore' && c.domain !== 'definitions')

  // Sheets map independently — up to 3 in flight (each already batches internally).
  async function mapOne(sheet) {
    const lock = lockMap.get(sheet.sheetName)
    const fp   = fpByName.get(sheet.sheetName)
    if (!fp || !lock) return null
    // (No `::` guard here. `classified` is built from structural.sheets, so every
    // sheetName is a real worksheet name — a compound `sheet::sub` pseudo-name has
    // never reached this list. The guard that used to sit here could not fire, and
    // reading as if it handled the stacked case is what let the missing sheet-level
    // lock go unnoticed. Stacked sub-table pseudo-names live only in `locks`.)

    const entityKinds = DOMAIN_ENTITY_KINDS[sheet.domain] || []
    const dictionary  = buildDomainDictionary(entityKinds)

    // ── State-matrix columns are handled DETERMINISTICALLY, never sent to the
    // mapper: a 51-state X-mark block would dwarf the real columns and blow the
    // response budget. They surface on the map as stateColumns for stage 4.
    const stateColumns = []
    const stateIdxSet  = new Set()
    let allStatesColIndex = null
    if (fp.wideMatrix) {
      for (const [code, idx] of Object.entries(fp.wideMatrix.stateColIndices || {})) {
        stateColumns.push({ colIndex: idx, stateCode: code })
        stateIdxSet.add(idx)
      }
      if (fp.wideMatrix.allStatesColIndex != null) {
        allStatesColIndex = fp.wideMatrix.allStatesColIndex
        stateIdxSet.add(allStatesColIndex)
      }
    }
    // ALL ACTIVE STATES column outside a detected wide matrix
    if (allStatesColIndex === null) {
      const allCol = (fp.columnProfiles || []).find(c => /^all\s+(active\s+)?states?$/i.test(String(c.headerLabel ?? '').trim()))
      if (allCol) { allStatesColIndex = allCol.colIndex; stateIdxSet.add(allCol.colIndex) }
    }
    // Fallback detection when the layout detector did not flag WIDE_MATRIX but the
    // sheet still carries a state block: 2-letter-code headers whose cells are X/blank.
    if (stateColumns.length === 0) {
      for (const col of fp.columnProfiles || []) {
        const h = String(col.headerLabel ?? '').trim().toUpperCase()
        if (/^[A-Z]{2}$/.test(h) && US_STATE_CODES.has(h)) {
          const sample = (col.distinctSample || []).map(v => String(v ?? '').trim().toUpperCase())
          if (sample.every(v => v === '' || v === 'X' || v === 'N/A')) {
            stateColumns.push({ colIndex: col.colIndex, stateCode: h })
            stateIdxSet.add(col.colIndex)
          }
        }
      }
    }

    const mappableCols = (fp.columnProfiles || []).filter(c => !stateIdxSet.has(c.colIndex))

    const defNames = Object.entries(fp.definitions ?? [])
      .slice(0, 10)
      .map(([, d]) => d.columnName)
      .join(', ') || '(none)'

    // ── Batch columns so responses never truncate (o-series reasoning tokens
    // share the completion budget; a 68-column single response cannot fit).
    const aAll = []
    const bAll = []
    let parseFailures = 0
    for (let start = 0; start < mappableCols.length; start += MAP_BATCH_COLS) {
      const chunk = mappableCols.slice(start, start + MAP_BATCH_COLS)
      const colMeta = serialiseColumns({ ...fp, columnProfiles: chunk }, lock.headerRowIndex)
      const userPrompt = [
        `Sheet: "${fp.sheetName}" | Domain: "${sheet.domain}"`,
        `Definitions from this workbook:\n${defNames}`,
        `\nCanonical field dictionary for this domain:\n${dictionary}`,
        `\nColumns to map (respond ONLY for columns you can map or that need review — omit the rest):\n${colMeta}`,
      ].join('\n')

      // REASONER_A (opus) + REASONER_B (gpt-5.1) map independently in parallel.
      // Malformed output = structured telemetry + one targeted retry per reasoner
      // (P0-7 / ledger F16).
      const chunkWhat = `column-map batch cols ${start}-${start + chunk.length - 1}`
      const [aParsed, bParsed] = await Promise.all([
        parseWithRetry({ call: () => callAnthropic({ deployment: deployOpus, systemPrompt: STAGE3_MAP_SYSTEM, userPrompt, maxTokens: 8192, budget }), parse: parseMappings, review, stage: 'stage3', sheetName: fp.sheetName, what: `REASONER_A ${chunkWhat}` }),
        parseWithRetry({ call: () => callOpenAI({ deployment: deployGpt, systemPrompt: STAGE3_MAP_SYSTEM, userPrompt, maxTokens: 8192, budget }), parse: parseMappings, review, stage: 'stage3', sheetName: fp.sheetName, what: `REASONER_B ${chunkWhat}` }),
      ])
      for (const [side, parsed] of [['REASONER_A', aParsed], ['REASONER_B', bParsed]]) {
        if (parsed && parsed.dropped > 0) {
          review.push({ kind: 'malformed-model-output', sheetName: fp.sheetName, detail: `stage3: ${side} ${chunkWhat} — ${parsed.dropped} malformed mapping item(s) dropped by shape validation.` })
        }
      }
      if (!aParsed && !bParsed) parseFailures++
      if (aParsed) aAll.push(...aParsed.entries)
      if (bParsed) bAll.push(...bParsed.entries)
    }

    if (parseFailures > 0) {
      review.push({ kind: 'low-confidence-map', sheetName: fp.sheetName, detail: `${parseFailures} column-map batch(es) failed to parse from both reasoners — affected columns are unmapped.` })
    }

    const mappings    = reconcileMappings(mappableCols, aAll.length ? aAll : null, bAll.length ? bAll : null, fp.sheetName, review)
    const unmappedIdx = mappings.filter(m => m.canonicalField === null).map(m => m.colIndex)

    return { sheetName: fp.sheetName, mappings, unmappedIndices: unmappedIdx, stateColumns, allStatesColIndex }
  }

  const mapped = await pMap(contentSheets, mapOne, 3)
  maps.push(...mapped.filter(Boolean))

  return maps
}

const MAP_BATCH_COLS = 24

const US_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH',
  'OK','OR','PA','PR','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
])

module.exports = { mapColumns }
