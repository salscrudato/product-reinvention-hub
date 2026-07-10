// Claims Analysis — a grounded, multi-turn "coverage copilot". Two panes: a left
// base-forms library (upload/select) and a right conversation that stays DISABLED
// until a form is selected. Each turn streams over SSE from the analyzeClaim Cloud
// Function, which reads the ACTUAL uploaded policy PDF server-side plus the product's
// structured data via the grounding tools; loss determinations render as a
// deterministic DeterminationCard. The browser never calls Anthropic — everything
// goes through the adapter seam.
import { useEffect, useMemo, useRef, useState } from 'react'
import { resolveClaimsLineProfile } from '@pf/shared'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { ChatComposer } from '../components/chat/ChatComposer'
import { Markdown } from '../components/chat/Markdown'
import { BaseFormsLibrary, type BaseForm } from '../components/claims/BaseFormsLibrary'
import { DeterminationCard, type Determination } from '../components/claims/DeterminationCard'
import { shouldRenderDetermination } from '../lib/claims/determination'
import { assistantBubbleContent, EMPTY_TURN_FALLBACK } from '../lib/claims/bubble'
import { isFormAnalyzable, isUnverified } from '../lib/claims/baseForm'
import { buildGapFeedbackPrefill } from '../lib/claims/gapFeedback'
import { useFeedbackLaunch } from '../context/useFeedbackLaunch'
import { RefChip } from '../components/ui'
import { IconCheck, IconSpinner, IconShield, IconInfo, IconWarning } from '../components/ui/icons'

// ─── Stream protocol (mirror of functions/src/runtime.ts StreamEvent) ───────────
type StreamEvent =
  | { t: 'token'; v: string }
  | { t: 'tool';  name: string; phase: 'start' | 'end'; summary?: string }
  | { t: 'json';  key: string; value: unknown }
  | { t: 'notice'; level: 'info' | 'warn'; message: string; refs?: string[] }
  | { t: 'error'; message: string }
  | { t: 'done' }

interface ToolChip { name: string; done: boolean; summary?: string }
interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  tools: ToolChip[]
  determination?: Determination
  // A non-fatal advisory from a `notice` event (budget cap, breaker, unverified citation,
  // degrade). Kept separate from text so a token flush can't wipe it — and so a turn that
  // produces ONLY a notice still renders something visible instead of a blank bubble.
  notice?: { level: 'info' | 'warn'; message: string }
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

// Full-name tooltip for the compact line chip in the context header — resolved through the
// shared claims line-profile registry (never a hard-coded per-line list), so HO/PA/GL and any
// future line label consistently, and an unrecognised code shows verbatim.
function lineTitle(code: string): string {
  const p = resolveClaimsLineProfile(code)
  return p.code === 'GENERIC' ? code : p.displayName
}

function toMillis(v: unknown): number {
  const o = v as { toDate?: () => Date; seconds?: number } | null
  if (o?.toDate) return o.toDate().getTime()
  if (typeof o?.seconds === 'number') return o.seconds * 1000
  return Number.MAX_SAFE_INTEGER   // pending serverTimestamp → sort newest first
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
    d.coverageGap?.note ? `Coverage gap: ${d.coverageGap.note}${d.coverageGap.sources?.length ? ` [${d.coverageGap.sources.join('] [')}]` : ''}` : '',
  ].filter(Boolean).join('\n')
}

// A non-fatal advisory surfaced from a `notice` SSE event — budget cap / breaker / degrade /
// unverified citation. Tokenised per level; never a blank or hard-coded hex.
function NoticeBanner({ level, message }: { level: 'info' | 'warn'; message: string }) {
  const warn = level === 'warn'
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-[10px] px-3 py-2 text-[12.5px] leading-snug"
      style={{
        background: warn ? 'var(--color-warn-soft)' : 'var(--color-raised)',
        border: `1px solid ${warn ? 'var(--color-warn-line)' : 'var(--color-border)'}`,
        color: warn ? 'var(--color-warn)' : 'var(--color-dim)',
      }}
    >
      {warn
        ? <IconWarning size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
        : <IconInfo size={14} className="shrink-0 mt-0.5" aria-hidden="true" />}
      <span>{message}</span>
    </div>
  )
}

