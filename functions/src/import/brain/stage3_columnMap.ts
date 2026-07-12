// functions/src/import/brain/stage3_columnMap.ts — Column → field mapping.
//
// For each content sheet (domain ≠ 'ignore', header confirmed):
//   1. Build a compact canonical dictionary limited to entity kinds plausible for this domain.
//   2. REASONER_A and REASONER_B map columns independently.
//   3. Reconcile: per-column, if both agree → accept at avg confidence; disagree → lower
//      confidence or route to review queue; unmapped by both → unmapped queue.
//   4. Low-confidence mappings (< CONFIDENCE_REVIEW) → review queue.
//   5. Columns in SURFACED_COLUMNS that are unmapped → surface in review (never silently drop).
//
// All AI calls are server-side.

import { CANONICAL_MAP, SURFACED_COLUMNS, type CanonicalEntityKind } from '@pf/shared'
import type { SheetFingerprint, ColumnProfile } from '@pf/shared'
import type { RoutingBudget } from '../../ai/router'
import { BRAIN_REASONER_A, BRAIN_REASONER_B, extractFieldsWithRole } from '../../ai/router'
import { STAGE3_MAP_SYSTEM } from './prompts'
import type {
  ClassifiedSheet, HeaderLock, SheetColumnMap, ColumnMappingEntry, BrainCitation, ReviewItem,
} from './types'
import { extractJson, DOMAIN_ENTITY_KINDS, CONFIDENCE_REVIEW, colLetter } from './types'

// ─── Canonical dictionary builder ────────────────────────────────────────────
// Produces a compact JSON string describing the fields relevant to a domain.

function buildDomainDictionary(kinds: CanonicalEntityKind[]): string {
  if (kinds.length === 0) return '(No entity kinds for this domain.)'

  const entries = kinds.flatMap(kind => {
    const def = CANONICAL_MAP[kind]
    return def.fields
      .filter(f => f.role !== 'system' && f.role !== 'derived')
      .map(f => ({
        entityKind:     kind,
        field:          f.field,
        type:           f.type,
        description:    f.description,
        aliases:        f.aliases,
        enumValues:     f.enumValues,
        ambiguous:      f.ambiguous ?? false,
        examples:       f.examples.slice(0, 2),
      }))
  })

  return JSON.stringify(entries, null, 2)
}

// ─── Column metadata serialiser ───────────────────────────────────────────────

function serialiseColumns(
  fp:            SheetFingerprint,
  headerRow:     number,
  sheetName:     string,
): string {
  const colLines = fp.columnProfiles.map(col => {
    const headerCell = `${colLetter(col.colIndex)}${headerRow + 1}`
    const samples = col.distinctSample
      .slice(0, 5)
      .map(v => JSON.stringify(v))
      .join(', ')
    return [
      `Column ${col.colIndex} (${colLetter(col.colIndex)}):`,
      `  Header (${sheetName}!${headerCell}): ${col.headerLabel ? `"${col.headerLabel}"` : '(none)'}`,
      `  Type mix: ${JSON.stringify(col.typeMix)}`,
      `  Sample values: ${samples || '(empty)'}`,
      col.isEnumLike ? `  Appears enum-like (${col.distinctSample.length} distinct values)` : '',
    ].filter(Boolean).join('\n')
  })
  return colLines.join('\n\n')
}

// ─── AI response shape ────────────────────────────────────────────────────────

interface RawMappingEntry {
  colIndex:       number
  canonicalField: string | null
  entityKind:     string | null
  confidence:     number
  citation:       { sheet: string; cell: string; verbatim: string } | null
  needsReview:    boolean
}

