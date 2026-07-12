// functions/src/import/brain/stage2_headerLock.ts — Header/region lock.
//
// Strategy (in priority order):
//   1. Fingerprinter confidence: if the top HeaderCandidate score > 0.80 → use it directly.
//   2. AI fallback: if ambiguous (score ≤ 0.80) or bestHeaderRow=-1 → REASONER_A picks.
//   3. STACKED_TABLES: each sub-table gets its own header lock from the SubTable descriptor.
//   4. If AI also fails → isConfirmed=false (human review required).
//
// No heavy model calls for sheets with clear fingerprints; AI is reserved for ambiguous cases.

import type { SheetFingerprint } from '@pf/shared'
import type { RoutingBudget } from '../../ai/router'
import { BRAIN_REASONER_A, extractFieldsWithRole } from '../../ai/router'
import { STAGE2_HEADER_SYSTEM } from './prompts'
import type { ClassifiedSheet, HeaderLock, ReviewItem } from './types'
import { extractJson } from './types'

// ─── AI response shape ────────────────────────────────────────────────────────

interface HeaderResponse {
  headerRowIndex: number
  isConfirmed:    boolean
  rationale:      string
}

function parseHeaderResponse(raw: string): HeaderResponse | null {
  try {
    const obj = extractJson(raw) as Record<string, unknown>
    return {
      headerRowIndex: Number(obj['headerRowIndex'] ?? -1),
      isConfirmed:    Boolean(obj['isConfirmed'] ?? false),
      rationale:      String(obj['rationale'] ?? ''),
    }
  } catch { return null }
}

// ─── AI fallback user prompt ───────────────────────────────────────────────────

function buildHeaderUser(fp: SheetFingerprint): string {
  const candidates = fp.headerCandidates.map((c, i) =>
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

export async function lockHeaders(
  classified: ClassifiedSheet[],
  fpByName:   Map<string, SheetFingerprint>,
  budget:     RoutingBudget,
  review:     ReviewItem[],
): Promise<HeaderLock[]> {
  const locks: HeaderLock[] = []
  const CONFIDENCE_FAST = 0.80

  const contentSheets = classified.filter(c => c.domain !== 'ignore')

  for (const sheet of contentSheets) {
    const fp = fpByName.get(sheet.sheetName)
    if (!fp) continue

    // STACKED_TABLES: lock per sub-table using the fingerprinter's sub-table data
    if (fp.layoutShape === 'STACKED_TABLES' && fp.subTables && fp.subTables.length > 0) {
      for (const sub of fp.subTables) {
        locks.push({
          sheetName:      `${fp.sheetName}::${sub.name}`,
          headerRowIndex: sub.headerRowIndex,
          layoutShape:    'STACKED_TABLES',
          columnCount:    sub.columnProfiles.length,
          isConfirmed:    true,
        })
      }
      continue
    }

    // Fast path: top candidate score exceeds the confidence threshold
    const topCandidate = fp.headerCandidates[0]
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

    // AI fallback: REASONER_A picks the header
    const result = await extractFieldsWithRole(BRAIN_REASONER_A, {
      systemPrompt: STAGE2_HEADER_SYSTEM,
      userPrompt:   buildHeaderUser(fp),
      maxTokens:    256,
    }, budget)

    const parsed = parseHeaderResponse(result.raw)

    if (!parsed || parsed.headerRowIndex < 0) {
      locks.push({
        sheetName:      fp.sheetName,
        headerRowIndex: fp.bestHeaderRow >= 0 ? fp.bestHeaderRow : -1,
        layoutShape:    fp.layoutShape,
        columnCount:    fp.dataColCount,
        isConfirmed:    false,
      })
      review.push({
        kind:      'ungrounded',
        sheetName: fp.sheetName,
        detail:    'Could not confirm header row; human review required.',
      })
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
      review.push({
        kind:      'ungrounded',
        sheetName: fp.sheetName,
        detail:    `Header lock unconfirmed: ${parsed.rationale}`,
      })
    }
  }

  return locks
}
