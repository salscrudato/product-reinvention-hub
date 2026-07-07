// Claims Analysis — a grounded, multi-turn "coverage copilot". Two panes: a left
// base-forms library (upload/select) and a right conversation that stays DISABLED
// until a form is selected. Each turn streams over SSE from the analyzeClaim Cloud
// Function, which reads the ACTUAL uploaded policy PDF server-side plus the product's
// structured data via the grounding tools; loss determinations render as a
// deterministic DeterminationCard. The browser never calls Anthropic — everything
// goes through the adapter seam.
import { useEffect, useMemo, useRef, useState } from 'react'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { ChatComposer } from '../components/chat/ChatComposer'
import { BaseFormsLibrary, type BaseForm } from '../components/claims/BaseFormsLibrary'
import { DeterminationCard, CitedText, type Determination } from '../components/claims/DeterminationCard'
import { shouldRenderDetermination } from '../lib/claims/determination'
import { RefChip } from '../components/ui'
import { IconSparkle, IconCheck, IconSpinner, IconShield, IconChat } from '../components/ui/icons'

// ─── Stream protocol (mirror of functions/src/runtime.ts StreamEvent) ───────────
type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }
  | { t: 'error'; message: string }
  | { t: 'done' }

interface ToolChip { name: string; done: boolean; summary?: string }
interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  tools: ToolChip[]
  determination?: Determination
  historyText?: string   // what we send back as history (card turns serialise their determination)
}

// Honest, human tool-status labels for the streaming chips.
const TOOL_LABELS: Record<string, string> = {
  search_entities:   'Searching the portfolio',
  get_product_tree:  'Reading the product',
  get_coverage:      'Reading coverage',
  get_rules:         'Checking rules',
  get_forms:         'Checking forms',
  get_ld_table:      'Checking limits',
  run_rating:        'Running the rating',
  get_dictionary:    'Checking the dictionary',
  emit_determination:'Forming the determination',
}

// Domain-true examples, per line — they become one-tap starters once a form is selected.
// HO exercises water discharge, sump back-up, fire, and off-premises theft; GL exercises
// premises bodily injury, products liability, third-party property damage, and Coverage B.
const HO_EXAMPLES = [
  'A pipe burst upstairs and soaked the hardwood floors and the ceiling below.',
  'Water backed up through my basement floor drain from the sump — is that covered?',
  'A wildfire damaged my detached garage and we lived in a hotel for two weeks.',
  'My laptop was stolen from my car at the mall.',
]
const GL_EXAMPLES = [
  'A customer slipped on a wet floor in our store and broke a wrist.',
  'A product we manufactured failed months after sale and injured the user.',
  "Our crew accidentally damaged a client's equipment while working on their site.",
  'A competitor claims our new ad copied their slogan and is suing us.',
]
// Zero-state (no form selected yet): a representative blend so the surface reads multi-line.
const BLENDED_EXAMPLES = [HO_EXAMPLES[0]!, GL_EXAMPLES[0]!, HO_EXAMPLES[2]!, GL_EXAMPLES[3]!]

// Pick the starter set matching the selected form's line (defaults to HO when unknown).
function examplesFor(lob?: string): string[] {
  const l = (lob ?? '').toUpperCase()
  if (l === 'GL') return GL_EXAMPLES
  return HO_EXAMPLES
}

// Full-name tooltip for the compact line chip in the context header.
const LINE_TITLE: Record<string, string> = { HO: 'Homeowners', GL: 'General Liability' }

function toMillis(v: unknown): number {
  const o = v as { toDate?: () => Date; seconds?: number } | null
  if (o?.toDate) return o.toDate().getTime()
  if (typeof o?.seconds === 'number') return o.seconds * 1000
  return Number.MAX_SAFE_INTEGER   // pending serverTimestamp → sort newest first
}

// Chunked base64 for the uploaded PDF (avoids call-stack overflow on large files).
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(bin)
}

