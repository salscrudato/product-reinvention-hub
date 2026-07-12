// coverageHierarchy.test.ts — first-principles sub-coverage resolution across formats.
//
// The point of this suite is FORMAT ROBUSTNESS: the same logic must resolve the parent/child
// tree for schemes it has seen (ISO GL nested ids, SECURA flat-sibling ids) AND for shapes it
// has not — as long as the row expresses one of the three structural signals.
import { describe, it, expect } from 'vitest'
import { resolveCoverageHierarchy, type CoverageRow } from './coverageHierarchy'

const row = (refId: string, coverageName: string, subCoverageName: string, rowIndex: number): CoverageRow =>
  ({ refId, coverageName, subCoverageName, rowIndex })

describe('resolveCoverageHierarchy — ISO GL nested-id scheme', () => {
  // GL.COV.001 (top) / GL.COV.001.001 (sub) — refId strictly nests AND sub column is populated.
  const rows: CoverageRow[] = [
    row('GL.COV.001', 'Wrongful Acts Coverage', '', 0),
    row('GL.COV.001.001', 'Wrongful Acts Coverage', 'Terrorism Coverage', 1),
    row('GL.COV.002', 'Bodily Injury (Premises Operations)', '', 2),
    row('GL.COV.002.001', 'Bodily Injury (Premises Operations)', 'Mobile Equipment Operation', 3),
    row('GL.COV.002.002', 'Bodily Injury (Premises Operations)', 'Watercraft Liability', 4),
  ]
  const res = resolveCoverageHierarchy(rows)

  it('keeps the two top-level coverages top-level', () => {
    expect(res.filter(c => !c.isSub).map(c => c.refId)).toEqual(['GL.COV.001', 'GL.COV.002'])
  })
  it('nests each sub under its refId parent', () => {
    expect(res.find(c => c.refId === 'GL.COV.001.001')?.parentRefId).toBe('GL.COV.001')
    expect(res.find(c => c.refId === 'GL.COV.002.001')?.parentRefId).toBe('GL.COV.002')
    expect(res.find(c => c.refId === 'GL.COV.002.002')?.parentRefId).toBe('GL.COV.002')
  })
  it('resolves GL parents via refId nesting', () => {
    expect(res.find(c => c.refId === 'GL.COV.001.001')?.parentSignal).toBe('refid-nesting')
  })
  it('orders siblings in source order', () => {
    expect(res.find(c => c.refId === 'GL.COV.002.001')?.order).toBe(1)
    expect(res.find(c => c.refId === 'GL.COV.002.002')?.order).toBe(2)
  })
  it('uses the sub-coverage name as the display name', () => {
    expect(res.find(c => c.refId === 'GL.COV.001.001')?.name).toBe('Terrorism Coverage')
  })
})

describe('resolveCoverageHierarchy — SECURA flat-sibling scheme (Property)', () => {
  // The headline case: PR.COV001.5 "Debris Removal" is a sub of PR.COV001.0 "Building" — but the
  // parent refId is NOT a prefix of the child (both live under PR.COV001.*). Resolution must be by
  // the COVERAGE-group name, not by string surgery.
  const rows: CoverageRow[] = [
    row('PR.COV001.0', 'Building', '', 8),
    row('PR.COV001.1', 'Building', 'Preservation Of Property', 9),
    row('PR.COV001.5', 'Building', 'Debris Removal', 33),
    row('PR.COV001.10', 'Building', 'Flood', 10),
    row('PR.COV002.0', 'Business Personal Property', '', 60),
    row('PR.COV002.3', 'Business Personal Property', 'Debris Removal', 63),
  ]
  const res = resolveCoverageHierarchy(rows)

  it('debris removal is a sub-coverage of Building (the user headline case)', () => {
    const debris = res.find(c => c.refId === 'PR.COV001.5')
    expect(debris?.isSub).toBe(true)
    expect(debris?.parentRefId).toBe('PR.COV001.0')
    expect(debris?.parentSignal).toBe('group-name')
  })
  it('does NOT nest one flat sibling under another (.1 is not a prefix of .10)', () => {
    expect(res.find(c => c.refId === 'PR.COV001.10')?.parentRefId).toBe('PR.COV001.0')
  })
  it('each coverage group anchors on its own empty-sub top-level row', () => {
    expect(res.find(c => c.refId === 'PR.COV002.3')?.parentRefId).toBe('PR.COV002.0')
  })
  it('two top-level coverages, four sub-coverages', () => {
    expect(res.filter(c => !c.isSub).length).toBe(2)
    expect(res.filter(c => c.isSub).length).toBe(4)
  })
})

