// Comments panel — add, view and resolve comments for any entity.
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { CheckCircle } from 'lucide-react'
import { Drawer } from '../ui/Drawer'
import { Button } from '../ui/Button'
import { useProductCtx } from '../../context/useProductCtx'
import { useUser } from '../../context/useUser'
import { adapter } from '../../lib/backend'

interface Props { onClose: () => void; entityPath: string }

function timeAgo(at: unknown): string {
  if (!at) return '—'
  try {
    const ts = at instanceof Object && 'toDate' in (at as object) ? (at as { toDate(): Date }).toDate() : new Date(String(at))
    const diff = Math.round((Date.now() - ts.getTime()) / 1000)
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.round(diff/60)}m ago`
    return ts.toLocaleDateString()
  } catch { return '—' }
}

export function CommentsPanel({ onClose, entityPath }: Props) {
  const { comments, pid } = useProductCtx()
  const { user }   = useUser()
  const canEdit    = user?.role === 'EDITOR' || user?.role === 'ADMIN'
  const actor      = { uid: user?.uid ?? '', name: user?.name ?? user?.email ?? 'Unknown' }
  const [body,     setBody]     = useState('')
  const [loading,  setLoading]  = useState(false)

  const relevant = comments.filter(c => c.entityPath === entityPath)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setLoading(true)
    try {
      await adapter.db.mutate({
        op: 'create',
        path: `comments/comment-${Date.now()}`,
        data: { entityPath, body: body.trim(), author: actor, resolved: false, at: null },
        entityType: 'comment', productId: pid, actor,
      })
      setBody('')
      toast.success('Comment added')
    } catch {
      toast.error('Failed to add comment')
    } finally {
      setLoading(false)
    }
  }

  async function handleResolve(commentId: string, rev: number | undefined) {
    try {
      await adapter.db.mutate({
        op: 'update', path: `comments/${commentId}`,
        data: { resolved: true }, entityType: 'comment', productId: pid, actor,
        expectedRev: rev,
      })
    } catch { toast.error('Could not resolve comment') }
  }

  return (
    <Drawer open title="Comments" onClose={onClose} width="w-[400px]">
      <div className="flex flex-col gap-4 h-full">
        {/* Comment list */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-3">
          {relevant.length === 0 && <p className="text-sm text-faint">No comments yet.</p>}
          {relevant.map(c => (
            <div key={c.id} className={`rounded-[10px] p-3 ${c.resolved ? 'opacity-50' : ''}`}
              style={{ background: 'var(--color-raised)', border: '1px solid var(--color-border)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm text-text">{c.body}</p>
                  <p className="text-xs text-faint mt-1">{c.author?.name ?? '—'} · {timeAgo(c.at)}</p>
                </div>
                {canEdit && !c.resolved && (
                  <button onClick={() => handleResolve(c.id, (c as { rev?: number }).rev)}
                    className="text-faint hover:text-good transition-colors" title="Resolve">
                    <CheckCircle size={14} />
                  </button>
                )}
              </div>
              {c.resolved && <p className="text-xs text-good mt-1">Resolved</p>}
            </div>
          ))}
        </div>

        {/* New comment */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <textarea
            className="w-full h-20 px-3 py-2 rounded-[10px] bg-surface border border-[rgba(19,19,26,.12)] text-sm text-text placeholder:text-faint resize-none focus:outline-none focus:ring-2 focus:ring-[rgba(192,38,211,.25)]"
            placeholder="Add a comment..."
            value={body} onChange={e => setBody(e.target.value)}
            disabled={loading}
          />
          <Button type="submit" variant="primary" size="sm" disabled={loading || !body.trim()}>
            {loading ? 'Posting...' : 'Post comment'}
          </Button>
        </form>
      </div>
    </Drawer>
  )
}
