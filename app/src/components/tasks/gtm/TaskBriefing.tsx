// TaskBriefing — the "Explain what's left for this task" action. It reuses the EXISTING
// server-side grounded chat/tools path (adapter.fns.stream('chat', …)) scoped to the linked
// product; there is NO new model and NO client-side AI. Tool chips show while the 8 grounding
// tools run, the answer renders with [refId]/form-number citation chips that deep-link into
// the product editors, and the server's own honesty (says "not found" on an empty tool
// result, flags unverifiable citations) is surfaced verbatim. Mirrors the Home cockpit chat.
import { useEffect, useRef, useState } from 'react'
import { adapter } from '../../../lib/backend'
import { useProductCtx } from '../../../context/useProductCtx'
import { Markdown } from '../../chat/Markdown'
import { IconSparkle, IconCheck, IconSpinner, IconWarning } from '../../ui/icons'
import { productDeepLink } from './taskLens'
import type { TaskDoc } from './gtm'

type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }
  | { t: 'notice'; level: 'info' | 'warn'; message: string; refs?: string[] }
  | { t: 'error'; message: string }
  | { t: 'done' }

interface ToolChip { name: string; done: boolean; summary?: string }

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ')

export function TaskBriefing({ task, pid, onNavigate }: {
  task: TaskDoc; pid: string; onNavigate: (to: string) => void
}) {
  const { coverages, rules, forms } = useProductCtx()
  const [phase, setPhase] = useState<'idle' | 'streaming' | 'done'>('idle')
  const [text, setText]   = useState('')
  const [tools, setTools] = useState<ToolChip[]>([])
  const [notice, setNotice] = useState<{ message: string; level: 'info' | 'warn' } | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const bufRef   = useRef('')
  const rafRef   = useRef<number | null>(null)
  const sessionRef = useRef(`task_${task.id}_${Math.random().toString(36).slice(2, 8)}`)

  // Cancel any in-flight stream on unmount (drawer close / task switch).
  useEffect(() => () => abortRef.current?.abort(), [])

  // Resolve a cited [refId] / form number to the right product editor deep link.
  function openCitation(cite: string) {
    const n = norm(cite)
    if (forms.some(f => norm(f.number) === n)) { onNavigate(productDeepLink(pid, { tab: 'forms', formNumber: cite })); return }
    const cov = coverages.find(c => (c.refId ?? '').toUpperCase() === n)
    if (cov?.refId) { onNavigate(productDeepLink(pid, { tab: 'coverages', ref: cov.refId })); return }
    if (rules.some(r => (r.refId ?? '').toUpperCase() === n)) { onNavigate(productDeepLink(pid, { tab: 'rules' })); return }
    onNavigate(productDeepLink(pid, { tab: 'overview' }))
  }

  async function run() {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('streaming'); setText(''); setTools([]); setNotice(null)
    bufRef.current = ''

    const prompt = `In the launch project for this product, I'm working the task "${task.title}"`
      + (task.groupL3 ? ` in the "${task.groupL3}" group (${task.phaseL2 ?? 'unphased'})` : '')
      + `. Using ONLY this product's coverages, forms, rules and rating, explain what's left to complete this task`
      + ` — the specific coverages, forms, rules, tables or premium checks it depends on. Cite every specific item with`
      + ` its [refId] or form number. If a tool returns nothing, or nothing relevant is linked, say so plainly rather than guessing.`

    const flush = () => { rafRef.current = null; setText(bufRef.current) }
    try {
      await adapter.fns.stream('chat',
        { messages: [{ role: 'user', content: prompt }], productId: pid, sessionId: sessionRef.current },
        (chunk) => {
          let ev: StreamEvent
          try { ev = JSON.parse(chunk) as StreamEvent } catch { return }
          switch (ev.t) {
            case 'token':
              bufRef.current += ev.v
              if (rafRef.current === null) rafRef.current = requestAnimationFrame(flush)
              break
            case 'tool':
              setTools(prev => {
                const next = [...prev]
                if (ev.phase === 'start') next.push({ name: ev.name, done: false })
                else {
                  const i = [...next].reverse().findIndex(t => t.name === ev.name && !t.done)
                  if (i >= 0) next[next.length - 1 - i] = { name: ev.name, done: true, summary: ev.summary }
                }
                return next
              })
              break
            case 'notice': setNotice({ message: ev.message, level: ev.level }); break
            case 'error':  bufRef.current += `\n\n⚠️ ${ev.message}`; setText(bufRef.current); break
            case 'done':
            case 'json':   break
          }
        },
        controller.signal,
      )
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return
      setText(t => t || `⚠️ ${err instanceof Error ? err.message : 'Briefing request failed.'}`)
    } finally {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; setText(bufRef.current) }
      if (abortRef.current === controller) { setPhase('done'); abortRef.current = null }
    }
  }

  const streaming = phase === 'streaming'

  return (
    <div className="flex flex-col gap-2.5">
      {phase === 'idle' ? (
        <button type="button" onClick={() => void run()}
          className="inline-flex items-center gap-2 self-start h-9 px-3.5 rounded-[10px] bg-accent-soft text-accent text-[13px] font-semibold transition-colors hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          style={{ border: '1px solid var(--color-accent-line)' }}>
          <IconSparkle size={15} aria-hidden="true" />Explain what's left for this task
        </button>
      ) : (
        <div className="flex flex-col gap-2.5" aria-live="polite">
          {tools.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {tools.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-[10.5px] font-medium"
                  style={{
                    background: t.done ? 'var(--color-good-soft)' : 'var(--color-accent-soft)',
                    border: `1px solid ${t.done ? 'var(--color-good-line, var(--color-border))' : 'var(--color-accent-line)'}`,
                    color: t.done ? 'var(--color-good)' : 'var(--color-accent)',
                  }}>
                  <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: t.done ? 'var(--color-good-soft)' : 'var(--color-accent-line)' }}>
                    {t.done ? <IconCheck size={9} aria-hidden="true" /> : <IconSpinner size={9} className="animate-spin" aria-hidden="true" />}
                  </span>
                  <span className="font-mono">{t.name}</span>
                  {t.done && t.summary && <span className="opacity-60 font-sans">· {t.summary}</span>}
                </span>
              ))}
            </div>
          )}

          {text.trim()
            ? <div className="text-sm"><Markdown text={text} onCite={openCitation} /></div>
            : streaming
              ? <p className="text-[12.5px] text-dim italic">Reading this product's coverages, forms, rules and rating…</p>
              : <p className="text-[12.5px] text-faint italic">No briefing produced.</p>}

          {notice && (
            <div className={`flex items-start gap-1.5 text-[12px] ${notice.level === 'info' ? 'text-dim' : 'text-warn'}`} role="note">
              {notice.level === 'info'
                ? <IconSparkle size={13} className="shrink-0 mt-0.5 text-accent" aria-hidden="true" />
                : <IconWarning size={13} className="shrink-0 mt-0.5" aria-hidden="true" />}
              <span>{notice.message}</span>
            </div>
          )}

          {phase === 'done' && (
            <button type="button" onClick={() => void run()}
              className="self-start inline-flex items-center gap-1 text-[11px] text-faint hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[6px] px-1">
              ↻ Ask again
            </button>
          )}
        </div>
      )}
    </div>
  )
}
