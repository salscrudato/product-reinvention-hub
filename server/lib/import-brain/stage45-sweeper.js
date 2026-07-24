'use strict'
// server/lib/import-brain/stage45-sweeper.js — CE3 Step 4: the conservation sweeper.
//
// After extraction, every censused sheet has an AccountingLedger where extracted cells
// are FACTs. This stage sweeps the UNACCOUNTED residue: batches of cells (verbatim +
// two rows of context, max SWEEP_BATCH cells) go to TWO independent voters
// (BULK_VERIFY / haiku + CHEAP_GENERAL / gpt-5-mini). Each cell must come back as:
//   - a NOISE classification from the ALLOWED vocabulary (code-enforced — a rule
//     outside the list is rejected as if the model said nothing),
//   - a FACT proposal carrying a full citation (the cell itself) + target entity kind, or
//   - UNKNOWN.
// Agreement is accepted; disagreement ladders ONCE to MID_REASONER (sonnet); residue and
// every UNKNOWN become NEEDS_REVIEW AccountingEntries AND first-class ImportPlan
// unresolved items (kind census_unaccounted) with sheet, refs, verbatim sample, reason.
//
// INVENTION IS IMPOSSIBLE BY CONSTRUCTION: acceptProposal() below is the only path that
// turns a sweeper answer into a FACT, and it drops any proposal whose cell ref is not in
// the batch it was asked about, whose kind is not in FACT_KINDS, or that carries no
// citation. The model never mints an entity — it nominates a cell; code decides.

const fleet = require('../fleet')
const brainShared = require('../import-brain-shared.cjs')
const { callAnthropic, callOpenAI, resolveAnthropic, resolveOpenAI } = require('./ai-call')
const { extractJson, pMap, parseWithRetry } = require('./constants')

const SWEEP_BATCH = 60
const CONTEXT_ROWS = 2
// Cap unaccounted cells swept per sheet via AI. Deterministic sheets (forms, rules, ratingStep)
// can have thousands of unmapped state-matrix cells — sweeping them all burns AI calls for near-zero
// data gain since state-applicability columns are almost always NOISE. Excess cells are marked
// NEEDS_REVIEW immediately and appear in the review queue without AI cost.
const SWEEP_MAX_PER_SHEET = 300

/** The ALLOWED noise vocabulary — the ONLY rules a sweeper classification may use. */
const ALLOWED_NOISE = new Set([
  'NOISE.TOC', 'NOISE.REVISION_HISTORY', 'NOISE.CONTACTS', 'NOISE.LOG',
  'NOISE.DECORATION', 'NOISE.BLANK_LABEL', 'NOISE.ARCHIVE_SHEET', 'NOISE.DROPDOWN_SRC',
])
/** Entity kinds a FACT proposal may target (the brain's own kind set). */
const FACT_KINDS = new Set(['product', 'coverage', 'form', 'rule', 'formRule', 'ldTable', 'rtTable', 'ratingStep'])

const SWEEPER_SYSTEM = [
  'You classify UNACCOUNTED spreadsheet cells from an insurance product workbook.',
  'For EVERY cell in the batch return exactly one of:',
  `  {"ref":"<A1>","kind":"NOISE","rule":"<one of ${[...ALLOWED_NOISE].join(', ')}>"}`,
  '  {"ref":"<A1>","kind":"FACT","entityKind":"<product|coverage|form|rule|formRule|ldTable|rtTable|ratingStep>","name":"<verbatim source text>"}',
  '  {"ref":"<A1>","kind":"UNKNOWN"}',
  'Rules: use ONLY the listed noise rules; a FACT must quote its name VERBATIM from the',
  'cell; when unsure say UNKNOWN — never guess. Respond with a JSON array only.',
].join('\n')

function batchPrompt(sheetName, batch) {
  const lines = [`Sheet: "${sheetName}"`, 'Unaccounted cells (ref = A1):']
  for (const c of batch) {
    lines.push(`  ${c.ref}: ${JSON.stringify(c.verbatim)}`)
    if (c.context && c.context.length) lines.push(`    context: ${c.context.map(x => JSON.stringify(x)).join(' | ')}`)
  }
  return lines.join('\n')
}

function parseSweep(raw) {
  try {
    const arr = extractJson(raw)
    if (!Array.isArray(arr)) return null
    return arr.filter(x => x && typeof x.ref === 'string' && typeof x.kind === 'string')
  } catch { return null }
}

