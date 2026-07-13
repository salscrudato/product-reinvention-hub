// TenantAdmin (/app/tenant-admin) — self-service org administration.
// Gate: member:manage capability (TENANT_ADMIN only, server-enforced).
// Scope: the caller's OWN tenant. Cannot read another org's members or audit.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { IconShield, IconPlus, IconUserX, IconFileClock } from '../components/ui/icons'
import { adapter } from '../lib/backend'
import type { TenantMember, Tier } from '../lib/backend'
import { useUser } from '../context/useUser'
import { Tabs, Badge, Button, Input, Dialog, Skeleton, EmptyState } from '../components/ui'
import { canI } from '../lib/canI'

const TENANT_ROLES: Tier[] = ['VIEWER', 'UNDERWRITING', 'COMPLIANCE', 'CLAIMS', 'ACTUARIAL', 'ANALYST', 'EDITOR', 'TENANT_ADMIN']

const roleColor: Record<string, 'purple' | 'blue' | 'good' | 'default'> = {
  TENANT_ADMIN: 'purple',
  EDITOR:       'blue',
  ANALYST:      'good',
  UNDERWRITING: 'good',
  COMPLIANCE:   'good',
  CLAIMS:       'good',
  ACTUARIAL:    'good',
  VIEWER:       'default',
}

const ROLE_HELP = 'VIEWER = read | inquiry personas = read + AI | EDITOR = edit + AI | TENANT_ADMIN = full org admin'

export default function TenantAdmin() {
  const { profile, user, loading } = useUser()
  const [tab, setTab] = useState('members')

  if (loading || !profile) return null

  if (!canI(profile, 'member:manage')) {
    return (
      <EmptyState
        icon={<IconShield size={28} />}
        title="Org Admins only"
        description="You need the TENANT_ADMIN role to access org administration."
      />
    )
  }

  const tenantLabel = user?.tenantId ?? 'your org'

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-text">Org Admin</h1>
        <p className="text-sm text-dim">Manage members and audit events for <span className="font-mono text-text">{tenantLabel}</span>.</p>
      </div>
      <Tabs
        tabs={[
          { id: 'members', label: 'Members'   },
          { id: 'audit',   label: 'Audit Log' },
        ]}
        active={tab} onChange={setTab}
      />
      {tab === 'members' && <MembersTab />}
      {tab === 'audit'   && <OrgAuditTab />}
    </div>
  )
}

// ─── Members ─────────────────────────────────────────────────────────────────

const MEMBER_PAGE = 50