// Faithful text rendering of a determination so multi-turn follow-ups keep context.
function determinationToText(d: Determination): string {
  const cov = d.coverages.map(c => `${c.name}${c.refId ? ` [${c.refId}]` : ''}${c.formNumber ? ` [${c.formNumber}]` : ''} — ${c.definition}`).join('; ')
  const exc = (d.exclusions ?? []).map(e => `${e.name}${e.refId ? ` [${e.refId}]` : ''}${e.formNumber ? ` [${e.formNumber}]` : ''}${e.note ? ` — ${e.note}` : ''}`).join('; ')
  const lim = d.limits.map(l => `${l.label}: ${l.value}${l.source ? ` [${l.source}]` : ''}${l.note ? ` (${l.note})` : ''}`).join('; ')
  return [
    `Determination: ${d.verdict.replace('_', ' ')}. ${d.summary}`,
    cov && `Coverages that apply: ${cov}`,
    exc && `What's not covered: ${exc}`,
    lim && `Limits & deductibles: ${lim}`,
    d.reasoning.length ? `Reasoning: ${d.reasoning.join(' ')}` : '',
    d.openItems?.length ? `Not determined by the form: ${d.openItems.join('; ')}` : '',
  ].filter(Boolean).join('\n')
}

interface FormData { base64?: string; text?: string; mediaType: string }

