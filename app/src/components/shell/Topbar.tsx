// Topbar — breadcrumb, global search (opens palette), presence slot, user menu.
import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { IconSearch, IconSignOut, IconChevronDown, IconUser, IconHome } from '../ui/icons'
import { useUser } from '../../context/useUser'
import { adapter } from '../../lib/backend'
import type { Product } from '@pf/shared'

interface TopbarProps { onOpenPalette: () => void }

const LABELS: Record<string, string> = {
  products: 'Products', builder: 'AI Builder', explorer: 'Explorer',
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
  // Subscribe once while in product-land (not per tab switch) to avoid listener churn.
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

export function Topbar({ onOpenPalette }: TopbarProps) {
  const { user } = useUser()
  const navigate  = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    await adapter.auth.signOut()
    navigate('/')
  }

  return (
    <header
      className="flex items-center gap-4 h-14 px-5 bg-surface shrink-0"
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <div className="flex-1 min-w-0"><Breadcrumb /></div>

      {/* Search field — opens palette */}
      <button
        onClick={onOpenPalette}
        className="hidden sm:flex items-center gap-2 px-3 h-8 rounded-[8px] text-sm text-faint bg-raised hover:bg-hover transition-colors"
        style={{ border: '1px solid var(--color-border)', minWidth: 200 }}
        aria-label="Search (Ctrl+K)"
      >
        <IconSearch size={14} aria-hidden="true" />
        <span>Search...</span>
        <kbd className="ml-auto text-xs bg-surface rounded px-1 py-0.5 font-mono text-faint" style={{ border: '1px solid var(--color-border)' }}>Ctrl+K</kbd>
      </button>

      {/* Presence slot (wired in Prompt 4) */}
      <div className="hidden lg:flex items-center gap-1" id="presence-slot" />

      {/* User menu */}
      {user && (
        <div className="relative">
          <button
            onClick={() => setMenuOpen(m => !m)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] text-sm text-dim hover:bg-raised hover:text-text transition-colors"
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
                className="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-surface rounded-[12px] py-1 text-sm"
                style={{ boxShadow: '0 8px 24px rgba(19,19,26,.12)', border: '1px solid var(--color-border)' }}
              >
                <div className="px-3 py-2 border-b border-[rgba(19,19,26,.08)]">
                  <p className="font-medium text-text truncate">{user.name ?? user.email}</p>
                  <p className="text-xs text-faint font-mono mt-0.5">{user.role}</p>
                </div>
                <button
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

      {!user && (
        <button onClick={() => navigate('/sign-in')} className="flex items-center gap-1.5 text-sm text-dim hover:text-text">
          <IconUser size={14} aria-hidden="true" />Sign in
        </button>
      )}
    </header>
  )
}