// The assistant turn's visible body. A single pure decision (assistantBubbleContent) guarantees
// it is NEVER empty: a determination card, streamed text, a notice advisory, a thinking spinner
// while streaming, or a plain-language fallback — so every terminal SSE path shows something.
function AssistantContent({ m, streamingThisTurn, onCreateFeedback, linked }: {
  m: ChatMessage; streamingThisTurn: boolean
  onCreateFeedback?: () => void; linked?: boolean
}) {
  const content = assistantBubbleContent(
    { text: m.text, hasDetermination: !!m.determination, notice: m.notice ?? null },
    streamingThisTurn,
  )
  return (
    <>
      {m.notice && <NoticeBanner level={m.notice.level} message={m.notice.message} />}
      {content === 'determination' && m.determination && (
        <DeterminationCard d={m.determination} onCreateFeedback={onCreateFeedback} linked={linked} />
      )}
      {content === 'text' && (
        <div className="text-sm text-text">
          <Markdown text={m.text} />
          {streamingThisTurn && <span aria-hidden="true" className="inline-block text-accent animate-pulse ml-0.5 select-none opacity-70" style={{ lineHeight: 1 }}>▍</span>}
        </div>
      )}
      {content === 'thinking' && (
        <span className="inline-flex items-center gap-2 text-[13px] text-faint">
          <IconSpinner size={13} className="animate-spin text-accent" aria-hidden="true" /> Reading the policy…
        </span>
      )}
      {content === 'fallback' && <p className="text-[13px] text-dim leading-relaxed">{EMPTY_TURN_FALLBACK}</p>}
    </>
  )
}

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
  // Message indices whose coverage gap has been turned into a linked feedback item.
  const [linkedMsgs, setLinkedMsgs] = useState<Set<number>>(new Set())
  const launch = useFeedbackLaunch()

  const scrollRef     = useRef<HTMLDivElement>(null)
  const abortRef      = useRef<AbortController | null>(null)
  // RAF token batching: buffer tokens and flush to React state at most once per animation
  // frame so hundreds of tiny token chunks don't each trigger a re-render.
  const textBufferRef = useRef<string>('')
  const rafRef        = useRef<number | null>(null)
  // G1: single "Response ready" polite announcement when streaming ends.
  const [srAnnounce, setSrAnnounce] = useState('')

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
  // Line-aware quick scenarios: derived from the selected form's DETECTED line via the shared
  // claims line-profile registry (generic fallback for an unrecognised line), so the one-tap
  // starters exercise THIS line's coverage grants/exclusions — never a hard-coded HO-only list.
  const lineProfile = useMemo(() => resolveClaimsLineProfile(selectedForm?.lob), [selectedForm])

  // A new selection starts a fresh conversation (a different policy) — abort any stream
  // still running against the previous form so its tokens can't bleed into the new thread.
  useEffect(() => { abortRef.current?.abort(); setMessages([]); setInput(''); setLinkedMsgs(new Set()) }, [selectedId])

  // Abort any in-flight analysis on unmount so it doesn't keep consuming tokens/network.
  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Announce once when the stream settles; clear after a short hold so the region resets.
  useEffect(() => {
    if (streaming) return
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && (last.text.trim() || last.determination)) {
      setSrAnnounce('Response ready')
      const t = setTimeout(() => setSrAnnounce(''), 1500)
      return () => clearTimeout(t)
    }
  }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps

  const composerReady = isFormAnalyzable(selectedForm)

  async function ask(text: string) {
    const question = text.trim()
    // Only analyze a form that is genuinely analyzable (READY + stored document). Mirrors the
    // composer gate so a stray call can never send an invalid payload for a selected-but-not-
    // ready form — the invariant behind "form selected, yet analysis reports no form".
    if (!question || streaming || !selectedForm || !isFormAnalyzable(selectedForm)) return
    setInput('')

    const history: ChatMessage[] = [...messages, { role: 'user', text: question, tools: [] }]
    setMessages([...history, { role: 'assistant', text: '', tools: [] }])
    setStreaming(true)
    textBufferRef.current = ''

    const wire = history.map(m => ({ role: m.role, content: m.historyText ?? m.text }))
    const payload = {
      messages: wire,
      formNumber: selectedForm.formNumber,
      formStoragePath: selectedForm.storagePath,
      formStorageMediaType: selectedForm.mediaType ?? 'application/pdf',
      ...(selectedForm.lob ? { lob: selectedForm.lob } : {}),
    }

    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages(prev => {
        const next = [...prev]
        const idx = next.length - 1
        if (idx >= 0 && next[idx]!.role === 'assistant') next[idx] = fn(next[idx]!)
        return next
      })

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await adapter.fns.stream('analyzeClaim', payload, chunk => {
        let ev: StreamEvent
        try { ev = JSON.parse(chunk) as StreamEvent } catch { return }
        switch (ev.t) {
          case 'token':
            textBufferRef.current += ev.v
            if (rafRef.current === null) {
              rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null
                const txt = textBufferRef.current
                patchAssistant(m => ({ ...m, text: txt }))
              })
            }
            break
          case 'tool':
            // Flush buffer immediately when a tool starts so the UI stays in sync.
            if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
            patchAssistant(m => {
              const tools = [...m.tools]
              if (ev.phase === 'start') {
                tools.push({ name: ev.name, done: false })
                // Drop pre-tool thinking text — real answer arrives after the tool.
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
          case 'notice':
            // Budget/breaker/degrade/unverified-citation advisory. Stored in its own field so a
            // later token flush can't wipe it and a notice-only turn is never a blank bubble.
            patchAssistant(m => ({ ...m, notice: { level: ev.level, message: ev.message } })); break
          case 'error':
            patchAssistant(m => ({ ...m, text: m.text + `\n\n⚠️ ${ev.message}` })); break
          case 'done': break
          default: break   // forward-compat: ignore an unknown event type safely (bubble fallback still applies)
        }
      }, controller.signal)
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return
      patchAssistant(m => ({ ...m, text: m.text || `⚠️ ${err instanceof Error ? err.message : 'Analysis failed.'}` }))
    } finally {
      // Cancel any pending RAF and do one final flush so no tokens are dropped.
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
        const txt = textBufferRef.current
        if (txt) patchAssistant(m => ({ ...m, text: txt }))
      }
      if (abortRef.current === controller) setStreaming(false)
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
                    title={lineTitle(selectedForm.lob)}
                  >
                    {selectedForm.lob}
                  </span>
                )}
                {isUnverified(selectedForm) && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-[5px] shrink-0"
                    style={{ background: 'var(--color-warn-soft)', color: 'var(--color-warn)' }}
                    title="This form number couldn’t be matched to the catalogue. Analysis uses the attached document, which is the authority."
                  >
                    <IconWarning size={9} aria-hidden="true" /> Unverified
                  </span>
                )}
              </div>
              <span className="text-[11px] text-faint">Grounded in this form + its product data</span>
            </div>
          </div>
        )}

        {/* Single polite announcement on stream completion — replaces per-token noise (G1) */}
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{srAnnounce}</div>
        {/* aria-live="off" overrides the implicit polite from role="log" to suppress per-token noise */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 pr-1" role="log" aria-live="off" aria-relevant="additions text">
          {messages.length === 0 ? (
            <Starters scenarios={composerReady ? lineProfile.scenarios : []} onPick={ask} />
          ) : (
            <div className="flex flex-col gap-5 py-4">
              {messages.map((m, i) => {
                // A coverage-gap determination (NOT_ADDRESSED / PARTIAL) offers "Create product
                // feedback", prefilled from the gap; the preceding user turn is the scenario.
                const det = m.determination
                const hasGap = !!det && (det.verdict === 'NOT_ADDRESSED' || det.verdict === 'PARTIAL') && !!det.coverageGap?.note?.trim()
                const scenario = messages[i - 1]?.role === 'user' ? messages[i - 1]!.text : undefined
                const onCreateFeedback = hasGap && launch
                  ? () => launch.openFeedback({
                      ...buildGapFeedbackPrefill(det!, { scenario, baseFormNumber: selectedForm?.formNumber }),
                      onSubmitted: () => setLinkedMsgs(prev => new Set(prev).add(i)),
                    })
                  : undefined
                return (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  {m.role === 'user' ? (
                    <div className="max-w-[85%] rounded-[14px] px-4 py-2.5 text-sm text-white" style={{ background: 'var(--gradient-accent)' }}>
                      {m.text}
                    </div>
                  ) : (
                    <div className="max-w-[94%] w-full flex flex-col gap-2">
                      {m.tools.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
                          {m.tools.map((t, ti) => (
                            <span key={ti}
                              className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-[10.5px] font-medium transition-colors"
                              style={{
                                background: t.done ? 'var(--color-good-soft)' : 'var(--color-accent-soft)',
                                border: `1px solid ${t.done ? 'rgba(4,120,87,.18)' : 'var(--color-accent-line)'}`,
                                color: t.done ? 'var(--color-good)' : 'var(--color-accent)',
                              }}>
                              <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                                style={{ background: t.done ? 'rgba(4,120,87,.15)' : 'var(--color-accent-line)' }}>
                                {t.done
                                  ? <IconCheck size={9} aria-hidden="true" />
                                  : <IconSpinner size={9} className="animate-spin" aria-hidden="true" />}
                              </span>
                              {TOOL_LABELS[t.name] ?? t.name}
                              {t.done && t.summary && <span className="opacity-55 font-sans">· {t.summary}</span>}
                            </span>
                          ))}
                        </div>
                      )}
                      <AssistantContent m={m} streamingThisTurn={streaming && i === messages.length - 1}
                        onCreateFeedback={onCreateFeedback} linked={linkedMsgs.has(i)} />
                    </div>
                  )}
                </div>
              )})}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="mt-3">
          <ChatComposer
            value={input} onChange={setInput} onSubmit={() => ask(input)} onAutoSubmit={ask}
            streaming={streaming}
            disabled={!composerReady}
            placeholder={
              !selectedForm ? 'Select a base form on the left to begin'
              : selectedForm.status === 'PROCESSING' ? 'Reading the form…'
              : selectedForm.status === 'NEEDS_REVIEW' ? "This form couldn't be identified — an editor needs to review it before analysis"
              : !selectedForm.storagePath?.trim() ? 'This form has no stored document — please remove and re-upload it'
              : 'Describe a loss — e.g. "a pipe burst and flooded the kitchen"…'
            }
            hint={
              !selectedForm ? 'Select a base form to start a coverage conversation'
              : selectedForm.status === 'NEEDS_REVIEW' ? "We couldn't read this form's number or line, so analysis is disabled. An editor should remove it and re-upload a clearer copy."
              : !selectedForm.storagePath?.trim() ? 'The PDF for this form is missing — remove the card and upload the form again'
              : 'Grounded in the selected form — every answer cites its source'
            }
          />

        </div>
      </section>
    </div>
  )
}

