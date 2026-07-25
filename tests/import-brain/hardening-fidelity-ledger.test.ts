/**
 * hardening-fidelity-ledger.test.ts — regression lock for the extraction-fidelity ledger.
 *
 * The meta-finding of that review was that EVERY load-bearing faithful-extraction transform
 * it flagged was unlocked: the forward-fill / join / conservation / provenance rules the
 * platform relies on had no test pinning them, so each defect could regress silently (and a
 * few existing tests passed for the wrong reason). This file locks the server-side half.
 *
 * One describe per defect, each written to FAIL on the pre-fix code:
 *   #1  stage 5  — an omitted citation (backfilled as cell:'') skipped the strict byte-compare
 *   #3  stage 7  — mapper formNumbers:[] clobbered the brain's cited form numbers
 *   #4  stage 7  — "Inactive - No Longer in Use" fell through the fold, then defaulted ACTIVE
 *   #5  stage 7  — source='BUREAU' inferred from proprietaryFlag===false (and from blank)
 *   #11 stage 7  — duplicate refIds collapsed onto one docId
 *   #14 stage 7  — mapper's hardcoded status clobbered a cited INACTIVE
 *   #17 stage 7  — one sweeper-nominated coverage flipped the framework pillar
 *   #8  stage 0  — CSV parsed with split(','), shifting every cell after a quoted comma
 *   #19 stage 4.5— a FACT name was never held against the cell it cites
 *   #7  router   — sub-threshold workbooks vanished on a multi-product split
 */
import { describe, it, expect } from 'vitest'

// unified-import pulls in the auth chain at require time (same convention as the other
// server-side hardening tests).
process.env.AUTH_JWT_SECRET ??= 'test-secret-fidelity-ledger-minimum-32chars'

/* eslint-disable @typescript-eslint/no-require-imports */
const { resolveCitationsDeterministic } = require('../../server/lib/import-brain/stage5-validate.js')
const { buildImportPlan } = require('../../server/lib/import-brain/stage7-plan.js')
const { parseCsv } = require('../../server/lib/import-brain/stage0-router.js')
const { acceptAnswer } = require('../../server/lib/import-brain/stage45-sweeper.js')
const { partitionWorkbooks } = require('../../server/lib/ai/unified-import.js')
/* eslint-enable @typescript-eslint/no-require-imports */

type Finding = { kind: string; severity: string; fieldName: string }

// ── #1: citation completeness ────────────────────────────────────────────────
const FW = {
  sheetName: 'FW', layoutShape: 'FLAT_TABLE', dataRowCount: 1,
  cells: [['Ref ID', 'Coverage Name'], ['GL.COV.001', 'Premises Liability']],
}
const fpMap = new Map([['FW', FW]])

function entityWithCitation(refId: string, citation: unknown) {
  return {
    kind: 'coverage', sourceSheet: 'FW', sourceRowIndex: 0, occurrence: 0,
    reviewFlag: false, needsRefIdSynthesis: false, overallConfidence: 0.81,
    fields: [{ fieldName: 'refId', value: refId, confidence: 0.81, citation }],
  }
}