/** Code-enforced acceptance: vocabulary + in-batch citation or nothing. */
function acceptAnswer(ans, batchRefs) {
  if (!ans || !batchRefs.has(ans.ref)) return null
  if (ans.kind === 'NOISE' && ALLOWED_NOISE.has(String(ans.rule))) return { ref: ans.ref, kind: 'NOISE', rule: String(ans.rule) }
  if (ans.kind === 'FACT' && FACT_KINDS.has(String(ans.entityKind)) && typeof ans.name === 'string' && ans.name.trim() !== '') {
    return { ref: ans.ref, kind: 'FACT', entityKind: String(ans.entityKind), name: ans.name }
  }
  if (ans.kind === 'UNKNOWN') return { ref: ans.ref, kind: 'UNKNOWN' }
  return null // outside the vocabulary — as if unanswered
}

function agreementOf(a, b) {
  if (!a || !b) return null
  if (a.kind !== b.kind) return null
  if (a.kind === 'NOISE') return a.rule === b.rule ? a : null
  if (a.kind === 'FACT') return a.entityKind === b.entityKind ? a : null
  return a // UNKNOWN + UNKNOWN
}

/**
 * Sweep one workbook's unaccounted residue.
 * @param {object} opts
 * @param {Map<string, object>} opts.accounting  sheetName -> SheetAccounting
 * @param {Map<string, object>} opts.censusBySheet sheetName -> SheetCensus
 * @param {object}   opts.budget
 * @param {object[]} opts.review    (mutated)
 * @param {function} [opts.emit]    SSE emit
 * @returns {Promise<{ sweptFacts: object[], unresolvedItems: object[], perSheet: object[] }>}
 *   sweptFacts: [{ sheet, ref, entityKind, name, verbatim }] — cited FACT proposals
 *   unresolvedItems: census_unaccounted plan items
 */
