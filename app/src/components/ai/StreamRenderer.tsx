// StreamRenderer — rich SSE stream output for the portfolio assistant and claims copilot.
// Extends the core Markdown renderer with streaming-specific enhancements:
//   • Per-block fade-in (para-in CSS class) layered on top of the existing RAF batching.
//   • Citation chips: hover card showing entity summary; click still navigates.
//   • Collapsible reasoning/consideration sections (detect via heading text).
//   • Coverage comparison tables: adds a labelled header above any table whose first
//     column header contains "coverage", "option", "plan", or "alternative".
//   • SVG sparklines for lists whose items contain two or more dollar amounts.
// Zero new third-party dependencies. 175 kB gzip budget is enforced by the gate.
import { useRef, useEffect, useState, memo, type ReactNode } from 'react'
import { parseBlocks, type Block } from '../chat/markdownParser'
import { WaveformLoader } from './WaveformLoader'
import type { SearchIndexEntry } from '@pf/shared'

// ─── Types ───────────────────────────────────────────────────────────────────

type CiteFn = (cite: string) => void

// ─── Section grouping ─────────────────────────────────────────────────────────
// Detects collapsible headings and groups their following blocks into a section.

const COLLAPSIBLE_RE = /^(reasoning|considerations|key considerations|things to consider|open items|coverage gap|analysis)$/i

type Section =
  | { kind: 'block'; block: Block; idx: number }
  | { kind: 'collapsible'; label: string; level: number; blocks: Block[]; startIdx: number }

function groupSections(blocks: Block[]): Section[] {
  const out: Section[] = []
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]!
    if (b.type === 'heading' && COLLAPSIBLE_RE.test(b.text)) {
      const level = b.level
      const grouped: Block[] = []
      const startIdx = i
      i++
      while (i < blocks.length) {
        const next = blocks[i]!
        if (next.type === 'heading' && next.level <= level) break
        grouped.push(next)
        i++
      }
      out.push({ kind: 'collapsible', label: b.text, level, blocks: grouped, startIdx })
    } else {
      out.push({ kind: 'block', block: b, idx: i })
      i++
    }
  }
  return out
}

// ─── Dollar amount extraction (for sparklines) ────────────────────────────────

const DOLLAR_RE = /\$[\d,]+(?:\.\d+)?/g

function extractAmounts(text: string): number[] {
  const matches = [...text.matchAll(DOLLAR_RE)]
  return matches.map(m => parseFloat(m[0].replace(/[$,]/g, '')))
}

function amountsFromList(items: string[]): number[] {
  return items.flatMap(it => extractAmounts(it))
}

// ─── SVG Sparkline (hand-rolled, no chart library) ───────────────────────────
// Renders a tiny proportional bar chart for a list of dollar amounts.

