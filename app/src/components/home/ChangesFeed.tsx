// ChangesFeed — the Home cockpit's "what changed" feed. Every item is sourced from
// REAL data and links to its source entity: filing / approval transitions and edits
// come from the append-only `versions` log (readable by any authed role — auditEvents
// is ADMIN-only per firestore.rules, so versions is the all-role change source), and
// risk signals come from stored product.health. Nothing is fabricated; when a tool /
// collection has nothing to show, the feed says so. News lives on its own tab — this
// panel links out to it rather than embedding a second feed.
import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconActivity, IconClipboard, IconEdit, IconPlus, IconTrash, IconWarning,
  IconNews, IconArrowRight,
} from '../ui/icons'
import { Badge } from '../ui'
import { toMillis } from '../../lib/homePriorities'
import type { LoadStatus } from '../../lib/useLiveCollection'
import type { Version, Product } from '@pf/shared'

type VersionDoc = Version & { id: string }
type ProductDoc = Product & { id: string }

interface Props {
  status:   LoadStatus
  versions: VersionDoc[]
  products: ProductDoc[]
  now:      number
}

type ItemColor = 'default' | 'good' | 'warn' | 'danger'
interface ChangeItem {
  id:     string
  icon:   ReactNode
  title:  string
  sub?:   string        // secondary context (e.g. the owning product)
  detail: string        // what changed
  color:  ItemColor
  actor?: string
  atMs:   number | null
  route:  string        // navigation target — the source entity
}

// Governance / workflow fields whose change is a "filing or approval" transition.
const STATUS_FIELDS = ['reviewStatus', 'lifecycle', 'status', 'column'] as const
const STATUS_LABEL: Record<(typeof STATUS_FIELDS)[number], string> = {
  reviewStatus: 'Review', lifecycle: 'Lifecycle', status: 'Status', column: 'Stage',
}
// Fields every mutation bumps — excluded so an edit's field count reflects real change.
const NOISE = new Set(['updatedAt', 'updatedBy', 'rev', 'createdAt'])

const fmt = (v: unknown) => String(v ?? '—').replace(/_/g, ' ')

/** Colour a governance transition by where it lands. */
function transitionColor(after: string): ItemColor {
  if (['APPROVED', 'LAUNCHED', 'ACTIVE'].includes(after)) return 'good'
  if (['BUSINESS_REVIEW', 'IN_REVIEW', 'IN_PROGRESS'].includes(after)) return 'warn'
  if (after === 'REJECTED') return 'danger'
  return 'default'
}

/** Map an entity path to its in-app route so every item links to its source. */
function routeForEntity(entityPath: string, productId?: string): string {
  const [c0, id0, c1] = entityPath.split('/')
  if (c0 === 'products') {
    if (!c1) return `/app/products/${id0}/overview`
    if (c1 === 'coverages')      return `/app/products/${id0}/coverages`
    if (c1 === 'rules')          return `/app/products/${id0}/rules`
    if (c1 === 'formRules')      return `/app/products/${id0}/forms`
    if (c1 === 'ratingPrograms') return `/app/products/${id0}/pricing`
    return `/app/products/${id0}/overview`
  }
  if (c0 === 'tasks')      return '/app/tasks'
  if (c0 === 'dictionary') return '/app/dictionary'
  if (c0 === 'forms')      return productId ? `/app/products/${productId}/forms` : '/app/explorer'
  if (c0 === 'ldTables' || c0 === 'rtTables') return productId ? `/app/products/${productId}/pricing` : '/app/explorer'
  return '/app/explorer'
}

