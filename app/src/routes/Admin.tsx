// Admin (/app/admin) — PLATFORM console (SUPER_ADMIN and SUPPORT only).
// Cross-tenant: tenant management, global user management, platform audit, AI cost.
// TENANT_ADMIN users are redirected to /app/tenant-admin (self-service org console).
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { IconShield, IconPlus, IconUserX, IconSearch, IconFileClock, IconWarning, IconLayers, IconTable, IconEdit } from '../components/ui/icons'
import { adapter, getSuperAdminTenant } from '../lib/backend'
import type { AuditSearchEvent, ManagedUser, TenantInfo, TenantSummary, Tier } from '../lib/backend'
import { useUser } from '../context/useUser'
import { isPlatform } from '../lib/canI'
import { Tabs, Badge, Button, Input, Dialog, Skeleton, EmptyState } from '../components/ui'
import { DEFAULT_BUDGET } from '@pf/shared'
import type { SeedReport } from '@pf/shared'

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

type SeedReportDoc = SeedReport & { id: string }

// Import pipeline telemetry is its own lazy chunk: the run inspector (pipeline
// flow, waterfall, payload renderers) is heavy relative to the console shell and
// only loads when the tab is opened — keeps the Admin route chunk in budget.
const ImportRunsTab = lazy(() => import('../components/admin/ImportRunsTab'))

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
  if (!isPlatform(profile)) {
    return <EmptyState icon={<IconShield size={28} />} title="Platform access only" description="The platform console requires SUPER_ADMIN or SUPPORT role." />
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-text">Platform</h1>
        <p className="text-sm text-dim">Cross-tenant administration, global users, audit trail, seed report and AI cost.</p>
      </div>
      <Tabs
        tabs={[
          { id: 'tenants',  label: 'Tenants'      },
          { id: 'users',    label: 'Users'       },
          { id: 'data',     label: 'Data'         },
          { id: 'imports',  label: 'Import Runs'  },
          { id: 'audit',    label: 'Audit Log'    },
          { id: 'seed',     label: 'Seed Report'  },
          { id: 'ai-cost',  label: 'AI Cost'      },
          { id: 'settings', label: 'Settings'     },
        ]}
        active={tab} onChange={setTab}
      />
      {tab === 'tenants'  && <TenantsTab />}
      {tab === 'users'    && <UsersTab />}
      {tab === 'data'     && <DataTab />}
      {tab === 'imports'  && <Suspense fallback={<Skeleton className="h-64" />}><ImportRunsTab /></Suspense>}
      {tab === 'audit'    && <AuditTab />}
      {tab === 'seed'     && <SeedTab />}
      {tab === 'ai-cost'  && <AiCostTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ─── Users ──────────────────────────────────────────────────────────────────

// Platform console manages global users; SUPER_ADMIN can assign any tenant-plane role.
const TIERS: Tier[] = ['VIEWER', 'UNDERWRITING', 'COMPLIANCE', 'CLAIMS', 'ACTUARIAL', 'ANALYST', 'EDITOR', 'TENANT_ADMIN']
const tierColor: Record<string, 'purple' | 'blue' | 'good' | 'default'> = {
  SUPER_ADMIN: 'purple', SUPPORT: 'purple',
  TENANT_ADMIN: 'purple', ADMIN: 'purple',
  EDITOR: 'blue',
  ANALYST: 'good', UNDERWRITING: 'good', COMPLIANCE: 'good', CLAIMS: 'good', ACTUARIAL: 'good',
  VIEWER: 'default',
}
const TIER_HELP = 'VIEWER = read | inquiry personas = read+AI | EDITOR = edit+AI | TENANT_ADMIN = org admin'

// ─── Tenants ──────────────────────────────────────────────────────────────
const TENANT_PAGE = 50

function TenantsTab() {
  const [tenants, setTenants] = useState<TenantInfo[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', id: '' })
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<TenantInfo | null>(null)
  const [removing, setRemoving] = useState(false)
  const [detail, setDetail] = useState<TenantInfo | null>(null)

  const load = useCallback(async (after?: string) => {
    const r = await adapter.tenancy.listTenants({ q: q.trim() || undefined, limit: TENANT_PAGE, after }).catch(() => ({ tenants: [], hasMore: false }))
    setTenants(prev => (after ? [...(prev ?? []), ...r.tenants] : r.tenants))
    setHasMore(r.hasMore)
  }, [q])
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t) }, [load])

  async function create() {
    if (!draft.name) { toast.error('Company name required'); return }
    setBusy(true)
    try { await adapter.tenancy.createTenant(draft.id || draft.name, draft.name); toast.success('Tenant created'); setCreating(false); setDraft({ name: '', id: '' }); void load() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  async function confirmAndRemove() {
    if (!confirmRemove) return
    setRemoving(true)
    try { await adapter.tenancy.deleteTenant(confirmRemove.id); toast.success('Tenant removed'); setConfirmRemove(null); void load() }
    catch { toast.error('Failed') } finally { setRemoving(false) }
  }

  if (tenants === null) return <Skeleton className="h-24" />
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search tenants…" aria-label="Search tenants"
            className="w-full h-8 pl-8 pr-3 rounded-[8px] bg-surface border text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
            style={{ borderColor: 'var(--color-border)' }}
          />
        </div>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} className="ml-auto"><IconPlus size={14} /> New tenant</Button>
      </div>
      {tenants.length === 0 ? (
        q.trim()
          ? <EmptyState icon={<IconSearch size={24} />} title="No tenants match" description={`No tenants match "${q}".`} />
          : <EmptyState icon={<IconShield size={26} />} title="No tenants yet" description="Create a tenant to load a company's isolated data. Each tenant is a securely separated database." />
      ) : (
        <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {tenants.map(t => (
            <button key={t.id} onClick={() => setDetail(t)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-surface text-left hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="w-8 h-8 rounded-[8px] flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: 'var(--gradient-accent)' }}>
                {t.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text">{t.name}</div>
                <div className="text-xs text-faint font-mono">{t.id}</div>
              </div>
              {t.status === 'suspended' && <Badge label="suspended" color="danger" />}
              <span className="text-xs text-faint hidden sm:block">{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ''}</span>
              <span
                role="button" tabIndex={0} aria-label={`Remove ${t.name}`} title="Remove tenant"
                onClick={e => { e.stopPropagation(); setConfirmRemove(t) }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setConfirmRemove(t) } }}
                className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-faint hover:text-danger hover:bg-danger/10 transition-colors">
                <IconUserX size={14} aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      )}
      {hasMore && (
        <div className="flex justify-center">
          <button className="text-xs text-accent hover:underline" onClick={() => void load(tenants.at(-1)?.id)}>Load more</button>
        </div>
      )}

      {/* New tenant dialog */}
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

      {/* Drill-down: user count, entity counts, recent activity, configure */}
      {detail && <TenantDetailDialog tenant={detail} onClose={() => setDetail(null)} onChanged={() => void load()} />}

      {/* Remove confirmation dialog */}
      <Dialog open={!!confirmRemove} onClose={() => setConfirmRemove(null)} title="Remove tenant" width="max-w-md">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-[12px] p-3.5" style={{ background: 'var(--color-danger-badge)', border: '1px solid var(--color-danger)' }}>
            <IconWarning size={16} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-dim leading-relaxed">
              Remove <span className="font-semibold text-text">{confirmRemove?.name}</span> (<span className="font-mono text-xs">{confirmRemove?.id}</span>)?
              Its data remains partitioned but users will lose access immediately.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setConfirmRemove(null)} disabled={removing}>Cancel</Button>
            <Button variant="ghost" onClick={() => void confirmAndRemove()} disabled={removing}
              className="text-danger border-danger/40 hover:bg-danger/10">
              {removing ? 'Removing…' : 'Remove tenant'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function TenantDetailDialog({ tenant, onClose, onChanged }: { tenant: TenantInfo; onClose: () => void; onChanged: () => void }) {
  const [summary, setSummary] = useState<TenantSummary | null>(null)
  const [error, setError] = useState(false)
  const [name, setName] = useState(tenant.name)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    adapter.tenancy.tenantSummary(tenant.id).then(setSummary).catch(() => setError(true))
  }, [tenant.id])

  const status = summary?.tenant.status ?? tenant.status ?? 'active'

  async function save(patch: { name?: string; status?: 'active' | 'suspended' }) {
    setBusy(true)
    try {
      await adapter.tenancy.updateTenant(tenant.id, patch)
      toast.success('Tenant updated')
      const s = await adapter.tenancy.tenantSummary(tenant.id).catch(() => null)
      if (s) setSummary(s)
      onChanged()
    } catch { toast.error('Update failed') } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={tenant.name} width="max-w-2xl">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-xs text-faint font-mono">
          {tenant.id}
          <Badge label={status} color={status === 'active' ? 'good' : 'danger'} />
          {summary?.tenant.createdAt && <span className="ml-auto font-sans">created {new Date(summary.tenant.createdAt).toLocaleDateString()}{summary.tenant.createdBy ? ` by ${summary.tenant.createdBy}` : ''}</span>}
        </div>

        {error ? (
          <EmptyState icon={<IconWarning size={24} />} title="Summary unavailable" description="Could not load this tenant's summary. Try again." />
        ) : summary === null ? (
          <div className="flex flex-col gap-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : (
          <>
            {/* Counts */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface rounded-[12px] p-3" style={{ border: '1px solid var(--color-border)' }}>
                <div className="text-lg font-bold text-text tabular-nums">{summary.userCount}</div>
                <div className="text-xs text-faint">users</div>
              </div>
              {Object.entries(summary.entityCounts).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, n]) => (
                <div key={k} className="bg-surface rounded-[12px] p-3" style={{ border: '1px solid var(--color-border)' }}>
                  <div className="text-lg font-bold text-text tabular-nums">{n.toLocaleString()}</div>
                  <div className="text-xs text-faint truncate">{k}</div>
                </div>
              ))}
            </div>

            {/* Recent activity */}
            <div>
              <div className="text-xs font-semibold text-dim uppercase mb-2">Recent activity</div>
              {summary.recentActivity.length === 0 ? (
                <p className="text-sm text-faint">No mutations recorded yet.</p>
              ) : (
                <div className="rounded-[10px] overflow-hidden max-h-56 overflow-y-auto" style={{ border: '1px solid var(--color-border)' }}>
                  {summary.recentActivity.map((a, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 bg-surface text-xs" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <Badge label={a.op} color={actionColor[a.op] ?? 'default'} />
                      <span className="text-text">{a.entityType}</span>
                      <span className="font-mono text-faint flex-1 min-w-[100px] truncate">{a.entityPath}</span>
                      <span className="text-dim">{a.actor?.name ?? '—'}</span>
                      <span className="text-faint">{fmt(a.at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Configure */}
        <div className="flex flex-wrap items-end gap-2 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex-1 min-w-[180px]">
            <Input label="Company name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <Button variant="ghost" size="sm" disabled={busy || !name.trim() || name.trim() === (summary?.tenant.name ?? tenant.name)} onClick={() => void save({ name: name.trim() })}>
            <IconEdit size={13} /> Rename
          </Button>
          <Button variant="ghost" size="sm" disabled={busy}
            className={status === 'active' ? 'text-danger border-danger/40 hover:bg-danger/10' : ''}
            onClick={() => void save({ status: status === 'active' ? 'suspended' : 'active' })}>
            {status === 'active' ? 'Suspend' : 'Reactivate'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// ─── Users ──────────────────────────────────────────────────────────────────
const USER_PAGE = 100

function UsersTab() {
  const [users, setUsers]   = useState<ManagedUser[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [tenants, setTenants] = useState<TenantInfo[]>([])
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<{ username: string; password: string; role: Tier; tenant: string }>({ username: '', password: '', role: 'VIEWER', tenant: '' })
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ManagedUser | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [tenantFilter, setTenantFilter] = useState('')
  const [editTarget, setEditTarget] = useState<ManagedUser | null>(null)

  const load = useCallback(async (after?: string) => {
    const result = await adapter.tenancy.listUsers({
      q: userSearch.trim() || undefined,
      tenant: tenantFilter || undefined,
      limit: USER_PAGE, after,
    }).catch(() => ({ users: [], hasMore: false }))
    setUsers(prev => (after ? [...(prev ?? []), ...result.users] : result.users))
    setHasMore(result.hasMore)
  }, [userSearch, tenantFilter])
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t) }, [load])
  useEffect(() => { adapter.tenancy.listTenants({ limit: 200 }).then(r => setTenants(r.tenants)).catch(() => {}) }, [])

  async function create() {
    if (!draft.username || !draft.password) { toast.error('Username and password required'); return }
    setBusy(true)
    try {
      await adapter.tenancy.createUser({ username: draft.username, password: draft.password, role: draft.role, tenants: draft.tenant ? [draft.tenant] : [] })
      toast.success('User created'); setCreating(false); setDraft({ username: '', password: '', role: 'VIEWER', tenant: '' }); void load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  async function confirmAndDelete() {
    if (!confirmDelete) return
    setDeleting(true)
    try { await adapter.tenancy.deleteUser(confirmDelete.username); toast.success('User deleted'); setConfirmDelete(null); void load() }
    catch { toast.error('Failed') } finally { setDeleting(false) }
  }
  async function toggleDisabled(u: ManagedUser) {
    try {
      await adapter.tenancy.updateUser(u.username, { disabled: !u.disabled })
      toast.success(u.disabled ? `${u.username} enabled` : `${u.username} disabled`)
      void load()
    } catch { toast.error('Failed') }
  }

  if (users === null) return <Skeleton className="h-24" />
  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar: search + tenant filter + new user */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
            placeholder="Search users…"
            aria-label="Search users"
            className="w-full h-8 pl-8 pr-3 rounded-[8px] bg-surface border text-sm text-text placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-accent/25"
            style={{ borderColor: 'var(--color-border)' }}
          />
        </div>
        <select value={tenantFilter} onChange={e => setTenantFilter(e.target.value)} aria-label="Filter by tenant"
          className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-dim" style={{ borderColor: 'var(--color-border)' }}>
          <option value="">All tenants</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} className="ml-auto"><IconPlus size={14} /> New user</Button>
      </div>

      {users.length === 0 ? (
        userSearch.trim() || tenantFilter
          ? <EmptyState icon={<IconSearch size={24} />} title="No users match" description="No users match the current search/filter." />
          : <EmptyState icon={<IconShield size={26} />} title="No gated users yet" description="No tenant-gated users yet. Create them here — each with a username, password, role and company." />
      ) : (
        <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {users.map(u => (
            <div key={u.username} className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface hover:bg-raised transition-colors" style={{ borderBottom: '1px solid var(--color-border)', opacity: u.disabled ? 0.6 : 1 }}>
              <span className="w-8 h-8 rounded-full text-[11px] font-semibold text-white flex items-center justify-center shrink-0" style={{ background: u.disabled ? 'var(--color-border-strong)' : 'var(--gradient-accent)' }}>{u.username.slice(0, 2).toUpperCase()}</span>
              <div className="flex-1 min-w-[140px]">
                <div className="text-sm font-medium text-text">{u.username}</div>
                <div className="text-xs text-faint font-mono">{u.tenants === '*' ? 'all tenants' : ((u.tenants || []).join(', ') || '— no tenant —')}</div>
              </div>
              {u.disabled && <Badge label="disabled" color="danger" />}
              <Badge label={u.role} color={tierColor[u.role] ?? 'default'} />
              <Button variant="ghost" size="sm" onClick={() => setEditTarget(u)}><IconEdit size={13} /> Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => void toggleDisabled(u)}>{u.disabled ? 'Enable' : 'Disable'}</Button>
              <button onClick={() => setConfirmDelete(u)} aria-label={`Delete ${u.username}`} title="Delete user"
                className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-[7px] text-faint hover:text-danger hover:bg-danger/10 transition-colors">
                <IconUserX size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      {hasMore && (
        <div className="flex justify-center">
          <button className="text-xs text-accent hover:underline" onClick={() => void load(users.at(-1)?.username)}>Load more</button>
        </div>
      )}

      {/* Edit user dialog: role + tenant + password reset (every change is audited server-side) */}
      {editTarget && (
        <EditUserDialog user={editTarget} tenants={tenants}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); void load() }} />
      )}

      {/* New user dialog */}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New user">
        <div className="flex flex-col gap-4">
          <Input label="Username" value={draft.username} onChange={e => setDraft({ ...draft, username: e.target.value })} placeholder="jane.doe" autoFocus />
          <Input label="Password" type="password" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} placeholder="set a strong password" />
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

      {/* Delete confirmation dialog */}
      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete user" width="max-w-md">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-[12px] p-3.5" style={{ background: 'var(--color-danger-badge)', border: '1px solid var(--color-danger)' }}>
            <IconWarning size={16} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-dim leading-relaxed">
              Permanently delete <span className="font-semibold text-text">{confirmDelete?.username}</span>?
              This cannot be undone. The user will immediately lose access to all tenants.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
            <Button variant="ghost" onClick={() => void confirmAndDelete()} disabled={deleting}
              className="text-danger border-danger/40 hover:bg-danger/10">
              {deleting ? 'Deleting…' : 'Delete user'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

// ─── Edit user (role / tenant / password — all changes audited server-side) ──
function EditUserDialog({ user, tenants, onClose, onSaved }: { user: ManagedUser; tenants: TenantInfo[]; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState<Tier>(user.role)
  const origTenant = user.tenants === '*' ? '*' : (user.tenants?.[0] ?? '')
  const [tenant, setTenant] = useState(origTenant)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    const patch: { role?: Tier; tenants?: string[] | '*'; password?: string } = {}
    if (role !== user.role) patch.role = role
    if (tenant !== origTenant) patch.tenants = tenant === '*' ? '*' : (tenant ? [tenant] : [])
    if (password) patch.password = password
    if (Object.keys(patch).length === 0) { onClose(); return }
    setBusy(true)
    try { await adapter.tenancy.updateUser(user.username, patch); toast.success('User updated'); onSaved() }
    catch { toast.error('Failed to update user') } finally { setBusy(false) }
  }

  return (
    <Dialog open onClose={onClose} title={`Edit ${user.username}`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text" htmlFor="edit-user-role">Role</label>
          <select id="edit-user-role" value={role} onChange={e => setRole(e.target.value as Tier)}
            className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text focus:outline-none" style={{ borderColor: 'var(--color-border-strong)' }}>
            {TIERS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <p className="text-xs text-faint">{TIER_HELP}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text" htmlFor="edit-user-tenant">Company (tenant)</label>
          <select id="edit-user-tenant" value={tenant} onChange={e => setTenant(e.target.value)}
            className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text focus:outline-none" style={{ borderColor: 'var(--color-border-strong)' }}>
            <option value="">— no tenant —</option>
            {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="*">all tenants (*)</option>
          </select>
        </div>
        <Input label="Reset password (leave blank to keep)" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="new password" />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Dialog>
  )
}

// ─── Data browser (paged) ─────────────────────────────────────────────────────
// Browses the ACTIVE tenant (Topbar switcher scopes the platform session). Every
// page is a bounded server read (cursor + hard cap), never a full-container dump.
const DATA_COLLECTIONS = ['products', 'coverages', 'rules', 'forms', 'ratingPrograms', 'filings', 'dictionary', 'groundingChunks']
const DATA_PAGE = 50

interface DataRow { id: string; refId?: string; name?: string; updatedAt?: string; [k: string]: unknown }

function DataTab() {
  const { user } = useUser()
  const activeTenant = getSuperAdminTenant() ?? user?.tenantId ?? 'default'
  const [coll, setColl] = useState('products')
  const [rows, setRows] = useState<DataRow[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<DataRow | null>(null)

  const load = useCallback(async (nextCursor?: string) => {
    setLoading(true); setError(null)
    try {
      const page = await adapter.db.listPage<DataRow>(coll, { pageSize: DATA_PAGE, cursor: nextCursor })
      setRows(prev => (nextCursor ? [...(prev ?? []), ...page.data] : page.data))
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      if (!nextCursor) setRows([])
    } finally { setLoading(false) }
  }, [coll])
  useEffect(() => { setRows(null); void load() }, [load, activeTenant])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[8px] text-xs text-dim bg-raised" style={{ border: '1px solid var(--color-border)' }}>
          <IconLayers size={13} className="text-accent" aria-hidden="true" />
          tenant <span className="font-mono text-text">{activeTenant}</span>
        </span>
        <div className="flex gap-1 flex-wrap">
          {DATA_COLLECTIONS.map(c => (
            <button key={c} onClick={() => setColl(c)}
              className={`px-2.5 py-1 rounded-[8px] text-xs font-medium transition-colors ${coll === c ? 'text-white' : 'text-dim hover:text-text bg-surface'}`}
              style={coll === c ? { background: 'var(--gradient-accent)' } : { border: '1px solid var(--color-border)' }}>
              {c}
            </button>
          ))}
        </div>
        <span className="text-xs text-faint ml-auto">{rows ? `${rows.length} loaded · ${DATA_PAGE}/page` : ''}</span>
      </div>
      <p className="text-xs text-faint">
        Pages are server-bounded (cursor + hard cap) — a large container is never dumped. Switch the active
        company from the topbar to browse its data.
      </p>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-[12px] px-4 py-3" style={{ border: '1px solid var(--color-danger)', background: 'var(--color-danger-badge)' }}>
          <IconWarning size={16} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-dim">{error}</p>
        </div>
      )}

      {rows === null ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : rows.length === 0 && !error ? (
        <EmptyState icon={<IconTable size={26} />} title="Empty collection" description={`No documents in "${coll}" for tenant ${activeTenant}.`} />
      ) : rows.length > 0 && (
        <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          <div className="grid grid-cols-[1.2fr_1fr_1.6fr_auto] gap-3 px-4 py-2 text-[11px] font-semibold text-faint uppercase bg-raised">
            <span>Id</span><span>refId</span><span>Name</span><span>Updated</span>
          </div>
          {rows.map(r => (
            <button key={r.id} onClick={() => setOpen(r)}
              className="w-full grid grid-cols-[1.2fr_1fr_1.6fr_auto] gap-3 items-center px-4 py-2 text-left text-xs bg-surface hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              style={{ borderTop: '1px solid var(--color-border)' }}>
              <span className="font-mono text-text truncate">{r.id}</span>
              <span className="font-mono text-dim truncate">{r.refId ?? '—'}</span>
              <span className="text-dim truncate">{typeof r.name === 'string' ? r.name : '—'}</span>
              <span className="text-faint whitespace-nowrap">{r.updatedAt ? fmt(r.updatedAt) : '—'}</span>
            </button>
          ))}
        </div>
      )}
      {hasMore && cursor && (
        <div className="flex justify-center">
          <button className="text-xs text-accent hover:underline disabled:opacity-50" disabled={loading} onClick={() => void load(cursor)}>
            {loading ? 'Loading…' : 'Load next page'}
          </button>
        </div>
      )}

      {/* Raw document viewer */}
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.id ?? 'Document'} width="max-w-2xl">
        {open && (
          <pre className="text-xs font-mono text-dim bg-raised rounded-[10px] p-3 overflow-auto max-h-[60vh]" style={{ border: '1px solid var(--color-border)' }}>
            {JSON.stringify(open, null, 2)}
          </pre>
        )}
      </Dialog>
    </div>
  )
}

// ─── Audit explorer (server-filtered, cursor-paginated, read-only) ───────────

const actionColor: Record<string, 'good' | 'blue' | 'danger' | 'default'> = { create: 'good', update: 'blue', delete: 'danger' }

const AUDIT_PAGE = 50

const actorName = (a: AuditSearchEvent['actor']): string =>
  typeof a === 'string' ? a : (a?.name ?? a?.uid ?? '—')

function AuditTab() {
  const [source, setSource] = useState<'all' | 'data' | 'platform'>('all')
  const [tenant, setTenant] = useState('')
  const [tenants, setTenants] = useState<TenantInfo[]>([])
  const [actor, setActor] = useState('')
  const [entityType, setEntityType] = useState('')
  const [action, setAction] = useState('')
  const [since, setSince] = useState('')
  const [events, setEvents] = useState<AuditSearchEvent[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<AuditSearchEvent | null>(null)

  useEffect(() => { adapter.tenancy.listTenants({ limit: 200 }).then(r => setTenants(r.tenants)).catch(() => {}) }, [])

  const load = useCallback(async (nextCursor?: string) => {
    setLoading(true)
    try {
      const page = await adapter.tenancy.searchAudit({
        source,
        tenant: tenant || undefined,
        actor: actor.trim() || undefined,
        entityType: entityType.trim() || undefined,
        action: action || undefined,
        since: since || undefined,
        limit: AUDIT_PAGE,
        cursor: nextCursor,
      })
      setEvents(prev => (nextCursor ? [...(prev ?? []), ...page.events] : page.events))
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } catch {
      if (!nextCursor) setEvents([])
    } finally { setLoading(false) }
  }, [source, tenant, actor, entityType, action, since])
  useEffect(() => { setEvents(null); const t = setTimeout(() => void load(), 250); return () => clearTimeout(t) }, [load])

  const anyFilter = tenant || actor || entityType || action || since

  return (
    <div className="flex flex-col gap-3">
      {/* Source + filters — all applied SERVER-side; results are cursor-paginated */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {([['all', 'All changes'], ['data', 'Data changes'], ['platform', 'Platform events']] as const).map(([id, label]) => (
            <button key={id} onClick={() => setSource(id)}
              className={`px-3 py-1 rounded-[8px] text-xs font-medium transition-colors ${source === id ? 'text-white' : 'text-dim hover:text-text bg-surface'}`}
              style={source === id ? { background: 'var(--gradient-accent)' } : { border: '1px solid var(--color-border)' }}>
              {label}
            </button>
          ))}
        </div>
        <select value={tenant} onChange={e => setTenant(e.target.value)} className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-dim" style={{ borderColor: 'var(--color-border)' }} aria-label="Tenant">
          <option value="">All tenants</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <Input value={actor} onChange={e => setActor(e.target.value)} placeholder="Actor…" leftIcon={<IconSearch size={13} />} className="max-w-[160px] h-8" />
        {source !== 'platform' && (
          <Input value={entityType} onChange={e => setEntityType(e.target.value)} placeholder="Entity type…" className="max-w-[140px] h-8" />
        )}
        {source === 'data' ? (
          <select value={action} onChange={e => setAction(e.target.value)} className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-dim" style={{ borderColor: 'var(--color-border)' }} aria-label="Action">
            <option value="">All actions</option>
            {['create', 'update', 'delete'].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        ) : (
          <Input value={action} onChange={e => setAction(e.target.value)} placeholder="Action (e.g. tenant:create)…" className="max-w-[190px] h-8" />
        )}
        <input type="date" value={since} onChange={e => setSince(e.target.value)} className="h-8 px-2 rounded-[8px] bg-surface border text-xs text-dim" style={{ borderColor: 'var(--color-border)' }} aria-label="Since date" />
        {anyFilter && <button className="text-xs text-accent" onClick={() => { setTenant(''); setActor(''); setEntityType(''); setAction(''); setSince('') }}>Clear</button>}
      </div>

      {events === null ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : events.length === 0 ? (
        <EmptyState icon={<IconFileClock size={26} />} title="No matching events" description="Adjust the filters, or perform a change to generate audit events." />
      ) : (
        <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {events.map(e => {
            const act = e.op ?? e.action ?? e.event ?? '—'
            const isData = (e.kind ?? 'audit') === 'audit'
            return (
              <button key={e.id} onClick={() => setOpen(e)} className="w-full flex flex-wrap items-center gap-3 px-4 py-2.5 bg-surface text-left hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" style={{ borderBottom: '1px solid var(--color-border)' }}>
                {source === 'all' && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-[5px] shrink-0"
                    style={isData ? { color: 'var(--color-accent)', background: 'var(--gradient-accent-soft)' } : { color: 'var(--color-dim)', background: 'var(--color-raised)' }}>
                    {isData ? 'data' : 'platform'}
                  </span>
                )}
                <Badge label={act} color={actionColor[act] ?? 'default'} />
                <span className="text-sm text-text">{e.entityType ?? (e.tenantId || '')}</span>
                <span className="text-xs font-mono text-faint flex-1 min-w-[120px] truncate">{e.entityPath ?? JSON.stringify(e.detail ?? {}).slice(0, 80)}</span>
                <span className="text-xs text-dim">{actorName(e.actor)}</span>
                <span className="text-xs text-faint">{fmt(e.at)}</span>
              </button>
            )
          })}
        </div>
      )}
      {hasMore && cursor && (
        <div className="flex justify-center pt-1">
          <button className="text-xs text-accent hover:underline disabled:opacity-50" disabled={loading} onClick={() => void load(cursor)}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {/* Event detail */}
      <Dialog open={!!open} onClose={() => setOpen(null)} title="Audit event" width="max-w-2xl">
        {open && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge label={open.op ?? open.action ?? open.event ?? '—'} color={actionColor[open.op ?? open.action ?? ''] ?? 'default'} />
              {open.entityPath && <span className="font-mono text-xs text-dim">{open.entityPath}</span>}
              {open.tenantId && <Badge label={open.tenantId} color="default" />}
            </div>
            <div className="text-xs text-faint">{actorName(open.actor)} · {fmt(open.at)}</div>
            <pre className="text-xs font-mono text-dim bg-raised rounded-[10px] p-3 overflow-auto max-h-[50vh]" style={{ border: '1px solid var(--color-border)' }}>
              {JSON.stringify(open, null, 2)}
            </pre>
          </div>
        )}
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
