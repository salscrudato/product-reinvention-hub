// Authenticated app shell â€” route guard, sidebar, topbar, command palette, outlet.
import { useState, useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useUser } from '../context/useUser'
import { Sidebar } from '../components/shell/Sidebar'
import { Topbar } from '../components/shell/Topbar'
import { CommandPalette } from '../components/palette/CommandPalette'
import { Skeleton } from '../components/ui'

export default function AppShell() {
  const { user, profile, loading } = useUser()
  const [collapsed,    setCollapsed]    = useState(false)
  const [paletteOpen, setPaletteOpen]   = useState(false)

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

  if (!user) return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />

  if (profile?.mustChangePassword) return <Navigate to="/must-change-password" replace />

  return (
    <div className="flex h-svh overflow-hidden bg-page">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar onOpenPalette={() => setPaletteOpen(true)} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toaster richColors position="bottom-right" />
    </div>
  )
}

