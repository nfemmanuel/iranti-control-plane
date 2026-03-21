/* Iranti Control Plane — App Shell */
/* Root layout route. Renders once; only main content area re-renders on navigation. */
/* Provides: sidebar nav, instance switcher, topbar, activity drawer slot, */
/*           theme toggle (dark/light), hidden Phase 2 chat panel slot. */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Outlet, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { useInstanceContext } from '../../hooks/useInstanceContext'
import { useSetupStatus } from '../onboarding/GettingStarted'
import { CommandPalette, useCommandPalette } from './CommandPalette'
import { ChatPanel, ChatToggleButton, loadPanelOpen } from '../chat/ChatPanel'
import { ToastContainer } from '../ui/ToastContainer'
import { useToasts } from '../../hooks/useToasts'
import { useViewNavigationShortcuts } from '../../hooks/useViewNavigationShortcuts'
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
  { to: '/overview',        label: 'Home',            icon: '⌂', phase: 1 },
  { to: '/memory',          label: 'Memory',          icon: '▦', phase: 1 },
  { to: '/archive',         label: 'Archive',         icon: '◫', phase: 1 },
  { to: '/activity',        label: 'Activity',        icon: '⚡', phase: 1 },
  { to: '/logs',            label: 'Logs',            icon: '≡', phase: 1 },
  { to: '/instances',       label: 'Instances',       icon: '⊞', phase: 1 },
  { to: '/health',          label: 'Health',          icon: '♥', phase: 1 },
  { to: '/metrics',         label: 'Metrics',         icon: '⊡', phase: 1 },
  { to: '/conflicts',       label: 'Conflicts',       icon: '⚖', phase: 1 },
  { to: '/providers',       label: 'Providers',       icon: '◈', phase: 1 },
  { to: '/agents',          label: 'Agents',          icon: '◉', phase: 1 },
  { to: '/getting-started', label: 'Getting Started', icon: '◎', phase: 1 },
  { to: '/settings',        label: 'Settings',        icon: '⚙', phase: 2 },  // Phase 2 — disabled
]

