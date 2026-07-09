// xml.test.ts — the tiny XML writer + parser must round-trip our dialect exactly and be
// strict enough to serve as the well-formedness gate (throw on malformed input).
import { describe, it, expect } from 'vitest'
import { el, leaf, empty, writeXml, parseXml, findAll, attr, everyNode, type XmlNode } from './xml'

const sample: XmlNode = el('root', [['a', '1'], ['b', 'two']], [
  leaf('title', 'Hello & <World>'),
  empty('marker', [['id', 'x1']]),
  el('items', [], [
    leaf('item', '10', [['unit', 'dollars']]),
    leaf('item', '20', [['unit', 'dollars']]),
  ]),
])

describe('writeXml → parseXml round-trip', () => {
  it('preserves names, ordered attributes, text and nesting', () => {
    const xml = writeXml(sample)
    const back = parseXml(xml)
    expect(back.name).toBe('root')
    expect(back.attrs).toEqual([['a', '1'], ['b', 'two']])
    const title = findAll(back, 'title')[0]!
    expect(title.text).toBe('Hello & <World>')   // entities decoded back
    const items = findAll(back, 'item')
    expect(items.map(i => i.text)).toEqual(['10', '20'])
    expect(items.map(i => attr(i, 'unit'))).toEqual(['dollars', 'dollars'])
    expect(attr(findAll(back, 'marker')[0]!, 'id')).toBe('x1')
  })

  it('escapes special characters in text and attributes', () => {
    const xml = writeXml(sample)
    expect(xml).toContain('Hello &amp; &lt;World&gt;')
    const quoted = writeXml(leaf('q', 'v', [['note', 'say "hi" <ok>']]))
    expect(quoted).toContain('note="say &quot;hi&quot; &lt;ok&gt;"')
    expect(attr(parseXml(quoted), 'note')).toBe('say "hi" <ok>')
  })

  it('emits self-closing empties and declaration + optional comment', () => {
    const xml = writeXml(empty('e', [['k', 'v']]), { comment: 'hi' })
    expect(xml).toContain('<?xml version="1.0" encoding="utf-8"?>')
    expect(xml).toContain('<!-- hi -->')
    expect(xml).toContain('<e k="v" />')
  })

  it('walks every node', () => {
    expect(everyNode(sample).map(n => n.name)).toEqual(['root', 'title', 'marker', 'items', 'item', 'item'])
  })
})

describe('parseXml strictness (well-formedness gate)', () => {
  it('throws on a mismatched closing tag', () => {
    expect(() => parseXml('<a><b></a></b>')).toThrow(/mismatched/)
  })
  it('throws on an unclosed element', () => {
    expect(() => parseXml('<a><b></b>')).toThrow(/unclosed/)
  })
  it('throws on trailing content after the root', () => {
    expect(() => parseXml('<a/><b/>')).toThrow(/trailing/)
  })
  it('strips the declaration + comments before parsing', () => {
    const node = parseXml('<?xml version="1.0"?><!-- c --><a>x</a>')
    expect(node.name).toBe('a')
    expect(node.text).toBe('x')
  })
})
