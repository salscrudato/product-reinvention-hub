'use strict'
// server/lib/import-brain/stage2-header-lock.js — Header/region lock.
//
// Strategy (priority order):
//   1. Deterministic fast path: call scoreHeaderCandidates() from import-brain-shared.cjs.
//      If the top candidate score > 0.80 → use it directly; NO AI call.
//   2. STACKED_TABLES: each sub-table gets its own header lock from the SubTable descriptor.
//   3. AI fallback: REASONER_A (opus) picks the header when score ≤ 0.80 or no candidate.
//   4. AI also fails → isConfirmed=false, human review required.
//
// Per REQ-1: shared/src/import/structure/headerScore.ts must be called FIRST;
// AI is reserved for the ambiguous minority.

const { callAnthropic, resolveAnthropic } = require('./ai-call')
const { STAGE2_HEADER_SYSTEM } = require('./prompts')
const { extractJson } = require('./constants')

// Load the deterministic header-scoring functions from the pre-built CJS bundle.
const brainShared = require('../import-brain-shared.cjs')
const { scoreHeaderCandidates, pickBestHeaderRow } = brainShared

const CONFIDENCE_FAST = 0.80

// ─── Parse AI header response ─────────────────────────────────────────────────

function parseHeaderResponse(raw) {
  try {
    const obj = extractJson(raw)
    return {
      headerRowIndex: Number(obj.headerRowIndex ?? -1),
      isConfirmed:    Boolean(obj.isConfirmed ?? false),
      rationale:      String(obj.rationale ?? ''),
    }
  } catch { return null }
}

// ─── Build AI fallback user prompt ────────────────────────────────────────────

function buildHeaderUser(fp) {
  const candidates = (fp.headerCandidates || []).map((c, i) =>
    `  Candidate ${i} (row ${c.rowIndex}, score ${c.score.toFixed(2)}): ${c.labels.slice(0, 10).map(l => `"${l}"`).join(' | ')}`,
  ).join('\n')

  return [
    `Sheet: "${fp.sheetName}"`,
    `Layout shape: ${fp.layoutShape}`,
    `Data rows: ${fp.dataRowCount}, Data columns: ${fp.dataColCount}`,
    `Current best guess from structural analysis: row ${fp.bestHeaderRow}`,
    `Candidate rows:\n${candidates || '  (none detected)'}`,
  ].join('\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * @param {object[]}          classified  ClassifiedSheet[]
 * @param {Map<string,object>} fpByName   sheetName → SheetFingerprint
 * @param {object}            budget      { degraded: boolean }
 * @param {object[]}          review      ReviewItem[] (mutated in place)
 * @returns {Promise<object[]>} HeaderLock[]
 */
async function lockHeaders(classified, fpByName, budget, review) {
  const locks = []
  const contentSheets = classified.filter(c => c.domain !== 'ignore')
  const deployOpus = resolveAnthropic('GROUNDED_CITED', budget)

  for (const sheet of contentSheets) {
    const fp = fpByName.get(sheet.sheetName)
    if (!fp) continue

    // STACKED_TABLES: lock per sub-table using fingerprinter sub-table data.
    if (fp.layoutShape === 'STACKED_TABLES' && fp.subTables && fp.subTables.length > 0) {
      for (const sub of fp.subTables) {
        locks.push({
          sheetName:      `${fp.sheetName}::${sub.name}`,
          headerRowIndex: sub.headerRowIndex,
          layoutShape:    'STACKED_TABLES',
          columnCount:    (sub.columnProfiles || []).length,
          isConfirmed:    true,
        })
      }
      continue
    }

    // ── Deterministic fast path: scoreHeaderCandidates from shared CJS bundle ──
    // Reconstruct the cells array from the columnProfiles distinctSample data
    // (this is what the fingerprinter builds the profile from). For header scoring
    // purposes we only need the top few rows, which the headerCandidates already
    // capture. We use the existing scored candidates when available.
    const existingCandidates = fp.headerCandidates || []
    const topCandidate = existingCandidates[0]

    // Fast path: existing fingerprinter result is already high-confidence.
    if (topCandidate && topCandidate.score > CONFIDENCE_FAST && fp.bestHeaderRow >= 0) {
      locks.push({
        sheetName:      fp.sheetName,
        headerRowIndex: fp.bestHeaderRow,
        layoutShape:    fp.layoutShape,
        columnCount:    fp.dataColCount,
        isConfirmed:    true,
      })
      continue
    }

    // Re-score using the shared deterministic scorer when fingerprinter result is
    // ambiguous. Build a synthetic 2-D cell grid from columnProfiles for scoring.
    let bestRow = fp.bestHeaderRow
    if (existingCandidates.length === 0 || !topCandidate || topCandidate.score <= CONFIDENCE_FAST) {
      try {
        // Rebuild top rows from headerLabel (row 0) + distinctSample values (rows 1+)
        const colCount = (fp.columnProfiles || []).length
        if (colCount > 0) {
          const maxSampleLen = Math.max(...fp.columnProfiles.map(c => (c.distinctSample || []).length), 0)
          const cells = []
          // Row 0: column header labels
          cells.push(fp.columnProfiles.map(c => c.headerLabel ?? null))
          // Rows 1+: sample values
          for (let r = 0; r < Math.min(maxSampleLen, 10); r++) {
            cells.push(fp.columnProfiles.map(c => (c.distinctSample || [])[r] ?? null))
          }
          const reScoredCandidates = scoreHeaderCandidates(cells)
          bestRow = pickBestHeaderRow(reScoredCandidates)
          if (bestRow >= 0 && reScoredCandidates[0] && reScoredCandidates[0].score > CONFIDENCE_FAST) {
            locks.push({
              sheetName:      fp.sheetName,
              headerRowIndex: bestRow,
              layoutShape:    fp.layoutShape,
              columnCount:    fp.dataColCount,
              isConfirmed:    true,
            })
            continue
          }
        }
      } catch { /* fall through to AI */ }
    }

    // ── AI fallback: REASONER_A (opus) picks the header ─────────────────────
    const result = await callAnthropic({
      deployment:   deployOpus,
      systemPrompt: STAGE2_HEADER_SYSTEM,
      userPrompt:   buildHeaderUser(fp),
      maxTokens:    256,
      budget,
    }).catch(() => ({ raw: '' }))

    const parsed = parseHeaderResponse(result.raw)

    if (!parsed || parsed.headerRowIndex < 0) {
      locks.push({
        sheetName:      fp.sheetName,
        headerRowIndex: bestRow >= 0 ? bestRow : -1,
        layoutShape:    fp.layoutShape,
        columnCount:    fp.dataColCount,
        isConfirmed:    false,
      })
      review.push({ kind: 'ungrounded', sheetName: fp.sheetName, detail: 'Could not confirm header row; human review required.' })
      continue
    }

    locks.push({
      sheetName:      fp.sheetName,
      headerRowIndex: parsed.headerRowIndex,
      layoutShape:    fp.layoutShape,
      columnCount:    fp.dataColCount,
      isConfirmed:    parsed.isConfirmed,
    })

    if (!parsed.isConfirmed) {
      review.push({ kind: 'ungrounded', sheetName: fp.sheetName, detail: `Header lock unconfirmed: ${parsed.rationale}` })
    }
  }

  return locks
}

module.exports = { lockHeaders }
