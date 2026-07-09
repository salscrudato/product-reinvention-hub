// ChatComposer — AI chat input with auto-growing textarea, grounding hint, send
// button, and an optional voice-to-text mic (Web Speech API, streamed interim
// results so text appears as the user speaks). Voice input is silently hidden on
// browsers without SpeechRecognition support (Firefox, older Safari).
import { useState, useRef, useEffect } from 'react'
import { IconArrowUp, IconSpinner, IconSparkle, IconMic } from '../ui/icons'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onAutoSubmit?: (text: string) => void
  streaming?: boolean
  disabled?: boolean
  hint?: string
  placeholder?: string
  autoFocus?: boolean
}

export function ChatComposer({
  value, onChange, onSubmit, onAutoSubmit,
  streaming = false, disabled = false,
  hint, placeholder = 'Ask your product portfolio…', autoFocus,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const srRef       = useRef<any>(null)
  const finalRef    = useRef('')       // accumulated final transcript for this recording session
  const [listening, setListening] = useState(false)

  // SpeechRecognition is a browser API not always typed; use this helper throughout.
  type SRC = { new(): SpeechRecognitionLike }
  interface SpeechRecognitionLike extends EventTarget {
    continuous: boolean; interimResults: boolean; lang: string
    start(): void; stop(): void; abort(): void
    onresult: ((e: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null
    onerror: (() => void) | null
    onend: (() => void) | null
  }

  // Detect SpeechRecognition support once (avoids SSR issues).
  const [hasSR] = useState(() => {
    if (typeof window === 'undefined') return false
    const w = window as unknown as Record<string, unknown>
    return !!(w['SpeechRecognition'] || w['webkitSpeechRecognition'])
  })

  const canSend = !!value.trim() && !streaming && !disabled

  // Auto-grow textarea up to a cap, then scroll.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`
  }, [value])

  // Clean up on unmount.
  useEffect(() => () => { srRef.current?.stop() }, [])

  // If streaming starts mid-recording, stop the mic so tokens don't race with voice.
  useEffect(() => {
    if (streaming && listening) {
      srRef.current?.stop()
    }
  }, [streaming]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleVoice() {
    if (listening) {
      srRef.current?.stop()
      srRef.current = null
      setListening(false)
      return
    }
    const w  = window as unknown as Record<string, unknown>
    const SR = (w['SpeechRecognition'] as SRC | undefined) ?? (w['webkitSpeechRecognition'] as SRC | undefined)
    if (!SR) return

    const sr = new SR()
    sr.continuous     = false  // auto-stops on silence (~1-2s pause) via browser VAD
    sr.interimResults = true
    sr.lang           = 'en-US'
    srRef.current     = sr
    // Seed from any text already typed so we append, not overwrite.
    finalRef.current  = value.trimEnd()

    sr.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!
        if (r.isFinal) {
          const word = r[0]!.transcript.trim()
          finalRef.current += (finalRef.current ? ' ' : '') + word
        } else {
          interim += r[0]!.transcript
        }
      }
      onChange(finalRef.current + (interim ? (finalRef.current ? ' ' : '') + interim : ''))
    }
    sr.onerror = () => { srRef.current = null; setListening(false) }
    sr.onend   = () => {
      srRef.current = null
      setListening(false)
      const transcript = finalRef.current.trim()
      if (transcript && !streaming && !disabled) {
        if (onAutoSubmit) {
          onAutoSubmit(transcript)
        } else {
          onSubmit()
        }
      }
    }

    sr.start()
    setListening(true)
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (canSend) onSubmit() }}
      className={`relative bg-surface rounded-[22px] transition-shadow focus-within:shadow-[var(--shadow-card-hover)] ${disabled ? 'opacity-60' : ''}`}
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSubmit() } }}
        placeholder={placeholder}
        rows={1}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label="Message"
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-11 text-[15px] leading-relaxed text-text placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
      />

      {/* Grounding hint (bottom-left) */}
      <div className="absolute left-4 bottom-3 flex items-center gap-1.5 text-[11px] text-faint select-none pointer-events-none">
        <IconSparkle size={12} className="text-accent" aria-hidden="true" />
        {hint ?? 'Grounded — every answer cites its source'}
      </div>

      {/* Mic button (bottom-right, left of send) — hidden when unsupported */}
      {hasSR && (
        <button
          type="button"
          onClick={toggleVoice}
          disabled={disabled}
          aria-label={listening ? 'Stop voice input' : 'Start voice input'}
          title={listening ? 'Click to stop recording' : 'Click to speak'}
          className={`absolute bottom-[10px] right-[44px] w-8 h-8 rounded-full flex items-center justify-center transition-all focus-visible:outline-2 focus-visible:outline-accent ${
            listening
              ? 'text-white'
              : disabled
              ? 'text-faint opacity-40 cursor-not-allowed'
              : 'text-faint hover:text-accent hover:bg-accent-soft'
          }`}
          style={listening
            ? { background: 'var(--gradient-accent)', boxShadow: '0 0 0 4px var(--color-accent-soft)' }
            : undefined}
        >
          {listening
            ? <IconMic size={15} className="animate-pulse" aria-hidden="true" />
            : <IconMic size={15} aria-hidden="true" />}
        </button>
      )}

      {/* Send button (bottom-right) */}
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send message"
        className={`absolute right-3 bottom-[10px] w-8 h-8 rounded-full flex items-center justify-center text-white transition-transform ${canSend ? 'hover:scale-105 active:scale-95' : 'opacity-30 cursor-not-allowed'}`}
        style={{ background: 'var(--gradient-accent)', boxShadow: canSend ? '0 1px 3px var(--glow-accent)' : 'none' }}
      >
        {streaming
          ? <IconSpinner size={15} className="animate-spin" aria-hidden="true" />
          : <IconArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />}
      </button>
    </form>
  )
}
