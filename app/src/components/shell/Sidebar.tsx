// Sidebar — grouped, collapsible workspace nav. Sections give the app a clear
// mental model (author vs. intelligence); the active item is a soft brand pill
// with a gradient rail. Collapsed → icon-only with tooltips.
import { NavLink, useLocation } from 'react-router-dom'
import { Tooltip, Logo } from '../ui'
import { prefetchRoute } from '../../lib/prefetch'
import {
  IconHome, IconProduct, IconSparkle, IconExplorer, IconTasks,
  IconNews, IconChart, IconBook, IconChat, IconChevronLeft,
  IconChevronRight, IconSettings, IconShield, type IconType,
} from '../ui/icons'
import { useUser } from '../../context/useUser'
import { isPlatform, isTenantAdmin } from '../../lib/canI'
import { useFeatureFlags } from '../../lib/useFeatureFlags'

// `flag` (optional) ties a nav item to a platform feature flag: when the server resolves
// that flag to `false` for the tenant, the item is hidden. Server-side enforcement on the
// underlying routes remains authoritative — this only declutters the nav.
interface NavItem { to: string; label: string; icon: IconType; exact?: boolean; flag?: string }

const WORKSPACE_ITEMS: NavItem[] = [
  { to: '/app',          label: 'Home',       icon: IconHome, exact: true },
  { to: '/app/products', label: 'Products',   icon: IconProduct },
  { to: '/app/builder',  label: 'Builder',    icon: IconSparkle, flag: 'page.builder' },
  { to: '/app/explorer', label: 'Explorer',   icon: IconExplorer, flag: 'page.explorer' },
]

const INTELLIGENCE_ITEMS: NavItem[] = [
  { to: '/app/tasks',      label: 'Tasks',           icon: IconTasks, flag: 'page.tasks' },
  { to: '/app/news',       label: 'News',            icon: IconNews, flag: 'page.news' },
  { to: '/app/claims',     label: 'Claims Analysis', icon: IconChart, flag: 'page.claims' },
  { to: '/app/dictionary', label: 'Data Dictionary', icon: IconBook, flag: 'page.dictionary' },
]

// Feedback is platform plumbing (talk to the makers), not portfolio intelligence —
// it lives in the Platform panel at the sidebar bottom. Route unchanged, so every
// existing /app/feedback deep link keeps working.
const FEEDBACK_ITEM: NavItem = { to: '/app/feedback', label: 'Feedback', icon: IconChat, flag: 'page.feedback' }

const SECTIONS = [
  { label: 'Workspace',    items: WORKSPACE_ITEMS   },
  { label: 'Intelligence', items: INTELLIGENCE_ITEMS },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  mobileOpen?: boolean
  onMobileClose?: () => void
}

const ROUTE_IMPORTS: Record<string, () => Promise<unknown>> = {
  '/app':                () => import('../../routes/Home'),
  '/app/products':       () => import('../../routes/Products'),
  '/app/builder':        () => import('../../routes/Builder'),
  '/app/explorer':       () => import('../../routes/Explorer'),
  '/app/tasks':          () => import('../../routes/Tasks'),
  '/app/news':           () => import('../../routes/News'),
  '/app/claims':         () => import('../../routes/Claims'),
  '/app/dictionary':     () => import('../../routes/Dictionary'),
  '/app/feedback':       () => import('../../routes/Feedback'),
  '/app/admin':          () => import('../../routes/Admin'),
  '/app/tenant-admin':   () => import('../../routes/TenantAdmin'),
}