function Sparkline({ amounts }: { amounts: number[] }) {
  if (amounts.length < 2) return null
  const max = Math.max(...amounts)
  if (max === 0) return null
  const W = 120
  const H = 28
  const gap = 3
  const barW = Math.max(4, Math.floor((W - gap * (amounts.length - 1)) / amounts.length))
  const totalW = barW * amounts.length + gap * (amounts.length - 1)
  const offsetX = Math.max(0, (W - totalW) / 2)

  return (
    <svg
      width={W} height={H + 14} viewBox={`0 0 ${W} ${H + 14}`}
      aria-label={`Premium comparison: ${amounts.map(a => '$' + a.toLocaleString()).join(', ')}`}
      role="img"
      style={{ display: 'block', marginTop: 6 }}
    >
      {amounts.map((amt, i) => {
        const h = Math.max(3, Math.round((amt / max) * H))
        const x = offsetX + i * (barW + gap)
        const y = H - h
        return (
          <g key={i}>
            <rect
              x={x} y={y} width={barW} height={h}
              rx={2}
              fill="var(--color-accent)"
              opacity={0.7 + 0.3 * (amt / max)}
            />
            <text
              x={x + barW / 2} y={H + 11}
              textAnchor="middle"
              fontSize={8}
              fill="var(--color-faint)"
              fontFamily="var(--font-mono)"
            >
              ${amt >= 1000 ? (amt / 1000).toFixed(1) + 'k' : amt.toLocaleString()}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Citation hover card ──────────────────────────────────────────────────────
// On hover: a small popover card with entity type, title, and refId/form number.
// On click: navigate via onCite (unchanged from existing chip behaviour).

function lookupEntry(cite: string, index?: SearchIndexEntry[]): SearchIndexEntry | null {
  if (!index?.length) return null
  const norm = cite.toLowerCase().replace(/\s+/g, ' ').trim()
  return index.find(e =>
    (e.refId ?? '').toLowerCase() === norm ||
    e.subtitle?.toLowerCase() === norm ||
    e.title.toLowerCase().includes(norm) ||
    (e.keywords ?? []).some(k => k.toLowerCase() === norm.replace(/\s/g, '-') || k.toLowerCase() === norm),
  ) ?? null
}

function CitationChipWithCard({ cite, onCite, index }: { cite: string; onCite?: CiteFn; index?: SearchIndexEntry[] }) {
  const [hovered, setHovered] = useState(false)
  const entry = lookupEntry(cite, index)

  const base = 'relative inline-flex items-center px-1.5 py-[2px] mx-0.5 rounded-[5px] font-mono text-[.78em] font-semibold align-baseline text-accent transition-all'
  const chipStyle: React.CSSProperties = { background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent-line)' }

  const chip = onCite ? (
    <button
      type="button"
      onClick={() => onCite(cite)}
      title={entry ? entry.title : `Open ${cite}`}
      className={`${base} hover:bg-accent/20 hover:shadow-[0_0_0_1.5px_var(--color-accent-line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
      style={chipStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {cite}
    </button>
  ) : (
    <span
      className={base}
      style={chipStyle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {cite}
    </span>
  )

  if (!entry) return chip

  return (
    <span className="relative inline-flex items-baseline">
      {chip}
      {hovered && (
        <span
          role="tooltip"
          className="absolute left-0 bottom-[calc(100%+4px)] z-50 min-w-[180px] max-w-[240px] rounded-[10px] p-2.5 text-left pointer-events-none"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-strong)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <span
            className="block text-[9.5px] font-semibold uppercase tracking-[.08em] mb-1"
            style={{ color: 'var(--color-accent)' }}
          >
            {entry.type}
          </span>
          <span className="block text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>
            {entry.title}
          </span>
          {entry.subtitle && (
            <span className="block text-[10.5px] font-mono mt-0.5" style={{ color: 'var(--color-faint)' }}>
              {entry.subtitle}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

// ─── Inline parser (citation-chip-aware) ─────────────────────────────────────
// Mirrors the inline parser in Markdown.tsx but overrides [cite] → CitationChipWithCard.

const RE = {
  code:   /^`([^`]+)`/,
  bold:   /^\*\*([\s\S]+?)\*\*/,
  italic: /^\*(\S[\s\S]*?\S|\S)\*/,
  link:   /^\[([^\]]+)\]\(([^)\s]+)\)/,
  cite:   /^\[([^\]]+)\]/,
}

function inlineNodes(text: string, onCite: CiteFn | undefined, index: SearchIndexEntry[] | undefined, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let buf = ''
  let i = 0
  let k = 0
  const flush = () => { if (buf) { nodes.push(buf); buf = '' } }

  while (i < text.length) {
    const ch = text[i]!
    if (ch === '`' || ch === '*' || ch === '[') {
      const rest = text.slice(i)
      let m: RegExpExecArray | null

      if ((m = RE.code.exec(rest))) {
        flush()
        nodes.push(
          <code key={`${keyBase}-k${k++}`}
            className="font-mono text-[.85em] px-1.5 py-[2px] rounded-[5px] font-medium text-accent"
            style={{ background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent-line)' }}>
            {m[1]}
          </code>,
        )
        i += m[0].length; continue
      }
      if ((m = RE.bold.exec(rest))) {
        flush()
        nodes.push(<strong key={`${keyBase}-k${k++}`} className="font-semibold text-text">{inlineNodes(m[1]!, onCite, index, `${keyBase}-b${k}`)}</strong>)
        i += m[0].length; continue
      }
      if ((m = RE.italic.exec(rest))) {
        flush()
        nodes.push(<em key={`${keyBase}-k${k++}`} className="italic text-dim">{inlineNodes(m[1]!, onCite, index, `${keyBase}-i${k}`)}</em>)
        i += m[0].length; continue
      }
      if ((m = RE.link.exec(rest))) {
        flush()
        nodes.push(
          <a key={`${keyBase}-k${k++}`} href={m[2]} target="_blank" rel="noopener noreferrer"
            className="text-accent underline underline-offset-2 decoration-accent/40 hover:decoration-accent transition-colors">
            {m[1]}
          </a>,
        )
        i += m[0].length; continue
      }
      if ((m = RE.cite.exec(rest))) {
        flush()
        nodes.push(
          <CitationChipWithCard key={`${keyBase}-k${k++}`} cite={m[1]!.trim()} onCite={onCite} index={index} />,
        )
        i += m[0].length; continue
      }
    }
    buf += ch; i++
  }
  flush()
  return nodes
}

// ─── Block renderer ──────────────────────────────────────────────────────────

type Align = 'left' | 'center' | 'right'
const ALIGN_CLASS: Record<Align, string> = { left: 'text-left', center: 'text-center', right: 'text-right' }

const COVERAGE_TABLE_RE = /^(coverage|option|plan|alternative|scenario)/i

function isCoverageTable(headers: string[]): boolean {
  return headers.length >= 2 && COVERAGE_TABLE_RE.test(headers[0] ?? '')
}

function renderBlock(b: Block, key: string, onCite: CiteFn | undefined, index: SearchIndexEntry[] | undefined, animate: boolean, lead = false): ReactNode {
  const cls = animate ? 'para-in' : ''

  switch (b.type) {
    case 'heading': {
      const content = inlineNodes(b.text, onCite, index, key)
      if (b.level === 1) return (
        <h3 key={key} className={`text-[17px] font-bold text-text pb-2.5 leading-snug tracking-tight ${cls}`}
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          {content}
        </h3>
      )
      if (b.level === 2) return (
        <h4 key={key} className={`text-[14px] font-semibold text-text pl-3 leading-snug ${cls}`}
          style={{ borderLeft: '2.5px solid var(--color-accent)' }}>
          {content}
        </h4>
      )
      return (
        <h5 key={key} className={`text-[10.5px] font-bold uppercase tracking-[.1em] text-accent ${cls}`}>
          {content}
        </h5>
      )
    }

    case 'paragraph':
      // The lead sentence — the answer's opening paragraph — reads a step larger
      // and a shade stronger, so the eye lands on the conclusion first.
      return (
        <p key={key} className={`whitespace-pre-wrap ${lead ? 'text-[15px] leading-[1.62] font-medium text-text' : 'leading-[1.72]'} ${cls}`}>
          {inlineNodes(b.text, onCite, index, key)}
        </p>
      )

    case 'ul': {
      const amounts = amountsFromList(b.items)
      return (
        <div key={key} className={cls}>
          <ul className="flex flex-col gap-1.5">
            {b.items.map((it, j) => (
              <li key={j} className="flex items-start gap-2.5 leading-[1.72]">
                <span className="shrink-0 mt-[0.52em] w-[5px] h-[5px] rounded-full"
                  style={{ background: 'var(--color-accent)' }} aria-hidden="true" />
                <span className="flex-1 min-w-0">{inlineNodes(it, onCite, index, `${key}-${j}`)}</span>
              </li>
            ))}
          </ul>
          {amounts.length >= 2 && <Sparkline amounts={amounts} />}
        </div>
      )
    }

    case 'ol': {
      const amounts = amountsFromList(b.items)
      return (
        <div key={key} className={cls}>
          <ol className="flex flex-col gap-1.5">
            {b.items.map((it, j) => (
              <li key={j} className="flex items-start gap-2 leading-[1.72]">
                <span className="shrink-0 text-[11px] font-bold text-accent tabular-nums mt-[0.22em] min-w-[1.4em] text-right select-none" aria-hidden="true">
                  {b.start + j}.
                </span>
                <span className="flex-1 min-w-0">{inlineNodes(it, onCite, index, `${key}-${j}`)}</span>
              </li>
            ))}
          </ol>
          {amounts.length >= 2 && <Sparkline amounts={amounts} />}
        </div>
      )
    }

    case 'table': {
      const isCovTable = isCoverageTable(b.headers)
      return (
        <div key={key} className={cls}>
          {isCovTable && (
            <p className="text-[10px] font-semibold uppercase tracking-[.08em] mb-1.5"
              style={{ color: 'var(--color-accent)' }}>
              Coverage comparison
            </p>
          )}
          <div className="overflow-x-auto rounded-[12px]"
            style={{ border: '1px solid var(--color-border)' }}>
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {b.headers.map((hd, j) => (
                    <th key={j} className={`font-semibold text-text px-3.5 py-2.5 ${ALIGN_CLASS[(b.align[j] as Align | undefined) ?? 'left']}`}
                      style={{ background: 'var(--color-raised)', borderBottom: '1.5px solid var(--color-border)' }}>
                      {inlineNodes(hd, onCite, index, `${key}-h${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => {
                  const rowAmounts = amountsFromList(row)
                  return (
                    <tr key={r} className="transition-colors hover:bg-raised/60"
                      style={r % 2 === 1 ? { background: 'var(--color-stripe)' } : undefined}>
                      {b.headers.map((_, c) => (
                        <td key={c} className={`text-dim px-3.5 py-2 align-top ${ALIGN_CLASS[(b.align[c] as Align | undefined) ?? 'left']}`}
                          style={{ borderTop: '1px solid var(--color-border)' }}>
                          {inlineNodes(row[c] ?? '', onCite, index, `${key}-${r}-${c}`)}
                        </td>
                      ))}
                      {rowAmounts.length >= 2 && (
                        <td className="px-3.5 py-2 align-top" style={{ borderTop: '1px solid var(--color-border)' }}>
                          <Sparkline amounts={rowAmounts} />
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    case 'code': return <CodeBlock key={key} text={b.text} animate={animate} />

    case 'quote':
      return (
        <blockquote key={key} className={`pl-4 py-1 italic leading-[1.72] rounded-r-[6px] ${cls}`}
          style={{
            borderLeft: '3px solid var(--color-accent)',
            background: 'var(--color-accent-soft)',
            color: 'var(--color-dim)',
          }}>
          {inlineNodes(b.text, onCite, index, key)}
        </blockquote>
      )

    case 'hr':
      return (
        <hr key={key} className="border-0 border-t my-0.5"
          style={{ borderColor: 'var(--color-border)' }} />
      )
  }
}

// ─── Code block ──────────────────────────────────────────────────────────────

function CodeBlock({ text, animate }: { text: string; animate: boolean }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className={`rounded-[12px] overflow-hidden ${animate ? 'para-in' : ''}`}
      style={{ background: 'var(--color-code-bg)', border: '1px solid var(--color-code-border)' }}>
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: '1px solid var(--color-code-border)' }}>
        <span className="font-mono text-[9.5px] uppercase tracking-[.12em]"
          style={{ color: 'var(--color-code-meta)' }}>code</span>
        <button type="button" onClick={copy}
          className="text-[11px] font-medium transition-colors select-none"
          style={{ color: copied ? 'var(--color-good)' : 'var(--color-code-meta)' }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="px-4 py-4 overflow-x-auto text-[12.5px] leading-[1.65]">
        <code className="font-mono" style={{ color: 'var(--color-code-text)' }}>{text}</code>
      </pre>
    </div>
  )
}

// ─── Collapsible section ─────────────────────────────────────────────────────
// Wraps a heading + its following blocks in a disclosure widget. Default open
// (so streaming content is visible); settles to collapsed once the stream ends,
// unless the reader has toggled it themselves — depth stays one click away and
// the finished answer reads short.

function CollapsibleSection({ label, blocks, firstNewBlockIdx, blockStartIdx, streaming, onCite, index }: {
  label: string
  blocks: Block[]
  firstNewBlockIdx: number
  blockStartIdx: number
  streaming: boolean
  onCite?: CiteFn
  index?: SearchIndexEntry[]
}) {
  const [open, setOpen] = useState(true)
  const touchedRef = useRef(false)
  const wasStreamingRef = useRef(streaming)
  useEffect(() => {
    if (wasStreamingRef.current && !streaming && !touchedRef.current) setOpen(false)
    wasStreamingRef.current = streaming
  }, [streaming])
  const isNew = blockStartIdx >= firstNewBlockIdx

  return (
    <div className={`rounded-[12px] overflow-hidden ${isNew ? 'para-in' : ''}`}
      style={{ border: '1px solid var(--color-border)' }}>
      <button
        type="button"
        onClick={() => { touchedRef.current = true; setOpen(o => !o) }}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
        style={{ background: 'var(--color-raised)' }}
        aria-expanded={open}
      >
        <span className="text-[12.5px] font-semibold text-text">{label}</span>
        <span className="ml-auto text-[10px] font-mono text-faint" aria-hidden="true">
          {open ? '' : `${blocks.length} block${blocks.length === 1 ? '' : 's'}`}
        </span>
        <span
          className="shrink-0 transition-transform"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', color: 'var(--color-faint)' }}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-4 py-4 text-sm text-text">
          {blocks.map((b, i) => renderBlock(
            b,
            `cs-${label}-${i}`,
            onCite,
            index,
            (blockStartIdx + 1 + i) >= firstNewBlockIdx,
          ))}
        </div>
      )}
    </div>
  )
}

// ─── StreamRenderer (root) ───────────────────────────────────────────────────

interface StreamRendererProps {
  text: string
  streaming: boolean
  onCite?: CiteFn
  citationIndex?: SearchIndexEntry[]
}

function StreamRendererImpl({ text, streaming, onCite, citationIndex }: StreamRendererProps) {
  const blocks = parseBlocks(text)
  const prevCountRef = useRef(0)
  const firstNewBlockIdx = prevCountRef.current

  // Track block count so only newly-appearing blocks get the fade-in animation.
  useEffect(() => {
    prevCountRef.current = blocks.length
  })

  const sections = groupSections(blocks)

  return (
    <div className="flex flex-col gap-3.5 text-[13.5px] leading-[1.72] text-text break-words">
      {sections.map((sec, si) => {
        if (sec.kind === 'block') {
          const animate = streaming && sec.idx >= firstNewBlockIdx
          const lead = si === 0 && sec.block.type === 'paragraph'
          return renderBlock(sec.block, `sr-${si}`, onCite, citationIndex, animate, lead)
        }
        return (
          <CollapsibleSection
            key={`sr-cs-${si}`}
            label={sec.label}
            blocks={sec.blocks}
            firstNewBlockIdx={firstNewBlockIdx}
            blockStartIdx={sec.startIdx}
            streaming={streaming}
            onCite={onCite}
            index={citationIndex}
          />
        )
      })}
      {streaming && blocks.length === 0 && (
        <WaveformLoader size="sm" label="Generating answer…" />
      )}
    </div>
  )
}

export const StreamRenderer = memo(StreamRendererImpl)
