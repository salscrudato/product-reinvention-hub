// Feedback (/app/feedback) — two-column: New (active) | Finished (shipped).
// Stripped to the essentials: title, detail, context deep-link, vote, screenshot.
// Editors can mark done (with a completion note), delete, or copy a "Claude Code
// prompt" that summarises all pending items ready to paste into Claude Code.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { IconArrowUp, IconLink, IconCheckCircle, IconTrash, IconCamera, IconExpand, IconCopy } from '../components/ui/icons'
import { adapter, MutationConflictError } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Skeleton, Dialog, Button } from '../components/ui'
import type { Feedback, FeedbackStatus } from '@pf/shared'

type FeedbackDoc = Feedback & { id: string; rev?: number }

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v
  const o = v as { toDate?: () => Date; seconds?: number }
  if (o && typeof o.toDate === 'function') return o.toDate().getTime()
  if (o && typeof o.seconds === 'number') return o.seconds * 1000
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t }
  return 0
}

function heatOf(fb: FeedbackDoc): number {
  const ageDays = Math.max(0, (Date.now() - toMillis(fb.createdAt)) / 86_400_000)
  return (fb.votes?.count ?? 0) * Math.exp(-ageDays / 14) + 0.15 * Math.exp(-ageDays / 14)
}

// Build a Claude Code prompt from all pending (non-shipped/declined) feedback items
function buildPrompt(items: FeedbackDoc[]): string {
  const pending = items.filter(f => f.status !== 'SHIPPED' && f.status !== 'DECLINED')
    .sort((a, b) => heatOf(b) - heatOf(a))
  if (pending.length === 0) return ''

  const lines: string[] = [
    'You are helping build the Product Reinvention Hub (Insurance Platforms AI, monorepo: app/ React+Vite, functions/ Cloud Functions, shared/ types+rating).',
    '',
    'Below is a prioritised list of user-submitted feedback. Address issues first, then ideas by vote heat. For each item the page context tells you which surface is affected.',
    '',
    `## Pending Feedback (${pending.length} item${pending.length === 1 ? '' : 's'})`,
    '',
  ]

  const issues = pending.filter(f => f.type === 'ISSUE')
  const ideas  = pending.filter(f => f.type !== 'ISSUE')

  if (issues.length) {
    lines.push('### 🐛 Issues (fix first)')
    issues.forEach((fb, i) => {
      const ctx = fb.context as { route?: string; label?: string } | undefined
      lines.push(`${i + 1}. [${fb.votes?.count ?? 0} vote${(fb.votes?.count ?? 0) !== 1 ? 's' : ''}] **${fb.title}**`)
      if (ctx?.label || ctx?.route) lines.push(`   Page: ${ctx.label ?? ctx.route}`)
      if (fb.detail) lines.push(`   Detail: ${fb.detail}`)
      if (fb.screenshotUrl) lines.push(`   Screenshot: ${fb.screenshotUrl}`)
      lines.push('')
    })
  }

  if (ideas.length) {
    lines.push('### 💡 Ideas & Praise')
    ideas.forEach((fb, i) => {
      const ctx = fb.context as { route?: string; label?: string } | undefined
      lines.push(`${issues.length + i + 1}. [${fb.votes?.count ?? 0} vote${(fb.votes?.count ?? 0) !== 1 ? 's' : ''}] **${fb.title}**`)
      if (ctx?.label || ctx?.route) lines.push(`   Page: ${ctx.label ?? ctx.route}`)
      if (fb.detail) lines.push(`   Detail: ${fb.detail}`)
      lines.push('')
    })
  }

  lines.push('Please implement these in a focused session. Run `pnpm typecheck && pnpm lint && pnpm test` before finishing.')
  return lines.join('\n')
}

