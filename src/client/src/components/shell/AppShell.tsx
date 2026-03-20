/* Iranti Control Plane — App Shell */
/* Root layout route. Renders once; only main content area re-renders on navigation. */
/* Provides: sidebar nav, instance switcher, topbar, activity drawer slot, */
/*           theme toggle (dark/light), hidden Phase 2 chat panel slot. */

import { useState, useEffect, useCallback } from 'react'
import { Outlet, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { useInstanceContext } from '../../hooks/useInstanceContext'
import styles from './AppShell.module.css'

/* ------------------------------------------------------------------ */
/*  Navigation definition                                               */
/* ------------------------------------------------------------------ */

interface NavItem {
  to: string
  label: string
  icon: string
  phase: 1 | 2
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',          label: 'Overview',  icon: '⬡', phase: 1 },
  { to: '/memory',    label: 'Memory',    icon: '▦', phase: 1 },
  { to: '/archive',   label: 'Archive',   icon: '◫', phase: 1 },
  { to: '/activity',  label: 'Activity',  icon: '⚡', phase: 1 },
  { to: '/instances', label: 'Instances', icon: '⊞', phase: 1 },
  { to: '/health',    label: 'Health',    icon: '♥', phase: 1 },
  { to: '/settings',  label: 'Settings',  icon: '⚙', phase: 2 },  // Phase 2 — disabled
]

/* Map routes to section titles for the topbar */
const SECTION_TITLES: Record<string, string> = {
  '/':          'Overview',
  '/memory':    'Memory Explorer',
  '/archive':   'Archive',
  '/activity':  'Staff Activity',
  '/instances': 'Instances & Projects',
  '/health':    'Health & Diagnostics',
  '/settings':  'Settings',
}

function getSectionTitle(pathname: string): string {
  // Exact match first, then prefix match for nested routes
  if (SECTION_TITLES[pathname]) return SECTION_TITLES[pathname]
  const prefix = Object.keys(SECTION_TITLES).find(
    k => k !== '/' && pathname.startsWith(k)
  )
  return prefix ? (SECTION_TITLES[prefix] ?? 'Iranti') : 'Iranti'
}

/* ------------------------------------------------------------------ */
/*  Theme helpers                                                       */
/* ------------------------------------------------------------------ */

type Theme = 'dark' | 'light'
const THEME_KEY = 'iranti-cp-theme'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage unavailable — use default
  }
  return 'dark'
}

function applyTheme(theme: Theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // localStorage unavailable — non-fatal
  }
}

/* ------------------------------------------------------------------ */
/*  Instance Switcher                                                   */
/* ------------------------------------------------------------------ */

