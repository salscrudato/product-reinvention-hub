// Sidebar — grouped, collapsible workspace nav. Sections give the app a clear
// mental model (author vs. intelligence); the active item is a soft brand pill
// with a gradient rail. Collapsed → icon-only with tooltips.
import { NavLink, useLocation } from 'react-router-dom'
import { Tooltip, Logo } from '../ui'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Package, Wand2, Telescope, CheckSquare,
  Newspaper, BarChart3, BookOpen, MessageSquare, ChevronLeft,
  ChevronRight, Settings2,
} from 'lucide-react'

interface NavItem { to: string; label: string; icon: LucideIcon; exact?: boolean }

const SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/app',          label: 'Home',       icon: LayoutDashboard, exact: true },
      { to: '/app/products', label: 'Products',   icon: Package },
      { to: '/app/builder',  label: 'AI Builder', icon: Wand2 },
      { to: '/app/explorer', label: 'Explorer',   icon: Telescope },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/app/tasks',      label: 'Tasks',           icon: CheckSquare },
      { to: '/app/news',       label: 'News',            icon: Newspaper },
      { to: '/app/claims',     label: 'Claims Analysis', icon: BarChart3 },
      { to: '/app/dictionary', label: 'Data Dictionary', icon: BookOpen },
      { to: '/app/feedback',   label: 'Feedback',        icon: MessageSquare },
    ],
  },
]

interface SidebarProps { collapsed: boolean; onToggle: () => void }

function Item({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) {
  const Icon = item.icon
  return (
    <Tooltip content={collapsed ? item.label : ''} side="right">
      <NavLink
        to={item.to}
        end={item.exact}
        aria-current={active ? 'page' : undefined}
        className={`relative flex items-center gap-3 mx-2 px-2.5 py-2 rounded-[10px] text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
          ${active ? 'bg-accent-soft text-accent font-medium' : 'text-dim hover:bg-raised hover:text-text'} ${collapsed ? 'justify-center' : ''}`}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
            style={{ background: 'var(--gradient-accent)' }} aria-hidden="true" />
        )}
        <Icon size={18} strokeWidth={active ? 2.2 : 1.9} className="shrink-0" aria-hidden="true" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    </Tooltip>
  )
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation()
  const isActive = (to: string, exact?: boolean) => exact ? location.pathname === to : location.pathname.startsWith(to)

  return (
    <aside
      className="flex flex-col shrink-0 h-full bg-surface transition-all duration-200"
      style={{ width: collapsed ? 60 : 232, borderRight: '1px solid var(--color-border)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 h-14 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Logo size={26} rounded={7} className="shrink-0 shadow-[0_2px_8px_rgba(139,31,224,.25)]" />
        {!collapsed && <span className="font-semibold text-sm text-text tracking-tight truncate">Product Reinvention Hub</span>}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        {SECTIONS.map((section, si) => (
          <div key={section.label}>
            {!collapsed
              ? <p className="px-4 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-faint select-none">{section.label}</p>
              : si > 0 && <div className="my-2 mx-3 h-px" style={{ background: 'var(--color-border)' }} aria-hidden="true" />}
            <div className="flex flex-col gap-0.5">
              {section.items.map(item => (
                <Item key={item.to} item={item} collapsed={collapsed} active={isActive(item.to, item.exact)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        <Item item={{ to: '/app/admin', label: 'Settings', icon: Settings2 }} collapsed={collapsed} active={isActive('/app/admin')} />
        <button
          onClick={onToggle}
          className={`flex items-center gap-3 mx-2 px-2.5 py-2 rounded-[10px] text-sm text-dim hover:bg-raised hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent w-[calc(100%-16px)] ${collapsed ? 'justify-center' : ''}`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} aria-hidden="true" /> : <><ChevronLeft size={18} aria-hidden="true" /><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  )
}