export default function Claims() {
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'
  const actor = user ? { uid: user.uid, name: user.name ?? user.email ?? 'User' } : null

  const [forms, setForms]         = useState<BaseForm[]>([])
  const [loading, setLoading]     = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [messages, setMessages]   = useState<ChatMessage[]>([])
  const [input, setInput]         = useState('')
  const [streaming, setStreaming] = useState(false)

  const [formData, setFormData]   = useState<FormData | null>(null)
  const [formState, setFormState] = useState<'idle' | 'loading' | 'error'>('idle')

  const scrollRef = useRef<HTMLDivElement>(null)

  // Live base-forms library.
  useEffect(() => {
    const unsub = adapter.db.subscribe<BaseForm>('baseForms', d => {
      if (Array.isArray(d)) { setForms(d); setLoading(false) }
    })
    return unsub
  }, [])

  const sortedForms = useMemo(
    () => [...forms].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
    [forms],
  )
  const selectedForm = useMemo(
    () => sortedForms.find(f => f.id === selectedId) ?? null,
    [sortedForms, selectedId],
  )

  // A new selection starts a fresh conversation (a different policy).
  useEffect(() => { setMessages([]); setInput('') }, [selectedId])

  // Load the selected form's bytes once so every turn can ground on the real policy.
  const selectedUrl = selectedForm?.url
  const selectedMedia = selectedForm?.mediaType
  useEffect(() => {
    if (!selectedUrl) { setFormData(null); setFormState('idle'); return }
    let cancelled = false
    setFormState('loading'); setFormData(null)
    ;(async () => {
      try {
        const resp = await fetch(selectedUrl)
        if (!resp.ok) throw new Error('read failed')
        const blob = await resp.blob()
        const isPdf = selectedMedia === 'application/pdf' || blob.type === 'application/pdf'
        const data: FormData = isPdf
          ? { base64: toBase64(await blob.arrayBuffer()), mediaType: 'application/pdf' }
          : { text: await blob.text(), mediaType: 'text/plain' }
        if (!cancelled) { setFormData(data); setFormState('idle') }
      } catch {
        if (!cancelled) setFormState('error')
      }
    })()
    return () => { cancelled = true }
  }, [selectedUrl, selectedMedia])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const composerReady = !!selectedForm && !!formData && formState === 'idle'

  async function ask(text: string) {
    const question = text.trim()
    if (!question || streaming || !selectedForm || !formData) return
    setInput('')

    const history: ChatMessage[] = [...messages, { role: 'user', text: question, tools: [] }]
    setMessages([...history, { role: 'assistant', text: '', tools: [] }])
    setStreaming(true)

    const wire = history.map(m => ({ role: m.role, content: m.historyText ?? m.text }))
    const payload = {
      messages: wire,
      formNumber: selectedForm.formNumber,
      ...(selectedForm.lob ? { lob: selectedForm.lob } : {}),
      ...(formData.base64 ? { formBase64: formData.base64, mediaType: formData.mediaType } : { formText: formData.text }),
    }

    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages(prev => {
        const next = [...prev]
        const idx = next.length - 1
        if (idx >= 0 && next[idx]!.role === 'assistant') next[idx] = fn(next[idx]!)
        return next
      })

    try {
      await adapter.fns.stream('analyzeClaim', payload, chunk => {
        let ev: StreamEvent
        try { ev = JSON.parse(chunk) as StreamEvent } catch { return }
        switch (ev.t) {
          case 'token':
            patchAssistant(m => ({ ...m, text: m.text + ev.v })); break
          case 'tool':
            patchAssistant(m => {
              const tools = [...m.tools]
              if (ev.phase === 'start') {
                tools.push({ name: ev.name, done: false })
                // Drop any text streamed before this tool — it's the model thinking out
                // loud; the real answer arrives after the final tool. Keeps prose clean.
                return { ...m, tools, text: '' }
              }
              const i = [...tools].reverse().findIndex(t => t.name === ev.name && !t.done)
              if (i >= 0) tools[tools.length - 1 - i] = { name: ev.name, done: true, summary: ev.summary }
              return { ...m, tools }
            }); break
          case 'json':
            if (ev.key === 'determination') {
              const d = ev.value as Determination
              // Guarantee the footer form-number chip even if the model omits it.
              const withForm = { ...d, formNumber: d.formNumber || selectedForm.formNumber || undefined }
              if (shouldRenderDetermination(withForm)) {
                patchAssistant(m => ({ ...m, determination: withForm, historyText: determinationToText(withForm) }))
              } else {
                // Defense in depth: the server guard already rejects an uncited substantive
                // determination, but should one ever slip through we refuse to render it as
                // fact and ask for a rephrase rather than showing an ungrounded verdict.
                patchAssistant(m => ({
                  ...m,
                  text: m.text || "I couldn't ground that determination in the form — please rephrase the scenario.",
                  historyText: undefined,
                }))
              }
            }
            break
          case 'error':
            patchAssistant(m => ({ ...m, text: m.text + `\n\n⚠️ ${ev.message}` })); break
          case 'done': break
        }
      })
    } catch (err) {
      patchAssistant(m => ({ ...m, text: m.text || `⚠️ ${err instanceof Error ? err.message : 'Analysis failed.'}` }))
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-full min-h-0">
      {/* Left — base-forms library */}
      <aside className="lg:w-[320px] lg:shrink-0 flex flex-col min-h-0 lg:h-full lg:border-r lg:pr-5" style={{ borderColor: 'var(--color-border)' }}>
        <BaseFormsLibrary
          forms={sortedForms} loading={loading} selectedId={selectedId}
          onSelect={id => setSelectedId(id || null)} canEdit={canEdit} actor={actor}
        />
      </aside>

      {/* Right — conversation */}
      <section className="flex-1 flex flex-col min-h-0 max-w-3xl w-full mx-auto">
        {/* Context header */}
        {selectedForm && (
          <div className="flex items-center gap-3 pb-3 mb-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="w-8 h-8 rounded-[9px] flex items-center justify-center shrink-0" style={{ background: 'var(--gradient-accent)' }}>
              <IconShield size={16} className="text-white" aria-hidden="true" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-[15px] font-semibold text-text truncate">{selectedForm.title}</h1>
                {selectedForm.formNumber && <RefChip id={selectedForm.formNumber} tone="accent" />}
                {selectedForm.lob && (
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-[5px] bg-raised text-dim shrink-0"
                    title={LINE_TITLE[selectedForm.lob] ?? selectedForm.lob}
                  >
                    {selectedForm.lob}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-faint">Grounded in this form + its product data</span>
            </div>
          </div>
        )}

        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 pr-1" role="log" aria-live="polite" aria-relevant="additions text">
          {!selectedForm ? (
            <ZeroState />
          ) : messages.length === 0 ? (
            <Starters onPick={ask} disabled={!composerReady} examples={examplesFor(selectedForm.lob)} />
          ) : (
            <div className="flex flex-col gap-5 py-4">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  {m.role === 'user' ? (
                    <div className="max-w-[85%] rounded-[14px] px-4 py-2.5 text-sm text-white" style={{ background: 'var(--gradient-accent)' }}>
                      {m.text}
                    </div>
                  ) : (
                    <div className="max-w-[94%] w-full flex flex-col gap-2">
                      {m.tools.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {m.tools.map((t, ti) => (
                            <span key={ti} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-raised text-[11px] text-dim">
                              {t.done ? <IconCheck size={10} className="text-good" aria-hidden="true" /> : <IconSpinner size={10} className="animate-spin text-accent" aria-hidden="true" />}
                              {TOOL_LABELS[t.name] ?? t.name}{t.done && t.summary ? ` · ${t.summary}` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {m.determination ? (
                        <DeterminationCard d={m.determination} />
                      ) : m.text ? (
                        <div className="text-sm text-text"><CitedText text={m.text} />{streaming && i === messages.length - 1 && <span className="inline-block w-1.5 h-4 ml-0.5 bg-accent align-middle animate-pulse" />}</div>
                      ) : (
                        streaming && i === messages.length - 1 && (
                          <span className="inline-flex items-center gap-2 text-[13px] text-faint">
                            <IconSpinner size={13} className="animate-spin text-accent" aria-hidden="true" /> Reading the policy…
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="mt-3">
          <ChatComposer
            value={input} onChange={setInput} onSubmit={() => ask(input)}
            streaming={streaming}
            disabled={!composerReady}
            placeholder={selectedForm ? 'Describe a loss — e.g. "a pipe burst and flooded the kitchen"…' : 'Select a base form on the left to begin'}
            hint={selectedForm ? 'Grounded in the selected form — every answer cites its source' : 'Select a base form to start a coverage conversation'}
          />
          {formState === 'error' && (
            <p className="text-[11px] text-danger pt-1.5">Couldn't read the selected form file. Try re-selecting or re-uploading it.</p>
          )}
        </div>
      </section>
    </div>
  )
}

// ─── Zero state (no form selected) ───────────────────────────────────────────────

function ZeroState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-6 py-10">
      <div className="w-14 h-14 rounded-[16px] flex items-center justify-center" style={{ background: 'var(--gradient-accent)' }}>
        <IconChat size={26} className="text-white" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-bold text-text">Coverage copilot</h1>
        <p className="text-sm text-dim max-w-md">
          Select a base coverage form, then describe a real situation. I'll tell you whether it's covered,
          under which coverages, up to what limits — and why — grounded in the actual policy language and product data.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-2.5 w-full max-w-xl">
        {BLENDED_EXAMPLES.map(s => (
          <div key={s} className="text-left text-sm text-dim bg-surface rounded-[12px] px-4 py-3" style={{ border: '1px solid var(--color-border)' }}>
            <span className="flex items-start gap-2">
              <IconSparkle size={13} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
              {s}
            </span>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-faint">Select a base form on the left to begin →</p>
    </div>
  )
}

// ─── Starters (form selected, no messages yet) ──────────────────────────────────

function Starters({ onPick, disabled, examples }: { onPick: (t: string) => void; disabled: boolean; examples: string[] }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-5 py-10">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-bold text-text">Describe a loss to check coverage</h2>
        <p className="text-sm text-dim max-w-md">Ask in plain English. Every determination cites the coverages, limits and exclusions it relied on.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-2.5 w-full max-w-xl">
        {examples.map(s => (
          <button
            key={s} onClick={() => onPick(s)} disabled={disabled}
            className="text-left text-sm text-dim bg-surface rounded-[12px] px-4 py-3 hover:text-text hover:shadow-[var(--shadow-card-hover)] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ border: '1px solid var(--color-border)' }}
          >
            <span className="flex items-start gap-2">
              <IconSparkle size={13} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
              {s}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