function timeAgo(ms: number | null, now: number): string {
  if (ms == null) return ''
  const s = Math.round((now - ms) / 1000)
  if (s < 60)    return 'just now'
  if (s < 3600)  return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

/** Build the merged, time-sorted feed from versions + product health. Pure so the
 *  render stays declarative; capped so the cockpit panel never grows unbounded. */
function buildItems(versions: VersionDoc[], products: ProductDoc[]): ChangeItem[] {
  const productById = new Map(products.map(p => [p.id, p]))
  const items: ChangeItem[] = []

  // ── Real change events from the version log ──
  for (const v of versions) {
    const diff  = Array.isArray(v.diff) ? v.diff : []
    const parts = v.entityPath.split('/')
    const pid   = v.productId ?? (parts[0] === 'products' ? parts[1] : undefined)
    const product = pid ? productById.get(pid) : undefined

    // Label: a product uses its name; a sub-entity uses its own name + the product.
    let title: string, sub: string | undefined
    if (parts[0] === 'products' && parts.length === 2) {
      title = product?.name ?? parts[1]!
    } else {
      const snap = (v.snapshot ?? null) as Record<string, unknown> | null
      title = (snap?.name as string) ?? (snap?.number as string) ?? (snap?.title as string)
        ?? (snap?.refId as string) ?? v.entityType
      sub = product?.name
    }
    const actor = v.actor?.name && !['seed', 'system', 'Product Factory Seed'].includes(v.actor.name)
      ? v.actor.name : undefined
    const atMs  = toMillis(v.at)
    const route = routeForEntity(v.entityPath, pid)
    const base  = { id: v.id, title, sub, actor, atMs, route }

    // Filing / approval (or workflow) transition takes precedence — it's the headline.
    const statusField = STATUS_FIELDS.find(f => diff.some(d => d.field === f))
    if (statusField) {
      const d = diff.find(x => x.field === statusField)!
      items.push({
        ...base, icon: <IconClipboard size={14} aria-hidden="true" />,
        detail: `${STATUS_LABEL[statusField]}: ${fmt(d.before)} → ${fmt(d.after)}`,
        color: transitionColor(String(d.after)),
      })
      continue
    }

    // Otherwise a create / delete / plain edit.
    const changed = diff.filter(d => !NOISE.has(d.field))
    if (v.snapshot == null) {
      items.push({ ...base, icon: <IconTrash size={14} aria-hidden="true" />, detail: 'Removed', color: 'danger' })
    } else if (changed.length > 0 && changed.every(d => d.before == null)) {
      items.push({ ...base, icon: <IconPlus size={14} aria-hidden="true" />, detail: 'Created', color: 'good' })
    } else {
      const n = changed.length || diff.length
      items.push({ ...base, icon: <IconEdit size={14} aria-hidden="true" />, detail: `${n} field${n === 1 ? '' : 's'} updated`, color: 'default' })
    }
  }

  // ── Risk signals from stored product health (surfaced only when a product is at risk) ──
  for (const p of products) {
    const h = p.health
    if (!h) continue
    const score = h.score ?? 100
    const findings = h.findingCount ?? 0
    if (findings > 0 || score < 100) {
      items.push({
        id: `health-${p.id}`, icon: <IconActivity size={14} aria-hidden="true" />,
        title: p.name, detail: `Health ${score} · ${findings} finding${findings === 1 ? '' : 's'}`,
        color: score < 70 ? 'danger' : score < 90 ? 'warn' : 'default',
        atMs: toMillis(h.updatedAt), route: `/app/products/${p.id}/overview`,
      })
    }
  }

  // Newest first; undated events sink to the bottom. Cap for the panel.
  return items.sort((a, b) => (b.atMs ?? -Infinity) - (a.atMs ?? -Infinity)).slice(0, 8)
}

export function ChangesFeed({ status, versions, products, now }: Props) {
  const navigate = useNavigate()
  const items = useMemo(() => buildItems(versions, products), [versions, products])

  return (
    <section aria-labelledby="rail-changes" aria-busy={status === 'loading'}
      className="bg-surface rounded-[14px] p-4 flex flex-col gap-3"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}>

      {/* Header — title + link out to the News tab (news is not embedded here) */}
      <div className="flex items-center justify-between gap-2">
        <h2 id="rail-changes" className="flex items-center gap-2 text-sm font-semibold text-text">
          <IconActivity size={15} className="text-accent" aria-hidden="true" /> Portfolio changes
        </h2>
        <button onClick={() => navigate('/app/news')}
          className="inline-flex items-center gap-1 text-xs text-dim hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[4px]">
          <IconNews size={12} aria-hidden="true" /> News <IconArrowRight size={12} aria-hidden="true" />
        </button>
      </div>

      {/* Body: loading / error / empty / list */}
      {status === 'loading' ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2].map(i => <div key={i} className="h-12 rounded-[10px] bg-raised animate-pulse" />)}
        </div>
      ) : status === 'error' ? (
        <div className="flex items-center gap-2 text-xs text-danger py-3">
          <IconWarning size={14} aria-hidden="true" /> Couldn't load recent changes. Refresh to try again.
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-dim py-4 text-center">
          No portfolio changes yet. Edits, filing &amp; approval status changes, and health signals will appear here.
        </p>
      ) : (
        <ul className="flex flex-col">
          {items.map((it, i) => (
            <li key={it.id}>
              <button onClick={() => navigate(it.route)}
                className={`w-full text-left flex items-start gap-2.5 py-2.5 group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[6px] ${i > 0 ? 'border-t' : ''}`}
                style={i > 0 ? { borderColor: 'var(--color-border)' } : undefined}>
                <span className="mt-0.5 shrink-0 text-faint group-hover:text-accent transition-colors">{it.icon}</span>
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-text truncate group-hover:text-accent transition-colors">{it.title}</span>
                    {it.atMs != null && <span className="ml-auto shrink-0 text-[10px] text-dim tabular-nums">{timeAgo(it.atMs, now)}</span>}
                  </span>
                  <span className="flex items-center flex-wrap gap-x-2 gap-y-0.5">
                    <Badge label={it.detail} color={it.color} />
                    {it.sub && <span className="text-[11px] text-dim truncate">{it.sub}</span>}
                    {it.actor && <span className="text-[11px] text-dim truncate">· {it.actor}</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
