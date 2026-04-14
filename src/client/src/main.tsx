/**
 * main.tsx — React application entry point for the Iranti Control Plane UI.
 *
 * Mounts the React tree inside <div id="root">. Wraps the app in:
 *   - React StrictMode
 *   - QueryClientProvider (React Query)
 *   - SettingsProvider (localStorage user preferences)
 *   - InstanceProvider (selected Iranti instance)
 *   - BrowserRouter (basename /control-plane)
 *
 * Route layout: all views live under AppShell, which provides the nav sidebar.
 */

import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './components/shell/AppShell'
import { MemoryExplorer } from './components/memory/MemoryExplorer'
import { ArchiveExplorer } from './components/memory/ArchiveExplorer'
import { EntityDetail } from './components/memory/EntityDetail'
import { TemporalHistory } from './components/memory/TemporalHistory'
import { ActivityStream } from './components/stream/ActivityStream'
import { StaffLogs } from './components/logs/StaffLogs'
import { InstanceManager } from './components/instances/InstanceManager'
import { HealthDashboard } from './components/health/HealthDashboard'
import { GettingStarted } from './components/onboarding/GettingStarted'
import { ConflictReview } from './components/conflicts/ConflictReview'
import { ProviderManager } from './components/providers/ProviderManager'
import { AgentRegistry } from './components/agents/AgentRegistry'
import { SessionsView } from './components/sessions/SessionsView'
import { FleetLedgerView } from './components/sessions/FleetLedgerView'
import { MetricsDashboard } from './components/metrics/MetricsDashboard'
import { OverviewDashboard } from './components/overview/OverviewDashboard'
import { SettingsPage } from './components/settings/SettingsPage'
import { RulesManager } from './components/rules/RulesManager'
import { InstanceProvider, useInstanceContext } from './hooks/useInstanceContext'
import { SettingsProvider, useSettings } from './hooks/useSettings'
import { LoadingPage } from './components/ui/LoadingPage'
import './styles/tokens.css'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

function AppLoadingBoundary({ children }: { children: ReactNode }) {
  const { loading } = useInstanceContext()
  if (loading) return <LoadingPage />
  return <>{children}</>
}

function RootRedirect() {
  const { settings } = useSettings()
  return <Navigate to={settings.landingPage} replace />
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsProvider>
        <InstanceProvider>
          <AppLoadingBoundary>
            <BrowserRouter basename="/control-plane">
              <Routes>
                <Route path="/" element={<AppShell />}>
                  <Route index element={<RootRedirect />} />
                  <Route path="overview" element={<OverviewDashboard />} />
                  <Route path="memory" element={<MemoryExplorer />} />
                  <Route path="memory/:entityType/:entityId" element={<EntityDetail />} />
                  <Route path="memory/:entityType/:entityId/:key" element={<TemporalHistory />} />
                  <Route path="archive" element={<ArchiveExplorer />} />
                  <Route path="activity" element={<ActivityStream />} />
                  <Route path="logs" element={<StaffLogs />} />
                  <Route path="instances" element={<InstanceManager />} />
                  <Route path="instances/:id" element={<InstanceManager />} />
                  <Route path="health" element={<HealthDashboard />} />
                  <Route path="metrics" element={<MetricsDashboard />} />
                  <Route path="getting-started" element={<GettingStarted />} />
                  <Route path="conflicts" element={<ConflictReview />} />
                  <Route path="providers" element={<ProviderManager />} />
                  <Route path="agents" element={<AgentRegistry />} />
                  <Route path="sessions" element={<SessionsView />} />
                  <Route path="fleet-ledger" element={<FleetLedgerView />} />
                  <Route path="rules" element={<RulesManager />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AppLoadingBoundary>
        </InstanceProvider>
      </SettingsProvider>
    </QueryClientProvider>
  </StrictMode>,
)
