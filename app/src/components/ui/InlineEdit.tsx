// InlineEdit — a small reusable click-to-edit text/textarea field. Displays the value
// with a hover pencil (EDITOR/ADMIN only); clicking swaps to an input with Enter-to-save
// (⌘/Ctrl+Enter for multiline), Escape-to-cancel, and check/✕ buttons. The caller owns
// persistence via `onSave` and surfaces its own toast; if `onSave` throws, the field stays
// in edit mode so nothing is lost. Mirrors the product-name rename pattern, made reusable.
import { useEffect, useState } from 'react'
import { IconEdit, IconCheck, IconClose } from './icons'

interface Props {
  value: string
  onSave: (next: string) => Promise<void> | void
  canEdit: boolean
  ariaLabel: string
  multiline?: boolean
  placeholder?: string
  emptyLabel?: string
  className?: string
}

export function InlineEdit({ value, onSave, canEdit, ariaLabel, multiline, placeholder, emptyLabel = 'Not set', className = '' }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])

  async function commit() {
    const next = draft.trim()
    if (next === (value ?? '').trim()) { setEditing(false); return }
    setBusy(true)
    try { await onSave(next); setEditing(false) }
    catch { /* caller surfaces the error; stay in edit mode so the draft isn't lost */ }
    finally { setBusy(false) }
  }
  function cancel() { setDraft(value); setEditing(false) }

  if (!editing) {
    return (
      <div className="group/inline flex items-start gap-1.5">
        <span className={`${value ? 'text-text' : 'text-faint italic'} ${className}`}>{value || emptyLabel}</span>
        {canEdit && (
          <button onClick={() => { setDraft(value); setEditing(true) }} aria-label={`Edit ${ariaLabel}`}
            className="opacity-0 group-hover/inline:opacity-100 focus:opacity-100 transition-opacity w-6 h-6 rounded-[6px] flex items-center justify-center text-faint hover:text-accent hover:bg-accent-soft shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent">
            <IconEdit size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    )
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit() }
  }
  const inputCls = `flex-1 min-w-0 ${multiline ? 'py-1.5 leading-relaxed' : 'h-8'} px-2.5 rounded-[8px] bg-surface border border-border-strong text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25`

  return (
    <div className="flex items-start gap-1.5 w-full">
      {multiline ? (
        <textarea autoFocus rows={3} value={draft} aria-label={ariaLabel} placeholder={placeholder} disabled={busy}
          onChange={e => setDraft(e.target.value)} onKeyDown={onKey} className={inputCls} />
      ) : (
        <input autoFocus value={draft} aria-label={ariaLabel} placeholder={placeholder} disabled={busy}
          onChange={e => setDraft(e.target.value)} onKeyDown={onKey} className={inputCls} />
      )}
      <button onClick={() => void commit()} disabled={busy} aria-label="Save" title="Save"
        className="w-8 h-8 rounded-[8px] flex items-center justify-center text-white shrink-0 disabled:opacity-50" style={{ background: 'var(--gradient-accent)' }}>
        <IconCheck size={14} aria-hidden="true" />
      </button>
      <button onClick={cancel} disabled={busy} aria-label="Cancel" title="Cancel"
        className="w-8 h-8 rounded-[8px] flex items-center justify-center text-faint hover:text-text hover:bg-hover shrink-0">
        <IconClose size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
