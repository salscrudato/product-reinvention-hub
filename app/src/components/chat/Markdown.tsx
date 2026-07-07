// Markdown — the single renderer for AI assistant prose (Claims copilot + portfolio
// chat). The models emit GitHub-flavoured markdown: headings, bold/italic, bullet &
// numbered lists, fenced code, blockquotes, horizontal rules and — crucially — TABLES
// (limits & deductibles come back as a table). The old plain `whitespace-pre-wrap`
// renderers laid none of that out: a table collapsed into overlapping, one-word-per-line
// columns. This is an in-house, dependency-free parser (the repo builds its own
// primitives rather than pulling heavy libs — see icons.tsx) styled entirely with design
// tokens, so an answer reads as a clean, professional document.
//
// It is XSS-safe by construction: every node is a real React element, never
// dangerouslySetInnerHTML. Citations — any [bracketed] token: a refId, form number or
// form section — stay load-bearing: they render as crisp mono chips, and when `onCite`
// is supplied (portfolio chat) each chip is a button that navigates to the cited entity.
// Streaming-safe: it re-parses the growing text each token; an unterminated table / bold
// simply renders as literal text until its closing marker streams in.
// The pure block parser lives in markdownParser.ts (React-free, unit-tested).
import { memo, useMemo, type ReactNode } from 'react'
import { parseBlocks, type Block, type Align } from './markdownParser'

// ─── Inline parsing ─────────────────────────────────────────────────────────────
// Emphasis is intentionally limited to `*italic*` and `**bold**` (asterisks only): the
// underscore forms are skipped so identifiers the model cites verbatim — refIds, snake_case
// fields, form numbers — are never mangled into italics. `[x]` is a citation chip; `[x](url)`
// is a link (checked first so a real link is not eaten by the chip rule).
type Cite = (cite: string) => void

const RE = {
  code:   /^`([^`]+)`/,
  bold:   /^\*\*([\s\S]+?)\*\*/,
  italic: /^\*(\S[\s\S]*?\S|\S)\*/,   // no leading/trailing space inside → skips stray "a * b"
  link:   /^\[([^\]]+)\]\(([^)\s]+)\)/,
  cite:   /^\[([^\]]+)\]/,
}

/** Render the inline span content of a line: emphasis, code, links, citation chips. */
function inline(text: string, onCite: Cite | undefined, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let buf = ''
  let i = 0
  let k = 0
  const flush = () => { if (buf) { nodes.push(buf); buf = '' } }

  while (i < text.length) {
    // Only special characters can start a token — fast-path the common case.
    const ch = text[i]!
    if (ch === '`' || ch === '*' || ch === '[') {
      const rest = text.slice(i)
      let m: RegExpExecArray | null

      if ((m = RE.code.exec(rest))) {
        flush()
        nodes.push(
          <code key={`${keyBase}-k${k++}`} className="font-mono text-[.85em] px-1 py-0.5 rounded-[4px] bg-raised text-text">{m[1]}</code>,
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
        nodes.push(<em key={`${keyBase}-k${k++}`} className="italic">{inline(m[1]!, onCite, `${keyBase}-i${k}`)}</em>)
        i += m[0].length; continue
      }
      if ((m = RE.link.exec(rest))) {
        flush()
        nodes.push(
          <a key={`${keyBase}-k${k++}`} href={m[2]} target="_blank" rel="noopener noreferrer"
            className="text-accent underline underline-offset-2 hover:opacity-80">{m[1]}</a>,
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

// A [bracketed] citation. Static mono chip by default; a navigating button when the
// surface wires up `onCite`. Mirrors the chip in DeterminationCard's CitedText.
function CitationChip({ cite, onCite }: { cite: string; onCite?: Cite }) {
  const base = 'inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-[5px] bg-accent-soft text-accent font-mono text-[.82em] font-medium align-baseline'
  if (!onCite) return <span className={base}>{cite}</span>
  return (
    <button
      type="button" onClick={() => onCite(cite)} title={`Open ${cite}`}
      className={`${base} hover:bg-accent/15 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
    >
      {cite}
    </button>
  )
}

// ─── Rendering ──────────────────────────────────────────────────────────────────

const HEADING_CLASS: Record<number, string> = {
  1: 'text-[15px] font-bold text-text',
  2: 'text-[14px] font-semibold text-text',
  3: 'text-[11px] font-semibold uppercase tracking-[.06em] text-faint',   // matches DeterminationCard section titles
}

const ALIGN_CLASS: Record<Align, string> = { left: 'text-left', center: 'text-center', right: 'text-right' }

function renderBlock(b: Block, key: string, onCite: Cite | undefined): ReactNode {
  switch (b.type) {
    case 'heading': {
      const cls = HEADING_CLASS[b.level] ?? HEADING_CLASS[3]!
      const content = inline(b.text, onCite, key)
      if (b.level <= 2) return b.level === 1 ? <h3 key={key} className={cls}>{content}</h3> : <h4 key={key} className={cls}>{content}</h4>
      return <h5 key={key} className={cls}>{content}</h5>
    }
    case 'paragraph':
      return <p key={key} className="whitespace-pre-wrap leading-relaxed">{inline(b.text, onCite, key)}</p>
    case 'ul':
      return (
        <ul key={key} className="flex flex-col gap-1 list-disc pl-5 marker:text-faint">
          {b.items.map((it, j) => <li key={j} className="leading-relaxed pl-0.5">{inline(it, onCite, `${key}-${j}`)}</li>)}
        </ul>
      )
    case 'ol':
      return (
        <ol key={key} start={b.start} className="flex flex-col gap-1 list-decimal pl-5 marker:text-faint marker:text-[.85em]">
          {b.items.map((it, j) => <li key={j} className="leading-relaxed pl-0.5">{inline(it, onCite, `${key}-${j}`)}</li>)}
        </ol>
      )
    case 'table':
      return (
        <div key={key} className="overflow-x-auto rounded-[10px]" style={{ border: '1px solid var(--color-border)' }}>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-raised">
                {b.headers.map((hd, j) => (
                  <th key={j} className={`font-semibold text-text px-3 py-2 ${ALIGN_CLASS[b.align[j] ?? 'left']}`}
                    style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {inline(hd, onCite, `${key}-h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {b.headers.map((_, c) => (
                    <td key={c} className={`text-dim px-3 py-2 align-top ${ALIGN_CLASS[b.align[c] ?? 'left']}`}
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
    case 'code':
      return (
        <pre key={key} className="overflow-x-auto rounded-[10px] p-3 text-[12px] leading-relaxed"
          style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
          <code className="font-mono text-text">{b.text}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote key={key} className="pl-3 text-dim italic" style={{ borderLeft: '2px solid var(--color-border-strong)' }}>
          {inline(b.text, onCite, key)}
        </blockquote>
      )
    case 'hr':
      return <hr key={key} className="border-0 border-t" style={{ borderColor: 'var(--color-border)' }} />
  }
}

/** Render AI assistant prose (GitHub-flavoured markdown) as a clean, token-styled
 *  document. Pass `onCite` to make [citation] chips navigate to the cited entity. */
function MarkdownImpl({ text, onCite }: { text: string; onCite?: Cite }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <div className="flex flex-col gap-3 text-[13.5px] leading-relaxed text-text break-words">
      {blocks.map((b, i) => renderBlock(b, `b${i}`, onCite))}
    </div>
  )
}

// Memoised so a stable prior message doesn't re-parse when the streaming message updates.
export const Markdown = memo(MarkdownImpl)