describe('#1 an omitted citation cannot launder a fabricated strict id', () => {
  it('BLOCKS a fabricated refId whose citation cell is empty (the unguarded path)', () => {
    // stage 4's toEntityFields backfills {sheet:'',cell:'',verbatim:''} when a model omits a
    // citation. Pre-fix, `if (!cit || !cit.cell) continue` skipped this BEFORE the strict
    // byte-compare, so an invented id with confidence 0.81 cleared the 0.60 floor unflagged.
    const e = entityWithCitation('GL.COV.999', { sheet: '', cell: '', verbatim: '' })
    const review: unknown[] = []
    const findings: Finding[] = resolveCitationsDeterministic([e], fpMap, review)
    expect(findings.some(f => f.kind === 'uncited-strict-id' && f.severity === 'BLOCKING')).toBe(true)
    expect((e as { blocked?: boolean }).blocked).toBe(true)
  })

  it('BLOCKS an entirely absent citation object too', () => {
    const e = entityWithCitation('GL.COV.999', undefined)
    const findings: Finding[] = resolveCitationsDeterministic([e], fpMap, [])
    expect(findings.some(f => f.kind === 'uncited-strict-id')).toBe(true)
  })

  it('still allows importer-SYNTHESIZED ids through (they carry a (…) verbatim)', () => {
    const e = entityWithCitation('GL.COV.SYNTH.001', { sheet: 'FW', cell: '', verbatim: '(synthesized)' })
    const findings: Finding[] = resolveCitationsDeterministic([e], fpMap, [])
    expect(findings).toHaveLength(0)
    expect((e as { blocked?: boolean }).blocked).toBeUndefined()
  })

  it('WARNs on a non-strict field that quotes a verbatim but cites no cell', () => {
    const e = entityWithCitation('GL.COV.001', { sheet: 'FW', cell: 'A2', verbatim: 'GL.COV.001' })
    e.fields.push({ fieldName: 'name', value: 'Premises Liability', confidence: 0.9,
      citation: { sheet: 'FW', cell: '', verbatim: 'Premises Liability' } })
    const findings: Finding[] = resolveCitationsDeterministic([e], fpMap, [])
    const f = findings.find(x => x.kind === 'uncited-field')
    expect(f?.severity).toBe('WARN')
    expect(e.reviewFlag).toBe(true)
  })
})

// ── stage 7 helpers ──────────────────────────────────────────────────────────
function cov(fields: Record<string, unknown>, rowIndex = 0) {
  return {
    kind: 'coverage', sourceSheet: 'FW', sourceRowIndex: rowIndex, occurrence: 0,
    reviewFlag: false, needsRefIdSynthesis: false, overallConfidence: 0.9,
    fields: Object.entries(fields).map(([fieldName, value]) => ({
      fieldName, value, confidence: 0.9,
      citation: { sheet: 'FW', cell: 'A2', verbatim: String(value) },
    })),
  }
}
// buildImportPlan returns { plan, completeness, importWarnings, … } — flatten what the
// assertions below need so each test reads as the fact it is locking.
function planOf(entities: unknown[], sweeper: unknown = null, opts: Record<string, unknown> = {}) {
  const out = buildImportPlan({ entities, review: [], sweeper }, opts)
  return {
    coverages: out.plan.coverages as { docId: string; refId: string; data: Record<string, unknown> }[],
    forms: out.plan.forms as { docId: string; refId: string; data: Record<string, unknown> }[],
    warnings: out.importWarnings as { kind: string; detail: string }[],
    completeness: out.completeness as { pillars: Record<string, boolean>; attachStrategy: string },
  }
}

describe('#4 a retired coverage must not import as in-force', () => {
  it('folds a qualified "Inactive - No Longer in Use" to INACTIVE', () => {
    const plan = planOf([cov({ refId: 'GL.COV.001', name: 'Retired Cov', status: 'Inactive - No Longer in Use' })])
    expect(plan.coverages[0].data.status).toBe('INACTIVE')
  })

  it('folds a qualified "Active — Renewal Only" to ACTIVE', () => {
    const plan = planOf([cov({ refId: 'GL.COV.001', name: 'C', status: 'Active — Renewal Only' })])
    expect(plan.coverages[0].data.status).toBe('ACTIVE')
  })

  it('marks an UNMAPPABLE source status as ASSUMED rather than passing it off as read', () => {
    const plan = planOf([cov({ refId: 'GL.COV.001', name: 'C', status: 'Approved - Completed' })])
    const c = plan.coverages[0]
    expect(c.data.sourceStatus).toBe('Approved - Completed')
    expect(c.data.statusAssumed).toBe(true)
    expect(c.data.needsReview).toBe(true)
    expect(plan.warnings.some(w => w.kind === 'status-assumed')).toBe(true)
  })

  it('does NOT flag a status the source never mentioned (nothing was overridden)', () => {
    const plan = planOf([cov({ refId: 'GL.COV.001', name: 'C' })])
    expect(plan.coverages[0].data.status).toBe('ACTIVE')
    expect(plan.coverages[0].data.statusAssumed).toBeUndefined()
  })
})

