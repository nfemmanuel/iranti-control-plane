/* Iranti Control Plane — Provider Manager */
/* Route: /providers */
/* CP-T046: Standalone provider view, warning threshold, detail panel */

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { ProvidersResponse, ProviderStatus, ProviderModelsResponse } from '../../api/types'
import styles from './ProviderManager.module.css'
import { Spinner } from '../ui/Spinner'

// ---------------------------------------------------------------------------
// localStorage helpers for warning thresholds
// ---------------------------------------------------------------------------

const THRESHOLDS_KEY = 'iranti_cp_provider_thresholds'

function loadThresholds(): Record<string, number> {
  try {
    const raw = localStorage.getItem(THRESHOLDS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, number>
    }
  } catch {
    // corrupt storage — reset
  }
  return {}
}

function saveThresholds(thresholds: Record<string, number>): void {
  try {
    localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(thresholds))
  } catch {
    // storage unavailable — non-fatal
  }
}

// ---------------------------------------------------------------------------
// In-session reachability history (last 3 checks per provider)
// ---------------------------------------------------------------------------

type ReachabilityHistory = Record<string, Array<{ reachable: boolean; checkedAt: string }>>

function recordHistory(prev: ReachabilityHistory, providers: ProviderStatus[]): ReachabilityHistory {
  const next = { ...prev }
  for (const p of providers) {
    const existing = prev[p.id] ?? []
    const entry = { reachable: p.reachable, checkedAt: p.lastChecked }
    // Avoid duplicate timestamps
    if (existing.length > 0 && existing[existing.length - 1]?.checkedAt === p.lastChecked) {
      continue
    }
    next[p.id] = [...existing, entry].slice(-3) // keep last 3
  }
  return next
}

// ---------------------------------------------------------------------------
// Provider icons
// ---------------------------------------------------------------------------

function providerIcon(id: string): string {
  switch (id) {
    case 'anthropic': return 'A'
    case 'openai':    return 'OA'
    case 'ollama':    return 'OL'
    case 'together':  return 'T'
    case 'groq':      return 'G'
    default:          return id.slice(0, 2).toUpperCase()
  }
}

// ---------------------------------------------------------------------------
// Reachability badge
// ---------------------------------------------------------------------------

type ReachabilityState = 'connected' | 'unreachable' | 'not_configured'

function resolveReachabilityState(p: ProviderStatus): ReachabilityState {
  if (!p.keyPresent) return 'not_configured'
  return p.reachable ? 'connected' : 'unreachable'
}