function parseMappings(raw: string): RawMappingEntry[] | null {
  try {
    const arr = extractJson(raw) as unknown[]
    if (!Array.isArray(arr)) return null
    return arr.map((item): RawMappingEntry => {
      const o = item as Record<string, unknown>
      const citation = o['citation'] as Record<string, string> | null
      return {
        colIndex:       Number(o['colIndex'] ?? 0),
        canonicalField: (o['canonicalField'] as string | null) ?? null,
        entityKind:     (o['entityKind'] as string | null) ?? null,
        confidence:     Number(o['confidence'] ?? 0),
        citation:       citation
          ? { sheet: citation['sheet'] ?? '', cell: citation['cell'] ?? '', verbatim: citation['verbatim'] ?? '' }
          : null,
        needsReview:    Boolean(o['needsReview'] ?? false),
      }
    })
  } catch { return null }
}

// ─── Reconcile two mapping arrays for a single sheet ─────────────────────────

function reconcileMappings(
  colProfiles: ColumnProfile[],
  aArr:        RawMappingEntry[] | null,
  bArr:        RawMappingEntry[] | null,
  sheetName:   string,
  review:      ReviewItem[],
): ColumnMappingEntry[] {
  const surfacedLabels = new Set(SURFACED_COLUMNS.map(s => s.column.toUpperCase()))

  // Index by colIndex for O(1) lookup
  const aMap = new Map<number, RawMappingEntry>()
  const bMap = new Map<number, RawMappingEntry>()
  for (const e of aArr ?? []) aMap.set(e.colIndex, e)
  for (const e of bArr ?? []) bMap.set(e.colIndex, e)

  return colProfiles.map(col => {
    const a = aMap.get(col.colIndex) ?? null
    const b = bMap.get(col.colIndex) ?? null

    // Both models failed for this column
    if (!a && !b) {
      const isSurfaced = col.headerLabel && surfacedLabels.has(col.headerLabel.toUpperCase())
      if (isSurfaced) {
        review.push({
          kind: 'unmapped-column', sheetName,
          colIndex: col.colIndex, colLabel: col.headerLabel ?? undefined,
          detail: `Surfaced column "${col.headerLabel}" could not be mapped.`,
        })
      }
      return {
        colIndex: col.colIndex, headerLabel: col.headerLabel,
        canonicalField: null, entityKind: null,
        confidence: 0, citation: null,
        disagreed: false, needsReview: true,
      }
    }

    // Only one model responded
    if (!a || !b) {
      const winner = a ?? b!
      const entry = toEntry(col, winner, sheetName, false)
      if (entry.confidence < CONFIDENCE_REVIEW) {
        review.push({
          kind: 'low-confidence-map', sheetName,
          colIndex: col.colIndex, colLabel: col.headerLabel ?? undefined,
          detail: `Single-model mapping "${winner.canonicalField ?? 'null'}" at confidence ${winner.confidence.toFixed(2)}.`,
        })
        entry.needsReview = true
      }
      return entry
    }

    // Both agree on field
    if (a.canonicalField === b.canonicalField) {
      const avgConf = (a.confidence + b.confidence) / 2
      const entry = toEntry(col, a.confidence >= b.confidence ? a : b, sheetName, false)
      entry.confidence = avgConf
      entry.reasonerAField = a.canonicalField ?? undefined
      entry.reasonerBField = b.canonicalField ?? undefined
      if (avgConf < CONFIDENCE_REVIEW && a.canonicalField !== null) {
        review.push({
          kind: 'low-confidence-map', sheetName,
          colIndex: col.colIndex, colLabel: col.headerLabel ?? undefined,
          detail: `Both agreed on "${a.canonicalField}" but avg confidence is low (${avgConf.toFixed(2)}).`,
        })
        entry.needsReview = true
      }
      return entry
    }

    // Disagreement — lower confidence, route to review
    const avgConf = (a.confidence + b.confidence) / 2 * 0.7
    const citation: BrainCitation | null =
      a.citation ? { sheet: a.citation.sheet, cell: a.citation.cell, verbatim: a.citation.verbatim }
      : b.citation ? { sheet: b.citation.sheet, cell: b.citation.cell, verbatim: b.citation.verbatim }
      : null

    review.push({
      kind: 'disagreement', sheetName,
      colIndex: col.colIndex, colLabel: col.headerLabel ?? undefined,
      detail: `Reasoner A mapped to "${a.canonicalField ?? 'unmapped'}", Reasoner B mapped to "${b.canonicalField ?? 'unmapped'}".`,
    })

    return {
      colIndex:       col.colIndex,
      headerLabel:    col.headerLabel,
      canonicalField: a.confidence >= b.confidence ? a.canonicalField : b.canonicalField,
      entityKind:     a.confidence >= b.confidence
        ? (a.entityKind as CanonicalEntityKind | null)
        : (b.entityKind as CanonicalEntityKind | null),
      confidence:     avgConf,
      citation,
      reasonerAField: a.canonicalField ?? undefined,
      reasonerBField: b.canonicalField ?? undefined,
      disagreed:      true,
      needsReview:    true,
    }
  })
}

