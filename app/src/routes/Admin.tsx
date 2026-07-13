// Admin (/app/admin, ADMIN only) — user management (via the setUserRole callable),
// an audit-log explorer that opens any event to its before/after diff, the seed
// report, AI cost telemetry, and local app settings.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconShield, IconPlus, IconUserX, IconSearch, IconFileClock, IconWarning } from '../components/ui/icons'
import { adapter } from '../lib/backend'
import type { ManagedUser, TenantInfo, Tier } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Tabs, Badge, Button, Input, Dialog, Skeleton, EmptyState } from '../components/ui'
import { DEFAULT_BUDGET } from '@pf/shared'
import type { AuditEvent, Version, SeedReport } from '@pf/shared'

// Headline cost-program result (projected — mirrors docs/review/COST_REPORT.md). No live
// Anthropic key exists in this environment, so these are structural projections from the
// prompt structure + the pricing table, exactly like COST_BASELINE.md's per-call estimates.
// Blended = Σ representative after-cost ÷ Σ baseline cost across the AI features.
const COST_HEADLINE = { beforeBlendedUsd: 0.0135, afterBlendedUsd: 0.0089, reductionPct: 34 }

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
  tier?:            'cheap' | 'strong'  // cheap-first cascade tier (older records may lack it)
  escalated?:       boolean             // strong record produced by a failed cheap check
  semanticCache?:   'hit' | 'miss'      // Part A: served from the semantic response cache?
  savedUsd?:        number              // spend avoided by a cache hit / degradation
  degraded?:        boolean             // Part C: served under a budget/breaker degradation
  denied?:          boolean             // Part C: denied by the global ceiling (no model call)
  at:               unknown
}

