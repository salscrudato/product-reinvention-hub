// Highlight — the shared search-match marker. Wraps every case-insensitive
// occurrence of `query` in text with the same <mark> treatment the command
// palette and combobox use, so highlighted matches read as one system.
import type { ReactNode } from 'react'

export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  if (!q) return <>{text}</>
  const lower = text.toLowerCase()
  const nodes: ReactNode[] = []
  let i = 0
  let k = 0
  while (i < text.length) {
    const at = lower.indexOf(q, i)
    if (at < 0) { nodes.push(text.slice(i)); break }
    if (at > i) nodes.push(text.slice(i, at))
    nodes.push(
      <mark key={k++} className="bg-accent-soft text-accent not-italic rounded-[2px]">
        {text.slice(at, at + q.length)}
      </mark>,
    )
    i = at + q.length
  }
  return <>{nodes}</>
}
