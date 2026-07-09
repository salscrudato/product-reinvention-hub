// Markdown — premium AI prose renderer. Handles GFM headings, bold/italic, bullet
// & numbered lists, fenced code blocks (dark surface, copy button), tables (striped,
// hover), blockquotes, horizontal rules, and [citation] chips that navigate to the
// cited entity when `onCite` is wired.
//
// Design goals: typography-forward hierarchy, generous whitespace, every block has a
// clear visual identity. Code blocks use a near-black dark surface so they read as
// a distinct zone inside the light chat, not just a slightly different grey.
//
// XSS-safe: all nodes are React elements, never dangerouslySetInnerHTML.
// Streaming-safe: incomplete tables/bold/code stay as literal text until the closing
// marker arrives — no crashes, no layout jank during streaming.
import { memo, useState, useMemo, type ReactNode } from 'react'
import { parseBlocks, type Block, type Align } from './markdownParser'

type Cite = (cite: string) => void

// ─── Inline parser ─────────────────────────────────────────────────────────────
// Asterisks only — underscore forms are intentionally absent so snake_case refIds
// and form numbers never get accidentally italicised mid-word.

const RE = {
  code:   /^`([^`]+)`/,
  bold:   /^\*\*([\s\S]+?)\*\*/,
  italic: /^\*(\S[\s\S]*?\S|\S)\*/,
  link:   /^\[([^\]]+)\]\(([^)\s]+)\)/,
  cite:   /^\[([^\]]+)\]/,
}

function inline(text: string, onCite: Cite | undefined, keyBase: string): ReactNode[] {
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
        nodes.push(<strong key={`${keyBase}-k${k++}`} className="font-semibold text-text">{inline(m[1]!, onCite, `${keyBase}-b${k}`)}</strong>)
        i += m[0].length; continue
      }
      if ((m = RE.italic.exec(rest))) {
        flush()
        nodes.push(<em key={`${keyBase}-k${k++}`} className="italic text-dim">{inline(m[1]!, onCite, `${keyBase}-i${k}`)}</em>)
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
        nodes.push(<CitationChip key={`${keyBase}-k${k++}`} cite={m[1]!.trim()} onCite={onCite} />)
        i += m[0].length; continue
      }
    }
    buf += ch; i++
  }
  flush()
  return nodes
}

// ─── Citation chip ──────────────────────────────────────────────────────────────
// Load-bearing — every chip navigates to the cited entity when onCite is wired.
// Hover state uses a ring instead of a fill change to keep the chip readable.

function CitationChip({ cite, onCite }: { cite: string; onCite?: Cite }) {
  const base = 'inline-flex items-center px-1.5 py-[2px] mx-0.5 rounded-[5px] font-mono text-[.78em] font-semibold align-baseline text-accent transition-all'
  const style = { background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent-line)' }
  if (!onCite) return <span className={base} style={style}>{cite}</span>
  return (
    <button type="button" onClick={() => onCite(cite)} title={`Open ${cite}`}
      className={`${base} hover:bg-accent/20 hover:shadow-[0_0_0_1.5px_var(--color-accent-line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
      style={style}>
      {cite}
    </button>
  )
}

// ─── Code block ────────────────────────────────────────────────────────────────
// Dark near-black surface (var(--color-code-bg)) so code reads as a distinct zone.
// Copy button gives tactile "I got it" feedback with a 2-second "✓ Copied" state.

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="rounded-[12px] overflow-hidden"
      style={{ background: 'var(--color-code-bg)', border: '1px solid var(--color-code-border)' }}>
      {/* Header bar: language label + copy button */}
      <div className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: '1px solid var(--color-code-border)' }}>
        <span className="font-mono text-[9.5px] uppercase tracking-[.12em]"
          style={{ color: 'var(--color-code-meta)' }}>
          code
        </span>
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

// ─── Block renderer ─────────────────────────────────────────────────────────────

const ALIGN_CLASS: Record<Align, string> = { left: 'text-left', center: 'text-center', right: 'text-right' }

