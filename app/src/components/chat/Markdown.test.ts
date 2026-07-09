// Markdown parser tests — the block parser is what turns AI prose into a clean document.
// The headline case is the TABLE: the old renderer laid a limits table out as overlapping,
// one-word-per-line columns; these assert it now parses into a real table block (and that the
// other block kinds + streaming half-blocks are handled without exploding).
import { describe, it, expect } from 'vitest'
import { parseBlocks, type Block } from './markdownParser'

const only = (blocks: Block[]): Block => {
  expect(blocks).toHaveLength(1)
  return blocks[0]!
}

describe('parseBlocks', () => {
  it('parses a GFM limits table into a table block (the reported regression)', () => {
    const md = [
      '| Coverage | Limit |',
      '| --- | --- |',
      '| Coverage B limit of liability | Not more than 10% of the Coverage A limit |',
      '| Coverage D limit of liability | Per the Declarations [HO.COV.004] |',
    ].join('\n')

    const b = only(parseBlocks(md))
    expect(b.type).toBe('table')
    if (b.type !== 'table') return
    expect(b.headers).toEqual(['Coverage', 'Limit'])
    expect(b.rows).toHaveLength(2)
    expect(b.rows[0]).toEqual(['Coverage B limit of liability', 'Not more than 10% of the Coverage A limit'])
    // A citation inside a cell is preserved verbatim so the chip renders in place.
    expect(b.rows[1]![1]).toContain('[HO.COV.004]')
  })

  it('honours column alignment markers', () => {
    const md = ['| L | C | R |', '| :-- | :--: | --: |', '| a | b | c |'].join('\n')
    const b = only(parseBlocks(md))
    expect(b.type === 'table' && b.align).toEqual(['left', 'center', 'right'])
  })

  it('does NOT treat a pipe row as a table until its separator streams in (streaming safety)', () => {
    // Mid-stream the model has emitted only the header row — must stay prose, not crash.
    const b = only(parseBlocks('| Coverage | Limit |'))
    expect(b.type).toBe('paragraph')
  })

  it('parses headings with their level', () => {
    expect(parseBlocks('## Limits & Deductibles')[0]).toEqual({ type: 'heading', level: 2, text: 'Limits & Deductibles' })
    expect(parseBlocks('#### Deep')[0]).toEqual({ type: 'heading', level: 4, text: 'Deep' })
  })

  it('parses unordered and ordered lists', () => {
    const ul = only(parseBlocks('- one\n- two\n- three'))
    expect(ul).toEqual({ type: 'ul', items: ['one', 'two', 'three'] })

    const ol = only(parseBlocks('2. first\n3. second'))
    expect(ol).toEqual({ type: 'ol', items: ['first', 'second'], start: 2 })
  })

  it('parses a fenced code block verbatim (with language tag)', () => {
    const b = only(parseBlocks('```ts\nconst x = 1\nconst y = 2\n```'))
    expect(b).toEqual({ type: 'code', text: 'const x = 1\nconst y = 2' })
  })

  it('parses blockquotes and horizontal rules', () => {
    expect(only(parseBlocks('> a note'))).toEqual({ type: 'quote', text: 'a note' })
    expect(only(parseBlocks('---')).type).toBe('hr')
  })

  it('does not mistake an unterminated fence for anything else (streaming safety)', () => {
    // Closing fence not yet streamed — everything after the opening fence is captured as code.
    const b = only(parseBlocks('```\nhalf a code block'))
    expect(b).toEqual({ type: 'code', text: 'half a code block' })
  })

  it('separates a paragraph, a table, and a list in one document', () => {
    const md = [
      'Here is what the form says about limits.',
      '',
      '| Coverage | Limit |',
      '| --- | --- |',
      '| A | Per Declarations |',
      '',
      'Key points:',
      '- covered peril',
      '- excluded peril',
    ].join('\n')

    const blocks = parseBlocks(md)
    expect(blocks.map(b => b.type)).toEqual(['paragraph', 'table', 'paragraph', 'ul'])
  })

  it('splits a table with no leading/trailing pipes and tolerates ragged rows', () => {
    const md = ['Coverage | Limit', '--- | ---', 'A | 10%', '| B |'].join('\n')
    const b = only(parseBlocks(md))
    expect(b.type).toBe('table')
    if (b.type !== 'table') return
    expect(b.headers).toEqual(['Coverage', 'Limit'])
    expect(b.rows).toEqual([['A', '10%'], ['B']])   // ragged last row kept; renderer pads missing cells
  })
})
