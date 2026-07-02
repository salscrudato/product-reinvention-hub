// Sidebar — collapsible nav with gradient active indicator and icon+label layout.
import { NavLink, useLocation } from 'react-router-dom'
import { Tooltip } from '../ui'
import {
  LayoutDashboard, Package, Wand2, Telescope, CheckSquare,
  Newspaper, BarChart3, BookOpen, MessageSquare, ChevronLeft,
  ChevronRight, Settings2,
} from 'lucide-react'

const NAV = [
  { to: '/app',            label: 'Home',           icon: LayoutDashboard, exact: true  },
  { to: '/app/products',   label: 'Products',       icon: Package                        },
  { to: '/app/builder',    label: 'AI Builder',     icon: Wand2                          },
  { to: '/app/explorer',   label: 'Explorer',       icon: Telescope                      },
  { to: '/app/tasks',      label: 'Tasks',          icon: CheckSquare                    },
  { to: '/app/news',       label: 'News',           icon: Newspaper                      },
  { to: '/app/claims',     label: 'Claims Analysis',icon: BarChart3                      },
  { to: '/app/dictionary', label: 'Data Dictionary',icon: BookOpen                       },
  { to: '/app/feedback',   label: 'Feedback',       icon: MessageSquare                  },
]

const BOTTOM = [
  { to: '/app/admin', label: 'Settings', icon: Settings2 },
]

interface SidebarProps { collapsed: boolean; onToggle: () => void }

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation()

  function isActive(to: string, exact?: boolean) {
    if (exact) return location.pathname === to
    return location.pathname.startsWith(to)
  }

  return (
    <aside
      className="flex flex-col shrink-0 h-full bg-surface transition-all duration-200"
      style={{
        width: collapsed ? 56 : 220,
        borderRight: '1px solid var(--color-border)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-14 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="url(#logo-g)" />
          <path d="M7 12l4 4 6-8" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <defs>
            <linearGradient id="logo-g" x1="0" y1="0" x2="24" y2="24">
              <stop stopColor="#C026D3" /><stop offset="1" stopColor="#EC4899" />
            </linearGradient>
          </defs>
        </svg>
        {!collapsed && <span className="font-semibold text-sm text-text tracking-tight">Product Factory</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
        {NAV.map(item => {
          const active = isActive(item.to, item.exact)
          const Icon   = item.icon
          return (
            <Tooltip key={item.to} content={collapsed ? item.label : ''} side="right">
              <NavLink
                to={item.to}
                end={item.exact}
                className={`relative flex items-center gap-3 mx-2 px-3 py-2 rounded-[10px] text-sm transition-colors duration-150
                  ${active ? 'bg-accent-soft text-accent font-medium' : 'text-dim hover:bg-raised hover:text-text'}`}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{ background: 'linear-gradient(180deg, #C026D3, #EC4899)' }}
                    aria-hidden="true"
                  />
                )}
                <Icon size={16} className="shrink-0" aria-hidden="true" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            </Tooltip>
          )
        })}
      </nav>

      {/* Bottom */}
      <div className="py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        {BOTTOM.map(item => {
          const Icon = item.icon
          return (
            <Tooltip key={item.to} content={collapsed ? item.label : ''} side="right">
              <NavLink
                to={item.to}
                className={({ isActive }) => `flex items-center gap-3 mx-2 px-3 py-2 rounded-[10px] text-sm transition-colors duration-150
                  ${isActive ? 'bg-accent-soft text-accent' : 'text-dim hover:bg-raised hover:text-text'}`}
              >
                <Icon size={16} aria-hidden="true" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            </Tooltip>
          )
        })}
        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          className="flex items-center gap-3 mx-2 px-3 py-2 rounded-[10px] text-sm text-dim hover:bg-raised hover:text-text transition-colors w-[calc(100%-16px)]"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} aria-hidden="true" /> : <><ChevronLeft size={16} aria-hidden="true" /><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  )
}
