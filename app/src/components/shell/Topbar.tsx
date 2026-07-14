// Topbar — breadcrumb, global search (opens palette), presence slot, user menu.
import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { IconSearch, IconSignOut, IconChevronDown, IconHome, IconKey, IconLayers } from '../ui/icons'
import { Tooltip } from '../ui'
import { ThemeToggle } from './ThemeToggle'
import { useUser } from '../../context/useUser'
import { adapter, setSuperAdminTenant } from '../../lib/backend'
import type { TenantInfo } from '../../lib/backend'
import type { Product } from '@pf/shared'

interface TopbarProps { onOpenPalette: () => void; onOpenMobileSidebar?: () => void }

const LABELS: Record<string, string> = {
  products: 'Products', builder: 'Builder', explorer: 'Explorer',
  tasks: 'Tasks', news: 'News', claims: 'Claims Analysis', dictionary: 'Data Dictionary',
  feedback: 'Feedback', admin: 'Settings',
}
const TAB_LABELS: Record<string, string> = {
  overview: 'Overview', coverages: 'Coverages', forms: 'Forms',
  pricing: 'Pricing', states: 'States', rules: 'Rules',
}

interface Crumb { label: string; to: string }

/** Resolve the current path to labelled, linkable crumbs (product ids → names). */
function useCrumbs(): Crumb[] {
  const { pathname } = useLocation()
  const [names, setNames] = useState<Record<string, string>>({})
  const onProductPage = pathname.startsWith('/app/products/')

  // Lightweight id→name map so a product crumb reads "Homeowners HO-3", not its id.
  useEffect(() => {
    if (!onProductPage) return
    const unsub = adapter.db.subscribe<Product & { id?: string }>('products', d => {
      if (Array.isArray(d)) setNames(Object.fromEntries(d.map(p => [p.id ?? '', p.name])))
    })
    return unsub
  }, [onProductPage])

  const parts = pathname.split('/').filter(Boolean).slice(1) // drop 'app'
  const crumbs: Crumb[] = []
  if (parts[0] === 'products' && parts[1]) {
    crumbs.push({ label: 'Products', to: '/app/products' })
    crumbs.push({ label: names[parts[1]] ?? 'Product', to: `/app/products/${parts[1]}/overview` })
    if (parts[2]) crumbs.push({ label: TAB_LABELS[parts[2]] ?? parts[2], to: `/app/products/${parts[1]}/${parts[2]}` })
  } else if (parts[0]) {
    crumbs.push({ label: LABELS[parts[0]] ?? parts[0], to: `/app/${parts[0]}` })
  }
  return crumbs
}

function Breadcrumb() {
  const crumbs = useCrumbs()
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm min-w-0">
      <Link to="/app" aria-label="Home"
        className={`flex items-center gap-1.5 shrink-0 rounded-[6px] px-1 -mx-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${crumbs.length ? 'text-dim hover:text-text' : 'text-text font-medium'}`}>
        <IconHome size={14} aria-hidden="true" />{!crumbs.length && <span>Home</span>}
      </Link>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1
        return (
          <span key={`${i}-${c.to}`} className="flex items-center gap-1.5 min-w-0">
            <span className="text-faint shrink-0" aria-hidden="true">/</span>
            {last
              ? <span className="font-medium text-text truncate" aria-current="page">{c.label}</span>
              : <Link to={c.to} className="text-dim hover:text-text truncate rounded-[6px] px-1 -mx-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{c.label}</Link>}
          </span>
        )
      })}
    </nav>
  )
}

// Detect Mac so the shortcut badge reads ⌘F instead of Ctrl+F.
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

