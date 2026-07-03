// ChatComposer — the modern AI chat box (à la Claude / ChatGPT): an auto-growing
// text field in a soft rounded surface, a grounding hint, and a circular up-arrow
// send. Controlled; Enter sends, Shift+Enter newlines.
import { useRef, useEffect } from 'react'
import { ArrowUp, Loader2, Sparkles } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  streaming?: boolean
  placeholder?: string
  autoFocus?: boolean
}

export function ChatComposer({ value, onChange, onSubmit, streaming = false, placeholder = 'Ask your product portfolio…', autoFocus }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const canSend = !!value.trim() && !streaming

  // Auto-grow the textarea up to a cap, then scroll.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`
  }, [value])

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (canSend) onSubmit() }}
      className="relative bg-surface rounded-[22px] transition-shadow focus-within:shadow-[var(--shadow-card-hover)]"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) onSubmit() } }}
        placeholder={placeholder}
        rows={1}
        autoFocus={autoFocus}
        aria-label="Message"
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-11 text-[15px] leading-relaxed text-text placeholder:text-faint focus:outline-none"
      />

      <div className="absolute left-4 bottom-3 flex items-center gap-1.5 text-[11px] text-faint select-none pointer-events-none">
        <Sparkles size={12} className="text-accent" aria-hidden="true" />
        Grounded — every answer cites its refId
      </div>

      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send message"
        className={`absolute right-3 bottom-3 w-8 h-8 rounded-full flex items-center justify-center text-white transition-transform ${canSend ? 'hover:scale-105 active:scale-95' : 'opacity-30 cursor-not-allowed'}`}
        style={{ background: 'var(--gradient-accent)', boxShadow: canSend ? '0 1px 3px var(--glow-accent)' : 'none' }}
      >
        {streaming ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />}
      </button>
    </form>
  )
}