function toEntry(
  col:       ColumnProfile,
  raw:       RawMappingEntry,
  _sheet:    string,
  disagreed: boolean,
): ColumnMappingEntry {
  const citation: BrainCitation | null = raw.citation
    ? { sheet: raw.citation.sheet, cell: raw.citation.cell, verbatim: raw.citation.verbatim }
    : null

  return {
    colIndex:       col.colIndex,
    headerLabel:    col.headerLabel,
    canonicalField: raw.canonicalField,
    entityKind:     raw.entityKind as CanonicalEntityKind | null,
    confidence:     raw.confidence,
    citation,
    disagreed,
    needsReview:    raw.needsReview || raw.canonicalField === null,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function mapColumns(
  classified: ClassifiedSheet[],
  locks:      HeaderLock[],
  fpByName:   Map<string, SheetFingerprint>,
  budget:     RoutingBudget,
  review:     ReviewItem[],
): Promise<SheetColumnMap[]> {
  const maps: SheetColumnMap[] = []

  // Index locks by sheetName for quick lookup
  const lockMap = new Map<string, HeaderLock>()
  for (const lock of locks) lockMap.set(lock.sheetName, lock)

  const contentSheets = classified.filter(c => c.domain !== 'ignore' && c.domain !== 'definitions')

  for (const sheet of contentSheets) {
    const lock = lockMap.get(sheet.sheetName)
    const fp   = fpByName.get(sheet.sheetName)
    if (!fp || !lock) continue

    // Skip sub-table pseudo-sheets (stacked) — they share the parent fp
    if (sheet.sheetName.includes('::')) continue

    const entityKinds = DOMAIN_ENTITY_KINDS[sheet.domain]
    const dictionary  = buildDomainDictionary(entityKinds)
    const colMeta     = serialiseColumns(fp, lock.headerRowIndex, fp.sheetName)

    const systemPrompt = STAGE3_MAP_SYSTEM
    const userPrompt   = [
      `Sheet: "${fp.sheetName}" | Domain: "${sheet.domain}"`,
      `Definitions from this workbook:\n${
        Object.entries(fp.definitions ?? [])
          .slice(0, 10)
          .map(([, d]) => (d as { columnName: string; description: string }).columnName)
          .join(', ') || '(none)'
      }`,
      `\nCanonical field dictionary for this domain:\n${dictionary}`,
      `\nColumns to map:\n${colMeta}`,
    ].join('\n')

    // REASONER_A and REASONER_B map independently
    const [rAResult, rBResult] = await Promise.all([
      extractFieldsWithRole(BRAIN_REASONER_A, { systemPrompt, userPrompt, maxTokens: 2048 }, budget),
      extractFieldsWithRole(BRAIN_REASONER_B, { systemPrompt, userPrompt, maxTokens: 2048 }, budget),
    ])

    const aArr = parseMappings(rAResult.raw)
    const bArr = parseMappings(rBResult.raw)

    const mappings    = reconcileMappings(fp.columnProfiles, aArr, bArr, fp.sheetName, review)
    const unmappedIdx = mappings.filter(m => m.canonicalField === null).map(m => m.colIndex)

    maps.push({ sheetName: fp.sheetName, mappings, unmappedIndices: unmappedIdx })
  }

  return maps
}
