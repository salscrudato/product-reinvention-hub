// serff/bundle.test.ts — SERFF bundle assembler + Texas DOI reviewer lens tests.
//
// Uses real HO-3 seed data to build a realistic SERFF bundle: three rate cells bumped
// by 5%, one deductible option default changed, and one form edition updated. This
// mirrors the PM scenario from the task spec (clone HO-3, change 3 rate cells + 1 ded
// option). Canaries are NOT changed — this test uses a clone snapshot with different
// table data but the underlying seed is untouched.

import { describe, it, expect } from 'vitest'
import {
  PH_RATING_PROGRAM, PH_RT_TABLES, PH_LD_TABLES,
  PH_COVERAGES, PH_FORMS, PH_PRODUCT,
  PH_WORKED_EXAMPLE, makePHRtGetter, makePHLdGetter,
} from '../seed/personalHome'
import { evaluate } from '../rating/evaluator'
import { diffProducts, type ProductSnapshot } from '../changeset/diff'
import { generateRedlineDocuments } from './redline'
import { generateRateExhibit, type ExhibitInputScenario } from './rateExhibit'
import { buildMemoStructure } from './memo'
import { assembleSerffBundle, documentsInTab } from './bundle'
import { checkTexasBundle } from './reviewer'
import { getStateProfile } from '../registry/stateFilingMatrix'
import type { SerffBundle } from './types'

// ─── Test setup: build a "clone" snapshot with 3 RT cells and 1 LD change ─────────

function buildCloneSnapshot(): ProductSnapshot {
  const cloneRT = JSON.parse(JSON.stringify(PH_RT_TABLES)) as typeof PH_RT_TABLES
  // Change 3 territory base-rate cells: T001 +5%, T002 +5%, T003 +5%
  const rt001 = cloneRT['PH.RT.001']!
  rt001.rows = rt001.rows.map(r => ({
    ...r,
    rate: ['T001', 'T002', 'T003'].includes(r.territory as string)
      ? Math.round((r.rate as number) * 1.05)
      : r.rate,
  }))

  const cloneLD = JSON.parse(JSON.stringify(PH_LD_TABLES)) as typeof PH_LD_TABLES
  const ld003 = cloneLD['PH.LD.003']!
  ld003.defaultValue = 2500   // was 1000

  const cloneForms = JSON.parse(JSON.stringify(PH_FORMS)) as typeof PH_FORMS
  const ho3 = cloneForms.find(f => f.number === 'HO 00 03')
  if (ho3) ho3.edition = '01 24'   // bump edition

  return {
    refId:         'PH.PROD.CLONE.001',
    name:          'Personal Home — HO-3 Special Form (TX Filing 2026)',
    coverages:     PH_COVERAGES,
    forms:         cloneForms,
    rtTables:      cloneRT,
    ldTables:      cloneLD,
    ratingProgram: PH_RATING_PROGRAM,
  }
}

const parentSnapshot: ProductSnapshot = {
  refId:         PH_PRODUCT.refId!,
  name:          PH_PRODUCT.name,
  coverages:     PH_COVERAGES,
  forms:         PH_FORMS,
  rtTables:      PH_RT_TABLES,
  ldTables:      PH_LD_TABLES,
  ratingProgram: PH_RATING_PROGRAM,
}

const cloneSnapshot  = buildCloneSnapshot()
const changeset      = diffProducts(parentSnapshot, cloneSnapshot)

// Scenarios for the rate exhibit: vary the territories that changed
const SCENARIOS: ExhibitInputScenario[] = [
  { label: 'Territory T001, PC5/Masonry, CovA $300k, Ded $1,000', inputs: { ...PH_WORKED_EXAMPLE, territory: 'T001', pc: 5, construction: 'M', covA: 300000 } },
  { label: 'Territory T002, PC5/Masonry, CovA $400k, Ded $1,000', inputs: { ...PH_WORKED_EXAMPLE, territory: 'T002' } },
  { label: 'Territory T003, PC5/Masonry, CovA $400k, Ded $1,000', inputs: { ...PH_WORKED_EXAMPLE, territory: 'T003' } },
  { label: 'Territory T004, PC5/Masonry, CovA $400k, Ded $1,000', inputs: { ...PH_WORKED_EXAMPLE, territory: 'T004' } },
  { label: 'Territory T005, PC5/Masonry, CovA $400k, Ded $1,000', inputs: { ...PH_WORKED_EXAMPLE, territory: 'T005' } },
]

const parentRtGetter = makePHRtGetter(PH_RT_TABLES)
const parentLdGetter = makePHLdGetter(PH_LD_TABLES)
const cloneRtGetter  = makePHRtGetter(cloneSnapshot.rtTables)
const cloneLdGetter  = makePHLdGetter(cloneSnapshot.ldTables)

