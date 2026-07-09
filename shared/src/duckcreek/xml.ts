// duckcreek/xml.ts — a tiny, dependency-free XML writer + parser. shared/ carries no
// runtime deps, so rather than pull in an XML library we implement exactly the subset the
// serializer emits and the validator round-trips: elements, ordered attributes, a single
// text value OR nested child elements (never mixed), self-closing empties, the XML
// declaration and comments. The writer is deterministic (fixed 2-space indent, attribute
// order preserved from the node); the parser is strict (throws on malformed input) so it
// doubles as the well-formedness check for our own dialect.

export type XmlAttr = [name: string, value: string]

/** An XML element. Content model: attributes plus EITHER `text` OR `children`, never both
 *  text and child elements together (keeps writer + parser unambiguous). */
export interface XmlNode {
  name:     string
  attrs:    XmlAttr[]
  children: XmlNode[]
  text?:    string
}

// ─── Builders ──────────────────────────────────────────────────────────────────

/** A container element (child elements, no text). */
export function el(name: string, attrs: XmlAttr[] = [], children: XmlNode[] = []): XmlNode {
  return { name, attrs, children }
}

/** A leaf element carrying a text value (and optional attributes). */
export function leaf(name: string, text: string | number, attrs: XmlAttr[] = []): XmlNode {
  return { name, attrs, children: [], text: String(text) }
}

/** An empty (self-closing) element with attributes only. */
export function empty(name: string, attrs: XmlAttr[] = []): XmlNode {
  return { name, attrs, children: [] }
}

// ─── Escaping ────────────────────────────────────────────────────────────────

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;')
}
function unescape(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos);/g, (_, e: string) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : "'")
}

// ─── Writer ──────────────────────────────────────────────────────────────────

export interface WriteXmlOptions {
  declaration?: string   // full <?xml …?> line; omit for none
  comment?:     string   // a leading comment, rendered as <!-- comment -->
  indent?:      string   // per-level indent (default two spaces)
}

const DEFAULT_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>'

export function writeXml(root: XmlNode, opts: WriteXmlOptions = {}): string {
  const indentUnit = opts.indent ?? '  '
  const lines: string[] = []
  if (opts.declaration !== '') lines.push(opts.declaration ?? DEFAULT_DECLARATION)
  if (opts.comment) lines.push(`<!-- ${opts.comment} -->`)

  const attrStr = (attrs: XmlAttr[]): string =>
    attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('')

  const write = (node: XmlNode, depth: number): void => {
    const pad = indentUnit.repeat(depth)
    const open = `${node.name}${attrStr(node.attrs)}`
    if (node.children.length === 0 && (node.text === undefined || node.text === '')) {
      lines.push(`${pad}<${open} />`)
      return
    }
    if (node.children.length === 0) {
      lines.push(`${pad}<${open}>${escapeText(node.text!)}</${node.name}>`)
      return
    }
    lines.push(`${pad}<${open}>`)
    for (const child of node.children) write(child, depth + 1)
    lines.push(`${pad}</${node.name}>`)
  }

  write(root, 0)
  return lines.join('\n') + '\n'
}

// ─── Parser (strict; focused on the dialect writeXml emits) ────────────────────

class Parser {
  private s: string
  private i = 0
  constructor(input: string) { this.s = input }

  private error(msg: string): never {
    throw new Error(`XML parse error at ${this.i}: ${msg}`)
  }
  private peek(): string { return this.s[this.i] ?? '' }
  private startsWith(t: string): boolean { return this.s.startsWith(t, this.i) }
  eof(): boolean { return this.i >= this.s.length }
  skipWs(): void { while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++ }

  private readName(): string {
    const start = this.i
    while (this.i < this.s.length && !/[\s/>=]/.test(this.s[this.i]!)) this.i++
    if (this.i === start) this.error('expected a name')
    return this.s.slice(start, this.i)
  }

  private readAttrs(): XmlAttr[] {
    const attrs: XmlAttr[] = []
    for (;;) {
      this.skipWs()
      const c = this.peek()
      if (c === '>' || c === '/' || c === '') break
      const name = this.readName()
      this.skipWs()
      if (this.peek() !== '=') this.error(`expected '=' after attribute '${name}'`)
      this.i++ // consume '='
      this.skipWs()
      if (this.peek() !== '"') this.error(`expected '"' opening value of '${name}'`)
      this.i++ // consume opening quote
      const vStart = this.i
      while (this.i < this.s.length && this.peek() !== '"') this.i++
      if (this.eof()) this.error(`unterminated attribute value for '${name}'`)
      const value = unescape(this.s.slice(vStart, this.i))
      this.i++ // consume closing quote
      attrs.push([name, value])
    }
    return attrs
  }

  parseElement(): XmlNode {
    if (this.peek() !== '<') this.error("expected '<'")
    this.i++ // consume '<'
    const name = this.readName()
    const attrs = this.readAttrs()
    this.skipWs()
    if (this.startsWith('/>')) { this.i += 2; return { name, attrs, children: [] } }
    if (this.peek() !== '>') this.error(`expected '>' or '/>' closing tag <${name}>`)
    this.i++ // consume '>'
    return this.parseContent(name, attrs)
  }

  private parseContent(name: string, attrs: XmlAttr[]): XmlNode {
    const children: XmlNode[] = []
    let text = ''
    for (;;) {
      if (this.eof()) this.error(`unclosed element <${name}>`)
      if (this.startsWith('</')) {
        this.i += 2
        const close = this.readName()
        if (close !== name) this.error(`mismatched close </${close}> for <${name}>`)
        this.skipWs()
        if (this.peek() !== '>') this.error(`expected '>' closing </${name}>`)
        this.i++
        break
      }
      if (this.peek() === '<') {
        children.push(this.parseElement())
      } else {
        const start = this.i
        while (this.i < this.s.length && this.peek() !== '<') this.i++
        text += this.s.slice(start, this.i)
      }
    }
    // Children win: inter-element whitespace collected in `text` is discarded.
    if (children.length > 0) return { name, attrs, children }
    const trimmed = text.trim()
    return trimmed === '' ? { name, attrs, children: [] } : { name, attrs, children: [], text: unescape(trimmed) }
  }
}

/** Parse a document into its root element. Strips the XML declaration + comments first.
 *  Throws on any malformedness (used as the well-formedness gate). */
export function parseXml(input: string): XmlNode {
  const stripped = input
    .replace(/^﻿/, '')
    .replace(/^\s*<\?xml[\s\S]*?\?>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const p = new Parser(stripped)
  p.skipWs()
  const root = p.parseElement()
  p.skipWs()
  if (!p.eof()) throw new Error('XML parse error: unexpected trailing content after root element')
  return root
}

// ─── Traversal helpers ─────────────────────────────────────────────────────────

/** Depth-first list of every element whose tag name matches `name`. */
export function findAll(root: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode): void => {
    if (n.name === name) out.push(n)
    for (const c of n.children) walk(c)
  }
  walk(root)
  return out
}

/** The value of an attribute, or undefined when absent. */
export function attr(node: XmlNode, name: string): string | undefined {
  return node.attrs.find(([k]) => k === name)?.[1]
}

/** Depth-first list of every element in the tree (root included). */
export function everyNode(root: XmlNode): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode): void => { out.push(n); for (const c of n.children) walk(c) }
  walk(root)
  return out
}
