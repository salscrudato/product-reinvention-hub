// Admin (/app/admin, ADMIN only) — user management (via the setUserRole callable),
// an audit-log explorer that opens any event to its before/after diff, a share-links
// manager, the seed report, and local app settings.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconShield, IconPlus, IconUserX, IconUserCheck, IconSearch, IconFileClock, IconShare, IconClose } from '../components/ui/icons'
import { adapter } from '../lib/backend'
import { copyToClipboard } from '../lib/clipboard'
import { useUser } from '../context/useUser'
import { Tabs, Badge, Button, Input, Dialog, Skeleton, EmptyState } from '../components/ui'
import type { User, AuditEvent, Version, SeedReport, Role } from '@pf/shared'

interface AiUsageDoc {
  id:               string
  feature:          string
  model:            string
  inputTokens:      number
  outputTokens:     number
  cacheReadTokens:  number
  cacheWriteTokens: number
  latencyMs:        number
  ok:               boolean
  estimatedUsd:     number
  at:               unknown
}

type UserDoc      = User & { id: string }
type AuditDoc     = AuditEvent & { id: string }
type VersionDoc   = Version & { id: string }
type SeedReportDoc = SeedReport & { id: string }

interface ShareDoc {
  id:         string
  productId:  string
  note:       string
  createdBy:  { uid: string; name: string }
  createdAt:  unknown
  expiresAt:  string
  snapshot:   { product: { name?: string } }
}

function toMillis(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  const o = v as { toDate?: () => Date; seconds?: number }
  if (typeof o.toDate === 'function') return o.toDate().getTime()
  if (typeof o.seconds === 'number') return o.seconds * 1000
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? null : t }
  return null
}
const fmt = (v: unknown) => { const m = toMillis(v); return m ? new Date(m).toLocaleString() : '—' }

