// Identifiers come in ANY format. The import must classify on what a source SAYS, not on
// whether it happens to follow the reference workbook's punctuation.
//
// Observed live (app-prodhub-dev, run verify-ms0mavy9): the real Hagerty CORE book routed as
// "LOB undetected" purely because its ids are prefixed "CORE" — a carrier prefix no registry
// line claims — while the workbook names "Personal Auto" outright in its LINE OF BUSINESS
// column. Convention was consulted; the evidence was not.
import { describe, it, expect } from 'vitest'
import { refIdSegmentKind, inferLob, resolveLobByRefId, PA_LOB, GL_LOB } from './lobRegistry'

describe('refIdSegmentKind — the kind token may sit anywhere', () => {
  it('still classifies the reference shapes exactly as before', () => {
    expect(refIdSegmentKind('GL.COV.002.003')).toBe('coverage')
    expect(refIdSegmentKind('CORE.PRD.001')).toBe('product')
    expect(refIdSegmentKind('PR.PROD001')).toBe('product')
    expect(refIdSegmentKind('IM.COV044.00')).toBe('coverage')
    expect(refIdSegmentKind('GL-PROD-001')).toBe('product')
    expect(refIdSegmentKind('GL.LOB.001')).toBe('lob')
  })

  it('a PREFIX that spells a kind never beats the segment (no regression)', () => {
    // "RU" is the rule token, but here it is the LINE prefix — the SEGMENT is authoritative.
    expect(refIdSegmentKind('RU.COV.001')).toBe('coverage')
    expect(refIdSegmentKind('LD.FORM.9')).toBe('form')
  })

  it('classifies ids that lead with the kind, or bury it', () => {
    expect(refIdSegmentKind('COV-001')).toBe('coverage')          // no line prefix at all
    expect(refIdSegmentKind('001-COV-1')).toBe('coverage')        // numeric first
    expect(refIdSegmentKind('Coverage 12')).toBe('coverage')      // spelled out
    expect(refIdSegmentKind('HAGERTY/CORE/RULE/17')).toBe('rule') // slash separators
    expect(refIdSegmentKind('form_00_12')).toBe('form')           // lowercase + underscores
  })

  it('still returns null when nothing names a kind', () => {
    expect(refIdSegmentKind('12345')).toBeNull()
    expect(refIdSegmentKind('')).toBeNull()
    expect(refIdSegmentKind(null)).toBeNull()
    expect(refIdSegmentKind('WIDGET-7')).toBeNull()
  })
})

describe('lobByPrefix — case must not decide whether a line resolves', () => {
  it('resolves a lowercase prefix', () => {
    expect(resolveLobByRefId('gl.cov.001')).toBe(GL_LOB)
    expect(resolveLobByRefId('GL.COV.001')).toBe(GL_LOB)
  })
  it('still claims nothing for an unknown carrier prefix', () => {
    expect(resolveLobByRefId('CORE.COV.001')).toBeUndefined()
  })
})

describe('inferLob — a stated line beats a guessed one', () => {
  it('reads the line the workbook NAMES even when no id prefix is known', () => {
    // Exactly the CORE case: carrier-prefixed ids, plus the stated LINE OF BUSINESS value.
    expect(inferLob({
      refIds: ['CORE.PRD.001', 'CORE.COV.001', 'CORE.COV.002'],
      lobName: 'Personal Auto',
      sheetNames: ['Core Framework', 'Core Forms Specifications'],
    })).toBe(PA_LOB)
  })

  it('an explicit statement outranks an incidental sheet-name match', () => {
    expect(inferLob({
      refIds: [],
      lobName: 'Personal Auto',
      sheetNames: ['General Liability Reference', 'Notes'],
    })).toBe(PA_LOB)
  })

  it('a known id prefix still wins — the strongest signal is unchanged', () => {
    expect(inferLob({ refIds: ['GL.COV.001', 'GL.COV.002'], lobName: 'Personal Auto' })).toBe(GL_LOB)
  })

  it('a placeholder-ish stated value does not resolve a line', () => {
    expect(inferLob({ refIds: [], lobName: 'Widgets', sheetNames: [] })).toBeUndefined()
  })

  it('still returns undefined when the source states nothing usable', () => {
    expect(inferLob({ refIds: ['TBD', 'N/A'], sheetNames: [] })).toBeUndefined()
  })
})
