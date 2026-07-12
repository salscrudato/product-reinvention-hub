// tests/import/harness.test.ts — the offline test harness for the format-agnostic importer.
// It runs the pure scorer (shared/src/import/validateAgainstExpected) against the golden
// fixtures (tests/fixtures/import) with PLACEHOLDER producers, proving:
//   1. all eight source workbooks are registered and physically exist in samples/iso/;
//   2. a PERFECT producer scores 1.0 on every axis — which also proves each hand-authored
//      snapshot is internally consistent (no dangling parentId, all enums valid, refIds present);
//   3. a DEGRADED producer is caught on every axis (the judge actually discriminates);
//   4. the per-line rating canaries compute through the REAL evaluator ($1,528 / $2,635 / …);
//   5. refIds match each line's exact refId shape and line inference recovers the line.
// No LLM and no exceljs — a deterministic, gate-safe harness the model-driven pipeline is
// judged against.
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  validateAgainstExpected, inferLob, PH_LOB, GL_LOB, IM_LOB, PR_LOB,
  type HarnessEntity, type LobDefinition,
} from '@pf/shared'
import {
  LINE_EXPECTATIONS, WORKBOOK_FIXTURES, fixturesForLine, type LineExpected,
} from '../fixtures/import'

const REPO_ROOT = process.cwd()
const LOB_FOR_LINE: Record<string, LobDefinition> = { HO: PH_LOB, GL: GL_LOB, IM: IM_LOB, PR: PR_LOB }
// Entities whose refId does NOT follow the line's prefix scheme: forms are keyed by number
// (refId null) and tables use the global "LDTable.NNN"/"RTTable.NNN" scheme.
const LINE_PREFIXED = new Set(['product', 'coverage', 'rule', 'formRule', 'ratingProgram', 'ratingStep'])

// ── placeholder producers ─────────────────────────────────────────────────────
/** A faithful producer: re-emits exactly the expected entities. */
function perfectProducer(x: LineExpected): HarnessEntity[] {
  return x.snapshot.entities.map(e => ({ ...e, fields: e.fields ? { ...e.fields } : undefined }))
}
/** A deliberately broken producer: mangles a refId, orphans a sub-coverage, drops a form,
 *  invents a ghost rule, and emits a bad enum — one defect per metric axis. */
function degradedProducer(x: LineExpected): HarnessEntity[] {
  const out = perfectProducer(x)
  const cov = out.find(e => e.entityType === 'coverage')!
  cov.refId = `${cov.refId}X`                                   // refId-exactness ↓
  if (cov.fields) cov.fields['requirement'] = 'BOGUS_ENUM'      // enum violation
  const sub = out.find(e => e.entityType === 'coverage' && e.parentRefId != null)
  if (sub) sub.parentRefId = 'ZZ.NONEXISTENT'                    // orphan
  const formIdx = out.findIndex(e => e.entityType === 'form')
  if (formIdx >= 0) out.splice(formIdx, 1)                       // recall ↓ + silent drop
  out.push({ entityType: 'rule', key: 'rule:__ghost__', refId: 'GL.RU.999', fields: { category: 'PRODUCT' } }) // precision ↓
  return out
}

// ─── 1. registration of the eight workbooks ────────────────────────────────────
describe('importer harness — workbook registration', () => {
  it('registers exactly eight source workbooks across GL / IM / PR', () => {
    expect(WORKBOOK_FIXTURES).toHaveLength(8)
    expect(fixturesForLine('GL')).toHaveLength(4)
    expect(fixturesForLine('IM')).toHaveLength(2)
    expect(fixturesForLine('PR')).toHaveLength(2)
  })

  it('all eight workbooks are marked presentInRepo and physically exist in samples/iso/', () => {
    for (const wb of WORKBOOK_FIXTURES) {
      expect(wb.presentInRepo, `${wb.id} should be presentInRepo`).toBe(true)
      for (const f of wb.files) {
        expect(fs.existsSync(path.join(REPO_ROOT, f)), `${f} should exist`).toBe(true)
      }
    }
  })

  it('records the cross-source sheet-name variance the pipeline must survive', () => {
    const gl = WORKBOOK_FIXTURES.find(w => w.id === 'gl-framework')!
    expect(gl.sheetNames).toContain('GL Product Framework')
    const im = WORKBOOK_FIXTURES.find(w => w.id === 'im-framework')!
    expect(im.sheetNames).toContain('Product Component Model')   // ≠ "GL Product Framework"
    const pr = WORKBOOK_FIXTURES.find(w => w.id === 'pr-rating')!
    expect(pr.sheetNames).toEqual(expect.arrayContaining(['PROPERTY ROC', 'ROC']))
  })
})

