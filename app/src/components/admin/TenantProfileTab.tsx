// TenantProfileTab — the tenant-carrier profile editor (BR-03 / NEWS_TENANT_SPEC §1).
// One doc per tenant (`tenantProfile/main`) through the standard audited mutate()
// envelope with optimistic-lock rev. The profile is the personalization source for the
// nightly news scout and the Home daily brief: carrierName anchors search + "about you"
// tagging; everything else only ADDS signal (the scout's fallback contract). EDITOR+
// saves; every other role sees the identical form read-only (the server's product:write
// guard on /db/mutate is the real gate — this is presentation).
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { adapter, MutationConflictError } from '../../lib/backend'
import { conflictToast } from '../../lib/conflict'
import { useUser } from '../../context/useUser'
import { canI } from '../../lib/canI'
import { Button, Input, Skeleton } from '../ui'
import { LOB_REGISTRY } from '@pf/shared'
import type { TenantProfile } from '@pf/shared'

const MARKETS = ['personal', 'commercial', 'both'] as const

const LOBS = Object.values(LOB_REGISTRY).map(l => ({ key: l.prefix, name: l.name }))

const csv = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)
const fromArr = (a?: string[]) => (a ?? []).join(', ')

const inputBorder = { borderColor: 'var(--color-border-strong)' }
const selectCls = 'h-9 w-full px-2.5 rounded-[10px] bg-surface border text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/25'

export function TenantProfileTab() {
  const { user, profile } = useUser()
  const canEdit = canI(profile, 'product:write')
  const actor = user ? { uid: user.uid, name: user.name ?? user.email ?? 'User' } : null

  // Live single-doc subscription (News newsPrefs pattern): delivers the stored profile +
  // the rev that guards the next save. `exists` decides create vs update.
  const [loading, setLoading] = useState(true)
  const [exists, setExists]   = useState(false)
  const [rev, setRev]         = useState<number | undefined>(undefined)

  const [carrierName, setCarrierName] = useState('')
  const [aliases, setAliases]         = useState('')
  const [lobs, setLobs]               = useState<Set<string>>(new Set())
  const [market, setMarket]           = useState('')
  const [states, setStates]           = useState('')
  const [watchTopics, setWatchTopics] = useState('')
  const [competitors, setCompetitors] = useState('')
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    const un = adapter.db.subscribe<TenantProfile & { rev?: number }>('tenantProfile/main', d => {
      setLoading(false)
      if (!d || Array.isArray(d)) return
      setExists(true)
      setRev(d.rev)
      setCarrierName(d.carrierName ?? '')
      setAliases(fromArr(d.aliases))
      setLobs(new Set(d.lobs ?? []))
      setMarket(d.market ?? '')
      setStates(fromArr(d.states))
      setWatchTopics(fromArr(d.watchTopics))
      setCompetitors(fromArr(d.competitors))
    })
    return un
  }, [])

  const valid = carrierName.trim().length > 0
  const stateList = useMemo(
    () => csv(states).map(s => s.toUpperCase()).filter(s => /^[A-Z]{2}$/.test(s)),
    [states],
  )

  async function save() {
    if (!canEdit || !actor || !valid) return
    setSaving(true)
    try {
      await adapter.db.mutate({
        op: exists ? 'update' : 'create',
        path: 'tenantProfile/main',
        entityType: 'tenantProfile',
        actor,
        expectedRev: exists ? rev : undefined,
        data: {
          carrierName: carrierName.trim(),
          aliases:     csv(aliases),
          lobs:        [...lobs],
          market:      MARKETS.includes(market as typeof MARKETS[number]) ? market : null,
          states:      stateList,
          watchTopics: csv(watchTopics),
          competitors: csv(competitors),
        },
      })
      toast.success('Carrier profile saved — the news scout and daily brief use it from the next run')
    } catch (err) {
      if (err instanceof MutationConflictError) conflictToast({})
      else toast.error('Could not save the profile')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex flex-col gap-3"><Skeleton className="h-9 w-80" /><Skeleton className="h-40" /></div>

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <h2 className="text-[15px] font-semibold text-text">Carrier profile</h2>
        <p className="text-[12.5px] text-dim mt-0.5">
          Who this tenant is in the market. The nightly news scout and the Home daily brief use it to
          tailor what they find — it only <em>adds</em> focus, never narrows the general P&amp;C feed.
          {!canEdit && ' You have read-only access; an editor can update it.'}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Input label="Carrier name (required)" value={carrierName} disabled={!canEdit} maxLength={120}
            onChange={e => setCarrierName(e.target.value)} placeholder="e.g. Accenture Test Mutual" />
        </div>
        <Input label="Also known as (comma-separated)" value={aliases} disabled={!canEdit} maxLength={400}
          onChange={e => setAliases(e.target.value)} placeholder="ATM Insurance" />
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-dim">
          Market
          <select className={selectCls} style={inputBorder} value={market} disabled={!canEdit}
            onChange={e => setMarket(e.target.value)} aria-label="Market">
            <option value="">—</option>
            {MARKETS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>

        <fieldset className="sm:col-span-2 flex flex-col gap-2">
          <legend className="text-[12px] font-medium text-dim">Lines of business</legend>
          <div className="flex flex-wrap gap-2">
            {LOBS.map(l => {
              const on = lobs.has(l.key)
              return (
                <label key={l.key}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-xs font-medium cursor-pointer select-none transition-colors"
                  style={{
                    background: on ? 'var(--color-accent-soft)' : 'var(--color-surface)',
                    color: on ? 'var(--color-accent)' : 'var(--color-dim)',
                    border: `1px solid ${on ? 'var(--color-accent-line)' : 'var(--color-border)'}`,
                  }}>
                  <input type="checkbox" className="sr-only" checked={on} disabled={!canEdit}
                    onChange={() => setLobs(prev => {
                      const next = new Set(prev)
                      if (next.has(l.key)) next.delete(l.key); else next.add(l.key)
                      return next
                    })} />
                  <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full"
                    style={{ background: on ? 'var(--color-accent)' : 'var(--color-border-strong)' }} />
                  {l.name}
                </label>
              )
            })}
          </div>
        </fieldset>

        <Input label="Operating states (2-letter, comma-separated)" value={states} disabled={!canEdit} maxLength={200}
          onChange={e => setStates(e.target.value)} placeholder="OH, NJ" />
        <Input label="Watch topics (comma-separated)" value={watchTopics} disabled={!canEdit} maxLength={400}
          onChange={e => setWatchTopics(e.target.value)} placeholder="telematics, wildfire" />
        <div className="sm:col-span-2">
          <Input label="Competitors (comma-separated)" value={competitors} disabled={!canEdit} maxLength={400}
            onChange={e => setCompetitors(e.target.value)} placeholder="—" />
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={!valid || saving}>
            {saving ? 'Saving…' : exists ? 'Save profile' : 'Create profile'}
          </Button>
          {!valid && <span className="text-[12px] text-faint">A carrier name is required.</span>}
        </div>
      )}
    </div>
  )
}