describe('#5 filing provenance is positive evidence, never a negation', () => {
  it('does NOT stamp BUREAU from proprietaryFlag = "No"', () => {
    const plan = planOf([cov({ refId: 'GL.COV.001', name: 'C', proprietaryFlag: 'No' })])
    expect(plan.coverages[0].data.source).toBeUndefined()
  })

  it('does NOT stamp BUREAU from a BLANK proprietary cell', () => {
    const plan = planOf([cov({ refId: 'GL.COV.001', name: 'C', proprietaryFlag: '' })])
    expect(plan.coverages[0].data.source).toBeUndefined()
  })

  it('still stamps PROPRIETARY and BUREAU from positive evidence', () => {
    expect(planOf([cov({ refId: 'GL.COV.001', name: 'C', proprietaryFlag: 'Yes' })])
      .coverages[0].data.source).toBe('PROPRIETARY')
    expect(planOf([cov({ refId: 'GL.COV.002', name: 'C', bureauFlag: 'Yes' })])
      .coverages[0].data.source).toBe('BUREAU')
    expect(planOf([cov({ refId: 'GL.COV.003', name: 'C', source: 'ISO' })])
      .coverages[0].data.source).toBe('BUREAU')
  })
})

describe('#11 duplicate refIds must stay independently resolvable', () => {
  it('gives each copy a distinct docId while leaving refId byte-identical', () => {
    const plan = planOf([
      cov({ refId: 'GL.COV.001', name: 'First' }, 0),
      cov({ refId: 'GL.COV.001', name: 'Second' }, 1),
    ])
    const [a, b] = plan.coverages
    expect(a.refId).toBe('GL.COV.001')
    expect(b.refId).toBe('GL.COV.001')     // refId is load-bearing — never renamed
    expect(a.docId).not.toBe(b.docId)      // …but the storage key must not collide
    expect(b.data.needsReview).toBe(true)
    expect(plan.warnings.some(w => w.kind === 'duplicate-refId')).toBe(true)
  })
})

describe('#17 a sweeper nomination is not a product backbone', () => {
  const sweeperFact = { sheet: 'FW', ref: 'FW!C7', entityKind: 'coverage', name: 'Maybe A Coverage', verbatim: 'Maybe A Coverage' }
  const formEntity = {
    kind: 'form', sourceSheet: 'FW', sourceRowIndex: 0, occurrence: 0,
    reviewFlag: false, needsRefIdSynthesis: false, overallConfidence: 0.9,
    fields: [{ fieldName: 'number', value: 'CG 20 10', confidence: 0.9, citation: { sheet: 'FW', cell: 'A2', verbatim: 'CG 20 10' } }],
  }

  it('a forms-only upload whose only "coverage" is a sweeper guess ATTACHES, not mints', () => {
    const plan = planOf([formEntity], { facts: [sweeperFact] })
    // The nomination still reaches the plan for review — it is not dropped…
    expect(plan.coverages.some(c => c.data.sweeperFact === true)).toBe(true)
    // …but it does not constitute a product backbone.
    expect(plan.completeness.pillars.framework).toBe(false)
    expect(plan.completeness.attachStrategy).toBe('ATTACH_TO_EXISTING_PRODUCT')
  })

  it('a real extracted coverage still raises the framework pillar', () => {
    const plan = planOf([cov({ refId: 'GL.COV.001', name: 'Premises Liability' })])
    expect(plan.completeness.pillars.framework).toBe(true)
    expect(plan.completeness.attachStrategy).toBe('NEW_PRODUCT')
  })
})