export default function Feedback() {
  const navigate = useNavigate()
  const { user, profile } = useUser()
  const canEdit = profile?.role === 'EDITOR' || profile?.role === 'ADMIN'
  const [items, setItems] = useState<FeedbackDoc[] | null>(null)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())
  const [pendingDelete, setPendingDelete] = useState<FeedbackDoc | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  // Completion comment dialog
  const [completingFor, setCompletingFor] = useState<FeedbackDoc | null>(null)
  const [completionNote, setCompletionNote] = useState('')
  const [completing, setCompleting] = useState(false)

  useEffect(() => {
    const unsub = adapter.db.subscribe<FeedbackDoc>('feedback', d => { if (Array.isArray(d)) setItems(d) })
    return unsub
  }, [])

  useEffect(() => {
    if (!items) return
    setHiddenIds(prev => {
      if (prev.size === 0) return prev
      const present = new Set(items.map(i => i.id))
      const next = new Set<string>()
      prev.forEach(id => { if (present.has(id)) next.add(id) })
      return next.size === prev.size ? prev : next
    })
  }, [items])

  const visible = useMemo(() => (items ?? []).filter(f => !hiddenIds.has(f.id)), [items, hiddenIds])
  const newItems      = useMemo(() => visible.filter(f => f.status !== 'SHIPPED' && f.status !== 'DECLINED').sort((a, b) => heatOf(b) - heatOf(a)), [visible])
  const finishedItems = useMemo(() => visible.filter(f => f.status === 'SHIPPED').sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)), [visible])
  const maxHeat = useMemo(() => Math.max(0.001, ...newItems.map(heatOf)), [newItems])

  async function vote(fb: FeedbackDoc) {
    if (!user) return
    if ((fb.votes?.voters ?? []).includes(user.uid)) { toast.info('You already voted'); return }
    try { await adapter.db.vote(`feedback/${fb.id}`, user.uid) }
    catch { toast.error('Vote failed') }
  }

  async function remove(fb: FeedbackDoc) {
    if (!user) return
    setPendingDelete(null)
    setHiddenIds(prev => new Set(prev).add(fb.id))
    try {
      await adapter.db.mutate({
        op: 'delete', path: `feedback/${fb.id}`, entityType: 'feedback',
        actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        expectedRev: fb.rev,
      })
      toast.success('Feedback deleted')
    } catch (err) {
      setHiddenIds(prev => { const next = new Set(prev); next.delete(fb.id); return next })
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh and try again.' : 'Delete failed')
    }
  }

  async function confirmComplete() {
    if (!completingFor || !user) return
    setCompleting(true)
    try {
      const { id, ...rest } = completingFor
      await adapter.db.mutate({
        op: 'update', path: `feedback/${id}`,
        data: {
          ...rest, status: 'SHIPPED' as FeedbackStatus,
          ...(completionNote.trim() ? { completionNote: completionNote.trim() } : {}),
        },
        entityType: 'feedback',
        actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
        expectedRev: completingFor.rev,
      })
      toast.success('Marked done')
      setCompletingFor(null); setCompletionNote('')
    } catch (err) {
      toast.error(err instanceof MutationConflictError ? 'Conflict — refresh.' : 'Update failed')
    } finally {
      setCompleting(false)
    }
  }

  function copyPrompt() {
    const prompt = buildPrompt(visible)
    if (!prompt) { toast.info('No pending feedback to summarise'); return }
    void navigator.clipboard.writeText(prompt).then(() => toast.success('Prompt copied — paste into Claude Code'))
  }

  if (items === null) {
    return <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
  }

  const cardProps = { canEdit, uid: user?.uid, maxHeat, onVote: vote, onComplete: setCompletingFor, onDelete: setPendingDelete, navigate, onViewScreenshot: setLightboxUrl }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-text">Feedback</h1>
          <p className="text-sm text-dim">Capture with ⌘. · Vote to surface priorities · Mark done with a note.</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={copyPrompt}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-[10px] text-sm font-medium text-dim bg-raised hover:text-accent hover:bg-accent-soft transition-colors"
            style={{ border: '1px solid var(--color-border)' }}
            title="Copy a Claude Code prompt summarising all pending feedback"
          >
            <IconCopy size={14} aria-hidden="true" />
            Copy prompt for Claude Code
          </button>
        )}
      </div>

      {/* Two-column board */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* New */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-dim uppercase tracking-wide">New</span>
            <span className="text-[11px] text-faint tabular-nums">{newItems.length}</span>
          </div>
          {newItems.length === 0
            ? <p className="text-xs text-faint italic px-1 py-3">No pending feedback. Press ⌘. to add some.</p>
            : newItems.map(fb => <Card key={fb.id} fb={fb} {...cardProps} />)
          }
        </section>

        {/* Finished */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-good uppercase tracking-wide">Finished</span>
            <span className="text-[11px] text-faint tabular-nums">{finishedItems.length}</span>
          </div>
          {finishedItems.length === 0
            ? <p className="text-xs text-faint italic px-1 py-3">Nothing shipped yet.</p>
            : finishedItems.map(fb => <Card key={fb.id} fb={fb} finished {...cardProps} />)
          }
        </section>
      </div>

      {/* Completion comment dialog */}
      <Dialog open={completingFor !== null} onClose={() => { setCompletingFor(null); setCompletionNote('') }} title="Mark as done" width="max-w-sm">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Marking <span className="font-medium text-text">"{completingFor?.title}"</span> as done.
            Add a note about what you did (optional).
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text" htmlFor="completion-note">What did you do?</label>
            <textarea
              id="completion-note"
              value={completionNote}
              onChange={e => setCompletionNote(e.target.value)}
              rows={3}
              placeholder="e.g. Fixed the deductible save error in TermOptionsDialog"
              autoFocus
              className="rounded-[10px] bg-surface border border-border-strong text-sm text-text p-3 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setCompletingFor(null); setCompletionNote('') }} disabled={completing}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={confirmComplete} disabled={completing}>
              {completing ? 'Saving…' : 'Mark done'}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Screenshot lightbox */}
      <Dialog open={lightboxUrl !== null} onClose={() => setLightboxUrl(null)} width="max-w-4xl">
        {lightboxUrl && (
          <img src={lightboxUrl} alt="Feedback screenshot" className="w-full rounded-[10px] object-contain max-h-[80vh]" />
        )}
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={pendingDelete !== null} onClose={() => setPendingDelete(null)} title="Delete feedback?" width="max-w-sm">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-dim">
            Permanently removes <span className="font-medium text-text">"{pendingDelete?.title}"</span> and its votes. This can't be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={() => pendingDelete && remove(pendingDelete)}>Delete</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

// ─── Card ───────────────────────────────────────────────────────────────────

interface CardProps {
  fb: FeedbackDoc
  canEdit: boolean
  uid?: string
  maxHeat: number
  finished?: boolean
  onVote: (fb: FeedbackDoc) => void
  onComplete: (fb: FeedbackDoc) => void
  onDelete: (fb: FeedbackDoc) => void
  navigate: (to: string) => void
  onViewScreenshot: (url: string) => void
}

function Card({ fb, canEdit, uid, maxHeat, finished, onVote, onComplete, onDelete, navigate, onViewScreenshot }: CardProps) {
  const voted = uid ? (fb.votes?.voters ?? []).includes(uid) : false
  const heat  = heatOf(fb)
  const ctx   = fb.context as { route?: string; label?: string; refId?: string } | undefined
  const label = ctx?.label ?? ctx?.refId ?? ctx?.route

  return (
    <div
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      className="bg-surface rounded-[12px] p-3.5 flex flex-col gap-2.5"
    >
      {/* Title + vote */}
      <div className="flex items-start gap-2">
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-text">{fb.title}</span>
          {fb.detail && <span className="block text-xs text-dim leading-relaxed line-clamp-2 mt-0.5">{fb.detail}</span>}
        </span>
        {!finished && (
          <button onClick={() => onVote(fb)} disabled={voted}
            className={`shrink-0 flex flex-col items-center rounded-[9px] px-2 py-1 transition-colors ${voted ? 'bg-accent-soft text-accent' : 'bg-raised text-dim hover:text-text'}`}
            title={voted ? 'You voted' : 'Vote'} aria-pressed={voted}>
            <IconArrowUp size={15} />
            <span className="text-[11px] font-semibold tabular-nums">{fb.votes?.count ?? 0}</span>
          </button>
        )}
      </div>

      {/* Screenshot thumbnail */}
      {fb.screenshotUrl && (
        <button
          type="button"
          onClick={() => onViewScreenshot(fb.screenshotUrl!)}
          className="group/thumb relative w-full rounded-[8px] overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          aria-label="View screenshot"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <img src={fb.screenshotUrl} alt="Feedback screenshot" className="w-full h-24 object-cover object-top" />
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.35)' }}>
            <IconExpand size={18} className="text-white drop-shadow" aria-hidden="true" />
          </span>
          <span className="absolute bottom-0 inset-x-0 px-2 py-1 flex items-center gap-1 text-[10px] text-white/70"
            style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.4))' }}>
            <IconCamera size={10} aria-hidden="true" /> Screenshot
          </span>
        </button>
      )}

      {/* Completion note (shown on finished cards) */}
      {finished && fb.completionNote && (
        <div className="flex items-start gap-1.5 bg-good/10 rounded-[8px] px-2.5 py-2">
          <IconCheckCircle size={13} className="shrink-0 text-good mt-px" aria-hidden="true" />
          <span className="text-xs text-dim leading-relaxed">{fb.completionNote}</span>
        </div>
      )}

      {/* Heat bar — only on active items */}
      {!finished && (
        <div className="h-1.5 rounded-full bg-raised overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.max(6, (heat / maxHeat) * 100)}%`, background: 'linear-gradient(90deg, var(--color-accent-bright), var(--color-accent-strong))' }} />
        </div>
      )}

      {/* Footer — context + actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {label && (
          <button onClick={() => ctx?.route && navigate(ctx.route)}
            className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline max-w-[12rem] truncate" title={ctx?.route}>
            <IconLink size={10} className="shrink-0" />
            <span className="font-mono truncate">{label}</span>
          </button>
        )}
        {finished && (
          <span className="flex items-center gap-1 text-[11px] text-good">
            <IconCheckCircle size={11} aria-hidden="true" /> Done
          </span>
        )}
        <span className="flex-1" />
        {!finished && canEdit && (
          <button onClick={() => onComplete(fb)} title="Mark done"
            className="h-6 inline-flex items-center gap-1 px-1.5 rounded-[7px] bg-raised text-dim hover:text-good hover:bg-[var(--color-good-soft)] text-[11px] transition-colors">
            <IconCheckCircle size={13} aria-hidden="true" /> Done
          </button>
        )}
        {canEdit && (
          <button onClick={() => onDelete(fb)} title="Delete"
            className="h-6 inline-flex items-center px-1.5 rounded-[7px] bg-raised text-dim hover:text-danger hover:bg-[var(--color-danger-hover)] transition-colors">
            <IconTrash size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
