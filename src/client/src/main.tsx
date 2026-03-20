import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './components/shell/AppShell'
import { MemoryExplorer } from './components/memory/MemoryExplorer'
import { ArchiveExplorer } from './components/memory/ArchiveExplorer'
import { ActivityStream } from './components/stream/ActivityStream'
import { InstanceManager } from './components/instances/InstanceManager'
import { HealthDashboard } from './components/health/HealthDashboard'
import { InstanceProvider } from './hooks/useInstanceContext'
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
        <BrowserRouter basename="/control-plane">
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<Navigate to="/health" replace />} />
              <Route path="memory" element={<MemoryExplorer />} />
              <Route path="memory/:entityType/:entityId" element={<PlaceholderView label="Entity Detail" />} />
              <Route path="memory/:entityType/:entityId/:key" element={<PlaceholderView label="Temporal History" />} />
              <Route path="archive" element={<ArchiveExplorer />} />
              <Route path="activity" element={<ActivityStream />} />
              <Route path="instances" element={<InstanceManager />} />
              <Route path="instances/:id" element={<InstanceManager />} />
              <Route path="health" element={<HealthDashboard />} />
              <Route path="settings" element={<PlaceholderView label="Settings — Phase 2" />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </InstanceProvider>
    </QueryClientProvider>
  </StrictMode>
)
