/* Iranti Control Plane — Provider Status Section */
/* Rendered inside HealthDashboard below system health checks */
/* CP-T034: Read-only provider key presence + reachability + model list */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { ProvidersResponse, ProviderStatus, ProviderModelsResponse } from '../../api/types'
import styles from './ProviderStatus.module.css'

// ---------------------------------------------------------------------------
// Provider icons — text-based to avoid external deps
// ---------------------------------------------------------------------------

function providerIcon(id: string): string {
  switch (id) {
    case 'anthropic': return 'A'
    case 'openai':    return 'OA'
    case 'ollama':    return 'OL'
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
// Model list panel (lazy-loaded per provider card)
// ---------------------------------------------------------------------------

function ModelList({ providerId, reachable }: { providerId: string; reachable: boolean }) {
  const { data, isLoading, error } = useQuery<ProviderModelsResponse, Error>({
    queryKey: ['provider-models', providerId],
    queryFn: () => apiFetch<ProviderModelsResponse>(`/providers/${providerId}/models`),
    staleTime: 5 * 60 * 1000,
    enabled: reachable || providerId === 'anthropic', // Anthropic always static
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

  const sourceLabel = data.source === 'live' ? 'live' : data.source === 'fallback' ? 'fallback list' : 'static list'

  return (
    <div className={styles.modelList}>
      <div className={styles.modelListHeader}>
        <span className={styles.modelCount}>{data.models.length} model{data.models.length !== 1 ? 's' : ''}</span>
        <span className={styles.modelSource}>via {sourceLabel}</span>
      </div>
      <ul className={styles.modelItems} aria-label={`Models for ${providerId}`}>
        {data.models.slice(0, 8).map((m) => (
          <li key={m.id} className={styles.modelItem}>
            <span className={styles.modelId}>{m.id}</span>
            {m.context > 0 && (
              <span className={styles.modelContext}>{(m.context / 1000).toFixed(0)}k ctx</span>
            )}
          </li>
        ))}
        {data.models.length > 8 && (
          <li className={styles.modelItemMore}>+{data.models.length - 8} more</li>
        )}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provider card
// ---------------------------------------------------------------------------

function ProviderCard({ provider }: { provider: ProviderStatus }) {
  const [expanded, setExpanded] = useState(false)
  const state = resolveReachabilityState(provider)

  const cardStateClass =
    state === 'connected'      ? styles.cardConnected :
    state === 'unreachable'    ? styles.cardUnreachable :
    /* not_configured */         styles.cardNotConfigured

  return (
    <div className={`${styles.card} ${cardStateClass}`} aria-label={`${provider.name} provider status`}>
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
        {(state === 'connected' || provider.id === 'anthropic') && (
          <button
            className={styles.expandBtn}
            onClick={() => setExpanded((v) => !v)}
            type="button"
            aria-expanded={expanded}
            aria-controls={`models-${provider.id}`}
          >
            {expanded ? 'Hide models' : 'Show models'}
          </button>
        )}
      </div>

      {expanded && (
        <div id={`models-${provider.id}`} className={styles.modelsPanel}>
          <ModelList providerId={provider.id} reachable={provider.reachable} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon} aria-hidden="true">⬡</span>
      <p className={styles.emptyTitle}>No providers configured</p>
      <p className={styles.emptyBody}>
        Set <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>, or{' '}
        <code>OLLAMA_BASE_URL</code> in your <code>.env.iranti</code> file to connect a provider.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export function ProviderStatusSection() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<ProvidersResponse, Error>({
    queryKey: ['providers'],
    queryFn: () => apiFetch<ProvidersResponse>('/providers'),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })

  const handleRefresh = () => void refetch()

  const configuredProviders = data?.providers.filter((p) => p.keyPresent) ?? []

  return (
    <section className={styles.section} aria-labelledby="providers-heading">
      <div className={styles.sectionHeader}>
        <h2 id="providers-heading" className={styles.sectionTitle}>Providers</h2>
        {data && (
          <span className={styles.sectionMeta}>
            {configuredProviders.length} configured
          </span>
        )}
        <button
          className={`${styles.refreshBtn} ${isFetching ? styles.refreshBtnSpinning : ''}`}
          onClick={handleRefresh}
          disabled={isFetching}
          type="button"
          aria-label="Refresh provider status"
          title="Refresh provider reachability"
        >
          ↺
        </button>
      </div>

      {isLoading && (
        <p className={styles.loadingText} aria-busy="true">Checking providers…</p>
      )}

      {!isLoading && error && (
        <div className={styles.errorState}>
          <span aria-hidden="true">✗</span> Could not load provider status: {error.message}
        </div>
      )}

      {!isLoading && data && configuredProviders.length === 0 && <EmptyState />}

      {!isLoading && data && data.providers.length > 0 && (
        <div className={styles.grid}>
          {data.providers.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      )}
    </section>
  )
}
