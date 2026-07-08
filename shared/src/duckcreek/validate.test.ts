// validate.test.ts — the validator must PASS a faithful document (well-formed + structural
// consistency + round-trip, with per-section counts) and CATCH tampering (malformed XML,
// dropped/renamed nodes, missing namespace). No giant snapshots — assert the report.
import { describe, it, expect } from 'vitest'
import { buildPersonalHomePdm, buildPersonalAutoPdm } from '../pdm/source'
import { type PdmProduct } from '../pdm/types'
import { serializePdmToDuckCreek } from './serialize'
import { validateDuckCreek, summarizeReport } from './validate'

const PRODUCTS: Array<[string, () => PdmProduct]> = [
  ['Personal Home', buildPersonalHomePdm],
  ['Personal Auto', buildPersonalAutoPdm],
]

describe.each(PRODUCTS)('validation report — %s', (_name, build) => {
  const pdm = build()
  const xml = serializePdmToDuckCreek(pdm)
  const report = validateDuckCreek(pdm, xml)

  it('passes every check on a faithful document', () => {
    expect(report.ok).toBe(true)
    expect(report.wellFormed).toBe(true)
    expect(report.namespaceDeclared).toBe(true)
    expect(report.idPrefixesValid).toBe(true)
    expect(report.crossRefsValid).toBe(true)
    expect(report.roundTripOk).toBe(true)
  })

  it('reports no dropped, extra or duplicate nodes', () => {
    expect(report.missingRefIds).toEqual([])
    expect(report.extraRefIds).toEqual([])
    expect(report.duplicateIds).toEqual([])
    expect(report.issues).toEqual([])
  })

  it('every section count balances (expected === emitted)', () => {
    expect(report.counts.length).toBeGreaterThan(0)
    for (const c of report.counts) expect(c.emitted).toBe(c.expected)
    expect(summarizeReport(report)).toContain('[PASS]')
  })
})

describe('validator catches tampering', () => {
  const pdm = buildPersonalHomePdm()
  const good = serializePdmToDuckCreek(pdm)

  it('flags a not-well-formed document', () => {
    const report = validateDuckCreek(pdm, '<manuscript><oops></manuscript>')
    expect(report.wellFormed).toBe(false)
    expect(report.ok).toBe(false)
    expect(report.issues[0]!.code).toBe('not-well-formed')
  })

  it('flags a dropped / renamed coverage refId as a round-trip failure', () => {
    // Rename one coverage's refId so it no longer matches the PDM.
    const tampered = good.replace('refId="PH.COV.006"', 'refId="PH.COV.999"')
    expect(tampered).not.toBe(good)
    const report = validateDuckCreek(pdm, tampered)
    expect(report.roundTripOk).toBe(false)
    expect(report.ok).toBe(false)
    expect(report.missingRefIds.some(m => m.refId === 'PH.COV.006')).toBe(true)
    expect(report.extraRefIds.some(m => m.refId === 'PH.COV.999')).toBe(true)
  })

  it('flags a missing namespace declaration', () => {
    const tampered = good.replace(/ xmlns:dctSys="[^"]*"/, '')
    const report = validateDuckCreek(pdm, tampered)
    expect(report.namespaceDeclared).toBe(false)
    expect(report.ok).toBe(false)
  })

  it('flags a broken id-prefix convention', () => {
    // Corrupt the first coverage id's prefix letter (c → z).
    const tampered = good.replace('id="c', 'id="z')
    const report = validateDuckCreek(pdm, tampered)
    expect(report.idPrefixesValid).toBe(false)
    expect(report.ok).toBe(false)
  })
})
