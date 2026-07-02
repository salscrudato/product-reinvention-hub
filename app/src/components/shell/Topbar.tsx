// Topbar — breadcrumb, global search (opens palette), presence slot, user menu.
import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Search, LogOut, ChevronDown, User } from 'lucide-react'
import { useUser } from '../../context/useUser'
import { adapter } from '../../lib/backend'

interface TopbarProps { onOpenPalette: () => void }

const LABELS: Record<string, string> = {
  app: 'Home', products: 'Products', builder: 'AI Builder', explorer: 'Explorer',
  tasks: 'Tasks', news: 'News', claims: 'Claims Analysis', dictionary: 'Data Dictionary',
  feedback: 'Feedback', admin: 'Settings',
}

function Breadcrumb() {
  const { pathname } = useLocation()
  const parts = pathname.split('/').filter(Boolean).slice(1) // skip 'app'
  if (!parts.length) return <span className="text-sm font-medium text-text">Home</span>
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-faint">/</span>}
          <span className={i === parts.length - 1 ? 'font-medium text-text' : 'text-dim'}>
            {LABELS[part] ?? part}
          </span>
        </span>
      ))}
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
        className="hidden sm:flex items-center gap-2 px-3 h-8 rounded-[8px] text-sm text-faint bg-raised hover:bg-[#EAEAF0] transition-colors"
        style={{ border: '1px solid var(--color-border)', minWidth: 200 }}
        aria-label="Search (Ctrl+K)"
      >
        <Search size={14} />
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
            <ChevronDown size={12} />
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
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!user && (
        <button onClick={() => navigate('/sign-in')} className="flex items-center gap-1.5 text-sm text-dim hover:text-text">
          <User size={14} />Sign in
        </button>
      )}
    </header>
  )
}
