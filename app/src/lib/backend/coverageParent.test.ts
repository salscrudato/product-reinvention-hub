import { describe, it, expect } from 'vitest'
import { validateCoverageParent } from './coverageParent'

describe('validateCoverageParent — C: server-validated parentId', () => {
  it('no-ops when parentId is null', () => {
    expect(() => validateCoverageParent(null, ['HO.COV.001'])).not.toThrow()
  })

  it('no-ops when parentId is undefined', () => {
    expect(() => validateCoverageParent(undefined, ['HO.COV.001', 'HO.COV.002'])).not.toThrow()
  })

  it('accepts a parentId that matches an existing coverage refId', () => {
    expect(() => validateCoverageParent('HO.COV.001', ['HO.COV.001', 'HO.COV.002'])).not.toThrow()
  })

  it('rejects a parentId not found among existing refIds', () => {
    expect(() => validateCoverageParent('HO.COV.999', ['HO.COV.001', 'HO.COV.002']))
      .toThrow(/not found/)
  })

  it('rejects any non-null parentId when the product has no coverages at all', () => {
    expect(() => validateCoverageParent('HO.COV.001', [])).toThrow(/not found/)
  })

  it('is case-sensitive (refId scheme is uppercase)', () => {
    expect(() => validateCoverageParent('ho.cov.001', ['HO.COV.001'])).toThrow(/not found/)
  })
})
