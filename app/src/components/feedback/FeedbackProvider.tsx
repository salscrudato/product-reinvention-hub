// FeedbackProvider — global quick-capture: a ⌘. shortcut and a floating button
// open a sheet (Idea / Issue / Praise + title + detail) that auto-attaches the
// current route, so feedback lands pre-linked. Any signed-in role may submit.
// Mounted once inside the app shell.
import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { adapter } from '../../lib/backend'
import { useUser } from '../../context/useUser'
import { Dialog, Button, Input } from '../ui'
import { IconChat, IconIdea, IconBug, IconHeart, IconLink, type IconType } from '../ui/icons'
import type { FeedbackType } from '@pf/shared'

const TYPES: { id: FeedbackType; label: string; icon: IconType }[] = [
  { id: 'IDEA',   label: 'Idea',   icon: IconIdea },
  { id: 'ISSUE',  label: 'Issue',  icon: IconBug },
  { id: 'PRAISE', label: 'Praise', icon: IconHeart },
]

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { user } = useUser()
  const location = useLocation()
  const [open, setOpen]     = useState(false)
  const [type, setType]     = useState<FeedbackType>('IDEA')
  const [title, setTitle]   = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy]     = useState(false)

  // ⌘. / Ctrl+. global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') { e.preventDefault(); setOpen(o => !o) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  async function submit() {
    if (!title.trim() || !user) return
    setBusy(true)
    try {
      const id = crypto.randomUUID()
      await adapter.db.mutate({
        op: 'create', path: `feedback/${id}`,
        data: {
          type, title: title.trim(), detail: detail.trim(),
          context: { route: location.pathname, entityPath: null, refId: null, label: null },
          votes: { count: 0, voters: [] },
          status: 'NEW', impact: 2, effort: 2, priorityScore: 0,
          author: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        },
        entityType: 'feedback',
        actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
      })
      toast.success('Feedback captured')
      setOpen(false); setTitle(''); setDetail(''); setType('IDEA')
    } catch {
      toast.error('Could not submit feedback')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {children}

      {/* Floating capture button */}
      <button
        onClick={() => setOpen(true)}
        title="Capture feedback (⌘.)" aria-label="Capture feedback"
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ background: 'var(--gradient-accent-vivid)', boxShadow: '0 8px 24px var(--glow-accent-strong)' }}
      >
        <IconChat size={20} aria-hidden="true" />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Quick feedback">
        <div className="flex flex-col gap-4">
          {/* Type */}
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map(t => {
              const Icon = t.icon; const active = type === t.id
              return (
                <button key={t.id} onClick={() => setType(t.id)} aria-pressed={active}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-[10px] text-xs font-medium transition-all ${active ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}
                  style={active ? { border: '1px solid var(--color-accent-line)' } : { border: '1px solid transparent' }}>
                  <Icon size={16} /> {t.label}
                </button>
              )
            })}
          </div>

          <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="A short summary" autoFocus />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text" htmlFor="fb-detail">Detail</label>
            <textarea id="fb-detail" value={detail} onChange={e => setDetail(e.target.value)} rows={3} placeholder="What happened, or what would help?"
              className="rounded-[10px] bg-surface border border-border-strong text-sm text-text p-3 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none" />
          </div>

          {/* Auto-attached context */}
          <div className="flex items-center gap-2 text-xs text-faint bg-raised rounded-[8px] px-3 py-2">
            <IconLink size={12} className="shrink-0" aria-hidden="true" />
            <span className="truncate">Linked to <span className="text-dim font-medium">{location.pathname}</span></span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={submit} disabled={busy || !title.trim()}>{busy ? 'Sending…' : 'Submit'}</Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
