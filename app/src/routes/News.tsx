// News (/app/news) — a market-news feed curated by the nightly agent, plus a
// natural-language preference box (stored per user as newsPrefs) and a manual
// "Refresh now" for on-demand fetches. Empty state explains the nightly agent.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconNews, IconRefresh, IconExternalLink, IconSparkle } from '../components/ui/icons'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Badge, Button, Skeleton, EmptyState } from '../components/ui'
import type { News as NewsType, NewsPrefs } from '@pf/shared'

type NewsDoc = NewsType & { id: string }

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v
  const o = v as { toDate?: () => Date; seconds?: number }
  if (o && typeof o.toDate === 'function') return o.toDate().getTime()
  if (o && typeof o.seconds === 'number') return o.seconds * 1000
  return 0
}

export default function News() {
  const { user } = useUser()
  const [items, setItems]         = useState<NewsDoc[] | null>(null)
  const [instruction, setInstr]   = useState('')
  const [savedInstr, setSaved]    = useState('')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const u1 = adapter.db.subscribe<NewsDoc>('news', d => { if (Array.isArray(d)) setItems(d) })
    let u2: (() => void) | undefined
    if (user) {
      u2 = adapter.db.subscribe<NewsPrefs>(`newsPrefs/${user.uid}`, d => {
        if (d && !Array.isArray(d)) { setInstr(d.instruction ?? ''); setSaved(d.instruction ?? '') }
      })
    }
    return () => { u1(); u2?.() }
  }, [user])

  const sorted = useMemo(() => [...(items ?? [])].sort((a, b) => toMillis(b.fetchedAt) - toMillis(a.fetchedAt)), [items])

  async function savePrefs() {
    if (!user) return
    try {
      await adapter.db.mutate({
        op: savedInstr ? 'update' : 'create', path: `newsPrefs/${user.uid}`,
        data: { instruction: instruction.trim() },
        entityType: 'newsPrefs', actor: { uid: user.uid, name: user.name ?? user.email ?? 'User' },
      })
      setSaved(instruction.trim())
      toast.success('Tracking preference saved')
    } catch {
      toast.error('Could not save preference')
    }
  }

  async function refresh() {
    setRefreshing(true)
    try {
      const r = await adapter.fns.call<Record<string, never>, { found: number; stored: number; error?: string }>('refreshNews', {})
      if (r.error) toast.error(r.error)
      else toast.success(`Found ${r.found}, added ${r.stored} new item${r.stored === 1 ? '' : 's'}`)
    } catch {
      toast.error('Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text">Market News</h1>
          <p className="text-sm text-dim">Curated nightly by an AI agent from your tracking instruction.</p>
        </div>
        <Button variant="default" size="sm" onClick={refresh} disabled={refreshing}>
          <IconRefresh size={14} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Fetching…' : 'Refresh now'}
        </Button>
      </div>

      {/* Preference box */}
      <div className="bg-surface rounded-[14px] p-4 flex flex-col gap-2" style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
        <label htmlFor="news-instr" className="flex items-center gap-1.5 text-sm font-medium text-text"><IconSparkle size={14} className="text-accent" /> What should the agent track?</label>
        <textarea id="news-instr" value={instruction} onChange={e => setInstr(e.target.value)} rows={2}
          placeholder="e.g. Track homeowners rate filings and competitor HO-3 launches in TX and FL"
          className="rounded-[10px] bg-surface border text-sm text-text p-3 focus:outline-none focus:ring-2 focus:ring-accent/25 resize-none" style={{ borderColor: 'var(--color-border-strong)' }} />
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={savePrefs} disabled={!instruction.trim() || instruction.trim() === savedInstr}>Save preference</Button>
        </div>
      </div>

      {/* Feed */}
      {items === null ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : sorted.length === 0 ? (
        <EmptyState icon={<IconNews size={28} />} title="No news yet"
          description="A nightly agent (06:00 ET) searches the web for your tracking instruction and files what it finds here. Set a preference above, then use “Refresh now” to fetch immediately." />
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map(n => (
            <a key={n.id} href={n.url} target="_blank" rel="noreferrer"
              className="group bg-surface rounded-[14px] p-4 flex flex-col gap-2 transition-all hover:shadow-[var(--shadow-card-hover)]"
              style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-center gap-2 text-xs text-faint">
                <span className="font-medium text-dim">{n.source || 'Web'}</span>
                {n.fetchedAt ? <><span>·</span><span>{new Date(toMillis(n.fetchedAt)).toLocaleDateString()}</span></> : null}
                <IconExternalLink size={12} className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <h3 className="text-sm font-semibold text-text group-hover:text-accent transition-colors leading-snug">{n.title}</h3>
              {n.summary && <p className="text-sm text-dim leading-relaxed">{n.summary}</p>}
              {(n.tags ?? []).length > 0 && <div className="flex flex-wrap gap-1.5 pt-0.5">{n.tags.map(t => <Badge key={t} label={t} color="purple" />)}</div>}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