export default function Admin() {
  const { profile, loading } = useUser()
  const [tab, setTab] = useState('users')

  // Hold until the profile resolves — prevents console content from flashing
  // to non-admins while the Firestore user doc is still in-flight.
  if (loading || !profile) return null
  if (profile.role !== 'ADMIN') {
    return <EmptyState icon={<IconShield size={28} />} title="Admins only" description="You need the ADMIN role to view the admin console." />
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-text">Admin</h1>
        <p className="text-sm text-dim">Users, share links, audit trail, seed report and settings.</p>
      </div>
      <Tabs
        tabs={[
          { id: 'users',    label: 'Users'       },
          { id: 'shares',   label: 'Share Links'  },
          { id: 'audit',    label: 'Audit Log'    },
          { id: 'seed',     label: 'Seed Report'  },
          { id: 'ai-cost',  label: 'AI Cost'      },
          { id: 'settings', label: 'Settings'     },
        ]}
        active={tab} onChange={setTab}
      />
      {tab === 'users'    && <UsersTab />}
      {tab === 'shares'   && <SharesTab />}
      {tab === 'audit'    && <AuditTab />}
      {tab === 'seed'     && <SeedTab />}
      {tab === 'ai-cost'  && <AiCostTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ─── Users ──────────────────────────────────────────────────────────────────

const ROLES: Role[] = ['ADMIN', 'EDITOR', 'VIEWER']
const roleColor: Record<Role, 'purple' | 'blue' | 'default'> = { ADMIN: 'purple', EDITOR: 'blue', VIEWER: 'default' }

function UsersTab() {
  const [users,    setUsers]    = useState<UserDoc[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [query,    setQuery]    = useState('')
  const [draft, setDraft] = useState({ email: '', name: '', password: '', role: 'VIEWER' as Role })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsub = adapter.db.subscribe<UserDoc>('users', d => { if (Array.isArray(d)) setUsers(d) })
    return unsub
  }, [])

  async function call(data: Record<string, unknown>, ok: string) {
    setBusy(true)
    try { await adapter.fns.call('setUserRole', data); toast.success(ok) }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Action failed') }
    finally { setBusy(false) }
  }

  async function createUser() {
    if (!draft.email || !draft.password) { toast.error('Email and password required'); return }
    await call({ action: 'create', ...draft }, 'User created')
    setCreating(false); setDraft({ email: '', name: '', password: '', role: 'VIEWER' })
  }

  // Instant typeahead over name + email
  const filtered = useMemo(() => {
    if (!users) return null
    if (!query.trim()) return users
    const q = query.toLowerCase()
    return users.filter(u => u.name?.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [users, query])

  if (users === null) return <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <IconSearch size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" aria-hidden="true" />
          <input
            className="w-full h-8 pl-8 pr-3 rounded-[8px] bg-surface border border-border-strong text-sm placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
            placeholder="Search users…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            aria-label="Search users"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-dim" aria-label="Clear search">
              <IconClose size={12} />
            </button>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} className="ml-auto"><IconPlus size={14} /> New user</Button>
      </div>
      <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        {(filtered ?? []).map(u => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <span className="w-8 h-8 rounded-full text-[11px] font-semibold text-white flex items-center justify-center shrink-0" style={{ background: 'var(--gradient-accent)' }}>
              {(u.name || u.email).slice(0, 2).toUpperCase()}
            </span>
            <div className="flex-1 min-w-[160px]">
              <div className="text-sm font-medium text-text">{u.name || '—'}</div>
              <div className="text-xs text-faint font-mono">{u.email}</div>
            </div>
            {!u.active && <Badge label="deactivated" color="danger" />}
            <select value={u.role} disabled={busy} aria-label={`Role for ${u.email}`}
              onChange={e => call({ action: 'setRole', uid: u.id, role: e.target.value }, 'Role updated')}
              className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-text focus:outline-none" style={{ borderColor: 'var(--color-border)' }}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <Badge label={u.role} color={roleColor[u.role]} />
            {u.active
              ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => call({ action: 'deactivate', uid: u.id }, 'User deactivated')}><IconUserX size={13} /> Deactivate</Button>
              : <Button variant="ghost" size="sm" disabled={busy} onClick={() => call({ action: 'reactivate', uid: u.id }, 'User reactivated')}><IconUserCheck size={13} /> Reactivate</Button>}
          </div>
        ))}
        {filtered?.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-faint">No users match "{query}".</div>
        )}
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="New user">
        <div className="flex flex-col gap-4">
          <Input label="Email" type="email" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="person@company.com" autoFocus />
          <Input label="Name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Full name" />
          <Input label="Temporary password" type="text" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} placeholder="min 6 characters" />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text" htmlFor="new-role">Role</label>
            <select id="new-role" value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value as Role })}
              className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text focus:outline-none" style={{ borderColor: 'var(--color-border-strong)' }}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={createUser} disabled={busy || !draft.email || !draft.password}>{busy ? 'Creating…' : 'Create user'}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

// ─── Share links ─────────────────────────────────────────────────────────────

