/**
 * hardening-f30-synth-prefix.test.ts — regression lock for ledger F30 (id half).
 *
 * The first completed CORE live run minted 345 XX-prefixed placeholder ids
 * (XX.RULE.SYNTH001…, XX.RT.SYNTH001…): the workbook's line is unregistered, no
 * LOB hint existed, and stage-4's synthesis ignored the source's OWN scheme —
 * sibling rows carried CORE.PRD.001 all along. The lock: prefix priority is the
 * router's line hint, then the workbook's own prefix read from real sibling ids,
 * then the obviously-fake XX last resort. Derived, never invented.
 */
import { describe, it, expect } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { synthesizeRefId } = require('../../server/lib/import-brain/stage4-extract.js')

function blankIdEntity(kind: string) {
  return {
    kind, sourceSheet: 'Rules', sourceRowIndex: 7, needsRefIdSynthesis: true,
    fields: [{ fieldName: 'refId', value: '', confidence: 0.4, citation: { sheet: 'Rules', cell: 'A9', verbatim: '' } }],
  }
}
const refIdOf = (e: { fields: Array<{ fieldName: string; value: unknown }> }) =>
  e.fields.find(f => f.fieldName === 'refId')?.value

describe('F30: synthesized placeholder ids borrow the source workbook scheme', () => {
  it('with no LOB hint, the workbook prefix from sibling real ids wins (never XX)', () => {
    const e = blankIdEntity('rule')
    synthesizeRefId(e, undefined, new Map(), 'CORE')
    expect(refIdOf(e)).toBe('CORE.RULE.SYNTH001')
  })
  it('the router line hint outranks the source prefix', () => {
    const e = blankIdEntity('coverage')
    synthesizeRefId(e, 'GL.LOB.001', new Map(), 'CORE')
    expect(refIdOf(e)).toBe('GL.COV.SYNTH001')
  })
  it('XX stays the honest last resort when nothing is derivable', () => {
    const e = blankIdEntity('rtTable')
    synthesizeRefId(e, undefined, new Map(), null)
    expect(refIdOf(e)).toBe('XX.RT.SYNTH001')
  })
})