function renderBlock(b: Block, key: string, onCite: Cite | undefined): ReactNode {
  switch (b.type) {

    // Headings — three distinct visual tiers:
    // H1 → large bold with border-bottom separator
    // H2 → medium semibold with accent left border
    // H3+ → small uppercase accent label
    case 'heading': {
      const content = inline(b.text, onCite, key)
      if (b.level === 1) return (
        <h3 key={key} className="text-[17px] font-bold text-text pb-2.5 leading-snug tracking-tight"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          {content}
        </h3>
      )
      if (b.level === 2) return (
        <h4 key={key} className="text-[14px] font-semibold text-text pl-3 leading-snug"
          style={{ borderLeft: '2.5px solid var(--color-accent)' }}>
          {content}
        </h4>
      )
      return (
        <h5 key={key} className="text-[10.5px] font-bold uppercase tracking-[.1em] text-accent">
          {content}
        </h5>
      )
    }

    // Paragraphs — slightly taller line-height than body for prose readability.
    case 'paragraph':
      return (
        <p key={key} className="whitespace-pre-wrap leading-[1.72]">
          {inline(b.text, onCite, key)}
        </p>
      )

    // Unordered lists — accent-colour dot bullets instead of default browser disc.
    case 'ul':
      return (
        <ul key={key} className="flex flex-col gap-1.5">
          {b.items.map((it, j) => (
            <li key={j} className="flex items-start gap-2.5 leading-[1.72]">
              <span className="shrink-0 mt-[0.52em] w-[5px] h-[5px] rounded-full"
                style={{ background: 'var(--color-accent)' }} aria-hidden="true" />
              <span className="flex-1 min-w-0">{inline(it, onCite, `${key}-${j}`)}</span>
            </li>
          ))}
        </ul>
      )

    // Ordered lists — accent-coloured bold numerals flush-right for clean alignment.
    case 'ol':
      return (
        <ol key={key} className="flex flex-col gap-1.5">
          {b.items.map((it, j) => (
            <li key={j} className="flex items-start gap-2 leading-[1.72]">
              <span className="shrink-0 text-[11px] font-bold text-accent tabular-nums mt-[0.22em] min-w-[1.4em] text-right select-none" aria-hidden="true">
                {b.start + j}.
              </span>
              <span className="flex-1 min-w-0">{inline(it, onCite, `${key}-${j}`)}</span>
            </li>
          ))}
        </ol>
      )

    // Tables — rounded container, bold header, alternating row tints, row hover.
    case 'table':
      return (
        <div key={key} className="overflow-x-auto rounded-[12px]"
          style={{ border: '1px solid var(--color-border)' }}>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {b.headers.map((hd, j) => (
                  <th key={j} className={`font-semibold text-text px-3.5 py-2.5 ${ALIGN_CLASS[b.align[j] ?? 'left']}`}
                    style={{ background: 'var(--color-raised)', borderBottom: '1.5px solid var(--color-border)' }}>
                    {inline(hd, onCite, `${key}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r} className="transition-colors hover:bg-raised/60"
                  style={r % 2 === 1 ? { background: 'var(--color-stripe)' } : undefined}>
                  {b.headers.map((_, c) => (
                    <td key={c} className={`text-dim px-3.5 py-2 align-top ${ALIGN_CLASS[b.align[c] ?? 'left']}`}
                      style={{ borderTop: '1px solid var(--color-border)' }}>
                      {inline(row[c] ?? '', onCite, `${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    // Code — dark panel component with copy button.
    case 'code':
      return <CodeBlock key={key} text={b.text} />

    // Blockquotes — accent left border + soft accent wash.
    case 'quote':
      return (
        <blockquote key={key} className="pl-4 py-1 italic leading-[1.72] rounded-r-[6px]"
          style={{
            borderLeft: '3px solid var(--color-accent)',
            background: 'var(--color-accent-soft)',
            color: 'var(--color-dim)',
          }}>
          {inline(b.text, onCite, key)}
        </blockquote>
      )

    case 'hr':
      return (
        <hr key={key} className="border-0 border-t my-0.5"
          style={{ borderColor: 'var(--color-border)' }} />
      )
  }
}

// ─── Root component ─────────────────────────────────────────────────────────────

function MarkdownImpl({ text, onCite }: { text: string; onCite?: Cite }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <div className="flex flex-col gap-3.5 text-[13.5px] leading-[1.72] text-text break-words">
      {blocks.map((b, i) => renderBlock(b, `b${i}`, onCite))}
    </div>
  )
}

// Memoised — stable prior messages don't re-parse when the streaming message updates.
export const Markdown = memo(MarkdownImpl)
