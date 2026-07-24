// BuilderChat — collapsible AI assistant panel for the Builder route.
// Lazy-loaded chunk to keep the Builder route chunk within the 25 kB gzip budget.
import { useEffect, useRef, useState } from 'react'
import { adapter } from '../../lib/backend'
import { IconChat, IconChevronDown, IconCheck } from '../ui/icons'
import { ChatComposer } from '../chat/ChatComposer'
import { StreamRenderer } from '../ai/StreamRenderer'
import { WaveformLoader } from '../ai/WaveformLoader'

type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool'; name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'notice'; level: string; message: string }
  | { t: 'json'; key: string; value: unknown }
  | { t: 'error'; message: string }
  | { t: 'done' }

interface ToolChip { name: string; done: boolean; summary?: string }
interface ChatMessage { role: 'user' | 'assistant'; text: string; tools: ToolChip[] }

export function BuilderChat() {
  const [chatOpen,  setChatOpen]  = useState(false)
  const [messages,  setMessages]  = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef  = useRef<HTMLDivElement>(null)
  const abortRef   = useRef<AbortController | null>(null)
  const textBufRef = useRef('')
  const rafRef     = useRef<number | null>(null)
  const [sessionId] = useState(() => `s_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`)

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])

  async function ask(text: string) {
    const q = text.trim()
    if (!q || streaming) return
    setChatInput('')
    const history: ChatMessage[] = [...messages, { role: 'user', text: q, tools: [] }]
    setMessages([...history, { role: 'assistant', text: '', tools: [] }])
    setStreaming(true)
    textBufRef.current = ''

    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages(prev => { const n = [...prev]; const i = n.length - 1; if (i >= 0 && n[i]!.role === 'assistant') n[i] = fn(n[i]!); return n })

    abortRef.current?.abort()
    const ctrl = new AbortController(); abortRef.current = ctrl
    try {
      await adapter.fns.stream('chat', { messages: history.map(m => ({ role: m.role, content: m.text })), sessionId, regenerate: false }, (chunk) => {
        let ev: StreamEvent
        try { ev = JSON.parse(chunk) as StreamEvent } catch { return }
        if (ev.t === 'token') {
          textBufRef.current += ev.v
          if (rafRef.current === null) rafRef.current = requestAnimationFrame(() => { rafRef.current = null; const t = textBufRef.current; patch(m => ({ ...m, text: t })) })
        } else if (ev.t === 'tool') {
          patch(m => {
            const tools = [...m.tools]
            if (ev.phase === 'start') tools.push({ name: ev.name, done: false })
            else { const i = [...tools].reverse().findIndex(t => t.name === ev.name && !t.done); if (i >= 0) tools[tools.length - 1 - i] = { name: ev.name, done: true, summary: ev.summary } }
            return { ...m, tools }
          })
        } else if (ev.t === 'error') {
          patch(m => ({ ...m, text: m.text + `\n\n⚠️ ${ev.message}` }))
        }
      }, ctrl.signal)
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') patch(m => ({ ...m, text: m.text || `⚠️ ${err instanceof Error ? err.message : 'Request failed.'}` }))
    } finally {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; const t = textBufRef.current; if (t) patch(m => ({ ...m, text: t })) }
      if (abortRef.current === ctrl) setStreaming(false)
    }
  }

  return (
    <section aria-label="Builder assistant">
      <button
        type="button"
        onClick={() => setChatOpen(o => !o)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-[10px] text-sm font-medium text-dim hover:text-accent hover:bg-accent-soft transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ border: '1px solid var(--color-border)' }}
        aria-expanded={chatOpen}
      >
        <IconChat size={15} aria-hidden="true" />
        Chat
        <IconChevronDown size={13} className={`transition-transform duration-200 ${chatOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {chatOpen && (
        <div className="mt-3 rounded-[16px] flex flex-col overflow-hidden"
          style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <div ref={scrollRef} className="overflow-y-auto max-h-[420px] p-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <IconChat size={28} className="text-faint" aria-hidden="true" />
                <p className="text-sm text-dim">Ask anything about your drafts, coverages, or product rules.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4" role="log" aria-live="off" aria-label="Conversation">
                {messages.map((m, i) => (
                  <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={m.role === 'user'
                        ? 'max-w-[85%] rounded-[14px] px-4 py-2.5 text-sm text-white'
                        : 'max-w-[92%] flex flex-col gap-2'}
                      style={m.role === 'user' ? { background: 'var(--gradient-accent)' } : undefined}
                    >
                      {m.role === 'assistant' && m.tools.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                          {m.tools.map((t, ti) => (
                            <span key={ti}
                              className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-[10.5px] font-medium transition-colors"
                              style={{
                                background: t.done ? 'var(--color-good-soft)' : 'var(--color-accent-soft)',
                                border: `1px solid ${t.done ? 'var(--color-good-line)' : 'var(--color-accent-line)'}`,
                                color: t.done ? 'var(--color-good)' : 'var(--color-accent)',
                              }}>
                              {t.done
                                ? <IconCheck size={9} aria-hidden="true" />
                                : <WaveformLoader size="xs" label="" className="text-accent" />}
                              <span className="font-mono">{t.name}</span>
                              {t.done && t.summary && <span className="opacity-60 font-sans">· {t.summary}</span>}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.role === 'assistant'
                        ? <div className="text-sm text-text"><StreamRenderer text={m.text} streaming={streaming && i === messages.length - 1} /></div>
                        : m.text}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-3" style={{ borderTop: '1px solid var(--color-border)' }}>
            <ChatComposer
              value={chatInput}
              onChange={setChatInput}
              onSubmit={() => void ask(chatInput)}
              onAutoSubmit={ask}
              streaming={streaming}
            />
          </div>
        </div>
      )}
    </section>
  )
}