async function sweepUnaccounted({ accounting, censusBySheet, budget, review, emit }) {
  const send = typeof emit === 'function' ? emit : () => {}
  const sweptFacts = []
  const unresolvedItems = []
  const perSheet = []
  if (!(accounting instanceof Map) || accounting.size === 0) return { sweptFacts, unresolvedItems, perSheet }

  let deployBulk = null
  let deployMini = null
  try { deployBulk = resolveAnthropic('BULK_VERIFY', budget) } catch { /* offline */ }
  try { deployMini = resolveOpenAI(fleet.DEPLOY_GPT_MINI, budget) } catch { /* offline */ }

  for (const [sheetName, acc] of accounting) {
    const census = censusBySheet.get(sheetName)
    if (!census || !Array.isArray(census.cells)) continue
    const cellByRef = new Map(census.cells.map(c => [c.ref, c]))
    const unaccounted = []
    for (const [ref, entry] of acc.entries) {
      if (entry.disposition === 'UNACCOUNTED') {
        const cell = cellByRef.get(ref)
        if (cell) unaccounted.push(cell)
      }
    }
    if (unaccounted.length === 0) continue

    // Build batches with 2-row context windows around each cell.
    const rowsOf = new Map()
    for (const c of census.cells) {
      const arr = rowsOf.get(c.row) ?? []
      arr.push(c)
      rowsOf.set(c.row, arr)
    }
    const toBatchCell = (c) => {
      const context = []
      for (let dr = -CONTEXT_ROWS; dr <= CONTEXT_ROWS; dr++) {
        if (dr === 0) continue
        for (const n of rowsOf.get(c.row + dr) ?? []) {
          if (Math.abs(n.col - c.col) <= 2 && context.length < 8) context.push(n.verbatim)
        }
      }
      return { ref: c.ref.split('!')[1] ?? c.ref, fullRef: c.ref, verbatim: c.verbatim, context }
    }

    const toSweep = unaccounted.length > SWEEP_MAX_PER_SHEET ? unaccounted.slice(0, SWEEP_MAX_PER_SHEET) : unaccounted
    let swept = 0
    let reviewed = 0
    for (const c of (unaccounted.length > SWEEP_MAX_PER_SHEET ? unaccounted.slice(SWEEP_MAX_PER_SHEET) : [])) {
      brainShared.post(acc, c.ref, 'NEEDS_REVIEW', 'sweeper', 'sweeper-capped', null, [])
      reviewed++
    }
    const batches = []
    for (let i = 0; i < toSweep.length; i += SWEEP_BATCH) batches.push(toSweep.slice(i, i + SWEEP_BATCH).map(toBatchCell))

    const sweepBatch = async (batch) => {
      const batchRefs = new Set(batch.map(c => c.ref))
      const userPrompt = batchPrompt(sheetName, batch)
      let decisions = new Map() // ref -> accepted answer

      if (deployBulk && deployMini) {
        const [aRaw, bRaw] = await Promise.all([
          parseWithRetry({ call: () => callAnthropic({ deployment: deployBulk, systemPrompt: SWEEPER_SYSTEM, userPrompt, maxTokens: 4096, budget }), parse: parseSweep, review, stage: 'stage4.5', sheetName, what: 'sweeper vote A' }),
          parseWithRetry({ call: () => callOpenAI({ deployment: deployMini, systemPrompt: SWEEPER_SYSTEM, userPrompt, maxTokens: 4096, budget }), parse: parseSweep, review, stage: 'stage4.5', sheetName, what: 'sweeper vote B' }),
        ])
        const aBy = new Map((aRaw || []).map(x => [x.ref, acceptAnswer(x, batchRefs)]))
        const bBy = new Map((bRaw || []).map(x => [x.ref, acceptAnswer(x, batchRefs)]))
        const conflicted = []
        for (const ref of batchRefs) {
          const agreed = agreementOf(aBy.get(ref), bBy.get(ref))
          if (agreed) decisions.set(ref, agreed)
          else if (aBy.get(ref) || bBy.get(ref)) conflicted.push(ref)
        }
        // Disagreement ladders ONCE to sonnet.
        if (conflicted.length > 0) {
          try {
            const deploySonnet = resolveAnthropic('MID_REASONER', budget)
            const subset = batch.filter(c => conflicted.includes(c.ref))
            const cRaw = await parseWithRetry({ call: () => callAnthropic({ deployment: deploySonnet, systemPrompt: SWEEPER_SYSTEM, userPrompt: batchPrompt(sheetName, subset), maxTokens: 4096, budget }), parse: parseSweep, review, stage: 'stage4.5', sheetName, what: 'sweeper ladder (sonnet)' })
            for (const x of cRaw || []) {
              const acc2 = acceptAnswer(x, batchRefs)
              if (acc2 && !decisions.has(acc2.ref)) decisions.set(acc2.ref, acc2)
            }
          } catch { /* ladder unavailable — residue goes to review */ }
        }
      }

      for (const cell of batch) {
        const d = decisions.get(cell.ref)
        if (d && d.kind === 'NOISE') {
          brainShared.post(acc, cell.fullRef, 'NOISE', 'sweeper', d.rule, null, [])
          swept++
        } else if (d && d.kind === 'FACT') {
          brainShared.post(acc, cell.fullRef, 'FACT', 'sweeper', 'sweeper-fact', `${d.entityKind}:${cell.fullRef}`, [cell.fullRef])
          sweptFacts.push({ sheet: sheetName, ref: cell.fullRef, entityKind: d.entityKind, name: d.name, verbatim: cell.verbatim })
          swept++
        } else {
          brainShared.post(acc, cell.fullRef, 'NEEDS_REVIEW', 'sweeper', d ? 'sweeper-unknown' : 'sweeper-unanswered', null, [])
          reviewed++
        }
      }
    }

    await pMap(batches, sweepBatch, 2)

    // Residue + UNKNOWNs become ONE first-class census_unaccounted item per sheet
    // (sheet, refs, verbatim sample, reason) — the plan review queue renders it.
    const needsReview = []
    for (const [ref, entry] of acc.entries) {
      if (entry.disposition === 'NEEDS_REVIEW' && entry.by === 'sweeper') needsReview.push(ref)
    }
    if (needsReview.length > 0) {
      const sample = needsReview.slice(0, 6).map(r => {
        const c = cellByRef.get(r)
        return c ? `${r}=${JSON.stringify(String(c.verbatim).slice(0, 40))}` : r
      })
      unresolvedItems.push({
        section: 'census',
        kind: 'census_unaccounted',
        sheet: sheetName,
        label: `${needsReview.length} unaccounted cell(s) on "${sheetName}"`,
        refs: needsReview.slice(0, 200),
        verbatimSample: sample,
        reason: 'sweeper could not classify these cells into the allowed noise vocabulary or a cited fact — human review required',
        citation: needsReview[0] || '',
      })
    }
    perSheet.push({ sheet: sheetName, unaccounted: unaccounted.length, swept, reviewed })
    send({ t: 'json', key: 'brain:sweeper', value: { sheet: sheetName, swept, reviewed } })
  }

  return { sweptFacts, unresolvedItems, perSheet }
}

module.exports = { sweepUnaccounted, ALLOWED_NOISE, FACT_KINDS, acceptAnswer, agreementOf, SWEEP_BATCH }