const exhibit = generateRateExhibit(
  changeset,
  PH_RATING_PROGRAM, PH_RATING_PROGRAM,
  parentRtGetter, parentLdGetter,
  cloneRtGetter,  cloneLdGetter,
  SCENARIOS,
)

const redlines = generateRedlineDocuments(changeset)
const memo     = buildMemoStructure(changeset, exhibit.overallImpactPct, 'TX')
const bundle   = assembleSerffBundle({
  filingId:     'TX-PH.PROD.001-2026-001',
  state:        'TX',
  productRefId: cloneSnapshot.refId,
  productName:  cloneSnapshot.name,
  changeset,
  redlines,
  rateExhibit:  exhibit,
  memo,
})

// ─── ChangeSet assertions ─────────────────────────────────────────────────────────

describe('ChangeSet from HO-3 clone (3 RT cells + 1 LD default + 1 form edition)', () => {
  it('detects 3 RT cell changes in PH.RT.001', () => {
    const rt001Changes = changeset.rateTableCellChanges.filter(c => c.tableRefId === 'PH.RT.001')
    expect(rt001Changes).toHaveLength(3)
  })

  it('all changed cells are in territories T001, T002, T003', () => {
    const territories = changeset.rateTableCellChanges
      .filter(c => c.tableRefId === 'PH.RT.001')
      .map(c => (c.rowKey as Record<string, unknown>).territory)
    expect(territories).toContain('T001')
    expect(territories).toContain('T002')
    expect(territories).toContain('T003')
  })

  it('each changed cell shows approximately +5% change', () => {
    for (const c of changeset.rateTableCellChanges.filter(c => c.tableRefId === 'PH.RT.001')) {
      expect(c.pctChange).toBeCloseTo(5, 0)
    }
  })

  it('detects LD table default-changed', () => {
    expect(changeset.ldTableChanges.some(c => c.kind === 'default-changed' && c.tableRefId === 'PH.LD.003')).toBe(true)
  })

  it('detects form edition change for HO 00 03', () => {
    expect(changeset.formEditionChanges.some(c => c.formNumber === 'HO 00 03' && c.field === 'edition')).toBe(true)
  })

  it('summary flags hasRateImpact and hasFormChanges', () => {
    expect(changeset.summary.hasRateImpact).toBe(true)
    expect(changeset.summary.hasFormChanges).toBe(true)
  })
})

// ─── Rate exhibit assertions ───────────────────────────────────────────────────────

describe('Rate exhibit — computed by actual evaluate()', () => {
  it('produces 5 premium impact rows', () => {
    expect(exhibit.premiumImpacts).toHaveLength(5)
  })

  it('territories T001/T002/T003 have higher "after" premium (rate cells bumped)', () => {
    for (const row of exhibit.premiumImpacts.slice(0, 3)) {
      expect(row.after).toBeGreaterThan(row.before)
    }
  })

  it('territories T004/T005 are unchanged (cells not modified)', () => {
    for (const row of exhibit.premiumImpacts.slice(3)) {
      expect(row.before).toBe(row.after)
      expect(row.pctChange).toBe(0)
    }
  })

  it('T002 scenario matches the canary territory ($1,528 base before change)', () => {
    const t002 = exhibit.premiumImpacts.find(r => r.inputLabel.includes('T002'))!
    expect(t002.before).toBe(1528)  // HO-3 canary must be preserved
  })

  it('histogram has 7 bands', () => {
    expect(exhibit.histogram).toHaveLength(7)
    expect(exhibit.histogram.every(b => typeof b.count === 'number')).toBe(true)
  })

  it('overall impact is positive when territories are bumped up', () => {
    if (exhibit.overallImpactPct !== null) {
      expect(exhibit.overallImpactPct).toBeGreaterThan(0)
    }
  })
})

// ─── Redline document assertions ──────────────────────────────────────────────────

describe('Redline documents', () => {
  it('generates at least one redline per changed table', () => {
    expect(redlines.length).toBeGreaterThanOrEqual(1)
  })

  it('form redline has kind=redline', () => {
    const fmRedline = redlines.find(r => r.formNumber === 'HO 00 03')
    expect(fmRedline).toBeDefined()
    expect(fmRedline!.kind).toBe('redline')
  })

  it('all redlines have at least one section with blocks', () => {
    for (const rd of redlines) {
      expect(rd.sections.length).toBeGreaterThan(0)
      expect(rd.sections.every(s => s.blocks.length > 0)).toBe(true)
    }
  })

  it('redline blocks contain del and ins markers for changed cells', () => {
    const rtRedline = redlines.find(r => r.title.includes('PH.RT.001'))
    expect(rtRedline).toBeDefined()
    const allBlocks = rtRedline!.sections.flatMap(s => s.blocks)
    expect(allBlocks.some(b => b.type === 'del')).toBe(true)
    expect(allBlocks.some(b => b.type === 'ins')).toBe(true)
  })
})

