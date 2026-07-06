// Admin (/app/admin, ADMIN only) — user management (via the setUserRole callable),
// an audit-log explorer that opens any event to its before/after diff, the seed
// report, and local app settings.
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconShield, IconPlus, IconUserX, IconUserCheck, IconSearch, IconFileClock } from '../components/ui/icons'
import { adapter } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Tabs, Badge, Button, Input, Dialog, Skeleton, EmptyState } from '../components/ui'
import type { User, AuditEvent, Version, SeedReport, Role } from '@pf/shared'

type UserDoc      = User & { id: string }
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
  const { profile } = useUser()
  const [tab, setTab] = useState('users')

  if (profile && profile.role !== 'ADMIN') {
    return <EmptyState icon={<IconShield size={28} />} title="Admins only" description="You need the ADMIN role to view the admin console." />
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-text">Admin</h1>
        <p className="text-sm text-dim">Users, audit trail, seed report and settings.</p>
      </div>
      <Tabs
        tabs={[{ id: 'users', label: 'Users' }, { id: 'audit', label: 'Audit Log' }, { id: 'seed', label: 'Seed Report' }, { id: 'settings', label: 'Settings' }]}
        active={tab} onChange={setTab}
      />
      {tab === 'users'    && <UsersTab />}
      {tab === 'audit'    && <AuditTab />}
      {tab === 'seed'     && <SeedTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ─── Users ──────────────────────────────────────────────────────────────────

const ROLES: Role[] = ['ADMIN', 'EDITOR', 'VIEWER']
const roleColor: Record<Role, 'purple' | 'blue' | 'default'> = { ADMIN: 'purple', EDITOR: 'blue', VIEWER: 'default' }

function UsersTab() {
  const [users, setUsers] = useState<UserDoc[] | null>(null)
  const [creating, setCreating] = useState(false)
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

  if (users === null) return <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}><IconPlus size={14} /> New user</Button>
      </div>
      <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        {users.map(u => (
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
      {/* One tile per reference product's worked-example premium (the canaries) */}
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
