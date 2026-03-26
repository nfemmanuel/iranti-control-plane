/* Iranti Control Plane — App Shell */
/* Root layout route. Renders once; only main content area re-renders on navigation. */
/* Provides: sidebar nav, instance switcher, topbar, activity drawer slot. */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Outlet, NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useInstanceContext } from '../../hooks/useInstanceContext'
import { useSettings } from '../../hooks/useSettings'
import { useSetupStatus } from '../onboarding/GettingStarted'
import { CommandPalette, useCommandPalette } from './CommandPalette'
import { ChatPanel, ChatToggleButton } from '../chat/ChatPanel'
import { ToastContainer } from '../ui/ToastContainer'
import { useToasts } from '../../hooks/useToasts'
import { useViewNavigationShortcuts } from '../../hooks/useViewNavigationShortcuts'
import { fetchInstallState } from '../../api/client'
import type { InstallStateResult } from '../../api/types'
import { SetupWizard, shouldShowWizard } from '../setup/SetupWizard'
import styles from './AppShell.module.css'
import { IrantiMark } from './IrantiMark'

interface NavItem {
  to: string
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/overview', label: 'Home', icon: '⌂' },
  { to: '/memory', label: 'Memory', icon: '▦' },
  { to: '/archive', label: 'Archive', icon: '◫' },
  { to: '/activity', label: 'Activity', icon: '⚡' },
  { to: '/logs', label: 'Logs', icon: '≡' },
  { to: '/instances', label: 'Instances', icon: '⊞' },
  { to: '/health', label: 'Health', icon: '♥' },
  { to: '/metrics', label: 'Metrics', icon: '⊡' },
  { to: '/conflicts', label: 'Conflicts', icon: '⚖' },
  { to: '/providers', label: 'Providers', icon: '◈' },
  { to: '/agents', label: 'Agents', icon: '◉' },
  { to: '/sessions', label: 'Sessions', icon: '⊙' },
  { to: '/getting-started', label: 'Getting Started', icon: '◎' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

const SECTION_TITLES: Record<string, string> = {
  '/': 'Overview',
  '/overview': 'Overview',
  '/memory': 'Memory Explorer',
  '/archive': 'Archive',
  '/activity': 'Staff Activity',
  '/logs': 'Staff Logs',
  '/instances': 'Instances & Projects',
  '/health': 'Health & Diagnostics',
  '/metrics': 'Metrics',
  '/conflicts': 'Conflict Review',
  '/providers': 'Provider Manager',
  '/agents': 'Agent Registry',
  '/sessions': 'Sessions',
  '/getting-started': 'Getting Started',
  '/settings': 'Settings',
}

function getSectionTitle(pathname: string): string {
  if (SECTION_TITLES[pathname]) return SECTION_TITLES[pathname]
  const prefix = Object.keys(SECTION_TITLES).find((key) => key !== '/' && pathname.startsWith(key))
  return prefix ? (SECTION_TITLES[prefix] ?? 'Iranti') : 'Iranti'
}

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
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={loading}
        title={error ? `Instance API unavailable: ${error}` : undefined}
      >
        <span className={styles.instanceName}>
          {loading ? '…' : (activeInstance?.name ?? 'No instance')}
        </span>
        {activeInstance && <span className={styles.instancePort}>:{activeInstance.port}</span>}
        <span className={styles.instanceCaret} aria-hidden="true">▾</span>
      </button>

      {open && instances.length > 0 && (
        <div className={styles.instanceDropdown} role="listbox" aria-label="Select instance">
          {instances.map((instance) => (
            <button
              key={instance.id}
              role="option"
              aria-selected={instance.id === activeInstance?.id}
              className={`${styles.instanceOption} ${instance.id === activeInstance?.id ? styles.instanceOptionActive : ''}`}
              onClick={() => handleSelect(instance)}
            >
              <span className={styles.instanceStatusDot} data-status={instance.status} aria-label={instance.status} />
              <span className={styles.instanceOptionName}>{instance.name}</span>
              <span className={styles.instanceOptionPort}>{instance.host}:{instance.port}</span>
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

function ApiConnectionIndicator({ intervalMs }: { intervalMs: number }) {
  const status = useApiReachability(intervalMs)

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

function SetupBanner() {
  const { incompleteCount, isFullyConfigured, isLoading } = useSetupStatus()
  const [dismissed, setDismissed] = useState(false)

  if (isLoading || isFullyConfigured || dismissed || incompleteCount === 0) return null

  return (
    <div className={styles.setupBanner} role="alert" aria-live="polite">
      <span className={styles.setupBannerIcon} aria-hidden="true">◎</span>
      <span className={styles.setupBannerText}>
        Setup incomplete — {incompleteCount} step{incompleteCount !== 1 ? 's' : ''} remaining.{' '}
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

function ActivityDrawerSlot() {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`${styles.activityDrawerSlot} ${expanded ? styles.activityDrawerExpanded : ''}`} aria-label="Activity drawer">
      <button
        className={styles.activityDrawerToggle}
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls="activity-drawer-panel"
      >
        <span className={styles.activityDrawerLabel}>Activity</span>
        <span aria-hidden="true">{expanded ? '↓' : '↑'}</span>
      </button>

      <div id="activity-drawer-panel" className={styles.activityDrawerPanel} aria-hidden={!expanded}>
        <div className={styles.activityDrawerPlaceholder}>Staff activity drawer — wired in CP-T014</div>
      </div>
    </div>
  )
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { settings, updateSettings } = useSettings()
  const { open: isPaletteOpen, openPalette, closePalette } = useCommandPalette()

  const handleChatToggle = () => {
    updateSettings((current) => ({ ...current, chatPanelOpen: !current.chatPanelOpen }))
  }

  const handleChatClose = () => {
    updateSettings((current) => ({ ...current, chatPanelOpen: false }))
  }

  const toggleTheme = () => {
    updateSettings((current) => ({
      ...current,
      theme: current.theme === 'dark' ? 'light' : 'dark',
    }))
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        openPalette()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openPalette])

  const sectionTitle = getSectionTitle(location.pathname)
  const { incompleteCount, firstRunDetected, isLoading: setupStatusLoading } = useSetupStatus()
  const firstRunRedirectHandledRef = useRef(false)

  useEffect(() => {
    if (setupStatusLoading || firstRunRedirectHandledRef.current) return
    firstRunRedirectHandledRef.current = true
    if (firstRunDetected && location.pathname !== '/getting-started') {
      navigate('/getting-started', { replace: true })
    }
  }, [firstRunDetected, location.pathname, navigate, setupStatusLoading])

  const { toasts, addToast, dismissToast } = useToasts()
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
            addToast({
              severity: 'info',
              title: 'Iranti healthy',
              message: 'All health checks are passing.',
              autoDismissMs: 4000,
            })
          }
        }
      } catch {
        // Skip transient network failures.
      }
    }

    void pollHealth()
    const id = setInterval(() => { void pollHealth() }, settings.healthPollIntervalMs)
    return () => clearInterval(id)
  }, [addToast, settings.healthPollIntervalMs])

  const { goModeActive } = useViewNavigationShortcuts()

  const { data: installState } = useQuery<InstallStateResult>({
    queryKey: ['install-state'],
    queryFn: fetchInstallState,
    staleTime: 10_000,
  })
  const [wizardDismissed, setWizardDismissed] = useState(false)

  const handleWizardDismiss = useCallback(() => {
    setWizardDismissed(true)
  }, [])

  const showWizard = !wizardDismissed && shouldShowWizard(installState)

  if (showWizard) {
    return <SetupWizard onDismiss={handleWizardDismiss} />
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Main navigation">
        <Link className={styles.logo} to={settings.landingPage}>
          <IrantiMark size={22} />
          <span className={styles.logoText}>iranti</span>
        </Link>

        <InstanceSwitcher />

        <nav className={styles.nav} aria-label="Control plane sections">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `${styles.navItem}${isActive ? ` ${styles.navItemActive}` : ''}`}
            >
              <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
              <span className={styles.navLabel}>{item.label}</span>
              {item.to === '/getting-started' && incompleteCount > 0 && (
                <span className={styles.navBadge} aria-label={`${incompleteCount} steps remaining`}>
                  {incompleteCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <ApiConnectionIndicator intervalMs={settings.healthPollIntervalMs} />
          <div className={styles.sidebarFooterActions}>
            <ChatToggleButton isOpen={settings.chatPanelOpen} onClick={handleChatToggle} />
            <button
              className={styles.themeToggle}
              onClick={toggleTheme}
              aria-label={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${settings.theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <span aria-hidden="true">{settings.theme === 'dark' ? '◑' : '◐'}</span>
            </button>
          </div>
        </div>
      </aside>

      <div className={styles.mainArea}>
        {settings.showSetupBanner && <SetupBanner />}

        <header className={styles.topbar} aria-label={`${sectionTitle} section`}>
          <h1 className={styles.topbarTitle}>{sectionTitle}</h1>
          <div className={styles.topbarActions} id="topbar-actions" aria-live="polite" />
        </header>

        <main className={styles.content} id="main-content">
          <Outlet />
        </main>

        <ActivityDrawerSlot />
      </div>

      {isPaletteOpen && (
        <CommandPalette onClose={closePalette} onToggleDarkMode={toggleTheme} />
      )}

      <ChatPanel isOpen={settings.chatPanelOpen} onClose={handleChatClose} />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {goModeActive && (
        <div className={styles.goModeChip} role="status" aria-live="polite">
          <span aria-hidden="true">⌨</span> go mode — press a key
        </div>
      )}
    </div>
  )
}