// ─── Hero shown when no messages yet (before or after form selection) ───────────
// Animated shield + voice-wave SVG, plus line-aware one-tap scenario starters once a form is
// selected. The scenarios are passed in from the selected form's claims line profile, so a GL
// form offers GL losses and an HO form offers HO losses — never a hard-coded list here.

function Starters({ scenarios, onPick }: { scenarios: readonly string[]; onPick: (s: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-7 py-8 select-none">
      {/* Animated shield + voice-wave SVG */}
      <div
        className="voice-bounce"
        style={{ filter: 'drop-shadow(0 0 22px var(--color-accent-soft)) drop-shadow(0 0 7px var(--color-accent))' }}
        aria-hidden="true"
      >
        <svg width="148" height="164" viewBox="0 0 148 164" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Outer pulsing rings */}
          <ellipse cx="74" cy="86" rx="68" ry="74" stroke="var(--color-accent)" strokeOpacity="0.07" strokeWidth="1" className="ring-glow" />
          <ellipse cx="74" cy="86" rx="52" ry="57" stroke="var(--color-accent)" strokeOpacity="0.11" strokeWidth="1" className="ring-glow" style={{ animationDelay: '1s' }} />

          {/* Shield body */}
          <path
            d="M74 16 L118 36 L118 84 C118 113 98 132 74 142 C50 132 30 113 30 84 L30 36 Z"
            fill="var(--color-accent)" fillOpacity="0.08"
            stroke="var(--color-accent)" strokeWidth="1.5" strokeLinejoin="round"
            className="shield-pulse"
          />
          {/* Shield inner highlight */}
          <path
            d="M74 28 L106 44 L106 82 C106 104 92 119 74 128 C56 119 42 104 42 82 L42 44 Z"
            fill="none"
            stroke="var(--color-accent)" strokeWidth="0.75" strokeLinejoin="round" strokeOpacity="0.28"
          />

          {/* Voice-wave arcs — staggered pulse */}
          <path d="M46 90 C46 70 58.7 54 74 54 C89.3 54 102 70 102 90"
            stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" className="arc-1" />
          <path d="M55 90 C55 74 63.6 62 74 62 C84.4 62 93 74 93 90"
            stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" className="arc-2" />
          <path d="M64 90 C64 79.5 68.5 72 74 72 C79.5 72 84 79.5 84 90"
            stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" className="arc-3" />

          {/* Center dot */}
          <circle cx="74" cy="90" r="4" fill="var(--color-accent)" className="shield-pulse" />
        </svg>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-[19px] font-bold text-text tracking-tight">Describe a loss to check coverage</h2>
        <p className="text-[13px] text-dim max-w-sm leading-relaxed">
          Speak or type in plain English — every determination cites the exact coverage, limit and exclusion it relied on.
        </p>
      </div>

      {/* Line-aware one-tap starters (only once a form is selected + ready). */}
      {scenarios.length > 0 && (
        <div className="flex flex-col items-center gap-2.5">
          <span className="text-[11px] font-medium uppercase tracking-[.06em] text-faint">Try one of these</span>
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-md">
            {scenarios.map((s, i) => (
              <button
                key={i}
                onClick={() => onPick(s)}
                className="text-[12.5px] text-dim px-3 py-1.5 rounded-full bg-surface hover:bg-hover hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                style={{ border: '1px solid var(--color-border)' }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
