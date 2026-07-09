// markdownParser — the pure, React-free block parser behind the chat Markdown renderer.
// AI assistants emit GitHub-flavoured markdown (headings, lists, fenced code, blockquotes,
// horizontal rules and — the case that broke the old plain-text renderer — TABLES). This
// turns a growing markdown string into a flat list of typed blocks; Markdown.tsx renders
// them with design tokens. Kept dependency-free and in its own module so it is trivially
// unit-testable and so the component file only exports components (fast-refresh clean).

export type Align = 'left' | 'center' | 'right'

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[]; start: number }
  | { type: 'table'; headers: string[]; align: Align[]; rows: string[][] }
  | { type: 'code'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'hr' }

const RX = {
  heading: /^(#{1,6})\s+(.*)$/,
  fence:   /^```/,
  hr:      /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
  ul:      /^\s*[-*+]\s+/,
  ol:      /^\s*(\d+)[.)]\s+/,
  quote:   /^\s*>\s?/,
  sep:     /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/,   // table separator row
}

/** A table starts when line `idx` has a pipe and line `idx+1` is a separator row. */
function isTableStart(lines: string[], idx: number): boolean {
  return idx + 1 < lines.length && lines[idx]!.includes('|') && RX.sep.test(lines[idx + 1]!)
}

/** Split a table row into trimmed cells, tolerating optional leading/trailing pipes. */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map(c => c.trim())
}

function cellAlign(sep: string): Align {
  const t = sep.trim()
  const l = t.startsWith(':'), r = t.endsWith(':')
  return l && r ? 'center' : r ? 'right' : 'left'
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i++; continue }

    // Fenced code — capture verbatim until the closing fence (or EOF while streaming).
    if (RX.fence.test(line)) {
      i++
      const buf: string[] = []
      while (i < lines.length && !RX.fence.test(lines[i]!)) { buf.push(lines[i]!); i++ }
      i++   // consume closing fence
      blocks.push({ type: 'code', text: buf.join('\n') })
      continue
    }

    const h = RX.heading.exec(line)
    if (h) { blocks.push({ type: 'heading', level: h[1]!.length, text: h[2]!.trim() }); i++; continue }

    if (RX.hr.test(line)) { blocks.push({ type: 'hr' }); i++; continue }

    if (isTableStart(lines, i)) {
      const headers = splitRow(line)
      const align   = splitRow(lines[i + 1]!).map(cellAlign)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) { rows.push(splitRow(lines[i]!)); i++ }
      blocks.push({ type: 'table', headers, align, rows })
      continue
    }

    if (RX.quote.test(line)) {
      const buf: string[] = []
      while (i < lines.length && RX.quote.test(lines[i]!)) { buf.push(lines[i]!.replace(RX.quote, '')); i++ }
      blocks.push({ type: 'quote', text: buf.join('\n') })
      continue
    }

    if (RX.ul.test(line)) {
      const items: string[] = []
      while (i < lines.length && RX.ul.test(lines[i]!)) { items.push(lines[i]!.replace(RX.ul, '')); i++ }
      blocks.push({ type: 'ul', items })
      continue
    }

    const ol = RX.ol.exec(line)
    if (ol) {
      const items: string[] = []
      const start = parseInt(ol[1]!, 10) || 1
      while (i < lines.length && RX.ol.test(lines[i]!)) { items.push(lines[i]!.replace(RX.ol, '')); i++ }
      blocks.push({ type: 'ol', items, start })
      continue
    }

    // Paragraph — gather consecutive lines until a blank line or the next block starts.
    const buf: string[] = []
    while (
      i < lines.length && lines[i]!.trim() &&
      !RX.heading.test(lines[i]!) && !RX.fence.test(lines[i]!) &&
      !RX.hr.test(lines[i]!) && !RX.ul.test(lines[i]!) && !RX.ol.test(lines[i]!) &&
      !RX.quote.test(lines[i]!) && !isTableStart(lines, i)
    ) { buf.push(lines[i]!); i++ }
    blocks.push({ type: 'paragraph', text: buf.join('\n') })
  }
  return blocks
}