// ── #8: CSV ──────────────────────────────────────────────────────────────────
describe('#8 a quoted comma must not shift every later column', () => {
  it('keeps a quoted field containing a comma in ONE cell', () => {
    const rows = parseCsv('Coverage,Limit\n"Dwelling, Fire",500000\n')
    expect(rows[1]).toEqual(['Dwelling, Fire', '500000'])
  })

  it('handles escaped doubled quotes and embedded newlines', () => {
    expect(parseCsv('a,"say ""hi""",c')[0]).toEqual(['a', 'say "hi"', 'c'])
    expect(parseCsv('a,"line1\nline2",c')[0]).toEqual(['a', 'line1\nline2', 'c'])
  })

  it('preserves the previous behavior for plain rows and blank lines', () => {
    expect(parseCsv('a,b,c\n\nd,e,f\n')).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']])
  })

  it('keeps genuinely empty interior fields (they are not blank rows)', () => {
    expect(parseCsv('a,,c')[0]).toEqual(['a', '', 'c'])
  })
})

// ── #19: sweeper verbatim ────────────────────────────────────────────────────
describe('#19 a sweeper FACT must appear in the cell it cites', () => {
  const cells = new Map([['C7', 'AI']])

  it('REJECTS an expanded abbreviation the cited cell does not contain', () => {
    expect(acceptAnswer({ ref: 'C7', kind: 'FACT', entityKind: 'coverage', name: 'Additional Insured Coverage' }, cells)).toBeNull()
  })

  it('accepts a name the cell actually contains (whitespace/case tolerant)', () => {
    const wide = new Map([['C7', 'Additional Insured  Coverage']])
    expect(acceptAnswer({ ref: 'C7', kind: 'FACT', entityKind: 'coverage', name: 'additional insured coverage' }, wide))
      .toMatchObject({ kind: 'FACT', entityKind: 'coverage' })
  })

  it('leaves NOISE and UNKNOWN acceptance unchanged', () => {
    expect(acceptAnswer({ ref: 'C7', kind: 'UNKNOWN' }, cells)).toEqual({ ref: 'C7', kind: 'UNKNOWN' })
  })
})

// ── #7: multi-product split ──────────────────────────────────────────────────
describe('#7 a supplementary workbook is never silently dropped', () => {
  const wb = (name: string, sheetCount: number) =>
    ({ name, structural: { sheets: Array.from({ length: sheetCount }, (_, i) => ({ sheetName: `S${i}` })) } })

  it('reports the sub-threshold books that the split excludes', () => {
    const { groups, isSplit, supplementary } = partitionWorkbooks([wb('CoreA', 6), wb('CoreB', 5), wb('RatesOnly', 2)])
    expect(isSplit).toBe(true)
    expect(groups).toHaveLength(2)
    expect(supplementary.map((w: { name: string }) => w.name)).toEqual(['RatesOnly'])
  })

  it('still merges everything when fewer than 2 books are self-contained', () => {
    const { groups, isSplit, supplementary } = partitionWorkbooks([wb('CoreA', 6), wb('RatesOnly', 2)])
    expect(isSplit).toBe(false)
    expect(groups[0]).toHaveLength(2)
    expect(supplementary).toEqual([])
  })
})

