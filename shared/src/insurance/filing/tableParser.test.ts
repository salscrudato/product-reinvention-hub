// tableParser.test.ts — the deterministic factor-table parser, exercised against VERBATIM
// regions of the reference filing. Proves the parser reads real rows, never invents cells,
// counts what it can't parse, and that a numeric-looking range label can't corrupt a matrix.
import { describe, it, expect } from 'vitest'
import { parseFactorTable, sampleCells, cellValueAppearsInText, parseNumericToken } from './tableParser'
import { NJ_LEMONADE_EXTRACTION } from './njLemonadeFiling'

const ruleFor = (concept: string) => NJ_LEMONADE_EXTRACTION.manual.rules.find(r => r.concept === concept)!

describe('parseNumericToken', () => {
  it('strips currency/percent/thousands formatting', () => {
    expect(parseNumericToken('$1,250.00')).toBe(1250)
    expect(parseNumericToken('0.93')).toBe(0.93)
    expect(parseNumericToken('50%')).toBe(50)
  })
  it('rejects placeholders and non-numbers', () => {
    for (const t of ['-', '–', '—', '', 'n/a', 'Statewide']) expect(parseNumericToken(t)).toBeNull()
  })
})

describe('pairs — base loss cost by territory', () => {
  it('parses every territory → loss cost row', () => {
    const p = parseFactorTable(ruleFor('baseLossCost').table!)
    expect(p.skipped).toBe(0)
    expect(p.rows.length).toBe(12)
    // Territory 30 → $456.93 and 41 → $170.89, both verbatim from the page.
    expect(p.rows.find(r => r.territory === '30')!.lossCost).toBe(456.93)
    expect(p.rows.find(r => r.territory === '41')!.lossCost).toBe(170.89)
  })
})

describe('triples — zip → territory → LCMF', () => {
  it('parses zip/territory/factor triples with leading zeros preserved', () => {
    const p = parseFactorTable(ruleFor('lossCostMod').table!)
    expect(p.skipped).toBe(0)
    expect(p.rows.length).toBe(6)
    const r = p.rows.find(x => x.zip === '07004')!
    expect(r.territory).toBe('30')     // kept as a string — leading zero survives
    expect(r.lcmf).toBe(1.606)
  })
})

describe('matrix — deductible factor by Coverage A band × deductible', () => {
  it('parses a 2-D matrix without mistaking the numeric range label for a value', () => {
    const p = parseFactorTable(ruleFor('allPerilDed').table!)
    expect(p.skipped).toBe(0)
    // 2 bands × 5 deductibles = 10 cells.
    expect(p.rows.length).toBe(10)
    const cell = p.rows.find(r => r.covABand === '$300,000 and Over' && r.deductible === '2500')!
    expect(cell.factor).toBe(0.83)
    // The "$100,000 to $199,999" band label (which contains numeric-looking tokens) is intact.
    expect(p.rows.some(r => r.covABand === '$100,000 to $199,999')).toBe(true)
    expect(p.rows.find(r => r.covABand === '$100,000 to $199,999' && r.deductible === '10000')!.factor).toBe(0.66)
  })

  it('SKIPS a ragged row rather than mis-aligning it into invented cells', () => {
    const p = parseFactorTable({
      layout: 'matrix', keyColumns: ['covABand', 'deductible'], columnKeys: ['1000', '2500', '5000'], valueColumn: 'factor',
      rowRegion: ['$300,000 and Over  0.94  0.83  0.74', 'Up to $99,999  0.93  0.81'].join('\n'),  // 2nd row only has 2 of 3 values
    })
    expect(p.rows.length).toBe(3)   // only the complete row emits
    expect(p.skipped).toBe(1)       // the ragged row is counted, never invented
  })
})

describe('sampled verification', () => {
  it('samples spread-out cells whose values appear literally in the source region', () => {
    const rule = ruleFor('baseLossCost')
    const p = parseFactorTable(rule.table!)
    const cells = sampleCells(p, 'lossCost', 5)
    expect(cells.length).toBe(5)
    for (const c of cells) expect(cellValueAppearsInText(c.value, rule.table!.rowRegion)).toBe(true)
  })
  it('flags a fabricated value that is NOT in the source region', () => {
    expect(cellValueAppearsInText(999.99, ruleFor('baseLossCost').table!.rowRegion)).toBe(false)
  })
})
