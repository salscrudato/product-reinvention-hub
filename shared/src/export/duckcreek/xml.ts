// Minimal XML infrastructure for the Author XML overlay.
//
// WRITER: two-space indent, attributes in the caller's insertion order (pinned per
// element from the SP3 exemplars), ASCII-only output — non-ASCII characters are
// emitted as numeric character references (spec §4.1 "ASCII only").
//
// PARSER: a deliberately small, HARDENED subset parser used by the overlay lint
// (L0 well-formed) and the round-trip validation seam (mapManuscriptOverlay).
// Hardening is structural, not configuration: there is NO DTD machinery at all —
// any <!DOCTYPE is rejected outright (XXE and billion-laughs entity expansion are
// impossible because custom entities cannot be declared), only the five predefined
// entities and numeric character references resolve, and input size / element
// depth / node count are capped.

export interface XmlNode {
  name:     string
  /** Insertion order is the serialization order. */
  attrs:    Record<string, string>
  children: XmlNode[]
  /** Concatenated character data (the overlay vocabulary is element/attribute shaped). */
  text?:    string
}

export function el(name: string, attrs: Record<string, string> = {}, children: XmlNode[] = []): XmlNode {
  return { name, attrs, children }
}

// ─── Escaping ─────────────────────────────────────────────────────────────────

function escapeCommon(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0) as number
    if (ch === '&') out += '&amp;'
    else if (ch === '<') out += '&lt;'
    else if (ch === '>') out += '&gt;'
    else if (code > 126 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) out += `&#${code};`
    else out += ch
  }
  return out
}