// ── #3 / #14: the deterministic join must never let absence beat a citation ──
describe('#3 / #14 a mapper default must not erase a cited value', () => {
  // The mapper is the identity ORACLE for refId/parentId/order, but it also STAMPS
  // workflow defaults for fields it never read. Overwriting on `!== undefined` let an
  // empty formNumbers:[] delete the brain's cited endorsement attachments and a
  // hardcoded 'ACTIVE' overwrite a cited INACTIVE.
  const isoCoverage = (data: Record<string, unknown>) =>
    ({ docId: 'GL-COV-001', refId: 'GL.COV.001', label: 'Premises Liability', data })

  const joined = (brainFields: Record<string, unknown>, isoData: Record<string, unknown>) =>
    planOf([cov({ refId: 'GL.COV.001', ...brainFields })], null, {
      isoPlan: { coverages: [isoCoverage({ refId: 'GL.COV.001', ...isoData })], forms: [], rules: [], formRules: [], ldTables: [], rtTables: [], products: [], product: null },
    }).coverages[0]

  it('an empty mapper formNumbers[] does NOT erase the cited form numbers', () => {
    const c = joined({ name: 'C', formNumbers: ['CG 20 10', 'CG 20 11'] }, { formNumbers: [] })
    expect(c.data.formNumbers).toEqual(['CG 20 10', 'CG 20 11'])
  })

  it('form numbers UNION — neither side may truncate the other', () => {
    const c = joined({ name: 'C', formNumbers: ['CG 20 10'] }, { formNumbers: ['CG 20 11'] })
    expect(c.data.formNumbers).toEqual(['CG 20 10', 'CG 20 11'])
  })

  it("the mapper's hardcoded ACTIVE does NOT overwrite a cited INACTIVE", () => {
    const c = joined({ name: 'C', status: 'Inactive' }, { status: 'ACTIVE' })
    expect(c.data.status).toBe('INACTIVE')
  })

  it('the mapper still GAP-FILLS a field the brain did not extract', () => {
    const c = joined({ name: 'C' }, { status: 'ACTIVE', reviewStatus: 'NOT_STARTED' })
    expect(c.data.status).toBe('ACTIVE')
    expect(c.data.reviewStatus).toBe('NOT_STARTED')
  })

  it('the mapper remains the ORACLE for true identity fields', () => {
    // parentId must resolve inside the plan, or the orphan-promotion pass legitimately
    // nulls it — so the parent is present on both sides here.
    const out = planOf(
      [cov({ refId: 'GL.COV.000', name: 'Parent' }, 0), cov({ refId: 'GL.COV.001', name: 'Child', order: 99 }, 1)],
      null,
      {
        isoPlan: {
          coverages: [
            isoCoverage({ refId: 'GL.COV.000' }),
            { docId: 'GL-COV-001', refId: 'GL.COV.001', label: 'Child', data: { refId: 'GL.COV.001', order: 1, parentId: 'GL.COV.000' } },
          ],
          forms: [], rules: [], formRules: [], ldTables: [], rtTables: [], products: [], product: null,
        },
      })
    const child = out.coverages.find(c => c.refId === 'GL.COV.001')!
    expect(child.data.order).toBe(1)              // mapper's order beats the brain's 99
    expect(child.data.parentId).toBe('GL.COV.000')
  })
})

// ── #12: the map cross-check must be BLIND to the map ────────────────────────
describe('#12 the map cross-check must not be handed the map it is checking', () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { buildExtractionPrompt, buildBlindExtractionPrompt } = require('../../server/lib/import-brain/stage4-extract.js')
  /* eslint-enable @typescript-eslint/no-require-imports */

  const fp = {
    sheetName: 'FW',
    cells: [['Ref ID', 'Coverage Name', 'Notes'], ['GL.COV.001', 'Premises Liability', 'internal only']],
  }
  // A WRONG map: 'name' is pointed at column C (Notes) instead of column B.
  const wrongMap = { mappings: [
    { colIndex: 0, canonicalField: 'refId', entityKind: 'coverage', confidence: 0.9 },
    { colIndex: 2, canonicalField: 'name', entityKind: 'coverage', confidence: 0.9 },
  ] }
  const batch = [['GL.COV.001', 'Premises Liability', 'internal only']]

  it('the ordinary prompt states the map AND hides the unmapped evidence', () => {
    const p = buildExtractionPrompt(fp, wrongMap, 0, batch, 0, null, null)
    expect(p).toMatch(/coverage\.name/)                 // the map is asserted to the model…
    expect(p).not.toContain('Premises Liability')       // …and column B is not even shown
  })

  it('the BLIND prompt withholds the map and shows every cell', () => {
    const p = buildBlindExtractionPrompt(fp, 0, batch, 0, null)
    expect(p).not.toMatch(/coverage\.name/)             // no canonical mapping supplied
    expect(p).toContain('Premises Liability')           // the contradicting evidence IS visible
    expect(p).toContain('internal only')
    expect(p).toContain('"Coverage Name"')              // real headers, so the model can judge
    expect(p).toMatch(/Decide for yourself/)
  })
})