// ─── 2. perfect producer → snapshots are internally consistent ──────────────────
describe('importer harness — perfect producer scores 1.0 (snapshots are self-consistent)', () => {
  for (const x of LINE_EXPECTATIONS) {
    it(`${x.line}: F1=1, refId-exactness=100%, 0 orphans, 100% enum, 0 drops`, () => {
      const r = validateAgainstExpected(perfectProducer(x), x.snapshot)
      expect(r.overall).toMatchObject({ precision: 1, recall: 1, f1: 1 })
      expect(r.refIdExactnessPct).toBe(100)
      expect(r.parentIdOrphans).toBe(0)
      expect(r.enumConformancePct).toBe(100)
      expect(r.silentDrops).toBe(0)
      // The snapshot carries a real refId to check (every seeded/authored line has ≥1).
      expect(r.refIdChecked).toBeGreaterThan(0)
    })
  }
})

// ─── 3. degraded producer → the judge discriminates ─────────────────────────────
describe('importer harness — degraded producer is caught on every axis', () => {
  for (const x of LINE_EXPECTATIONS) {
    it(`${x.line}: recall<1, precision<1, refId<100%, orphan≥1, enum viol, drop≥1`, () => {
      const r = validateAgainstExpected(degradedProducer(x), x.snapshot)
      expect(r.overall.recall).toBeLessThan(1)
      expect(r.overall.precision).toBeLessThan(1)
      expect(r.refIdExactnessPct).toBeLessThan(100)
      expect(r.parentIdOrphans).toBeGreaterThanOrEqual(1)
      expect(r.enumViolations.length).toBeGreaterThanOrEqual(1)
      expect(r.silentDrops).toBeGreaterThanOrEqual(1)
    })
  }
})

// ─── 4. rating canaries compute through the REAL evaluator ──────────────────────
describe('importer harness — per-line rating canaries', () => {
  it('HO = $1,528 and GL = $2,635 (byte-for-byte, via the seed programs)', () => {
    const ho = LINE_EXPECTATIONS.find(x => x.line === 'HO')!
    const gl = LINE_EXPECTATIONS.find(x => x.line === 'GL')!
    expect(ho.ratingCanary.run()).toBe(1528)
    expect(ho.ratingCanary.expectedPremium).toBe(1528)
    expect(gl.ratingCanary.run()).toBe(2635)
    expect(gl.ratingCanary.expectedPremium).toBe(2635)
  })

  it('IM + PR authored programs price through the real evaluator', () => {
    for (const line of ['IM', 'PR'] as const) {
      const x = LINE_EXPECTATIONS.find(e => e.line === line)!
      expect(x.ratingCanary.run()).toBe(x.ratingCanary.expectedPremium)
    }
  })
})

// ─── 5. refId shapes + line inference from a snapshot's own content ──────────────
describe('importer harness — refId shapes + line inference', () => {
  for (const x of LINE_EXPECTATIONS) {
    it(`${x.line}: line-prefixed refIds match the line's exact refId shape`, () => {
      const lob = LOB_FOR_LINE[x.line]!
      for (const e of x.snapshot.entities) {
        if (e.refId != null && LINE_PREFIXED.has(e.entityType)) {
          expect(lob.refIdScheme.pattern.test(e.refId), `${e.refId} vs ${lob.prefix} shape`).toBe(true)
        }
      }
    })

    it(`${x.line}: every sub-coverage parentId resolves within the snapshot`, () => {
      const covRefIds = new Set(
        x.snapshot.entities.filter(e => e.entityType === 'coverage' && e.refId).map(e => e.refId),
      )
      for (const e of x.snapshot.entities) {
        if (e.entityType === 'coverage' && e.parentRefId != null) {
          expect(covRefIds.has(e.parentRefId), `${e.refId} parent ${e.parentRefId} missing`).toBe(true)
        }
      }
    })

    it(`${x.line}: inferLob recovers the line from the snapshot's own refIds`, () => {
      const refIds = x.snapshot.entities.map(e => e.refId)
      expect(inferLob({ refIds })).toBe(LOB_FOR_LINE[x.line])
    })
  }

  it('preserves the load-bearing refIds + form numbers verbatim (incl. the prompt examples)', () => {
    const all = LINE_EXPECTATIONS.flatMap(x => x.snapshot.entities)
    const refIds = new Set(all.map(e => e.refId))
    for (const id of ['GL.COV.004.009', 'IM.COV044.00', 'IM.RL.001', 'PR.COV001.0']) {
      expect(refIds.has(id), `refId ${id} preserved`).toBe(true)
    }
    const formKeys = new Set(all.filter(e => e.entityType === 'form').map(e => e.key))
    for (const num of ['form:CG 00 01', 'form:HO 00 03', 'form:CP 00 10']) {
      expect(formKeys.has(num), `form number in ${num} preserved (spaces intact)`).toBe(true)
    }
  })
})
