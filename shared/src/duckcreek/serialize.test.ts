// serialize.test.ts — the serializer must be DETERMINISTIC (byte-identical across runs),
// COMPLETE (every PDM node emitted), PRESERVE every refId + form number, and be driven by
// the mapping (element names are DATA, not hard-coded). No giant snapshots — structure +
// counts only.
import { describe, it, expect } from 'vitest'
import { buildPersonalHomePdm, buildPersonalAutoPdm } from '../pdm/source'
import { flattenCoverages, allTerms, type PdmProduct } from '../pdm/types'
import { serializePdmToDuckCreek } from './serialize'
import { parseXml, findAll, attr } from './xml'
import { DEFAULT_DUCKCREEK_MAPPING, composeManuscriptId } from './mapping'

const PRODUCTS: Array<[string, () => PdmProduct]> = [
  ['Personal Home', buildPersonalHomePdm],
  ['Personal Auto', buildPersonalAutoPdm],
]

describe.each(PRODUCTS)('serializer — %s', (_name, build) => {
  const pdm = build()
  const xml = serializePdmToDuckCreek(pdm)

  it('is deterministic — two serializations are byte-identical', () => {
    expect(serializePdmToDuckCreek(pdm)).toBe(xml)
  })

  it('is deterministic end-to-end — rebuild + reserialize is byte-identical', () => {
    expect(serializePdmToDuckCreek(build())).toBe(xml)
  })

  it('is well-formed and declares the dctSys namespace + manuScriptID pattern', () => {
    const root = parseXml(xml)
    expect(root.name).toBe(DEFAULT_DUCKCREEK_MAPPING.elements.manuscript)
    expect(attr(root, 'xmlns:dctSys')).toBe(DEFAULT_DUCKCREEK_MAPPING.namespace.uri)
    expect(attr(root, 'manuScriptID')).toBe(composeManuscriptId(DEFAULT_DUCKCREEK_MAPPING, pdm.line.code, 'viewModel'))
    expect(attr(root, 'manuScriptID')).toMatch(/^[A-Za-z]+_[A-Za-z]+_[A-Za-z_]+_[A-Za-z]+_[A-Z]{2}_\d+_\d+_\d+_\d+$/)
  })

  it('emits a node for every coverage / term / form / rule / step / table', () => {
    const root = parseXml(xml)
    const E = DEFAULT_DUCKCREEK_MAPPING.elements
    expect(findAll(root, E.coverage).length).toBe(flattenCoverages(pdm.coverages).length)
    const terms = allTerms(pdm)
    expect(findAll(root, E.limit).length).toBe(terms.filter(t => t.kind === 'LIMIT').length)
    expect(findAll(root, E.deductible).length).toBe(terms.filter(t => t.kind === 'DEDUCTIBLE').length)
    expect(findAll(root, E.options).length).toBe(terms.filter(t => t.kind === 'OPTION').length)
    expect(findAll(root, E.form).length).toBe(pdm.forms.length)
    expect(findAll(root, E.rule).length).toBe(pdm.rules.length)
    expect(findAll(root, E.step).length).toBe(pdm.ratingPrograms[0]!.steps.length)
    expect(findAll(root, E.table).length).toBe(pdm.ratingTables.length)
  })

  it('preserves every refId', () => {
    const refIds = [
      ...flattenCoverages(pdm.coverages).map(c => c.refId),
      ...allTerms(pdm).map(t => t.refId),
      ...pdm.rules.map(r => r.refId),
      ...pdm.ratingPrograms.map(p => p.refId),
      ...pdm.ratingPrograms.flatMap(p => p.steps.map(s => s.refId)),
      ...pdm.ratingTables.map(t => t.refId),
    ]
    for (const ref of refIds) expect(xml).toContain(`refId="${ref}"`)
  })

  it('preserves every form-number chip (as ref + as a FormNumber element)', () => {
    const E = DEFAULT_DUCKCREEK_MAPPING.elements
    for (const f of pdm.forms) {
      expect(xml).toContain(`refId="${f.formNumber}"`)
      expect(xml).toContain(`<${E.formNumber}>${f.formNumber}</${E.formNumber}>`)
    }
  })
})

describe('serializer is mapping-driven (element names are DATA, not hard-coded)', () => {
  it('honours a custom element name + id prefix from the mapping', () => {
    const mapping = structuredClone(DEFAULT_DUCKCREEK_MAPPING)
    mapping.elements.coverage = 'cvg'
    mapping.idPrefix.coverage = 'Z'
    const xml = serializePdmToDuckCreek(buildPersonalHomePdm(), { mapping })
    expect(xml).toContain('<cvg ')
    expect(xml).not.toContain('<coverage ')
    // Coverage ids now use the overridden prefix letter.
    const root = parseXml(xml)
    for (const c of findAll(root, 'cvg')) expect(attr(c, 'id')!.startsWith('Z')).toBe(true)
  })

  it('can omit the leading comment', () => {
    const xml = serializePdmToDuckCreek(buildPersonalAutoPdm(), { comment: '' })
    expect(xml).toContain('<?xml')
    expect(xml).not.toContain('<!--')
  })
})
