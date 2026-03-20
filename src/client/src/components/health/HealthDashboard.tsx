/* Iranti Control Plane — Health & Diagnostics Dashboard */
/* Route: /health */
/* CP-T016 — All 10 health checks, auto-refresh, remediation guidance */

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { HealthResponse, HealthCheck } from '../../api/types'
import { getRemediation } from './remediationText'
import styles from './HealthDashboard.module.css'

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const REFRESH_INTERVAL_MS = 30_000

/* ------------------------------------------------------------------ */
/*  Human-readable check name mapping                                  */
/* ------------------------------------------------------------------ */

const CHECK_LABELS: Record<string, string> = {
  db_reachability: 'Database Connection',
  db_schema_version: 'Schema Version',
  vector_backend: 'Vector Backend (pgvector)',
  anthropic_key: 'Anthropic API Key',
  openai_key: 'OpenAI API Key',
  default_provider_configured: 'Default Provider',
  mcp_integration: 'MCP Integration',
  claude_md_integration: 'CLAUDE.md',
  runtime_version: 'Iranti Version',
  staff_events_table: 'Staff Events Table',
}

function getCheckLabel(name: string): string {
  return CHECK_LABELS[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/* ------------------------------------------------------------------ */
/*  Status sort order: error first, warn second, ok last               */
/* ------------------------------------------------------------------ */

function statusSortKey(status: HealthCheck['status']): number {
  if (status === 'error') return 0
  if (status === 'warn') return 1
  return 2
}

/* ------------------------------------------------------------------ */
/*  Relative time helper                                                */
/* ------------------------------------------------------------------ */

function secondsAgo(isoTimestamp: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000))
}

