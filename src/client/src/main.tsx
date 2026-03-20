import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from './components/shell/AppShell'
import { MemoryExplorer } from './components/memory/MemoryExplorer'
import { InstanceProvider } from './hooks/useInstanceContext'
import './styles/tokens.css'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
    },
  },
})

// Placeholder views for routes not yet implemented
// These will be replaced by CP-T013–CP-T016 component implementations
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
              <Route index element={<Navigate to="/memory" replace />} />
              <Route path="memory" element={<MemoryExplorer />} />
              <Route path="memory/:entityType/:entityId" element={<PlaceholderView label="Entity Detail" />} />
              <Route path="memory/:entityType/:entityId/:key" element={<PlaceholderView label="Temporal History" />} />
              <Route path="archive" element={<PlaceholderView label="Archive — CP-T013" />} />
              <Route path="activity" element={<PlaceholderView label="Staff Activity — CP-T014" />} />
              <Route path="instances" element={<PlaceholderView label="Instances — CP-T015" />} />
              <Route path="instances/:id" element={<PlaceholderView label="Instance Detail — CP-T015" />} />
              <Route path="health" element={<PlaceholderView label="Health & Diagnostics — CP-T016" />} />
              <Route path="settings" element={<PlaceholderView label="Settings — Phase 2" />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </InstanceProvider>
    </QueryClientProvider>
  </StrictMode>
)