function SharesTab() {
  const { user } = useUser()
  const [shares, setShares] = useState<ShareDoc[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const unsub = adapter.db.subscribe<ShareDoc>('shares', d => {
      if (Array.isArray(d)) setShares([...d].sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0)))
    })
    return unsub
  }, [])

  async function deleteShare(id: string) {
    if (!user) return
    setBusy(true)
    try {
      // Attribute the deletion to the real acting admin so the audit trail is truthful —
      // not a hard-coded "Admin" actor. (Only ADMINs reach this tab; the guard is belt-and-braces.)
      await adapter.db.mutate({ op: 'delete', path: `shares/${id}`, entityType: 'share', actor: { uid: user.uid, name: user.name ?? user.email ?? 'Admin' } })
      toast.success('Share link deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete share link')
    } finally {
      setBusy(false)
    }
  }

  async function copyLink(id: string) {
    const url = `${location.origin}/share/${id}`
    // Only claim success if the copy actually landed — otherwise the user is told it
    // copied when it didn't (insecure context / no focus / blocked permission).
    const ok = await copyToClipboard(url)
    toast[ok ? 'success' : 'error'](ok ? 'Link copied' : 'Could not copy the link')
  }

  if (shares === null) return <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>

  if (shares.length === 0) return (
    <EmptyState
      icon={<IconShare size={26} />}
      title="No share links yet"
      description="Share buttons in the product workspace create read-only snapshot links here."
    />
  )

  return (
    <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      {shares.map(s => {
        const expired = s.expiresAt && new Date(s.expiresAt) < new Date()
        return (
          <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-medium text-text truncate">{s.snapshot?.product?.name ?? s.productId}</div>
              <div className="text-xs text-faint font-mono mt-0.5">{s.id}</div>
              {s.note && <div className="text-xs text-dim mt-0.5 truncate">{s.note}</div>}
            </div>
            <div className="text-xs text-faint text-right shrink-0">
              <div>{s.createdBy?.name}</div>
              <div>{fmt(s.createdAt)}</div>
              <div className={expired ? 'text-danger' : ''}>Exp: {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : '—'}</div>
            </div>
            {expired && <Badge label="expired" color="danger" />}
            <Button variant="ghost" size="sm" onClick={() => void copyLink(s.id)}>Copy link</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void deleteShare(s.id)}>
              <IconClose size={13} /> Delete
            </Button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Audit explorer ─────────────────────────────────────────────────────────

const actionColor: Record<string, 'good' | 'blue' | 'danger' | 'default'> = { create: 'good', update: 'blue', delete: 'danger' }

function AuditTab() {
  const [events, setEvents]     = useState<AuditDoc[] | null>(null)
  const [versions, setVersions] = useState<VersionDoc[]>([])
  const [actor, setActor]       = useState('')
  const [entityType, setEntityType] = useState('')
  const [action, setAction]     = useState('')
  const [since, setSince]       = useState('')
  const [open, setOpen]         = useState<AuditDoc | null>(null)

  useEffect(() => {
    const u1 = adapter.db.subscribe<AuditDoc>('auditEvents', d => { if (Array.isArray(d)) setEvents(d) })
    const u2 = adapter.db.subscribe<VersionDoc>('versions', d => { if (Array.isArray(d)) setVersions(d) })
    return () => { u1(); u2() }
  }, [])

  const entityTypes = useMemo(() => [...new Set((events ?? []).map(e => e.entityType))].sort(), [events])

  const filtered = useMemo(() => {
    let list = [...(events ?? [])]
    if (actor)      list = list.filter(e => (e.actor?.name ?? '').toLowerCase().includes(actor.toLowerCase()))
    if (entityType) list = list.filter(e => e.entityType === entityType)
    if (action)     list = list.filter(e => e.action === action)
    if (since)      { const s = Date.parse(since); list = list.filter(e => (toMillis(e.at) ?? 0) >= s) }
    return list.sort((a, b) => (toMillis(b.at) ?? 0) - (toMillis(a.at) ?? 0)).slice(0, 200)
  }, [events, actor, entityType, action, since])

  // Correlate an audit event to its version (same entityPath, closest timestamp).
  const versionFor = (e: AuditDoc): VersionDoc | null => {
    const at = toMillis(e.at) ?? 0
    const candidates = versions.filter(v => v.entityPath === e.entityPath)
    if (!candidates.length) return null
    return candidates.reduce((best, v) => Math.abs((toMillis(v.at) ?? 0) - at) < Math.abs((toMillis(best.at) ?? 0) - at) ? v : best)
  }

  if (events === null) return <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input value={actor} onChange={e => setActor(e.target.value)} placeholder="Actor…" leftIcon={<IconSearch size={13} />} className="max-w-[180px] h-8" />
        <select value={entityType} onChange={e => setEntityType(e.target.value)} className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-dim" style={{ borderColor: 'var(--color-border)' }} aria-label="Entity type">
          <option value="">All entities</option>
          {entityTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={action} onChange={e => setAction(e.target.value)} className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-dim" style={{ borderColor: 'var(--color-border)' }} aria-label="Action">
          <option value="">All actions</option>
          {['create', 'update', 'delete'].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="date" value={since} onChange={e => setSince(e.target.value)} className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-dim" style={{ borderColor: 'var(--color-border)' }} aria-label="Since date" />
        {(actor || entityType || action || since) && <button className="text-xs text-accent" onClick={() => { setActor(''); setEntityType(''); setAction(''); setSince('') }}>Clear</button>}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<IconFileClock size={26} />} title="No matching events" description="Adjust the filters, or perform a change to generate audit events." />
      ) : (
        <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {filtered.map(e => (
            <button key={e.id} onClick={() => setOpen(e)} className="w-full flex flex-wrap items-center gap-3 px-4 py-2.5 bg-surface text-left hover:bg-raised transition-colors" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Badge label={e.action} color={actionColor[e.action] ?? 'default'} />
              <span className="text-sm text-text">{e.entityType}</span>
              <span className="text-xs font-mono text-faint flex-1 min-w-[120px] truncate">{e.entityPath}</span>
              <span className="text-xs text-dim">{e.actor?.name ?? '—'}</span>
              <span className="text-xs text-faint">{fmt(e.at)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Diff viewer */}
      <Dialog open={!!open} onClose={() => setOpen(null)} title="Audit event" width="max-w-2xl">
        {open && (() => {
          const v = versionFor(open)
          return (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge label={open.action} color={actionColor[open.action] ?? 'default'} />
                <span className="font-mono text-xs text-dim">{open.entityPath}</span>
              </div>
              <div className="text-xs text-faint">{open.actor?.name} · {fmt(open.at)}</div>
              {v && v.diff?.length ? (
                <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                  <div className="grid grid-cols-[1fr_1fr_1fr] text-[11px] font-semibold text-faint uppercase px-3 py-1.5 bg-raised">
                    <span>Field</span><span>Before</span><span>After</span>
                  </div>
                  {v.diff.map((d, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr] gap-2 px-3 py-2 text-xs" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <span className="font-mono text-text">{d.field}</span>
                      <span className="text-danger font-mono break-all">{JSON.stringify(d.before)}</span>
                      <span className="text-good font-mono break-all">{JSON.stringify(d.after)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-dim">{v ? 'No field-level diff recorded for this event.' : 'No version snapshot correlated to this event.'}</p>
              )}
            </div>
          )
        })()}
      </Dialog>
    </div>
  )
}

// ─── Seed report ────────────────────────────────────────────────────────────

function SeedTab() {
  const [reports, setReports] = useState<SeedReportDoc[] | null>(null)
  useEffect(() => {
    const unsub = adapter.db.subscribe<SeedReportDoc>('seedReports', d => { if (Array.isArray(d)) setReports(d) })
    return unsub
  }, [])

  if (reports === null) return <Skeleton className="h-40" />
  const latest = [...reports].sort((a, b) => (toMillis(b.at) ?? 0) - (toMillis(a.at) ?? 0))[0]
  if (!latest) return <EmptyState icon={<IconFileClock size={26} />} title="No seed reports" description="Run pnpm seed to generate one." />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text">Latest seed</span>
        <span className="text-xs text-faint">{fmt(latest.at)}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(latest.workedExamplePremiums ?? { 'HO.PROD.001': latest.workedExamplePremium }).map(([pid, prem]) => (
          <div key={pid} className="flex items-center justify-between px-4 py-3 rounded-[12px]" style={{ background: 'var(--gradient-accent-soft)', border: '1px solid var(--color-accent-line)' }}>
            <span className="text-sm text-text">{pid} worked example</span>
            <span className="text-lg font-bold gradient-text">${prem?.toLocaleString()}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(latest.counts ?? {}).map(([k, n]) => (
          <div key={k} className="bg-surface rounded-[12px] p-3" style={{ border: '1px solid var(--color-border)' }}>
            <div className="text-lg font-bold text-text tabular-nums">{n}</div>
            <div className="text-xs text-faint">{k}</div>
          </div>
        ))}
      </div>
      {(latest.warnings ?? []).length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-warn uppercase">Warnings</span>
          {latest.warnings.map((w, i) => <span key={i} className="text-xs text-dim">• {w}</span>)}
        </div>
      )}
    </div>
  )
}

// ─── AI Cost ────────────────────────────────────────────────────────────────

type Window = '7d' | '30d' | '90d' | 'all'

const WINDOWS: { id: Window; label: string }[] = [
  { id: '7d',  label: 'Last 7 days'  },
  { id: '30d', label: 'Last 30 days' },
  { id: '90d', label: 'Last 90 days' },
  { id: 'all', label: 'All time'     },
]

function windowStart(w: Window): number {
  if (w === 'all') return 0
  const days: Record<Window, number> = { '7d': 7, '30d': 30, '90d': 90, all: 0 }
  return Date.now() - days[w] * 86_400_000
}

function fmtUsd(n: number): string {
  return n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(6)}`
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function AiCostTab() {
  const [records, setRecords] = useState<AiUsageDoc[] | null>(null)
  const [win, setWin]         = useState<Window>('30d')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // Read-only; server-side ADMIN gate in Firestore rules + Admin component gate above.
    adapter.db.list<AiUsageDoc>('aiUsage', { orderBy: [{ field: 'at', dir: 'desc' }], limit: 2000 })
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!records) return []
    const cutoff = windowStart(win)
    return records.filter(r => (toMillis(r.at) ?? 0) >= cutoff)
  }, [records, win])

  // Aggregate totals
  const totals = useMemo(() => {
    const base = { calls: 0, usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, latencyMs: 0, errors: 0 }
    for (const r of filtered) {
      base.calls++
      base.usd       += r.estimatedUsd    ?? 0
      base.input     += r.inputTokens     ?? 0
      base.output    += r.outputTokens    ?? 0
      base.cacheRead += r.cacheReadTokens ?? 0
      base.cacheWrite += r.cacheWriteTokens ?? 0
      base.latencyMs += r.latencyMs       ?? 0
      if (!r.ok) base.errors++
    }
    return base
  }, [filtered])

  // By feature
  const byFeature = useMemo(() => {
    const map = new Map<string, typeof totals>()
    for (const r of filtered) {
      const f = r.feature ?? 'unknown'
      if (!map.has(f)) map.set(f, { calls: 0, usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, latencyMs: 0, errors: 0 })
      const a = map.get(f)!
      a.calls++; a.usd += r.estimatedUsd ?? 0; a.input += r.inputTokens ?? 0
      a.output += r.outputTokens ?? 0; a.cacheRead += r.cacheReadTokens ?? 0
      a.cacheWrite += r.cacheWriteTokens ?? 0; a.latencyMs += r.latencyMs ?? 0
      if (!r.ok) a.errors++
    }
    return [...map.entries()].sort((a, b) => b[1].usd - a[1].usd)
  }, [filtered])

  // By model
  const byModel = useMemo(() => {
    const map = new Map<string, typeof totals>()
    for (const r of filtered) {
      const m = r.model ?? 'unknown'
      if (!map.has(m)) map.set(m, { calls: 0, usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, latencyMs: 0, errors: 0 })
      const a = map.get(m)!
      a.calls++; a.usd += r.estimatedUsd ?? 0; a.input += r.inputTokens ?? 0
      a.output += r.outputTokens ?? 0; a.cacheRead += r.cacheReadTokens ?? 0
      a.cacheWrite += r.cacheWriteTokens ?? 0; a.latencyMs += r.latencyMs ?? 0
      if (!r.ok) a.errors++
    }
    return [...map.entries()].sort((a, b) => b[1].usd - a[1].usd)
  }, [filtered])

  const totalTokens = totals.input + totals.output + totals.cacheRead + totals.cacheWrite
  const cacheHitRatio = totalTokens > 0 ? totals.cacheRead / totalTokens : 0
  const avgLatency    = totals.calls > 0 ? Math.round(totals.latencyMs / totals.calls) : 0

  if (loading) return <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
  if (!records || records.length === 0) return (
    <EmptyState
      icon={<IconFileClock size={26} />}
      title="No AI usage data yet"
      description="Usage records appear here after the first AI call is made."
    />
  )

  return (
    <div className="flex flex-col gap-5">
      {/* Window selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-dim uppercase">Window</span>
        <div className="flex gap-1">
          {WINDOWS.map(w => (
            <button
              key={w.id}
              onClick={() => setWin(w.id)}
              className={`px-3 py-1 rounded-[8px] text-xs font-medium transition-colors ${win === w.id ? 'text-white' : 'text-dim hover:text-text bg-surface'}`}
              style={win === w.id ? { background: 'var(--gradient-accent)' } : { border: '1px solid var(--color-border)' }}
            >{w.label}</button>
          ))}
        </div>
        {filtered.length < (records?.length ?? 0) && (
          <span className="text-xs text-faint ml-auto">{filtered.length} / {records?.length} records</span>
        )}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total spend', value: fmtUsd(totals.usd) },
          { label: 'Total calls', value: totals.calls.toLocaleString() },
          { label: 'Cache-hit ratio', value: `${(cacheHitRatio * 100).toFixed(1)}%` },
          { label: 'Avg latency', value: `${avgLatency.toLocaleString()} ms` },
        ].map(t => (
          <div key={t.label} className="bg-surface rounded-[12px] p-3" style={{ border: '1px solid var(--color-border)' }}>
            <div className="text-lg font-bold text-text tabular-nums">{t.value}</div>
            <div className="text-xs text-faint">{t.label}</div>
          </div>
        ))}
      </div>

      {/* Token volume */}
      <div className="bg-surface rounded-[12px] p-4" style={{ border: '1px solid var(--color-border)' }}>
        <div className="text-xs font-semibold text-dim uppercase mb-3">Token volume</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {[
            { label: 'Input', value: fmtTokens(totals.input), color: 'var(--color-accent)' },
            { label: 'Output', value: fmtTokens(totals.output), color: 'var(--color-good)' },
            { label: 'Cache read', value: fmtTokens(totals.cacheRead), color: 'var(--color-warn)' },
            { label: 'Cache write', value: fmtTokens(totals.cacheWrite), color: 'var(--color-dim)' },
          ].map(t => (
            <div key={t.label} className="flex flex-col gap-0.5">
              <div className="font-semibold tabular-nums" style={{ color: t.color }}>{t.value}</div>
              <div className="text-xs text-faint">{t.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* By feature */}
      {byFeature.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-dim uppercase mb-2">By feature</div>
          <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2 text-[11px] font-semibold text-faint uppercase bg-raised">
              <span>Feature</span><span>Calls</span><span>Tokens</span><span>Cost</span><span>Errors</span>
            </div>
            {byFeature.map(([feat, a]) => (
              <div key={feat} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-2.5 text-sm bg-surface" style={{ borderTop: '1px solid var(--color-border)' }}>
                <span className="font-mono text-text text-xs truncate">{feat}</span>
                <span className="text-dim tabular-nums text-right">{a.calls}</span>
                <span className="text-dim tabular-nums text-right">{fmtTokens(a.input + a.output + a.cacheRead)}</span>
                <span className="font-semibold tabular-nums text-right" style={{ color: 'var(--color-accent)' }}>{fmtUsd(a.usd)}</span>
                <span className={`tabular-nums text-right ${a.errors > 0 ? 'text-danger' : 'text-faint'}`}>{a.errors}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* By model */}
      {byModel.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-dim uppercase mb-2">By model</div>
          <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 text-[11px] font-semibold text-faint uppercase bg-raised">
              <span>Model</span><span>Calls</span><span>Tokens</span><span>Cost</span>
            </div>
            {byModel.map(([model, a]) => (
              <div key={model} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center px-4 py-2.5 text-sm bg-surface" style={{ borderTop: '1px solid var(--color-border)' }}>
                <span className="font-mono text-text text-xs truncate">{model}</span>
                <span className="text-dim tabular-nums text-right">{a.calls}</span>
                <span className="text-dim tabular-nums text-right">{fmtTokens(a.input + a.output + a.cacheRead)}</span>
                <span className="font-semibold tabular-nums text-right" style={{ color: 'var(--color-accent)' }}>{fmtUsd(a.usd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <EmptyState
          icon={<IconFileClock size={26} />}
          title="No records in this window"
          description="Select a wider time window or wait for AI calls to be made."
        />
      )}
    </div>
  )
}

// ─── Settings (local, demo) ─────────────────────────────────────────────────

const SETTINGS_KEY = 'prh:settings'
function SettingsTab() {
  const [appName, setAppName] = useState('Product Reinvention Hub')
  const [expiry, setExpiry]   = useState('30')

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); if (s.appName) setAppName(s.appName); if (s.expiry) setExpiry(String(s.expiry)) } catch { /* ignore */ }
  }, [])

  function save() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ appName, expiry: Number(expiry) }))
    toast.success('Settings saved')
  }

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <Input label="App name" value={appName} onChange={e => setAppName(e.target.value)} />
      <Input label="Default share-link expiry (days)" type="number" value={expiry} onChange={e => setExpiry(e.target.value)} min={1} />
      <p className="text-xs text-faint">Stored locally in this browser for the demo.</p>
      <div><Button variant="primary" size="sm" onClick={save}>Save settings</Button></div>
    </div>
  )
}