// ─── Memo structure assertions ─────────────────────────────────────────────────────

describe('Memo structure', () => {
  it('includes overallImpactPct when rates changed', () => {
    expect(memo.overallImpactPct).not.toBeNull()
    expect(typeof memo.overallImpactPct).toBe('number')
  })

  it('includes all Texas citations', () => {
    expect(memo.citations).toContain('Texas Insurance Code Chapter 2251 (File-and-Use)')
    expect(memo.citations).toContain('28 Tex. Admin. Code §5.9334 (Filing Memorandum)')
  })

  it('rate changes section contains overall impact item', () => {
    const rateSec = memo.sections.find(s => s.heading === 'Rate Changes')
    expect(rateSec).toBeDefined()
    const impactItem = rateSec!.items.find(i => i.label === 'Overall Rate Level Impact')
    expect(impactItem).toBeDefined()
    expect(impactItem!.citation).toContain('§5.9334(d)')
  })

  it('regulatory compliance section is always present', () => {
    const regSec = memo.sections.find(s => s.heading === 'Regulatory Compliance')
    expect(regSec).toBeDefined()
  })
})

// ─── Bundle structure assertions ──────────────────────────────────────────────────

describe('SERFF bundle — tab structure', () => {
  it('GeneralInformation tab has at least one document', () => {
    expect(documentsInTab(bundle, 'GeneralInformation').length).toBeGreaterThanOrEqual(1)
  })

  it('RateRuleSchedule tab has a rate exhibit', () => {
    const exhibits = documentsInTab(bundle, 'RateRuleSchedule')
    expect(exhibits.some(d => d.documentType === 'rateExhibit')).toBe(true)
  })

  it('FormSchedule tab has a clean-form placeholder for HO 00 03', () => {
    const cleanForms = documentsInTab(bundle, 'FormSchedule')
    expect(cleanForms.some(d => d.documentType === 'cleanForm' && d.refIds.includes('HO 00 03'))).toBe(true)
  })

  it('SupportingDocumentation tab has both marked copies and a memo', () => {
    const suppDocs = documentsInTab(bundle, 'SupportingDocumentation')
    expect(suppDocs.some(d => d.documentType === 'redline')).toBe(true)
    expect(suppDocs.some(d => d.documentType === 'memo')).toBe(true)
  })

  it('all documents are in valid SERFF tabs', () => {
    const validTabs = new Set(['GeneralInformation', 'RateRuleSchedule', 'FormSchedule', 'SupportingDocumentation', 'CorrespondenceNotes'])
    for (const doc of bundle.documents) {
      expect(validTabs.has(doc.tabName)).toBe(true)
    }
  })
})

// ─── Texas DOI reviewer lens assertions ──────────────────────────────────────────