/* Map routes to section titles for the topbar */
const SECTION_TITLES: Record<string, string> = {
  '/':                'Overview',
  '/overview':        'Overview',
  '/memory':          'Memory Explorer',
  '/archive':         'Archive',
  '/activity':        'Staff Activity',
  '/logs':            'Staff Logs',
  '/instances':       'Instances & Projects',
  '/health':          'Health & Diagnostics',
  '/metrics':         'Metrics',
  '/conflicts':       'Conflict Review',
  '/providers':       'Provider Manager',
  '/agents':          'Agent Registry',
  '/getting-started': 'Getting Started',
  '/settings':        'Settings',
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
/*  CP-T035: Setup incomplete banner (shell header)                   */
/* ------------------------------------------------------------------ */

function SetupBanner() {
  const { incompleteCount, isFullyConfigured, isLoading } = useSetupStatus()
  const [dismissed, setDismissed] = useState(false)

  // Only show if: not loading, not fully configured, not dismissed this session
  if (isLoading || isFullyConfigured || dismissed || incompleteCount === 0) return null

  return (
    <div className={styles.setupBanner} role="alert" aria-live="polite">
      <span className={styles.setupBannerIcon} aria-hidden="true">◎</span>
      <span className={styles.setupBannerText}>
        Setup incomplete — {incompleteCount} step{incompleteCount !== 1 ? 's' : ''} remaining.
        {' '}
        <Link to="/getting-started" className={styles.setupBannerLink}>View setup guide</Link>
      </span>
      <button
        className={styles.setupBannerDismiss}
        onClick={() => setDismissed(true)}
        type="button"
        aria-label="Dismiss setup banner"
      >
        ×
      </button>
    </div>
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
  const { open: isPaletteOpen, openPalette, closePalette } = useCommandPalette()

  // CP-T020: Chat panel open/close state — persisted in localStorage
  const [chatOpen, setChatOpen] = useState<boolean>(loadPanelOpen)
  const handleChatToggle = () => {
    setChatOpen(prev => {
      const next = !prev
      try {
        localStorage.setItem('iranti_cp_chat_panel_open', String(next))
      } catch {
        // non-fatal
      }
      return next
    })
  }
  const handleChatClose = () => {
    setChatOpen(false)
    try {
      localStorage.setItem('iranti_cp_chat_panel_open', 'false')
    } catch {
      // non-fatal
    }
  }

  // Apply persisted theme on mount
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
  }

  // CP-T024: Cmd+K / Ctrl+K opens the command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        openPalette()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openPalette])

  const sectionTitle = getSectionTitle(location.pathname)

  // CP-T035: Setup status for nav badge + auto-redirect on first run
  const { incompleteCount, firstRunDetected } = useSetupStatus()

  // CP-T035: Auto-redirect to /getting-started on first load when firstRunDetected
  useEffect(() => {
    if (firstRunDetected && location.pathname !== '/getting-started') {
      navigate('/getting-started', { replace: true })
    }
  }, [firstRunDetected, location.pathname, navigate])

  // Root redirect handled by <Navigate to="/overview" replace /> in main.tsx (CP-T068)

  // CP-T069: Toast notification system
  const { toasts, addToast, dismissToast } = useToasts()

  // CP-T069: Health degradation poller (60s interval, fires toasts on state transitions)
  const prevOverallRef = useRef<string | null>(null)
  const healthPollerInitializedRef = useRef(false)
  useEffect(() => {
    async function pollHealth() {
      try {
        const res = await fetch('/api/control-plane/health', { method: 'GET' })
        if (!res.ok) return
        const data = await res.json() as { overall?: string }
        const overall = data.overall ?? 'healthy'
        const prev = prevOverallRef.current

        // Initial check
        if (!healthPollerInitializedRef.current) {
          healthPollerInitializedRef.current = true
          prevOverallRef.current = overall
          if (overall !== 'healthy') {
            addToast({
              severity: overall === 'error' ? 'error' : 'warn',
              title: overall === 'error' ? 'Iranti health error' : 'Iranti degraded',
              message: overall === 'error'
                ? 'A critical health check has failed.'
                : 'One or more health checks are warning.',
              action: { label: 'View Health →', href: '/health' },
            })
          }
          return
        }

        // State transition detection
        if (prev !== overall) {
          prevOverallRef.current = overall
          if (overall !== 'healthy') {
            addToast({
              severity: overall === 'error' ? 'error' : 'warn',
              title: overall === 'error' ? 'Iranti health error' : 'Iranti degraded',
              message: overall === 'error'
                ? 'A critical health check has failed.'
                : 'One or more health checks are warning.',
              action: { label: 'View Health →', href: '/health' },
            })
          } else {
            // Recovery
            addToast({
              severity: 'info',
              title: 'Iranti healthy',
              message: 'All health checks are passing.',
              autoDismissMs: 4000,
            })
          }
        }
      } catch {
        // Network failure — silently skip
      }
    }

    void pollHealth()
    const id = setInterval(() => { void pollHealth() }, 60_000)
    return () => clearInterval(id)
  }, [addToast])

  // CP-T070: Global G+key navigation shortcuts
  const { goModeActive } = useViewNavigationShortcuts()

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
                {/* CP-T035: Badge showing incomplete setup step count on Getting Started nav item */}
                {item.to === '/getting-started' && incompleteCount > 0 && (
                  <span className={styles.navBadge} aria-label={`${incompleteCount} steps remaining`}>
                    {incompleteCount}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Footer: API connection status + chat toggle + theme toggle */}
        <div className={styles.sidebarFooter}>
          {/* CP-T027: Shell-level connection status indicator */}
          <ApiConnectionIndicator />
          <div className={styles.sidebarFooterActions}>
            {/* CP-T020: Chat panel toggle */}
            <ChatToggleButton isOpen={chatOpen} onClick={handleChatToggle} />
            <button
              className={styles.themeToggle}
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <span aria-hidden="true">{theme === 'dark' ? '◑' : '◐'}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content area ────────────────────────────────────── */}
      <div className={styles.mainArea}>
        {/* CP-T035: Setup incomplete banner — shown when setup steps remain */}
        <SetupBanner />

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

      {/* CP-T024: Command Palette — mounted at shell level, accessible from every view */}
      {isPaletteOpen && (
        <CommandPalette
          onClose={closePalette}
          onToggleDarkMode={toggleTheme}
        />
      )}

      {/* ── CP-T020: Embedded Chat Panel ─────────────────────────── */}
      {/* 380px wide at ≥ 1280px (renders alongside main content). */}
      {/* Overlays at < 1280px. Open/close persisted to localStorage. */}
      <ChatPanel
        isOpen={chatOpen}
        onClose={handleChatClose}
      />

      {/* CP-T069: Toast notifications — fixed bottom-right, z-index 1100 */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* CP-T070: Go mode indicator — shown while G+key navigation is pending */}
      {goModeActive && (
        <div className={styles.goModeChip} role="status" aria-live="polite">
          <span aria-hidden="true">⌨</span> go mode — press a key
        </div>
      )}
    </div>
  )
}