export function escapeAttr(s: string): string {
  return escapeCommon(s).replace(/"/g, '&quot;')
}

export function escapeText(s: string): string {
  return escapeCommon(s)
}

// ─── Writer ───────────────────────────────────────────────────────────────────

export function serialize(root: XmlNode): string {
  const lines: string[] = []
  const write = (n: XmlNode, depth: number) => {
    const pad = '  '.repeat(depth)
    if (n.name === '#comment') {
      lines.push(`${pad}<!-- ${escapeText(n.text ?? '')} -->`)
      return
    }
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('')
    if (n.children.length === 0 && !n.text) {
      lines.push(`${pad}<${n.name}${attrs} />`)
      return
    }
    if (n.children.length === 0 && n.text !== undefined) {
      lines.push(`${pad}<${n.name}${attrs}>${escapeText(n.text)}</${n.name}>`)
      return
    }
    lines.push(`${pad}<${n.name}${attrs}>`)
    for (const c of n.children) write(c, depth + 1)
    lines.push(`${pad}</${n.name}>`)
  }
  write(root, 0)
  return lines.join('\n') + '\n'
}

// ─── Hardened parser ──────────────────────────────────────────────────────────

export interface ParseLimits {
  /** Max input size in bytes (UTF-16 code units approximate the cap well enough). */
  maxChars:  number
  maxDepth:  number
  maxNodes:  number
}

export const DEFAULT_PARSE_LIMITS: ParseLimits = {
  maxChars: 5 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 200_000,
}

export class XmlParseError extends Error {
  constructor(message: string, public readonly at?: number) {
    super(message)
    this.name = 'XmlParseError'
  }
}

const PREDEFINED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

function decodeEntities(s: string, at: number): string {
  return s.replace(/&([^;&]{0,32});|&/g, (_m, body: string | undefined, off: number) => {
    if (body === undefined) throw new XmlParseError('bare "&" — unterminated entity', at + (off as unknown as number))
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new XmlParseError(`bad character reference &${body};`, at)
      return String.fromCodePoint(code)
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new XmlParseError(`bad character reference &${body};`, at)
      return String.fromCodePoint(code)
    }
    const rep = PREDEFINED[body]
    // Structural hardening: custom entities cannot exist because DOCTYPE is rejected,
    // so any non-predefined entity is an error — never an expansion.
    if (rep === undefined) throw new XmlParseError(`undefined entity &${body}; (custom entities are not supported)`, at)
    return rep
  })
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/

/**
 * Parse a single-document XML string into an XmlNode tree.
 * Throws XmlParseError on: DOCTYPE (always — DTDs are disabled by construction),
 * processing anomalies, size/depth/node-count cap breaches, malformed markup.
 */
export function parseXml(input: string, limits: ParseLimits = DEFAULT_PARSE_LIMITS): XmlNode {
  if (input.length > limits.maxChars) {
    throw new XmlParseError(`document exceeds the ${limits.maxChars}-character cap`)
  }
  let i = 0
  const n = input.length
  let nodes = 0

  // Strip BOM + leading whitespace.
  if (input.charCodeAt(0) === 0xfeff) i = 1
  const skipWs = () => { while (i < n && /\s/.test(input[i] as string)) i++ }

  const skipMisc = () => {
    for (;;) {
      skipWs()
      if (input.startsWith('<?', i)) {
        const end = input.indexOf('?>', i)
        if (end < 0) throw new XmlParseError('unterminated processing instruction', i)
        i = end + 2
        continue
      }
      if (input.startsWith('<!--', i)) {
        const end = input.indexOf('-->', i)
        if (end < 0) throw new XmlParseError('unterminated comment', i)
        i = end + 3
        continue
      }
      if (input.startsWith('<!DOCTYPE', i) || input.startsWith('<!doctype', i)) {
        throw new XmlParseError('DOCTYPE is not allowed (DTDs, external entities and entity expansion are disabled)', i)
      }
      if (input.startsWith('<![CDATA[', i)) return // handled by content loop
      return
    }
  }

  const parseElement = (depth: number): XmlNode => {
    if (depth > limits.maxDepth) throw new XmlParseError(`element depth exceeds the ${limits.maxDepth} cap`, i)
    if (++nodes > limits.maxNodes) throw new XmlParseError(`node count exceeds the ${limits.maxNodes} cap`, i)
    if (input[i] !== '<') throw new XmlParseError('expected element start', i)
    i++
    const nameStart = i
    while (i < n && !/[\s/>]/.test(input[i] as string)) i++
    const name = input.slice(nameStart, i)
    if (!NAME_RE.test(name)) throw new XmlParseError(`bad element name "${name.slice(0, 40)}"`, nameStart)
    const node: XmlNode = { name, attrs: {}, children: [] }

    // Attributes.
    for (;;) {
      skipWs()
      if (i >= n) throw new XmlParseError('unterminated start tag', i)
      if (input.startsWith('/>', i)) { i += 2; return node }
      if (input[i] === '>') { i++; break }
      const aStart = i
      while (i < n && !/[\s=/>]/.test(input[i] as string)) i++
      const aName = input.slice(aStart, i)
      if (!NAME_RE.test(aName)) throw new XmlParseError(`bad attribute name "${aName.slice(0, 40)}"`, aStart)
      skipWs()
      if (input[i] !== '=') throw new XmlParseError(`attribute "${aName}" missing value`, i)
      i++
      skipWs()
      const q = input[i]
      if (q !== '"' && q !== "'") throw new XmlParseError(`attribute "${aName}" value must be quoted`, i)
      i++
      const vStart = i
      while (i < n && input[i] !== q) i++
      if (i >= n) throw new XmlParseError(`unterminated attribute value for "${aName}"`, vStart)
      if (Object.prototype.hasOwnProperty.call(node.attrs, aName)) {
        throw new XmlParseError(`duplicate attribute "${aName}"`, aStart)
      }
      node.attrs[aName] = decodeEntities(input.slice(vStart, i), vStart)
      i++
    }

    // Content.
    let text = ''
    for (;;) {
      if (i >= n) throw new XmlParseError(`unterminated element <${name}>`, i)
      if (input.startsWith('</', i)) {
        i += 2
        const cStart = i
        while (i < n && input[i] !== '>' && !/\s/.test(input[i] as string)) i++
        const cName = input.slice(cStart, i)
        skipWs()
        if (input[i] !== '>') throw new XmlParseError('malformed end tag', i)
        i++
        if (cName !== name) throw new XmlParseError(`mismatched end tag </${cName}> for <${name}>`, cStart)
        if (text.trim()) node.text = text.trim()
        return node
      }
      if (input.startsWith('<!--', i)) {
        const end = input.indexOf('-->', i)
        if (end < 0) throw new XmlParseError('unterminated comment', i)
        i = end + 3
        continue
      }
      if (input.startsWith('<![CDATA[', i)) {
        const end = input.indexOf(']]>', i)
        if (end < 0) throw new XmlParseError('unterminated CDATA section', i)
        text += input.slice(i + 9, end)
        i = end + 3
        continue
      }
      if (input.startsWith('<!DOCTYPE', i) || input.startsWith('<!doctype', i)) {
        throw new XmlParseError('DOCTYPE is not allowed (DTDs, external entities and entity expansion are disabled)', i)
      }
      if (input[i] === '<') {
        node.children.push(parseElement(depth + 1))
        continue
      }
      const tStart = i
      while (i < n && input[i] !== '<') i++
      text += decodeEntities(input.slice(tStart, i), tStart)
    }
  }

  skipMisc()
  if (i >= n || input[i] !== '<') throw new XmlParseError('no root element', i)
  const root = parseElement(1)
  skipMisc()
  skipWs()
  if (i < n) throw new XmlParseError('content after the root element', i)
  return root
}

/** ASCII scan for L0 (spec §6): every byte of the serialized overlay must be ASCII. */
export function firstNonAsciiIndex(s: string): number {
  for (let k = 0; k < s.length; k++) {
    if (s.charCodeAt(k) > 126) return k
  }
  return -1
}