function InstanceSwitcher() {
  const { activeInstance, instances, loading, error, setActiveInstance } = useInstanceContext()
  const [open, setOpen] = useState(false)

  const handleSelect = (instance: typeof instances[number]) => {
    setActiveInstance(instance)
    setOpen(false)
  }

  return (
    <div className={styles.instanceSwitcher}>
      <span className={styles.instanceLabel}>instance</span>
      <button
        className={styles.instanceButton}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={loading}
        title={error ? `Instance API unavailable: ${error}` : undefined}
      >
        <span className={styles.instanceName}>
          {loading ? '…' : (activeInstance?.name ?? 'No instance')}
        </span>
        {activeInstance && (
          <span className={styles.instancePort}>:{activeInstance.port}</span>
        )}
        <span className={styles.instanceCaret} aria-hidden="true">▾</span>
      </button>

      {open && instances.length > 0 && (
        <div className={styles.instanceDropdown} role="listbox" aria-label="Select instance">
          {instances.map(inst => (
            <button
              key={inst.id}
              role="option"
              aria-selected={inst.id === activeInstance?.id}
              className={`${styles.instanceOption} ${inst.id === activeInstance?.id ? styles.instanceOptionActive : ''}`}
              onClick={() => handleSelect(inst)}
            >
              <span
                className={styles.instanceStatusDot}
                data-status={inst.status}
                aria-label={inst.status}
              />
              <span className={styles.instanceOptionName}>{inst.name}</span>
              <span className={styles.instanceOptionPort}>{inst.host}:{inst.port}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <span className={styles.instanceError} title={error}>
          API unavailable
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  CP-T027: Shell-level API connection status indicator               */
/* ------------------------------------------------------------------ */

/** Probe the Iranti API health endpoint to determine reachability. */
function useApiReachability(intervalMs: number): 'checking' | 'reachable' | 'unreachable' {
  const [status, setStatus] = useState<'checking' | 'reachable' | 'unreachable'>('checking')

  const probe = useCallback(async () => {
    try {
      const res = await fetch('/api/control-plane/health', { method: 'GET' })
      setStatus(res.ok || res.status === 503 ? 'reachable' : 'unreachable')
    } catch {
      setStatus('unreachable')
    }
  }, [])

  useEffect(() => {
    void probe()
    const id = setInterval(() => void probe(), intervalMs)
    return () => clearInterval(id)
  }, [probe, intervalMs])

  return status
}

function ApiConnectionIndicator() {
  const status = useApiReachability(30_000)

  if (status === 'checking') {
    return (
      <span className={styles.apiStatusIndicator} data-status="checking" aria-label="Checking API connection">
        <span className={styles.apiStatusDot} data-status="checking" aria-hidden="true" />
        <span className={styles.apiStatusLabel}>Connecting</span>
      </span>
    )
  }

  if (status === 'unreachable') {
    return (
      <Link to="/health" className={styles.apiStatusIndicator} data-status="unreachable" aria-label="Iranti API unreachable — open Health dashboard">
        <span className={styles.apiStatusDot} data-status="unreachable" aria-hidden="true" />
        <span className={styles.apiStatusLabel}>API unreachable</span>
      </Link>
    )
  }

  return (
    <span className={styles.apiStatusIndicator} data-status="reachable" aria-label="Iranti API reachable">
      <span className={styles.apiStatusDot} data-status="reachable" aria-hidden="true" />
      <span className={styles.apiStatusLabel}>Connected</span>
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Activity Drawer                                                     */
/* ------------------------------------------------------------------ */

function ActivityDrawerSlot() {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={`${styles.activityDrawerSlot} ${expanded ? styles.activityDrawerExpanded : ''}`}
      aria-label="Activity drawer"
    >
      <button
        className={styles.activityDrawerToggle}
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-controls="activity-drawer-panel"
      >
        <span className={styles.activityDrawerLabel}>Activity</span>
        <span aria-hidden="true">{expanded ? '↓' : '↑'}</span>
      </button>

      {/* Drawer panel — content will be wired by CP-T014 */}
      <div
        id="activity-drawer-panel"
        className={styles.activityDrawerPanel}
        aria-hidden={!expanded}
      >
        {/* CP-T014 will mount the Staff event tail here */}
        <div className={styles.activityDrawerPlaceholder}>
          Staff activity drawer — wired in CP-T014
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  App Shell                                                           */
/* ------------------------------------------------------------------ */

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  // Apply persisted theme on mount
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
  }

  const sectionTitle = getSectionTitle(location.pathname)

  // Redirect root to /memory (Memory Explorer is the primary Phase 1 surface)
  useEffect(() => {
    if (location.pathname === '/') {
      navigate('/memory', { replace: true })
    }
  }, [location.pathname, navigate])

  return (
    <div className={styles.shell}>
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside className={styles.sidebar} aria-label="Main navigation">
        {/* Logo */}
        <div className={styles.logo}>
          <span className={styles.logoMark} aria-hidden="true">⬡</span>
          <span className={styles.logoText}>iranti</span>
        </div>

        {/* Instance switcher — always visible */}
        <InstanceSwitcher />

        {/* Navigation */}
        <nav className={styles.nav} aria-label="Control plane sections">
          {NAV_ITEMS.map(item => {
            if (item.phase === 2) {
              // Settings: Phase 2 placeholder — rendered but disabled
              return (
                <span key={item.to} className={`${styles.navItem} ${styles.navItemDisabled}`} aria-disabled="true">
                  <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
                  <span className={styles.navLabel}>{item.label}</span>
                  <span className={styles.navPhase2Badge}>Phase 2</span>
                </span>
              )
            }
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `${styles.navItem}${isActive ? ` ${styles.navItemActive}` : ''}`
                }
              >
                <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
                <span className={styles.navLabel}>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Footer: API connection status + theme toggle */}
        <div className={styles.sidebarFooter}>
          {/* CP-T027: Shell-level connection status indicator */}
          <ApiConnectionIndicator />
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            <span aria-hidden="true">{theme === 'dark' ? '◑' : '◐'}</span>
          </button>
        </div>
      </aside>

      {/* ── Main content area ────────────────────────────────────── */}
      <div className={styles.mainArea}>
        {/* Topbar — section title, per-section actions injected by views */}
        <header className={styles.topbar} aria-label={`${sectionTitle} section`}>
          <h1 className={styles.topbarTitle}>{sectionTitle}</h1>
          {/* Per-section action buttons will be injected via a portal or context in Phase 1 views */}
          <div className={styles.topbarActions} id="topbar-actions" aria-live="polite" />
        </header>

        {/* Content area — view components render here via Outlet */}
        <main className={styles.content} id="main-content">
          <Outlet />
        </main>

        {/* Activity Drawer slot — visible from any section */}
        {/* Content wired by CP-T014; slot structure established here per CP-T017 scope */}
        <ActivityDrawerSlot />
      </div>

      {/* ── Phase 2 Chat Panel slot ───────────────────────────────── */}
      {/* Width: 0, display: none in Phase 1. Layout refactor deferred to Phase 2. */}
      {/* aria-hidden: true ensures screen readers skip this empty region. */}
      <aside
        className={styles.chatPanelSlot}
        aria-hidden="true"
        data-phase="2"
        style={{ display: 'none' }}
      />
    </div>
  )
}