function Item({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) {
  const Icon = item.icon
  return (
    <Tooltip content={collapsed ? item.label : ''} side="right">
      <NavLink
        to={item.to}
        end={item.exact}
        aria-current={active ? 'page' : undefined}
        onMouseEnter={() => { const fn = ROUTE_IMPORTS[item.to]; if (fn) prefetchRoute(item.to, fn) }}
        className={`group relative flex items-center gap-3 mx-2 px-2.5 py-2 rounded-[10px] text-sm transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
          ${active
            ? 'bg-accent-soft text-accent font-medium shadow-[inset_0_0_0_1px_var(--color-accent-line)]'
            : 'text-dim hover:bg-raised hover:text-text hover:translate-x-[1px]'} ${collapsed ? 'justify-center' : ''}`}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
            style={{ background: 'var(--gradient-accent)', boxShadow: '0 0 8px var(--glow-accent)' }} aria-hidden="true" />
        )}
        <Icon size={18} strokeWidth={active ? 2.2 : 1.9}
          className={`shrink-0 transition-colors duration-150 ${active ? '' : 'group-hover:text-accent'}`} aria-hidden="true" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    </Tooltip>
  )
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const location = useLocation()
  const { profile } = useUser()
  const flags = useFeatureFlags()
  const visible = (items: NavItem[]) => items.filter((it) => !it.flag || flags[it.flag] !== false)
  const isActive = (to: string, exact?: boolean) => exact ? location.pathname === to : location.pathname.startsWith(to)
  // Platform plane (SUPER_ADMIN/SUPPORT) → platform console at /app/admin
  // Tenant admin (TENANT_ADMIN) → self-service org console at /app/tenant-admin
  // Everyone else → settings at /app/admin (the page gates itself and shows settings)
  const onPlatform    = isPlatform(profile)
  const onTenantAdmin = isTenantAdmin(profile)

  return (
    <aside
      className={`flex flex-col shrink-0 h-full bg-surface transition-all duration-200
        ${mobileOpen !== undefined
          ? 'fixed inset-y-0 left-0 z-50 lg:relative lg:z-auto'
          : 'relative'}
        ${mobileOpen === false ? '-translate-x-full lg:translate-x-0' : 'translate-x-0'}
      `}
      style={{ width: collapsed ? 60 : 232, borderRight: '1px solid var(--color-border)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 h-14 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <Logo size={26} className="shrink-0" />
        {!collapsed && <span className="font-semibold text-sm text-text tracking-tight truncate flex-1 min-w-0">The Reinvention Engine</span>}
        {onMobileClose && !collapsed && (
          <button
            onClick={onMobileClose}
            className="lg:hidden ml-auto p-1 rounded-[7px] text-dim hover:text-text hover:bg-raised transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Close navigation"
          >
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        )}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        {SECTIONS.map((section, si) => (
          <div key={section.label}>
            {!collapsed
              ? <p className="px-4 pt-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-faint select-none">{section.label}</p>
              : si > 0 && <div className="my-2 mx-3 h-px" style={{ background: 'var(--color-border)' }} aria-hidden="true" />}
            <div className="flex flex-col gap-0.5">
              {visible(section.items).map(item => (
                <Item key={item.to} item={item} collapsed={collapsed} active={isActive(item.to, item.exact)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer — the Platform panel: feedback to the makers + the role-appropriate console. */}
      <div className="py-2" style={{ borderTop: '1px solid var(--color-border)' }}>
        {!collapsed && <p className="px-4 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[.08em] text-faint select-none">Platform</p>}
        {visible([FEEDBACK_ITEM]).map(item => (
          <Item key={item.to} item={item} collapsed={collapsed} active={isActive(item.to)} />
        ))}
        {/* Role-based console: platform roles → platform console; org admins → org admin; others → settings. */}
        {onPlatform
          ? <Item item={{ to: '/app/admin',        label: 'Admin console', icon: IconShield }} collapsed={collapsed} active={isActive('/app/admin')} />
          : onTenantAdmin
            ? <Item item={{ to: '/app/tenant-admin', label: 'Org Admin', icon: IconShield }} collapsed={collapsed} active={isActive('/app/tenant-admin')} />
            : <Item item={{ to: '/app/admin',        label: 'Settings',  icon: IconSettings }} collapsed={collapsed} active={isActive('/app/admin')} />
        }
        <button
          onClick={onToggle}
          className={`flex items-center gap-3 mx-2 px-2.5 py-2 rounded-[10px] text-sm text-dim hover:bg-raised hover:text-text transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent w-[calc(100%-16px)] ${collapsed ? 'justify-center' : ''}`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <IconChevronRight size={18} aria-hidden="true" /> : <><IconChevronLeft size={18} aria-hidden="true" /><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  )
}