function ReachabilityBadge({ state }: { state: ReachabilityState }) {
  const labels: Record<ReachabilityState, string> = {
    connected:      'Connected',
    unreachable:    'Unreachable',
    not_configured: 'Not configured',
  }
  const classMap: Record<ReachabilityState, string> = {
    connected:      styles.badgeConnected,
    unreachable:    styles.badgeUnreachable,
    not_configured: styles.badgeNotConfigured,
  }
  return (
    <span className={`${styles.badge} ${classMap[state]}`} aria-label={`Reachability: ${labels[state]}`}>
      {labels[state]}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Quota-supported providers
// ---------------------------------------------------------------------------

// Providers where balance threshold is meaningful (supported:true from quota endpoint)
// Anthropic is permanently supported:false — threshold hidden for it.
// We compute this frontend-side rather than fetching quota for each provider on load.
// Instead: show the threshold field for together/openai (may be supported), hide for anthropic.
const QUOTA_SUPPORTED_PROVIDERS = new Set(['openai', 'together'])

// ---------------------------------------------------------------------------
// Model list (full — no truncation for detail panel)
// ---------------------------------------------------------------------------

function FullModelList({ providerId, reachable }: { providerId: string; reachable: boolean }) {
  const { data, isLoading, error } = useQuery<ProviderModelsResponse, Error>({
    queryKey: ['provider-models', providerId],
    queryFn: () => apiFetch<ProviderModelsResponse>(`/providers/${providerId}/models`),
    staleTime: 5 * 60 * 1000,
    enabled: reachable || providerId === 'anthropic',
  })

  if (isLoading) {
    return <p className={styles.modelsLoading}>Loading models…</p>
  }

  if (error || !data) {
    return <p className={styles.modelsError}>Could not load models</p>
  }

  if (data.models.length === 0) {
    return <p className={styles.modelsEmpty}>No models available</p>
  }

  const sourceLabel =
    data.source === 'live' ? 'live' :
    data.source === 'fallback' ? 'fallback list' : 'static list'

  return (
    <div className={styles.fullModelList}>
      <div className={styles.modelListHeader}>
        <span className={styles.modelCount}>{data.models.length} model{data.models.length !== 1 ? 's' : ''}</span>
        <span className={styles.modelSource}>via {sourceLabel}</span>
      </div>
      <ul className={styles.modelItems} aria-label={`Models for ${providerId}`}>
        {data.models.map((m) => (
          <li key={m.id} className={styles.modelItem}>
            <span className={styles.modelId}>{m.id}</span>
            {m.context > 0 && (
              <span className={styles.modelContext}>{(m.context / 1000).toFixed(0)}k ctx</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provider Detail Panel (right-side)
// ---------------------------------------------------------------------------

interface DetailPanelProps {
  provider: ProviderStatus
  history: Array<{ reachable: boolean; checkedAt: string }>
  threshold: number | undefined
  onThresholdChange: (providerId: string, value: number) => void
  onRefresh: () => void
  isRefreshing: boolean
}

function DetailPanel({
  provider,
  history,
  threshold,
  onThresholdChange,
  onRefresh,
  isRefreshing,
}: DetailPanelProps) {
  const state = resolveReachabilityState(provider)
  const showThreshold = QUOTA_SUPPORTED_PROVIDERS.has(provider.id)
  const [thresholdInput, setThresholdInput] = useState<string>(
    threshold !== undefined ? String(threshold) : '5.00'
  )

  // Sync input if threshold prop changes externally
  useEffect(() => {
    if (threshold !== undefined) {
      setThresholdInput(String(threshold))
    }
  }, [threshold])

  const handleThresholdBlur = () => {
    const parsed = parseFloat(thresholdInput)
    if (!isNaN(parsed) && parsed >= 0) {
      onThresholdChange(provider.id, parsed)
    } else {
      // reset to stored or default
      setThresholdInput(threshold !== undefined ? String(threshold) : '5.00')
    }
  }

  const handleThresholdKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  // Provider-specific quota note
  const quotaNote = (() => {
    if (provider.id === 'anthropic') {
      return 'Anthropic does not expose credits via API. Check your Anthropic Console for usage.'
    }
    if (provider.id === 'openai') {
      return 'Live balance requires org:read scope. Check the OpenAI Usage dashboard directly.'
    }
    if (provider.id === 'groq') {
      return 'Groq exposes rate limit headers only — no persistent balance available.'
    }
    return null
  })()

  return (
    <div className={styles.detailPanel} aria-label={`${provider.name} detail panel`}>
      <div className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <span className={styles.detailIcon} aria-hidden="true">{providerIcon(provider.id)}</span>
          <div className={styles.detailTitleMeta}>
            <span className={styles.detailProviderName}>{provider.name}</span>
            <span className={styles.detailEnvVar}>{provider.keyEnvVar}</span>
          </div>
          <div className={styles.detailBadges}>
            {provider.isDefault && (
              <span className={styles.defaultBadge} aria-label="Default provider">Default</span>
            )}
            <ReachabilityBadge state={state} />
          </div>
        </div>

        <button
          className={`${styles.refreshBtn} ${isRefreshing ? styles.refreshBtnSpinning : ''}`}
          onClick={onRefresh}
          disabled={isRefreshing}
          type="button"
          aria-label="Refresh provider status"
          title="Refresh now (bypasses 1-min cache)"
        >
          ↺ Refresh now
        </button>
      </div>

      {/* Key info */}
      <section className={styles.detailSection}>
        <h3 className={styles.detailSectionTitle}>API Key</h3>
        {provider.keyPresent && provider.keyMasked ? (
          <div className={styles.keyRow}>
            <span className={styles.keyLabel}>key</span>
            <code className={styles.keyValue}>{provider.keyMasked}</code>
            <span className={styles.keyPresent}>✓ Present</span>
          </div>
        ) : (
          <p className={styles.keyAbsent}>No key configured — set <code>{provider.keyEnvVar}</code> in <code>.env.iranti</code>.</p>
        )}
      </section>

      {/* Quota / balance */}
      <section className={styles.detailSection}>
        <h3 className={styles.detailSectionTitle}>Balance &amp; Quota</h3>
        {quotaNote ? (
          <p className={styles.quotaNote}>{quotaNote}</p>
        ) : (
          <p className={styles.quotaNote}>Balance data not available — check your provider dashboard.</p>
        )}

        {/* Warning threshold — only for quota-capable providers */}
        {showThreshold && (
          <div className={styles.thresholdRow}>
            <label htmlFor={`threshold-${provider.id}`} className={styles.thresholdLabel}>
              Warn when balance below
            </label>
            <div className={styles.thresholdInputGroup}>
              <span className={styles.thresholdCurrency}>$</span>
              <input
                id={`threshold-${provider.id}`}
                type="number"
                min="0"
                step="0.01"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                onBlur={handleThresholdBlur}
                onKeyDown={handleThresholdKey}
                className={styles.thresholdInput}
                aria-label="Warning threshold in USD"
              />
              <span className={styles.thresholdUnit}>USD</span>
            </div>
            <p className={styles.thresholdNote}>
              Balance data not available — threshold will apply when live balance is supported.
            </p>
          </div>
        )}
      </section>

      {/* Reachability history */}
      {history.length > 0 && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Recent Reachability</h3>
          <ul className={styles.historyList} aria-label="Recent reachability checks">
            {[...history].reverse().map((entry, i) => (
              <li key={i} className={styles.historyItem}>
                <span
                  className={entry.reachable ? styles.historyDotOk : styles.historyDotFail}
                  aria-hidden="true"
                >●</span>
                <span className={styles.historyState}>
                  {entry.reachable ? 'Connected' : 'Unreachable'}
                </span>
                <span className={styles.historyTime}>
                  {new Date(entry.checkedAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Model list — full, untruncated */}
      {(state === 'connected' || provider.id === 'anthropic') && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Models</h3>
          {provider.id === 'groq' && (
            <p className={styles.groqRateLimitNote}>
              Rate limit snapshot (from last check) — reflects rate limit state at the time of the last API check, not a persistent balance.
            </p>
          )}
          <FullModelList providerId={provider.id} reachable={provider.reachable} />
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provider list card (left panel)
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  provider: ProviderStatus
  isSelected: boolean
  onClick: () => void
}

function ProviderCard({ provider, isSelected, onClick }: ProviderCardProps) {
  const state = resolveReachabilityState(provider)

  const cardStateClass =
    state === 'connected'   ? styles.cardConnected :
    state === 'unreachable' ? styles.cardUnreachable :
                              styles.cardNotConfigured

  return (
    <button
      type="button"
      className={`${styles.card} ${cardStateClass} ${isSelected ? styles.cardSelected : ''}`}
      onClick={onClick}
      aria-pressed={isSelected}
      aria-label={`${provider.name} provider — ${state.replace('_', ' ')}`}
    >
      <div className={styles.cardHeader}>
        <span className={styles.providerIcon} aria-hidden="true">
          {providerIcon(provider.id)}
        </span>
        <div className={styles.providerMeta}>
          <div className={styles.providerNameRow}>
            <span className={styles.providerName}>{provider.name}</span>
            {provider.isDefault && (
              <span className={styles.defaultBadge} aria-label="Default provider">Default</span>
            )}
          </div>
          <span className={styles.providerEnvVar}>{provider.keyEnvVar}</span>
        </div>
        <div className={styles.cardBadges}>
          <span
            className={provider.keyPresent ? styles.keyPresent : styles.keyAbsent}
            aria-label={provider.keyPresent ? 'API key present' : 'API key absent'}
          >
            {provider.keyPresent ? '✓ Key set' : '✗ No key'}
          </span>
          <ReachabilityBadge state={state} />
        </div>
      </div>

      {provider.keyPresent && provider.keyMasked && (
        <div className={styles.keyMasked} aria-label="Masked API key">
          <span className={styles.keyMaskedLabel}>key</span>
          <code className={styles.keyMaskedValue}>{provider.keyMasked}</code>
        </div>
      )}

      <div className={styles.cardFooter}>
        <span className={styles.lastChecked}>
          Checked: {new Date(provider.lastChecked).toLocaleTimeString()}
        </span>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main component: ProviderManager
// ---------------------------------------------------------------------------

export function ProviderManager() {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [thresholds, setThresholds] = useState<Record<string, number>>(loadThresholds)
  const [reachabilityHistory, setReachabilityHistory] = useState<ReachabilityHistory>({})
  const historyRef = useRef(reachabilityHistory)
  historyRef.current = reachabilityHistory

  const { data, isLoading, error, refetch, isFetching } = useQuery<ProvidersResponse, Error>({
    queryKey: ['providers'],
    queryFn: () => apiFetch<ProvidersResponse>('/providers'),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })

  // Record reachability history whenever data changes
  useEffect(() => {
    if (data?.providers) {
      setReachabilityHistory(prev => recordHistory(prev, data.providers))
    }
  }, [data])

  const handleThresholdChange = (providerId: string, value: number) => {
    setThresholds(prev => {
      const next = { ...prev, [providerId]: value }
      saveThresholds(next)
      return next
    })
  }

  const handleRefreshAll = () => void refetch()

  const handleDetailRefresh = () => {
    // Invalidates the reachability cache on next call via forced refetch
    void refetch()
  }

  const selectedProvider = data?.providers.find(p => p.id === selectedProviderId) ?? null

  // Auto-select first configured provider on load
  useEffect(() => {
    if (!selectedProviderId && data?.providers) {
      const first = data.providers.find(p => p.keyPresent) ?? data.providers[0]
      if (first) setSelectedProviderId(first.id)
    }
  }, [data, selectedProviderId])

  if (!isLoading && error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorState}>
          <span aria-hidden="true">✗</span> Could not load providers: {error.message}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Page header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <span className={styles.pageIcon} aria-hidden="true">◈</span>
          <div>
            <h1 className={styles.pageTitle}>Providers</h1>
            <p className={styles.pageSubtitle}>
              API key presence, reachability, models, and warning thresholds
            </p>
          </div>
        </div>
        <button
          className={`${styles.refreshAllBtn} ${isFetching ? styles.refreshBtnSpinning : ''}`}
          onClick={handleRefreshAll}
          disabled={isFetching}
          type="button"
          aria-label="Refresh all providers"
        >
          ↺ Refresh all
        </button>
      </div>

      {/* CP-T058 AC-1 (M4) — read-only guidance note */}
      <div className={styles.readOnlyNote} role="note" aria-label="Provider configuration guidance">
        <span className={styles.readOnlyNoteIcon} aria-hidden="true">ℹ</span>
        <p className={styles.readOnlyNoteText}>
          Provider and model configuration is read-only. To change providers or models, run{' '}
          <code className={styles.readOnlyNoteCode}>iranti setup</code> in your project directory.
        </p>
      </div>

      {/* Main content: provider list + detail panel */}
      <div className={styles.layout}>
        {/* Left: provider list */}
        <div className={styles.listPane}>
          {isLoading && (
            <div className={styles.loadingState} aria-busy="true" aria-label="Loading providers">
              <Spinner size="md" label="Loading providers" />
            </div>
          )}

          {!isLoading && data && data.providers.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon} aria-hidden="true">◈</span>
              <p className={styles.emptyTitle}>No providers detected</p>
              <p className={styles.emptyBody}>
                Set <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>,{' '}
                <code>TOGETHER_API_KEY</code>, <code>GROQ_API_KEY</code>, or{' '}
                <code>OLLAMA_BASE_URL</code> in your <code>.env.iranti</code> file.
              </p>
            </div>
          )}

          {!isLoading && data && data.providers.map(p => (
            <ProviderCard
              key={p.id}
              provider={p}
              isSelected={p.id === selectedProviderId}
              onClick={() => setSelectedProviderId(p.id)}
            />
          ))}
        </div>

        {/* Right: detail panel */}
        <div className={styles.detailPane}>
          {!selectedProvider && !isLoading && (
            <div className={styles.detailEmpty}>
              <span className={styles.detailEmptyIcon} aria-hidden="true">◈</span>
              <p className={styles.detailEmptyText}>Select a provider to view details</p>
            </div>
          )}

          {selectedProvider && (
            <DetailPanel
              provider={selectedProvider}
              history={reachabilityHistory[selectedProvider.id] ?? []}
              threshold={thresholds[selectedProvider.id]}
              onThresholdChange={handleThresholdChange}
              onRefresh={handleDetailRefresh}
              isRefreshing={isFetching}
            />
          )}
        </div>
      </div>
    </div>
  )
}