function formatSecondsAgo(secs: number): string {
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs} seconds ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`
  const hours = Math.floor(mins / 60)
  return `${hours} hour${hours !== 1 ? 's' : ''} ago`
}

/* ------------------------------------------------------------------ */
/*  Overall status badge                                                */
/* ------------------------------------------------------------------ */

function OverallBadge({ overall }: { overall: HealthResponse['overall'] }) {
  const classMap: Record<HealthResponse['overall'], string> = {
    healthy: styles.badgeHealthy,
    degraded: styles.badgeDegraded,
    error: styles.badgeError,
  }
  const labelMap: Record<HealthResponse['overall'], string> = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    error: 'Error',
  }
  return (
    <span className={`${styles.overallBadge} ${classMap[overall]}`}>
      {labelMap[overall]}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Countdown ring / progress bar                                       */
/* ------------------------------------------------------------------ */

function RefreshCountdown({ checkedAt, intervalMs }: { checkedAt: string; intervalMs: number }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const tick = () => setElapsed(Math.min(Date.now() - new Date(checkedAt).getTime(), intervalMs))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [checkedAt, intervalMs])

  const progress = Math.min(elapsed / intervalMs, 1)
  const secondsLeft = Math.max(0, Math.round((intervalMs - elapsed) / 1000))

  return (
    <div className={styles.countdown} title={`Refreshing in ${secondsLeft}s`}>
      <div className={styles.countdownBar} style={{ width: `${progress * 100}%` }} />
      <span className={styles.countdownLabel}>Refreshes in {secondsLeft}s</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Health check card                                                   */
/* ------------------------------------------------------------------ */

function HealthCard({ check }: { check: HealthCheck }) {
  const remediation = getRemediation(check.name, check.status)
  const label = getCheckLabel(check.name)

  const iconMap: Record<HealthCheck['status'], string> = {
    ok: '✓',
    warn: '⚠',
    error: '✗',
  }
  const iconClassMap: Record<HealthCheck['status'], string> = {
    ok: styles.iconOk,
    warn: styles.iconWarn,
    error: styles.iconError,
  }
  const cardClassMap: Record<HealthCheck['status'], string> = {
    ok: styles.cardOk,
    warn: styles.cardWarn,
    error: styles.cardError,
  }

  return (
    <div className={`${styles.card} ${cardClassMap[check.status]}`} aria-label={`${label}: ${check.status}`}>
      <div className={styles.cardHeader}>
        <span className={`${styles.statusIcon} ${iconClassMap[check.status]}`} aria-label={check.status}>
          {iconMap[check.status]}
        </span>
        <span className={styles.cardName}>{label}</span>
      </div>
      <p className={styles.cardMessage}>{check.message}</p>

      {check.detail && Object.keys(check.detail).length > 0 && (
        <dl className={styles.cardDetail}>
          {Object.entries(check.detail).map(([k, v]) => (
            <div key={k} className={styles.cardDetailRow}>
              <dt className={styles.cardDetailKey}>{k}</dt>
              <dd className={styles.cardDetailVal}>{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {remediation && (
        <div className={styles.remediation}>
          <span className={styles.remediationLabel}>How to fix</span>
          <p className={styles.remediationText}>{remediation}</p>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                    */
/* ------------------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div className={styles.grid} aria-busy="true" aria-label="Loading health checks">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={`${styles.card} ${styles.cardSkeleton}`}>
          <div className={styles.cardHeader}>
            <span className={styles.skeletonDot} aria-hidden="true" />
            <span className={styles.skeleton} style={{ width: '140px', height: '14px' }} />
          </div>
          <span className={styles.skeleton} style={{ width: '200px', height: '12px', marginTop: '8px' }} />
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function HealthDashboard() {
  const [refreshingManual, setRefreshingManual] = useState(false)
  const manualRefetchRef = useRef<(() => Promise<unknown>) | null>(null)

  const { data, isLoading, error, refetch, isFetching } = useQuery<HealthResponse, Error>({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
    refetchInterval: REFRESH_INTERVAL_MS,
    staleTime: 0,
  })

  manualRefetchRef.current = refetch

  const handleManualRefresh = async () => {
    setRefreshingManual(true)
    try {
      await manualRefetchRef.current?.()
    } finally {
      setRefreshingManual(false)
    }
  }

  // Sort checks: error first, warn second, ok last
  const sortedChecks = data
    ? [...data.checks].sort((a, b) => statusSortKey(a.status) - statusSortKey(b.status))
    : []

  const isRefreshing = isFetching || refreshingManual

  // Error state: health endpoint itself failed (503)
  if (!isLoading && error) {
    return (
      <div className={styles.page}>
        <div className={styles.unavailableState}>
          <span className={styles.unavailableIcon}>✗</span>
          <h2 className={styles.unavailableTitle}>Diagnostics unavailable</h2>
          <p className={styles.unavailableBody}>
            The health endpoint returned an error. Iranti may not be running, or the control plane server is unreachable.
          </p>
          <p className={styles.unavailableDetail}>{error.message}</p>
          <button
            className={styles.retryBtn}
            onClick={() => void handleManualRefresh()}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {data && <OverallBadge overall={data.overall} />}
          {isLoading && <span className={styles.overallLoading}>Checking…</span>}
          <div className={styles.headerMeta}>
            {data && (
              <span className={styles.checkedAt}>
                {isRefreshing
                  ? 'Refreshing…'
                  : `Last checked: ${formatSecondsAgo(secondsAgo(data.checkedAt))}`
                }
              </span>
            )}
          </div>
        </div>
        <div className={styles.headerRight}>
          {data && (
            <RefreshCountdown checkedAt={data.checkedAt} intervalMs={REFRESH_INTERVAL_MS} />
          )}
          <button
            className={`${styles.refreshBtn} ${isRefreshing ? styles.refreshBtnSpinning : ''}`}
            onClick={() => void handleManualRefresh()}
            disabled={isRefreshing}
            type="button"
            aria-label="Refresh health checks"
          >
            ↺
          </button>
        </div>
      </div>

      {/* Setup guidance banner for new users in error state */}
      {data?.overall === 'error' && (
        <div className={styles.setupBanner}>
          <span className={styles.setupBannerIcon}>⚠</span>
          <div>
            <strong>Looks like Iranti needs some setup.</strong>
            {' '}Check the items below and follow the remediation steps to get started.
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && <LoadingSkeleton />}

      {/* Health check cards */}
      {!isLoading && data && (
        <div className={styles.grid}>
          {sortedChecks.map(check => (
            <HealthCard key={check.name} check={check} />
          ))}
        </div>
      )}
    </div>
  )
}