type AuditDoc     = AuditEvent & { id: string }
type VersionDoc   = Version & { id: string }
type SeedReportDoc = SeedReport & { id: string }

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
        <p className="text-sm text-dim">Users, audit trail, seed report, AI cost and settings.</p>
      </div>
      <Tabs
        tabs={[
          { id: 'tenants',  label: 'Tenants'      },
          { id: 'users',    label: 'Users'       },
          { id: 'audit',    label: 'Audit Log'    },
          { id: 'seed',     label: 'Seed Report'  },
          { id: 'ai-cost',  label: 'AI Cost'      },
          { id: 'settings', label: 'Settings'     },
        ]}
        active={tab} onChange={setTab}
      />
      {tab === 'tenants'  && <TenantsTab />}
      {tab === 'users'    && <UsersTab />}
      {tab === 'audit'    && <AuditTab />}
      {tab === 'seed'     && <SeedTab />}
      {tab === 'ai-cost'  && <AiCostTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ─── Users ──────────────────────────────────────────────────────────────────

const TIERS: Tier[] = ['VIEWER', 'ANALYST', 'EDITOR', 'ADMIN']
const tierColor: Record<Tier, 'purple' | 'blue' | 'good' | 'default'> = { SUPER_ADMIN: 'purple', ADMIN: 'purple', EDITOR: 'blue', ANALYST: 'good', VIEWER: 'default' }
const TIER_HELP = 'VIEWER = read · ANALYST = read + AI · EDITOR = edit + AI · ADMIN = full (tenants + users)'

// ─── Tenants ──────────────────────────────────────────────────────────────
function TenantsTab() {
  const [tenants, setTenants] = useState<TenantInfo[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', id: '' })
  const [busy, setBusy] = useState(false)
  const load = () => adapter.tenancy.listTenants().then(setTenants).catch(() => setTenants([]))
  useEffect(() => { load() }, [])

  async function create() {
    if (!draft.name) { toast.error('Company name required'); return }
    setBusy(true)
    try { await adapter.tenancy.createTenant(draft.id || draft.name, draft.name); toast.success('Tenant created'); setCreating(false); setDraft({ name: '', id: '' }); load() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  async function remove(id: string) {
    if (!window.confirm(`Remove tenant "${id}"? Its data stays partitioned but becomes inaccessible.`)) return
    try { await adapter.tenancy.deleteTenant(id); toast.success('Tenant removed'); load() } catch { toast.error('Failed') }
  }

  if (tenants === null) return <Skeleton className="h-24" />
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center"><Button variant="primary" size="sm" onClick={() => setCreating(true)} className="ml-auto"><IconPlus size={14} /> New tenant</Button></div>
      {tenants.length === 0 ? (
        <EmptyState icon={<IconShield size={26} />} title="No tenants yet" description="Create a tenant to load a company's isolated data. Each tenant is a securely separated database." />
      ) : (
        <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {tenants.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex-1"><div className="text-sm font-medium text-text">{t.name}</div><div className="text-xs text-faint font-mono">{t.id}</div></div>
              <Button variant="ghost" size="sm" onClick={() => remove(t.id)}><IconUserX size={13} /> Remove</Button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New tenant">
        <div className="flex flex-col gap-4">
          <Input label="Company name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Acme Insurance" autoFocus />
          <Input label="Tenant id (optional)" value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value })} placeholder="auto-derived from name if blank" />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={create} disabled={busy || !draft.name}>{busy ? 'Creating…' : 'Create tenant'}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

// ─── Users ──────────────────────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null)
  const [tenants, setTenants] = useState<TenantInfo[]>([])
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<{ username: string; password: string; role: Tier; tenant: string }>({ username: '', password: '', role: 'VIEWER', tenant: '' })
  const [busy, setBusy] = useState(false)
  const load = () => adapter.tenancy.listUsers().then(setUsers).catch(() => setUsers([]))
  useEffect(() => { load(); adapter.tenancy.listTenants().then(setTenants).catch(() => {}) }, [])

  async function create() {
    if (!draft.username || !draft.password) { toast.error('Username and password required'); return }
    setBusy(true)
    try {
      await adapter.tenancy.createUser({ username: draft.username, password: draft.password, role: draft.role, tenants: draft.tenant ? [draft.tenant] : [] })
      toast.success('User created'); setCreating(false); setDraft({ username: '', password: '', role: 'VIEWER', tenant: '' }); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  async function remove(u: string) {
    if (!window.confirm(`Delete user "${u}"?`)) return
    try { await adapter.tenancy.deleteUser(u); toast.success('User deleted'); load() } catch { toast.error('Failed') }
  }

  if (users === null) return <Skeleton className="h-24" />
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center"><Button variant="primary" size="sm" onClick={() => setCreating(true)} className="ml-auto"><IconPlus size={14} /> New user</Button></div>
      {users.length === 0 ? (
        <EmptyState icon={<IconShield size={26} />} title="No gated users yet" description="No tenant-gated users yet. Create them here — each with a username, password, role and company." />
      ) : (
        <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {users.map(u => (
            <div key={u.username} className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="w-8 h-8 rounded-full text-[11px] font-semibold text-white flex items-center justify-center shrink-0" style={{ background: 'var(--gradient-accent)' }}>{u.username.slice(0, 2).toUpperCase()}</span>
              <div className="flex-1 min-w-[140px]">
                <div className="text-sm font-medium text-text">{u.username}</div>
                <div className="text-xs text-faint font-mono">{u.tenants === '*' ? 'all tenants' : ((u.tenants || []).join(', ') || '— no tenant —')}</div>
              </div>
              <Badge label={u.role} color={tierColor[u.role]} />
              <Button variant="ghost" size="sm" onClick={() => remove(u.username)}><IconUserX size={13} /> Delete</Button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New user">
        <div className="flex flex-col gap-4">
          <Input label="Username" value={draft.username} onChange={e => setDraft({ ...draft, username: e.target.value })} placeholder="jane.doe" autoFocus />
          <Input label="Password" type="text" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} placeholder="set a password" />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text" htmlFor="new-role">Role</label>
            <select id="new-role" value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value as Tier })}
              className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text focus:outline-none" style={{ borderColor: 'var(--color-border-strong)' }}>
              {TIERS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-xs text-faint">{TIER_HELP}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text" htmlFor="new-tenant">Company (tenant)</label>
            <select id="new-tenant" value={draft.tenant} onChange={e => setDraft({ ...draft, tenant: e.target.value })}
              className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text focus:outline-none" style={{ borderColor: 'var(--color-border-strong)' }}>
              <option value="">— select company —</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={create} disabled={busy || !draft.username || !draft.password}>{busy ? 'Creating…' : 'Create user'}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

// ─── Audit explorer ─────────────────────────────────────────────────────────

const actionColor: Record<string, 'good' | 'blue' | 'danger' | 'default'> = { create: 'good', update: 'blue', delete: 'danger' }

const AUDIT_PAGE = 200

function AuditTab() {
  const [events, setEvents]     = useState<AuditDoc[] | null>(null)
  const [versions, setVersions] = useState<VersionDoc[]>([])
  const [actor, setActor]       = useState('')
  const [entityType, setEntityType] = useState('')
  const [action, setAction]     = useState('')
  const [since, setSince]       = useState('')
  const [open, setOpen]         = useState<AuditDoc | null>(null)
  const [limit, setLimit]       = useState(AUDIT_PAGE)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    setEvents(null)
    Promise.all([
      adapter.db.list<AuditDoc>('auditEvents',  { orderBy: [{ field: 'at', dir: 'desc' }], limit }),
      adapter.db.list<VersionDoc>('versions', { orderBy: [{ field: 'at', dir: 'desc' }], limit }),
    ]).then(([evts, vers]) => { setEvents(evts); setVersions(vers); setLoadingMore(false) })
      .catch(() => { setEvents([]); setVersions([]); setLoadingMore(false) })
  }, [limit])

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
      {(events?.length ?? 0) >= limit && (
        <div className="flex justify-center pt-1">
          <button
            className="text-xs text-accent hover:underline disabled:opacity-50"
            disabled={loadingMore}
            onClick={() => { setLoadingMore(true); setLimit(l => l + AUDIT_PAGE) }}
          >
            {loadingMore ? 'Loading…' : `Load more (showing ${limit})`}
          </button>
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

const AI_USAGE_PAGE = 500

function AiCostTab() {
  const [records, setRecords]   = useState<AiUsageDoc[] | null>(null)
  const [win, setWin]           = useState<Window>('30d')
  const [loading, setLoading]   = useState(true)
  const [usageLimit, setUsageLimit] = useState(AI_USAGE_PAGE)
  const [loadingMore, setLoadingMore] = useState(false)
  // Live provider circuit-breaker state (ADMIN-readable per firestore.rules; read-only).
  // Absent doc = never tripped = closed.
  const [breaker, setBreaker] = useState<{ consecutiveFailures?: number; openUntil?: number } | null>(null)
  useEffect(() => {
    const unsub = adapter.db.subscribe<{ consecutiveFailures?: number; openUntil?: number }>(
      'costCounters/breaker-anthropic',
      d => setBreaker(Array.isArray(d) ? null : (d ?? null)),
    )
    return unsub
  }, [])

  useEffect(() => {
    setLoading(true)
    // Read-only; server-side ADMIN gate in Firestore rules + Admin component gate above.
    // Bounded to usageLimit — use "Load more" to see older records.
    adapter.db.list<AiUsageDoc>('aiUsage', { orderBy: [{ field: 'at', dir: 'desc' }], limit: usageLimit })
      .then(r => { setRecords(r); setLoadingMore(false) })
      .catch(() => { setRecords([]); setLoadingMore(false) })
      .finally(() => setLoading(false))
  }, [usageLimit])

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

  // Cheap-first cascade metrics (P-B6): `tier` splits cheap (haiku) vs strong (sonnet) spend;
  // escalation rate = escalations ÷ cheap calls. It climbs toward 100% exactly in the known
  // failure mode — a drifting verifier escalating every cheap pass — so it drives the alarm.
  // Older records predate the field; fall back to inferring the tier from the model id.
  const tierOf = (r: AiUsageDoc) => r.tier ?? (r.model?.includes('haiku') ? 'cheap' : 'strong')
  const cascade = useMemo(() => {
    let cheapCalls = 0, strongCalls = 0, escalations = 0, cheapUsd = 0, strongUsd = 0
    for (const r of filtered) {
      if (tierOf(r) === 'cheap') { cheapCalls++; cheapUsd += r.estimatedUsd ?? 0 }
      else { strongCalls++; strongUsd += r.estimatedUsd ?? 0 }
      if (r.escalated) escalations++
    }
    return { cheapCalls, strongCalls, escalations, cheapUsd, strongUsd, rate: cheapCalls > 0 ? escalations / cheapCalls : null }
  }, [filtered])

  // Per-feature escalation so the by-feature table can pinpoint a drifting verifier.
  const escByFeature = useMemo(() => {
    const map = new Map<string, { cheap: number; escalated: number }>()
    for (const r of filtered) {
      const f = r.feature ?? 'unknown'
      if (!map.has(f)) map.set(f, { cheap: 0, escalated: 0 })
      const a = map.get(f)!
      if (tierOf(r) === 'cheap') a.cheap++
      if (r.escalated) a.escalated++
    }
    return map
  }, [filtered])

  // Cost-ensemble metrics (Part A/C): semantic-cache hit rate + savings, plus the budget
  // degradation/denial counts that show the caps + breaker doing their job.
  const ensemble = useMemo(() => {
    let hits = 0, misses = 0, saved = 0, degraded = 0, denied = 0
    for (const r of filtered) {
      if (r.semanticCache === 'hit')  hits++
      if (r.semanticCache === 'miss') misses++
      saved += r.savedUsd ?? 0
      if (r.degraded) degraded++
      if (r.denied)   denied++
    }
    const total = hits + misses
    return { hits, misses, saved, degraded, denied, hitRate: total > 0 ? hits / total : null }
  }, [filtered])

  // Today's global spend (UTC day, ALL records — not the window) vs the server-enforced global
  // ceiling. The ceiling is the hard "no spend without bound" backstop with this ADMIN alarm.
  const todaySpendUsd = useMemo(() => {
    const startOfUtcDay = new Date(new Date().toISOString().slice(0, 10)).getTime()
    let usd = 0
    for (const r of records ?? []) if ((toMillis(r.at) ?? 0) >= startOfUtcDay) usd += r.estimatedUsd ?? 0
    return usd
  }, [records])
  const ceilingUsd = DEFAULT_BUDGET.globalDailyUsd
  const ceilingBreached = todaySpendUsd >= ceilingUsd
  const ceilingPct = ceilingUsd > 0 ? Math.min(100, (todaySpendUsd / ceilingUsd) * 100) : 0
  const breakerOpen = !!breaker?.openUntil && breaker.openUntil > Date.now()

  // Configurable cost alarm (localStorage; advisory). A rising escalation rate is the tell
  // for a drifting verifier; the spend cap catches runaway blended cost in the window.
  const [alarm, setAlarm] = useState<{ escalationPct: number; spendCapUsd: number }>(() => {
    try { const raw = localStorage.getItem('prh:aiCostAlarm'); if (raw) return JSON.parse(raw) as { escalationPct: number; spendCapUsd: number } } catch { /* default */ }
    return { escalationPct: 50, spendCapUsd: 0 }
  })
  useEffect(() => { try { localStorage.setItem('prh:aiCostAlarm', JSON.stringify(alarm)) } catch { /* quota — non-fatal */ } }, [alarm])

  const totalTokens = totals.input + totals.output + totals.cacheRead + totals.cacheWrite
  const cacheHitRatio = totalTokens > 0 ? totals.cacheRead / totalTokens : 0
  const avgLatency    = totals.calls > 0 ? Math.round(totals.latencyMs / totals.calls) : 0
  const escBreached   = cascade.rate != null && alarm.escalationPct > 0 && cascade.rate * 100 > alarm.escalationPct
  const spendBreached = alarm.spendCapUsd > 0 && totals.usd > alarm.spendCapUsd

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

      {/* Headline — cost-program result (projected; see COST_REPORT.md). BEFORE = COST_BASELINE. */}
      <div className="rounded-[12px] p-4" style={{ border: '1px solid var(--color-border)', background: 'var(--gradient-accent-soft)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-dim uppercase">Cost reduction — blended</div>
          <span className="text-[11px] text-faint">projected · see COST_REPORT.md</span>
        </div>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-faint line-through tabular-nums">${COST_HEADLINE.beforeBlendedUsd.toFixed(4)}</span>
            <span className="text-faint">→</span>
            <span className="text-2xl font-bold text-text tabular-nums">${COST_HEADLINE.afterBlendedUsd.toFixed(4)}</span>
            <span className="text-xs text-faint">/ AI call (blended)</span>
          </div>
          <div className="flex flex-col">
            <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-good)' }}>−{COST_HEADLINE.reductionPct}%</span>
            <span className="text-xs text-faint">blended reduction vs baseline</span>
          </div>
        </div>
      </div>

      {/* Global daily ceiling — the ADMIN alarm for the hard "no spend without bound" backstop */}
      {ceilingBreached && (
        <div role="alert" className="flex items-start gap-2.5 rounded-[12px] px-4 py-3"
          style={{ border: '1px solid var(--color-danger)', background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)' }}>
          <IconWarning size={18} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <div className="font-semibold text-danger">Global daily AI ceiling reached</div>
            <div className="mt-0.5 text-dim">Today's spend <span className="font-semibold tabular-nums">{fmtUsd(todaySpendUsd)}</span> has reached the ${ceilingUsd} daily ceiling — new AI calls are being denied server-side with a "temporarily limited" message until the day rolls over.</div>
          </div>
        </div>
      )}

      {/* Cost alarm — fires when a verifier drifts (escalation rate) or spend runs away */}
      {(escBreached || spendBreached) && (
        <div role="alert" className="flex items-start gap-2.5 rounded-[12px] px-4 py-3"
          style={{ border: '1px solid var(--color-danger)', background: 'color-mix(in srgb, var(--color-danger) 8%, transparent)' }}>
          <IconWarning size={18} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-sm">
            <div className="font-semibold text-danger">AI cost alarm</div>
            <ul className="mt-0.5 flex flex-col gap-0.5 text-dim">
              {escBreached && <li>Escalation rate <span className="font-semibold tabular-nums">{(cascade.rate! * 100).toFixed(1)}%</span> exceeds the {alarm.escalationPct}% threshold — a cheap-first verifier may be escalating too often (see “Escal.” by feature below).</li>}
              {spendBreached && <li>Spend <span className="font-semibold tabular-nums">{fmtUsd(totals.usd)}</span> exceeds the ${alarm.spendCapUsd} cap for this window.</li>}
            </ul>
          </div>
        </div>
      )}

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

      {/* Cheap-first cascade + configurable alarm (P-B6) */}
      <div className="bg-surface rounded-[12px] p-4" style={{ border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-dim uppercase">Cheap-first cascade</div>
          <span className="text-xs text-faint">
            escalation rate{' '}
            <span className="font-semibold tabular-nums" style={{ color: escBreached ? 'var(--color-danger)' : 'var(--color-text)' }}>
              {cascade.rate == null ? '—' : `${(cascade.rate * 100).toFixed(1)}%`}
            </span>
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          {[
            { label: 'Cheap calls (haiku)',   value: cascade.cheapCalls.toLocaleString(),  color: 'var(--color-good)' },
            { label: 'Strong calls (sonnet)', value: cascade.strongCalls.toLocaleString(), color: 'var(--color-accent)' },
            { label: 'Escalations',           value: cascade.escalations.toLocaleString(), color: 'var(--color-warn)' },
            { label: 'Strong spend share',    value: totals.usd > 0 ? `${(cascade.strongUsd / totals.usd * 100).toFixed(0)}%` : '—', color: 'var(--color-dim)' },
          ].map(t => (
            <div key={t.label} className="flex flex-col gap-0.5">
              <div className="font-semibold tabular-nums" style={{ color: t.color }}>{t.value}</div>
              <div className="text-xs text-faint">{t.label}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-4 mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <label className="flex flex-col gap-1 text-[11px] text-faint uppercase font-semibold">
            Escalation alarm (%)
            <input type="number" min={0} max={100} value={alarm.escalationPct}
              onChange={e => setAlarm(a => ({ ...a, escalationPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
              className="w-20 h-8 px-2 rounded-[8px] bg-raised text-text text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ border: '1px solid var(--color-border)' }} />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-faint uppercase font-semibold">
            Spend cap ($ · 0 = off)
            <input type="number" min={0} step="0.5" value={alarm.spendCapUsd}
              onChange={e => setAlarm(a => ({ ...a, spendCapUsd: Math.max(0, Number(e.target.value) || 0) }))}
              className="w-24 h-8 px-2 rounded-[8px] bg-raised text-text text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              style={{ border: '1px solid var(--color-border)' }} />
          </label>
          <span className="text-[11px] text-faint max-w-xs leading-snug">Advisory thresholds for this window. A rising escalation rate is the tell for a drifting verifier escalating everything.</span>
        </div>
      </div>

      {/* Semantic response cache (Part A) + cost controls (Part C) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-surface rounded-[12px] p-4" style={{ border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-dim uppercase">Semantic response cache</div>
            <span className="text-xs text-faint">
              hit rate{' '}
              <span className="font-semibold tabular-nums text-text">{ensemble.hitRate == null ? '—' : `${(ensemble.hitRate * 100).toFixed(1)}%`}</span>
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {[
              { label: 'Cache hits',  value: ensemble.hits.toLocaleString(),   color: 'var(--color-good)' },
              { label: 'Cache misses', value: ensemble.misses.toLocaleString(), color: 'var(--color-dim)' },
              { label: 'Est. saved',  value: fmtUsd(ensemble.saved),           color: 'var(--color-accent)' },
            ].map(t => (
              <div key={t.label} className="flex flex-col gap-0.5">
                <div className="font-semibold tabular-nums" style={{ color: t.color }}>{t.value}</div>
                <div className="text-xs text-faint">{t.label}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-faint mt-3 leading-snug">Questions grounded against the tenant corpus via keyword-ranked retrieval; unverified [refId] citations flagged in the response stream.</p>
        </div>

        <div className="bg-surface rounded-[12px] p-4" style={{ border: '1px solid var(--color-border)' }}>
          <div className="text-xs font-semibold text-dim uppercase mb-3">Cost controls — caps &amp; breaker</div>
          {/* Today's spend vs the hard global ceiling */}
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-dim">Today's spend</span>
            <span className="tabular-nums text-text"><span className="font-semibold">{fmtUsd(todaySpendUsd)}</span> <span className="text-faint">/ ${ceilingUsd} ceiling</span></span>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-raised" role="progressbar" aria-valuenow={Math.round(ceilingPct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full" style={{ width: `${ceilingPct}%`, background: ceilingBreached ? 'var(--color-danger)' : 'var(--gradient-accent)' }} />
          </div>
          {/* Live provider circuit-breaker — read straight from costCounters/breaker-anthropic. */}
          <div className="flex items-center justify-between text-sm mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
            <span className="text-dim">Provider circuit breaker</span>
            {breakerOpen ? (
              <span className="inline-flex items-center gap-1.5 font-medium tabular-nums" style={{ color: 'var(--color-danger)' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-danger)' }} aria-hidden="true" />
                Open — retries {new Date(breaker!.openUntil!).toLocaleTimeString()}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: 'var(--color-good)' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: 'var(--color-good)' }} aria-hidden="true" />
                Closed
              </span>
            )}
          </div>
          {!breakerOpen && (breaker?.consecutiveFailures ?? 0) > 0 && (
            <p className="text-[11px] text-faint mt-1 tabular-nums">{breaker!.consecutiveFailures} recent provider error{breaker!.consecutiveFailures === 1 ? '' : 's'} — trips open at 4.</p>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm mt-4">
            {[
              { label: 'Degraded calls', value: ensemble.degraded.toLocaleString(), color: 'var(--color-warn)' },
              { label: 'Denied calls',   value: ensemble.denied.toLocaleString(),   color: 'var(--color-danger)' },
            ].map(t => (
              <div key={t.label} className="flex flex-col gap-0.5">
                <div className="font-semibold tabular-nums" style={{ color: t.color }}>{t.value}</div>
                <div className="text-xs text-faint">{t.label}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-faint mt-3 leading-snug">Per-feature + per-session caps degrade to a cheaper/cached path; the global ceiling denies with a clear message; a stalled provider trips a breaker, not the budget.</p>
        </div>
      </div>

      {/* By feature */}
      {byFeature.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-dim uppercase mb-2">By feature</div>
          <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 px-4 py-2 text-[11px] font-semibold text-faint uppercase bg-raised">
              <span>Feature</span><span>Calls</span><span>Tokens</span><span>Cost</span><span className="text-right">Escal.</span><span>Errors</span>
            </div>
            {byFeature.map(([feat, a]) => {
              const esc = escByFeature.get(feat)
              const rate = esc && esc.cheap > 0 ? esc.escalated / esc.cheap : null
              const hot  = rate != null && alarm.escalationPct > 0 && rate * 100 > alarm.escalationPct
              return (
                <div key={feat} className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 items-center px-4 py-2.5 text-sm bg-surface" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <span className="font-mono text-text text-xs truncate">{feat}</span>
                  <span className="text-dim tabular-nums text-right">{a.calls}</span>
                  <span className="text-dim tabular-nums text-right">{fmtTokens(a.input + a.output + a.cacheRead)}</span>
                  <span className="font-semibold tabular-nums text-right" style={{ color: 'var(--color-accent)' }}>{fmtUsd(a.usd)}</span>
                  <span className={`tabular-nums text-right ${hot ? 'text-danger font-semibold' : 'text-faint'}`}>{rate == null ? '—' : `${(rate * 100).toFixed(0)}%`}</span>
                  <span className={`tabular-nums text-right ${a.errors > 0 ? 'text-danger' : 'text-faint'}`}>{a.errors}</span>
                </div>
              )
            })}
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

      {(records?.length ?? 0) >= usageLimit && (
        <div className="flex justify-center pt-1">
          <button
            className="text-xs text-accent hover:underline disabled:opacity-50"
            disabled={loadingMore}
            onClick={() => { setLoadingMore(true); setUsageLimit(l => l + AI_USAGE_PAGE) }}
          >
            {loadingMore ? 'Loading…' : `Load more (showing ${usageLimit})`}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Settings (local, demo) ─────────────────────────────────────────────────

const SETTINGS_KEY = 'prh:settings'
function SettingsTab() {
  const [appName, setAppName] = useState('Product Reinvention Hub')

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); if (s.appName) setAppName(s.appName) } catch { /* ignore */ }
  }, [])

  function save() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ appName }))
    toast.success('Settings saved')
  }

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <Input label="App name" value={appName} onChange={e => setAppName(e.target.value)} />
      <p className="text-xs text-faint">Stored locally in this browser for the demo.</p>
      <div><Button variant="primary" size="sm" onClick={save}>Save settings</Button></div>
    </div>
  )
}