describe('Texas DOI reviewer lens', () => {
  let result: ReturnType<typeof checkTexasBundle>

  it('runs without throwing', () => {
    result = checkTexasBundle(bundle)
    expect(result).toBeDefined()
  })

  it('passes for a well-formed bundle', () => {
    result = checkTexasBundle(bundle)
    expect(result.passed).toBe(true)
  })

  it('all 8 checks are present', () => {
    result = checkTexasBundle(bundle)
    expect(result.checklist).toHaveLength(8)
  })

  it('all checks carry a citation', () => {
    result = checkTexasBundle(bundle)
    for (const item of result.checklist) {
      expect(item.citation.length).toBeGreaterThan(0)
    }
  })

  it('TX-02 (marked copies) passes when redlines are present', () => {
    result = checkTexasBundle(bundle)
    expect(result.checklist.find(c => c.id === 'TX-02')?.passed).toBe(true)
  })

  it('TX-04 (filing memo) passes', () => {
    result = checkTexasBundle(bundle)
    expect(result.checklist.find(c => c.id === 'TX-04')?.passed).toBe(true)
  })

  it('TX-05 (overall impact statement) passes when rate impact is present', () => {
    result = checkTexasBundle(bundle)
    expect(result.checklist.find(c => c.id === 'TX-05')?.passed).toBe(true)
  })

  it('TX-06 (rate exhibits) passes when rate cells changed', () => {
    result = checkTexasBundle(bundle)
    expect(result.checklist.find(c => c.id === 'TX-06')?.passed).toBe(true)
  })

  it('TX-07 (form schedule) passes when form edition changed', () => {
    result = checkTexasBundle(bundle)
    expect(result.checklist.find(c => c.id === 'TX-07')?.passed).toBe(true)
  })

  it('TX-02 (marked copies) FAILS when redlines are removed', () => {
    const emptyBundle: SerffBundle = { ...bundle, documents: bundle.documents.filter(d => d.documentType !== 'redline') }
    const r2 = checkTexasBundle(emptyBundle)
    expect(r2.checklist.find(c => c.id === 'TX-02')?.passed).toBe(false)
    expect(r2.passed).toBe(false)
    const finding = r2.findings.find(f => f.citation.includes('§5.9327'))
    expect(finding).toBeDefined()
  })

  it('TX-04 (memo) FAILS when memo is removed', () => {
    const noMemo: SerffBundle = { ...bundle, documents: bundle.documents.filter(d => d.documentType !== 'memo') }
    const r3 = checkTexasBundle(noMemo)
    expect(r3.checklist.find(c => c.id === 'TX-04')?.passed).toBe(false)
    expect(r3.passed).toBe(false)
  })

  it('TX-05 (impact statement) FAILS when memo overallImpactPct is null', () => {
    const nullImpactMemo = buildMemoStructure(changeset, null, 'TX')
    const nullBundle = assembleSerffBundle({ ...{ filingId: bundle.filingId, state: 'TX', productRefId: cloneSnapshot.refId, productName: cloneSnapshot.name, changeset, redlines, rateExhibit: exhibit, memo: nullImpactMemo } })
    const r4 = checkTexasBundle(nullBundle)
    expect(r4.checklist.find(c => c.id === 'TX-05')?.passed).toBe(false)
  })

  it('TX-06 (rate exhibits) FAILS when exhibit is removed', () => {
    const noExhibit: SerffBundle = { ...bundle, documents: bundle.documents.filter(d => d.documentType !== 'rateExhibit') }
    const r5 = checkTexasBundle(noExhibit)
    expect(r5.checklist.find(c => c.id === 'TX-06')?.passed).toBe(false)
    expect(r5.passed).toBe(false)
  })

  it('documents known gaps in the reviewer result', () => {
    result = checkTexasBundle(bundle)
    expect(result.knownGaps.length).toBeGreaterThanOrEqual(5)
    // Must mention actuarial certification gap
    expect(result.knownGaps.some(g => g.toLowerCase().includes('actuarial'))).toBe(true)
    // Must mention TDI-filed version gap
    expect(result.knownGaps.some(g => g.toLowerCase().includes('tdi') || g.toLowerCase().includes('last approved'))).toBe(true)
  })
})

// ─── State filing matrix assertions ───────────────────────────────────────────────

describe('State filing matrix', () => {
  it('Texas is fully populated as file-and-use', () => {
    const tx = getStateProfile('TX')
    expect(tx).not.toBeNull()
    expect(tx!.filingType).toBe('file-and-use')
    expect(tx!.serffEnabled).toBe(true)
    expect(tx!.serffTabs?.requiresMarkedCopies).toBe(true)
    expect(tx!.serffTabs?.requiresRateExhibits).toBe(true)
  })

  it('Texas source cites Insurance Code §2251 and 28 TAC', () => {
    const tx = getStateProfile('TX')!
    expect(tx.source).toContain('2251')
    expect(tx.source).toContain('5.9334')
  })

  it('Illinois is stubbed with pending legislation annotation', () => {
    const il = getStateProfile('IL')
    expect(il).not.toBeNull()
    expect(il!.pendingLegislationEffective).toBe('2027-07-01')
    expect(il!.note).toContain('SB714')
  })

  it('California is prior-approval with Prop 103 citation', () => {
    const ca = getStateProfile('CA')
    expect(ca).not.toBeNull()
    expect(ca!.filingType).toBe('prior-approval')
    expect(ca!.source).toContain('1861')
  })

  it('returns null for an unknown state code', () => {
    expect(getStateProfile('XX')).toBeNull()
  })
})

// ─── Canary regression guard ───────────────────────────────────────────────────────

describe('HO-3 canary — unchanged after SERFF module addition', () => {
  it('$1,528 canary still holds on the unchanged parent seed', () => {
    // Runs the actual evaluator on the original (parent) inputs — must be $1,528
    const result = evaluate(PH_RATING_PROGRAM, PH_WORKED_EXAMPLE, parentRtGetter, parentLdGetter)
    expect(result.finalPremium).toBe(1528)
  })
})