// SUPER_ADMIN tenant switcher — selecting a company scopes the platform session to
// that tenant's data (X-Tenant-Id override, honoured server-side for the platform
// plane). Tenant-plane users are always pinned to their own tenant; this control is
// SUPER_ADMIN-only. Every cross-tenant data change is still recorded in the audit log.
function SuperAdminTenantSwitcher({ currentTenantId }: { currentTenantId: string | null | undefined }) {
  const [tenants, setTenants] = useState<TenantInfo[]>([])
  const [active, setActive] = useState<string>(currentTenantId ?? '')

  useEffect(() => {
    adapter.auth.listTenants().then(setTenants).catch(() => {})
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    setActive(id)
    setSuperAdminTenant(id || null)
  }

  if (tenants.length === 0) return null
  return (
    <div className="hidden sm:flex items-center gap-1.5 px-2 h-8 rounded-[8px] bg-raised text-sm text-dim" style={{ border: '1px solid var(--color-border)' }}>
      <IconLayers size={13} aria-hidden="true" className="text-accent shrink-0" />
      <select
        value={active}
        onChange={handleChange}
        aria-label="Active tenant (super admin)"
        className="bg-transparent text-sm text-text focus:outline-none cursor-pointer"
      >
        <option value="">— platform (no tenant) —</option>
        {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  )
}

export function Topbar({ onOpenPalette, onOpenMobileSidebar }: TopbarProps) {
  const { user } = useUser()
  const navigate  = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    await adapter.auth.signOut()
    navigate('/')
  }

  return (
    <header
      className="flex items-center gap-3 h-14 px-4 bg-surface shrink-0"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      {/* Hamburger for mobile — opens the sidebar overlay */}
      {onOpenMobileSidebar && (
        <button
          onClick={onOpenMobileSidebar}
          className="lg:hidden p-1.5 rounded-[8px] text-dim hover:text-text hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent shrink-0"
          aria-label="Open navigation"
        >
          <svg width={18} height={18} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" />
          </svg>
        </button>
      )}
      <div className="flex-1 min-w-0"><Breadcrumb /></div>

      {/* Search — the persistent input bar is gone by design: ⌘F/Ctrl+F (or ⌘K/Ctrl+K)
          opens the centered search overlay. This compact affordance keeps mouse users
          one click away without re-introducing a bar. */}
      <Tooltip content={`Search — ${isMac ? '⌘F' : 'Ctrl+F'}`} side="bottom">
        <button
          onClick={onOpenPalette}
          className="flex items-center justify-center w-8 h-8 rounded-[8px] text-dim hover:text-text hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent shrink-0"
          aria-label={`Search (${isMac ? '⌘F' : 'Ctrl+F'})`}
        >
          <IconSearch size={16} aria-hidden="true" />
        </button>
      </Tooltip>

      {/* Tenant switcher — visible only to SUPER_ADMIN */}
      {user?.role === 'SUPER_ADMIN' && <SuperAdminTenantSwitcher currentTenantId={user.tenantId} />}

      {/* Theme toggle — light ⇄ dark, persisted */}
      <ThemeToggle />

      {/* Presence slot (wired in Prompt 4) */}
      <div className="hidden lg:flex items-center gap-1" id="presence-slot" />

      {/* User menu */}
      {user && (
        <div className="relative">
          <button
            onClick={() => setMenuOpen(m => !m)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-sm text-dim hover:bg-raised hover:text-text transition-colors"
            aria-label="User menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent-soft text-accent text-xs font-semibold">
              {(user.name ?? user.email ?? 'U')[0].toUpperCase()}
            </span>
            <span className="hidden md:block max-w-[120px] truncate">{user.name ?? user.email}</span>
            <IconChevronDown size={12} aria-hidden="true" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-50 min-w-[200px] bg-surface rounded-[12px] py-1 text-sm"
                style={{ boxShadow: 'var(--shadow-dropdown)', border: '1px solid var(--color-border)' }}
              >
                <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <p className="font-medium text-text truncate">{user.name ?? user.email}</p>
                  <p className="text-xs text-faint font-mono mt-0.5">{user.email}</p>
                  <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-[4px] bg-accent-soft text-accent">{user.role}</span>
                </div>
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); navigate('/must-change-password') }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-dim hover:bg-raised hover:text-text transition-colors"
                >
                  <IconKey size={14} aria-hidden="true" />
                  Change password
                </button>
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); void handleSignOut() }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-dim hover:bg-raised hover:text-text transition-colors"
                >
                  <IconSignOut size={14} aria-hidden="true" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </header>
  )
}