describe('resolveCoverageHierarchy — SECURA IM (same-name sub reused across groups)', () => {
  // "Debris Removal" appears under both Signs and Contractors Equipment — it must attach to the
  // right group each time (the COVERAGE column disambiguates, not the sub name).
  const rows: CoverageRow[] = [
    row('IM.COV044.02', 'Signs', '', 7),
    row('IM.COV044.03', 'Signs', 'Debris Removal', 8),
    row('IM.COV001.02', 'Contractors Equipment', '', 18),
    row('IM.COV001.03', 'Contractors Equipment', 'Debris Removal', 19),
  ]
  const res = resolveCoverageHierarchy(rows)
  it('attaches each Debris Removal to its own parent group', () => {
    expect(res.find(c => c.refId === 'IM.COV044.03')?.parentRefId).toBe('IM.COV044.02')
    expect(res.find(c => c.refId === 'IM.COV001.03')?.parentRefId).toBe('IM.COV001.02')
  })
})

describe('resolveCoverageHierarchy — robustness on unseen shapes', () => {
  it('pure refId nesting with NO sub-coverage column still nests', () => {
    // A hypothetical format that expresses hierarchy only through dotted ids.
    const rows = [
      row('C1', 'Dwelling', '', 0),
      row('C1.1', 'Other Structures', '', 1),   // nests under C1 by id, no sub column
      row('C1.1.1', 'Debris Removal', '', 2),    // two levels deep
      row('C2', 'Personal Property', '', 3),
    ]
    const res = resolveCoverageHierarchy(rows)
    expect(res.find(c => c.refId === 'C1.1')?.parentRefId).toBe('C1')
    expect(res.find(c => c.refId === 'C1.1.1')?.parentRefId).toBe('C1.1')
    expect(res.find(c => c.refId === 'C2')?.isSub).toBe(false)
  })

  it('sub with a blank COVERAGE cell falls back to the nearest preceding top-level', () => {
    const rows = [
      row('X.1', 'Building', '', 0),
      row('X.2', '', 'Debris Removal', 1),   // sub named, parent group cell blank
    ]
    const res = resolveCoverageHierarchy(rows)
    const sub = res.find(c => c.refId === 'X.2')
    expect(sub?.isSub).toBe(true)
    expect(sub?.parentRefId).toBe('X.1')
    expect(sub?.parentSignal).toBe('nearest-preceding')
  })

  it('a parentless sub (no preceding top-level) is promoted, never dropped', () => {
    const rows = [row('Z.9', '', 'Orphan Sub', 0)]
    const res = resolveCoverageHierarchy(rows)
    expect(res).toHaveLength(1)
    expect(res[0]!.isSub).toBe(false)
    expect(res[0]!.parentRefId).toBeNull()
  })

  it('duplicate refIds keep the first occurrence', () => {
    const rows = [
      row('PR.COV001.0', 'Building', '', 6),
      row('PR.COV001.0', 'Building', '', 8),   // duplicate id from a header/hierarchy row
    ]
    const res = resolveCoverageHierarchy(rows)
    expect(res).toHaveLength(1)
  })

  it('never emits a dangling parentRefId (every parent exists in the output)', () => {
    const rows = [
      row('A.0', 'Alpha', '', 0),
      row('A.1', 'Alpha', 'Sub One', 1),
      row('B.0', 'Beta', '', 2),
      row('B.5', 'Beta', 'Sub Five', 3),
      row('C.2', '', 'Loose Sub', 4),
    ]
    const res = resolveCoverageHierarchy(rows)
    const ids = new Set(res.map(c => c.refId))
    for (const c of res) if (c.parentRefId) expect(ids.has(c.parentRefId)).toBe(true)
  })
})
