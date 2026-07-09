// Authenticated app shell — route guard, sidebar, topbar, command palette, outlet.
import { useState, useEffect } from 'react'
import { Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useUser } from '../context/useUser'
import { IconKey } from '../components/ui/icons'
import { Sidebar } from '../components/shell/Sidebar'
import { Topbar } from '../components/shell/Topbar'
import { CommandPalette } from '../components/palette/CommandPalette'
import { FeedbackProvider } from '../components/feedback/FeedbackProvider'
import { CaptureProvider } from '../context/CaptureContext'
import { Skeleton } from '../components/ui'

export default function AppShell() {
  const { user, profile, loading } = useUser()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [collapsed,    setCollapsed]    = useState(false)
  const [paletteOpen, setPaletteOpen]   = useState(false)
  // Top-level route segment drives the page-in key so transitions fire on section changes
  // (Home → Products → Explorer) but not on product-tab sub-navigation.
  const topSegment = pathname.split('/')[2] ?? 'home'

  // âŒ˜K / Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(p => !p)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (loading) {
    return (
      <div className="flex h-svh items-center justify-center bg-page gap-3">
        <Skeleton className="w-32 h-4" />
      </div>
    )
  }

  // Require a *credentialed* session, not just any truthy user. The adapter auto-connects
  // an ANONYMOUS session (email === null) whenever Firebase reports no user — including right
  // after sign-out. Gating on `!user` alone would let that anonymous session linger inside the
  // app, stranding a signed-out user on /app. Mirror Landing's `user?.email` guard so anonymous
  // (and null) sessions are sent back to the landing/sign-in page.
  if (!user?.email) return <Navigate to="/" replace />

  return (
    // CaptureProvider wraps FeedbackProvider so the drawer can read the entity the user was
    // viewing; product routes below (via Outlet) publish into it.
    <CaptureProvider>
    <FeedbackProvider>
      <div className="flex h-svh overflow-hidden bg-page">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Topbar onOpenPalette={() => setPaletteOpen(true)} />

          {/* Persistent banner until the seeded/temp password is changed */}
          {profile?.mustChangePassword && (
            <div className="flex items-center justify-between gap-3 px-6 py-2 text-sm" style={{ background: 'var(--color-warn-soft)', borderBottom: '1px solid var(--color-warn-line)' }}>
              <span className="flex items-center gap-2 text-warn"><IconKey size={14} aria-hidden="true" /> You're using a temporary password. Please set a new one.</span>
              <button onClick={() => navigate('/must-change-password')} className="font-medium text-warn hover:underline shrink-0">Change password →</button>
            </div>
          )}

          <main className="flex-1 overflow-y-auto p-6">
            {/* key on top-level segment so page-in fires on section switches, not tab changes */}
            <div key={topSegment} className="page-in h-full">
              <Outlet />
            </div>
          </main>
        </div>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <Toaster richColors position="bottom-right" />
      </div>
    </FeedbackProvider>
    </CaptureProvider>
  )
}

