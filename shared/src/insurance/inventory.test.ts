// Inventory builder tests — lock the SAFE parent/child guarantees the hierarchy and
// inventory table lean on: a sub-coverage always resolves to its parent, no coverage
// is ever dropped, an unresolvable parent surfaces as an explicit orphan (never as a
// phantom top-level), and cycles/deep nesting terminate.
import { describe, it, expect } from 'vitest'
import {
  buildCoverageTree, buildInventoryRows, formsForCoverage, productDisplayIdentity,
  type CoverageLike, type FormLike,
} from './inventory'

const cov = (over: Partial<CoverageLike> & { refId: string }): CoverageLike => ({
  parentId: null, name: over.refId, order: 0, formNumbers: [], ...over,
})
const form = (number: string, over: Partial<FormLike> = {}): FormLike => ({ number, name: number, edition: '05 11', source: 'BUREAU', ...over })

describe('formsForCoverage', () => {
  it('resolves attached forms in the coverage\'s declared order and skips missing numbers', () => {
    const forms = [form('HO 00 03'), form('HO 04 90')]
    const c = cov({ refId: 'HO.COV.001', formNumbers: ['HO 04 90', 'HO 00 03', 'NOPE'] })
    expect(formsForCoverage(c, forms).map(f => f.number)).toEqual(['HO 04 90', 'HO 00 03'])
  })
})

describe('buildCoverageTree', () => {
  it('nests sub-coverages under the parent whose refId equals their parentId', () => {
    const coverages = [
      cov({ refId: 'HO.COV.002', name: 'Personal Property', order: 2 }),
      cov({ refId: 'HO.COV.001', name: 'Dwelling', order: 1 }),
      cov({ refId: 'HO.COV.001.001', name: 'Ordinance or Law', parentId: 'HO.COV.001', order: 1 }),
    ]
    const { roots, orphans } = buildCoverageTree(coverages, [])
    expect(orphans).toHaveLength(0)
    expect(roots.map(r => r.coverage.name)).toEqual(['Dwelling', 'Personal Property']) // sorted by order
    expect(roots[0]!.children.map(c => c.coverage.name)).toEqual(['Ordinance or Law'])
    expect(roots[1]!.children).toHaveLength(0)
  })

  it('surfaces a coverage with an unresolvable parent as an orphan — never dropped, never top-level', () => {
    const coverages = [
      cov({ refId: 'HO.COV.001', name: 'Dwelling' }),
      cov({ refId: 'HO.COV.999.001', name: 'Ghost Endorsement', parentId: 'HO.COV.999' }),
    ]
    const { roots, orphans } = buildCoverageTree(coverages, [])
    expect(roots.map(r => r.coverage.name)).toEqual(['Dwelling'])          // orphan is NOT a root
    expect(orphans.map(o => o.coverage.name)).toEqual(['Ghost Endorsement']) // …it is surfaced here
    // Total coverages accounted for equals the input — nothing lost.
    const count = (ns: { children: unknown[] }[]): number => ns.reduce((n, x) => n + 1 + count(x.children as never), 0)
    expect(count(roots) + count(orphans)).toBe(coverages.length)
  })

  it('terminates on a cycle without infinite recursion', () => {
    const coverages = [
      cov({ refId: 'A', parentId: 'B' }),
      cov({ refId: 'B', parentId: 'A' }),
    ]
    // Both have resolvable parents, so neither is an orphan; the visited-set guard
    // keeps the build finite.
    const { roots, orphans } = buildCoverageTree(coverages, [])
    expect(orphans).toHaveLength(0)
    expect(roots).toHaveLength(0) // neither is a root (both have a parentId)
  })
})

describe('buildInventoryRows', () => {
  const coverages = [
    cov({ refId: 'HO.COV.001', name: 'Dwelling', order: 1, formNumbers: ['HO 00 03', 'HO 04 90'] }),
    cov({ refId: 'HO.COV.001.001', name: 'Ordinance or Law', parentId: 'HO.COV.001', order: 1, formNumbers: [] }),
    cov({ refId: 'HO.COV.002', name: 'Liability', order: 2, formNumbers: [] }),
  ]
  const forms = [form('HO 00 03'), form('HO 04 90')]

  it('emits one row per attached form and one form-less row when a coverage has none', () => {
    const rows = buildInventoryRows(coverages, forms)
    // Dwelling has 2 forms → 2 rows; Ordinance (sub, 0 forms) → 1 row; Liability (0 forms) → 1 row.
    expect(rows).toHaveLength(4)
    expect(rows.map(r => r.form?.number ?? null)).toEqual(['HO 00 03', 'HO 04 90', null, null])
  })

  it('reads in tree order and every sub-coverage row names its top-level parent', () => {
    const rows = buildInventoryRows(coverages, forms)
    expect(rows.map(r => r.coverage.name)).toEqual(['Dwelling', 'Dwelling', 'Ordinance or Law', 'Liability'])
    const sub = rows.find(r => r.coverage.name === 'Ordinance or Law')!
    expect(sub.isSub).toBe(true)
    expect(sub.top.name).toBe('Dwelling')   // the sub-coverage row always shows its parent
    expect(sub.isOrphan).toBe(false)
  })

  it('flags an orphan row instead of hiding it or reparenting it', () => {
    const orphaned = [
      cov({ refId: 'HO.COV.001', name: 'Dwelling', order: 1 }),
      cov({ refId: 'X.001', name: 'Detached Sub', parentId: 'MISSING', order: 1 }),
    ]
    const rows = buildInventoryRows(orphaned, [])
    const detached = rows.find(r => r.coverage.name === 'Detached Sub')!
    expect(detached.isOrphan).toBe(true)
    expect(detached.top).toBe(detached.coverage) // resolves to itself, not a phantom parent
  })
})

describe('productDisplayIdentity', () => {
  it('splits an "Offering — Form" name on an em/en dash but preserves hyphens (HO-3)', () => {
    const id = productDisplayIdentity({ refId: 'HO.PROD.001', name: 'Homeowners — HO-3 Special Form', lob: { refId: 'HO.LOB.001', name: 'Homeowners' } })
    expect(id.offeringName).toBe('Homeowners — HO-3 Special Form')
    expect(id.productName).toBe('HO-3 Special Form') // hyphen in HO-3 kept intact
    expect(id.productCode).toBe('HO')
    expect(id.frameworkId).toBe('HO.PROD.001')
    expect(id.lobName).toBe('Homeowners')
  })

  it('uses the whole name as the product name when there is no dash separator', () => {
    const id = productDisplayIdentity({ refId: 'GL.PROD.001', name: 'Monoline General Liability Product', lob: { refId: 'GL.LOB.001', name: 'General Liability' } })
    expect(id.offeringName).toBe('Monoline General Liability Product')
    expect(id.productName).toBe('Monoline General Liability Product')
    expect(id.productCode).toBe('GL')
  })
})
