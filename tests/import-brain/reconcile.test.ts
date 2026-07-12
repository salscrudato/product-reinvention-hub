// tests/import-brain/reconcile.test.ts
// Unit tests for stage6-reconcile.js (server CJS port of stage6_reconcile.ts).
// Pure function — no AI calls, no I/O; matches functions/ reference tests.

import { describe, it, expect } from 'vitest'

// Require the CJS server module directly (vitest runs in Node and handles require).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { reconcileOutput } = require('../../server/lib/import-brain/stage6-reconcile.js')

// ─── Fixture builders ──────────────────────────────────────────────────────────

function entity(overallConfidence: number, reviewFlag: boolean) {
  return { kind: 'coverage', fields: [], overallConfidence, sourceSheet: 'GL Framework', sourceRowIndex: 1, reviewFlag, needsRefIdSynthesis: false }
}

function sheet(domain: string) {
  return { sheetName: `${domain}-sheet`, domain, confidence: 1.0, rationale: 'test', disagreed: false, humanFlagNeeded: false }
}

function columnMap(totalCols: number, mappedCols: number) {
  return {
    sheetName: 'test-sheet',
    mappings: Array.from({ length: totalCols }, (_, i) => ({
      colIndex: i, headerLabel: `Col${i}`,
      canonicalField: i < mappedCols ? `field${i}` : null,
      entityKind: null, confidence: 0.9, citation: null, disagreed: false, needsReview: false,
    })),
    unmappedIndices: Array.from({ length: totalCols - mappedCols }, (_, i) => i + mappedCols),
  }
}

const LOCK = { sheetName: 'GL Framework', headerRowIndex: 0, layoutShape: 'FLAT_TABLE', columnCount: 5, isConfirmed: true }
const REVIEW_ITEM = { kind: 'low-confidence-map', sheetName: 'GL Framework', detail: 'coverage.name: confidence 0.6' }
const DISCREPANCY = { kind: 'orphan-coverage', detail: 'GL.COV.004.009 has no parent GL.COV.004' }

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('reconcileOutput (stage 6 — server CJS port)', () => {
  it('passes all inputs through unchanged', () => {
    const entities = [entity(0.9, false), entity(0.7, true)]
    const sheets = [sheet('product-framework'), sheet('forms'), sheet('ignore')]
    const locks = [LOCK]
    const maps = [columnMap(5, 3)]
    const queue = [REVIEW_ITEM]
    const discrepancies = [DISCREPANCY]
    const out = reconcileOutput(entities, sheets, locks, maps, queue, discrepancies)
    expect(out.entities).toBe(entities)
    expect(out.classifiedSheets).toBe(sheets)
    expect(out.headerLocks).toBe(locks)
    expect(out.columnMaps).toBe(maps)
    expect(out.reviewQueue).toBe(queue)
    expect(out.validationDiscrepancies).toBe(discrepancies)
  })

  it('derives perEntityConfidence from entities.overallConfidence', () => {
    const entities = [entity(0.95, false), entity(0.72, false), entity(0.50, true)]
    const out = reconcileOutput(entities, [], [], [], [], [])
    expect(out.perEntityConfidence).toEqual([0.95, 0.72, 0.50])
  })

  it('summaryCounts: sheet totals', () => {
    const sheets = [sheet('product-framework'), sheet('forms'), sheet('ignore'), sheet('ignore')]
    const { summaryCounts: s } = reconcileOutput([], sheets, [], [], [], [])
    expect(s.sheetsTotal).toBe(4)
    expect(s.sheetsClassified).toBe(2)
    expect(s.sheetsIgnored).toBe(2)
  })

  it('summaryCounts: column totals across multiple maps', () => {
    const maps = [columnMap(4, 3), columnMap(6, 5)]
    const { summaryCounts: s } = reconcileOutput([], [], [], maps, [], [])
    expect(s.columnsTotal).toBe(10)
    expect(s.columnsMapped).toBe(8)
    expect(s.columnsUnmapped).toBe(2)
  })

  it('summaryCounts: row and entity totals', () => {
    const entities = [entity(0.9, false), entity(0.8, true), entity(0.7, true)]
    const { summaryCounts: s } = reconcileOutput(entities, [], [], [], [], [])
    expect(s.rowsExtracted).toBe(3)
    expect(s.rowsInReview).toBe(2)
    expect(s.entitiesProduced).toBe(3)
  })

  it('summaryCounts: validatorDiscrepancies count', () => {
    const disc = [DISCREPANCY, DISCREPANCY, DISCREPANCY]
    const { summaryCounts: s } = reconcileOutput([], [], [], [], [], disc)
    expect(s.validatorDiscrepancies).toBe(3)
  })

  it('summaryCounts: all-zero on empty inputs', () => {
    const { summaryCounts: s } = reconcileOutput([], [], [], [], [], [])
    expect(s).toEqual({
      sheetsTotal: 0, sheetsClassified: 0, sheetsIgnored: 0,
      columnsTotal: 0, columnsMapped: 0, columnsUnmapped: 0,
      rowsExtracted: 0, rowsInReview: 0,
      validatorDiscrepancies: 0, entitiesProduced: 0,
    })
  })

  it('columnsUnmapped = columnsTotal - columnsMapped invariant', () => {
    const maps = [columnMap(8, 6), columnMap(3, 0), columnMap(5, 5)]
    const { summaryCounts: s } = reconcileOutput([], [], [], maps, [], [])
    expect(s.columnsUnmapped).toBe(s.columnsTotal - s.columnsMapped)
  })

  it('entitiesProduced equals entities.length', () => {
    const entities = Array.from({ length: 12 }, (_, i) => entity(0.8 + i * 0.01, i % 3 === 0))
    const { summaryCounts: s } = reconcileOutput(entities, [], [], [], [], [])
    expect(s.entitiesProduced).toBe(entities.length)
    expect(s.rowsExtracted).toBe(entities.length)
  })
})
