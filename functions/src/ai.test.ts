// ai.test.ts — locks the chat system-prompt assembly seam (buildSystemBlocks): the
// ephemeral-cache breakpoint sits on the LAST STABLE block, the volatile per-request context is
// left AFTER it (uncached), and the non-invention + cite-everything house rules survive whatever
// stable feature block (e.g. the portfolio digest) is injected. Pure + deterministic — NO live
// model call (those are flaky); this asserts only the request-shaping seam.
import { describe, it, expect } from 'vitest'
import { buildSystemBlocks } from './ai'
import { SYSTEM_PROMPT } from './tools'
import { CACHE_1H } from './runtime'
import { assemblePortfolioDigest } from '@pf/shared'

const joined = (blocks: { text: string }[]) => blocks.map(b => b.text).join('\n')

describe('buildSystemBlocks — cache breakpoint placement', () => {
  it('with no feature prompt: one block (house rules), breakpoint on it', () => {
    const blocks = buildSystemBlocks({})
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.text).toBe(SYSTEM_PROMPT)
    expect(blocks[0]!.cache_control).toEqual(CACHE_1H)
  })

  it('with a stable feature prompt: breakpoint moves to the LAST stable block (the digest)', () => {
    const blocks = buildSystemBlocks({ system: 'DIGEST BLOCK' })
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.text).toBe(SYSTEM_PROMPT)
    expect(blocks[0]!.cache_control).toBeUndefined()       // house rules are cached transitively via the prefix
    expect(blocks[1]!.text).toBe('DIGEST BLOCK')
    expect(blocks[1]!.cache_control).toEqual(CACHE_1H)     // breakpoint on the last stable block → digest is INSIDE the cache
  })

  it('volatile context is pushed AFTER the breakpoint (never cached)', () => {
    const blocks = buildSystemBlocks({ system: 'DIGEST BLOCK', context: 'focus: product X' })
    expect(blocks).toHaveLength(3)
    // Breakpoint is on the digest (last STABLE block), NOT on the volatile context.
    expect(blocks[1]!.text).toBe('DIGEST BLOCK')
    expect(blocks[1]!.cache_control).toEqual(CACHE_1H)
    expect(blocks[2]!.text).toBe('focus: product X')
    expect(blocks[2]!.cache_control).toBeUndefined()
    // Exactly one breakpoint, and it is not on the last (volatile) block.
    expect(blocks.filter(b => b.cache_control).length).toBe(1)
  })

  it('with only volatile context: breakpoint stays on the house rules, context uncached', () => {
    const blocks = buildSystemBlocks({ context: 'focus: product X' })
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.cache_control).toEqual(CACHE_1H)
    expect(blocks[1]!.cache_control).toBeUndefined()
  })
})

describe('buildSystemBlocks — grounding contract survives digest injection', () => {
  it('the assembled system prompt still carries the non-invention + cite-everything rules', () => {
    // A realistic digest from the pure assembler, injected as the stable feature block.
    const digest = assemblePortfolioDigest({
      products: [{
        refId: 'PH.PROD.001', name: 'Personal Home',
        coverages: [{ refId: 'PH.COV.001', name: 'Coverage A – Dwelling' }],
        formNumbers: ['HO 00 03'], ruleRefIds: ['PH.RU.001'],
        rating: [{ programRef: 'HO.RAT.1', premium: 1528 }],
      }],
    })
    const text = joined(buildSystemBlocks({ system: digest, context: 'focus: PH.PROD.001' }))
    // House rules (from SYSTEM_PROMPT) — the grounding contract.
    expect(text).toMatch(/never invent/i)
    expect(text).toMatch(/cite every specific claim/i)
    // The digest actually made it in.
    expect(text).toContain('[PH.COV.001]')
    expect(text).toContain('[HO.RAT.1] worked example → $1,528')
  })
})
