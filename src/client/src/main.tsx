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
import { InstanceManager } from './components/instances/InstanceManager'
import { HealthDashboard } from './components/health/HealthDashboard'
import { InstanceProvider, useInstanceContext } from './hooks/useInstanceContext'
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

// Top-level loading boundary: shows LoadingPage while instance context initializes.
// Consumes InstanceProvider's loading flag — must be rendered inside InstanceProvider.
function AppLoadingBoundary({ children }: { children: ReactNode }) {
  const { loading } = useInstanceContext()
  if (loading) return <LoadingPage />
  return <>{children}</>
}

// Placeholder for routes not yet implemented in Phase 1
function PlaceholderView({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: 'var(--color-text-tertiary)',
      fontSize: '13px',
      fontFamily: 'var(--font-mono)',
    }}>
      {label} — coming soon
    </div>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <InstanceProvider>
        <AppLoadingBoundary>
          <BrowserRouter basename="/control-plane">
            <Routes>
              <Route path="/" element={<AppShell />}>
                <Route index element={<Navigate to="/health" replace />} />
                <Route path="memory" element={<MemoryExplorer />} />
                <Route path="memory/:entityType/:entityId" element={<EntityDetail />} />
                <Route path="memory/:entityType/:entityId/:key" element={<TemporalHistory />} />
                <Route path="archive" element={<ArchiveExplorer />} />
                <Route path="activity" element={<ActivityStream />} />
                <Route path="instances" element={<InstanceManager />} />
                <Route path="instances/:id" element={<InstanceManager />} />
                <Route path="health" element={<HealthDashboard />} />
                <Route path="settings" element={<PlaceholderView label="Settings — Phase 2" />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AppLoadingBoundary>
      </InstanceProvider>
    </QueryClientProvider>
  </StrictMode>
)