function MembersTab() {
  const { profile } = useUser()
  const canAssign = canI(profile ?? null, 'role:assign')

  const [members, setMembers]   = useState<TenantMember[] | null>(null)
  const [hasMore, setHasMore]   = useState(false)
  const [creating, setCreating] = useState(false)
  const [editTarget, setEditTarget] = useState<TenantMember | null>(null)
  const [busy, setBusy]         = useState(false)
  const [draft, setDraft]       = useState<{ email: string; name: string; role: Tier; password: string }>({
    email: '', name: '', role: 'VIEWER', password: '',
  })

  async function load(after?: string) {
    const result = await adapter.orgAdmin.listMembers({ limit: MEMBER_PAGE, after }).catch(() => ({ members: [], hasMore: false }))
    if (after) setMembers(prev => [...(prev ?? []), ...result.members])
    else       setMembers(result.members)
    setHasMore(result.hasMore)
  }

  useEffect(() => { load() }, [])

  async function invite() {
    if (!draft.email && !draft.name) { toast.error('Email or name required'); return }
    setBusy(true)
    try {
      await adapter.orgAdmin.inviteMember({ email: draft.email || undefined, name: draft.name || undefined, role: draft.role, password: draft.password || undefined })
      toast.success('Member invited')
      setCreating(false)
      setDraft({ email: '', name: '', role: 'VIEWER', password: '' })
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }

  async function changeRole(username: string, role: Tier) {
    try {
      await adapter.orgAdmin.changeMemberRole(username, role)
      toast.success('Role updated')
      setEditTarget(null)
      load()
    } catch { toast.error('Failed to update role') }
  }

  async function remove(username: string) {
    if (!window.confirm(`Remove "${username}" from your org?`)) return
    try {
      await adapter.orgAdmin.removeMember(username)
      toast.success('Member removed')
      load()
    } catch { toast.error('Failed') }
  }

  if (members === null) return <Skeleton className="h-24" />

  return (
    <div className="flex flex-col gap-3">
      {canAssign && (
        <div className="flex items-center">
          <Button variant="primary" size="sm" onClick={() => setCreating(true)} className="ml-auto">
            <IconPlus size={14} /> Invite member
          </Button>
        </div>
      )}

      {members.length === 0 ? (
        <EmptyState icon={<IconShield size={26} />} title="No members yet" description="Invite members to give them access to your org." />
      ) : (
        <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
          {members.map(m => (
            <div key={m.username} className="flex flex-wrap items-center gap-3 px-4 py-3 bg-surface" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="w-8 h-8 rounded-full text-[11px] font-semibold text-white flex items-center justify-center shrink-0"
                style={{ background: 'var(--gradient-accent)' }}>
                {(m.name ?? m.username).slice(0, 2).toUpperCase()}
              </span>
              <div className="flex-1 min-w-[140px]">
                <div className="text-sm font-medium text-text">{m.name ?? m.username}</div>
                <div className="text-xs text-faint font-mono">{m.email ?? m.username}</div>
              </div>
              <Badge label={m.role} color={roleColor[m.role] ?? 'default'} />
              {canAssign && (
                <Button variant="ghost" size="sm" onClick={() => setEditTarget(m)}>Change role</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => remove(m.username)}>
                <IconUserX size={13} /> Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button className="text-xs text-accent hover:underline"
            onClick={() => load(members.at(-1)?.username)}>
            Load more
          </button>
        </div>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Invite member">
        <div className="flex flex-col gap-4">
          <Input label="Email" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="jane.doe@example.com" autoFocus />
          <Input label="Name (optional)" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Jane Doe" />
          <Input label="Temporary password" type="text" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} placeholder="ask user to change on first login" />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text" htmlFor="invite-role">Role</label>
            <select id="invite-role" value={draft.role}
              onChange={e => setDraft({ ...draft, role: e.target.value as Tier })}
              className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text focus:outline-none"
              style={{ borderColor: 'var(--color-border-strong)' }}>
              {TENANT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <p className="text-xs text-faint">{ROLE_HELP}</p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={invite} disabled={busy || (!draft.email && !draft.name)}>
              {busy ? 'Inviting…' : 'Invite'}
            </Button>
          </div>
        </div>
      </Dialog>

      {editTarget && (
        <RoleDialog
          member={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={(role) => changeRole(editTarget.username, role)}
        />
      )}
    </div>
  )
}

function RoleDialog({ member, onClose, onSave }: { member: TenantMember; onClose: () => void; onSave: (r: Tier) => void }) {
  const [role, setRole] = useState<Tier>(member.role)
  return (
    <Dialog open onClose={onClose} title={`Change role for ${member.name ?? member.username}`}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text" htmlFor="edit-role">New role</label>
          <select id="edit-role" value={role} onChange={e => setRole(e.target.value as Tier)}
            className="h-9 px-3 rounded-[10px] bg-surface border text-sm text-text focus:outline-none"
            style={{ borderColor: 'var(--color-border-strong)' }}>
            {TENANT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <p className="text-xs text-faint">{ROLE_HELP}</p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => onSave(role)} disabled={role === member.role}>Save</Button>
        </div>
      </div>
    </Dialog>
  )
}

// ─── Org Audit Log ───────────────────────────────────────────────────────────

const fmt = (v: unknown) => {
  if (!v) return '—'
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? v : new Date(t).toLocaleString() }
  return String(v)
}

function OrgAuditTab() {
  const [events, setEvents] = useState<unknown[] | null>(null)
  useEffect(() => {
    adapter.orgAdmin.listAudit({ limit: 200 })
      .then(setEvents)
      .catch(() => setEvents([]))
  }, [])

  if (events === null) return <div className="flex flex-col gap-2">{[0,1,2].map(i => <Skeleton key={i} className="h-12" />)}</div>
  if (events.length === 0) return <EmptyState icon={<IconFileClock size={26} />} title="No member events yet" description="Member changes (invite, role change, removal) will appear here." />

  return (
    <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      {(events as Record<string, unknown>[]).map((e, i) => (
        <div key={i} className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-surface text-sm" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <span className="font-mono text-xs text-faint w-20">{String(e.op ?? e.action ?? '—')}</span>
          <span className="text-text flex-1">{String((e.data as Record<string, unknown>)?.username ?? e.entityPath ?? '—')}</span>
          <span className="text-xs text-dim">{String((e.actor as Record<string, unknown>)?.name ?? '—')}</span>
          <span className="text-xs text-faint">{fmt(e.at)}</span>
        </div>
      ))}
    </div>
  )
}
