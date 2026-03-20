/* Iranti Control Plane — Health & Diagnostics Dashboard */
/* Route: /health */
/* CP-T016 — All 10 health checks, auto-refresh, remediation guidance */
/* CP-T028 — Four-tier severity taxonomy: CRITICAL / WARNING / INFO / HEALTHY */

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { HealthResponse, HealthCheck } from '../../api/types'
import { getRemediation } from './remediationText'
import styles from './HealthDashboard.module.css'
import { Spinner } from '../ui/Spinner'

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
/*  CP-T028: Four-tier severity taxonomy                               */
/* ------------------------------------------------------------------ */

/**
 * Severity levels in descending priority order.
 * Classification rules are explicit and testable — no implicit fallbacks.
 *
 * CRITICAL  — Iranti cannot function. User must act before Iranti works.
 * WARNING   — Iranti is functional but a specific capability is degraded.
 * INFO      — Expected state for a standard installation. No action required.
 * HEALTHY   — Check passed.
 */
export type Severity = 'CRITICAL' | 'WARNING' | 'INFO' | 'HEALTHY'

/**
 * Classify a health check into the four-tier severity taxonomy.
 *
 * Rules for Phase 1 checks (CP-T028 spec, confirmed classifications):
 *
 * CRITICAL:
 *   - db_reachability:error
 *   - db_schema_version:error
 *   - vector_backend:error
 *   - default_provider_configured:error  (no provider = Iranti cannot process writes)
 *
 * WARNING:
 *   - db_reachability:warn
 *   - db_schema_version:warn
 *   - vector_backend:warn
 *   - anthropic_key:warn        (missing key — degraded but only if no other provider)
 *   - openai_key:warn           (missing key — informational by default)
 *   - default_provider_configured:warn
 *   - mcp_integration:warn
 *   - claude_md_integration:warn
 *   - staff_events_table:error
 *
 * INFO (explicitly expected states — do NOT show as warning):
 *   - anthropic_key:ok          (present = healthy, but absence is a warning only)
 *   - runtime_version:warn      (version behind — non-breaking, expected)
 *   - staff_events_table:warn   (table not yet created — expected on clean install)
 *   - openai_key:warn — handled as INFO because most users use Anthropic
 *
 * HEALTHY:
 *   - Any check with status:ok that isn't reclassified above
 *
 * When adding new checks: classify explicitly here. Do not rely on the
 * raw status field alone — backend status values may not match UX intent.
 */
export function classifyCheckSeverity(check: HealthCheck): Severity {
  const { name, status } = check

  if (status === 'ok') return 'HEALTHY'

  // CRITICAL: Iranti cannot function at all
  if (
    (name === 'db_reachability' && status === 'error') ||
    (name === 'db_schema_version' && status === 'error') ||
    (name === 'vector_backend' && status === 'error') ||
    (name === 'default_provider_configured' && status === 'error')
  ) {
    return 'CRITICAL'
  }

  // INFO: explicitly expected states for standard installations
  // These must not appear as warnings — they will alarm users unnecessarily.
  if (
    // Version behind latest (minor) — expected, non-breaking
    (name === 'runtime_version' && status === 'warn') ||
    // staff_events_table not created yet — expected on clean install
    (name === 'staff_events_table' && status === 'warn') ||
    // OpenAI key absent — only matters if OpenAI is the chosen provider
    // Informational because most users use Anthropic as their primary provider
    (name === 'openai_key' && status === 'warn')
  ) {
    return 'INFO'
  }

  // WARNING: Iranti is functional but something is degraded
  // This covers all remaining warn/error states not classified above
  return 'WARNING'
}

/**
 * Normalization copy for Informational items.
 * These explain why the state is expected — "this is not a problem because..."
 */
export function getInfoNormalization(checkName: string): string | null {
  switch (checkName) {
    case 'runtime_version':
      return 'A newer version is available, but this update is non-breaking. Iranti is fully operational on your current version.'
    case 'staff_events_table':
      return 'The staff_events table is created automatically when migrations run. This is expected on a fresh install before \u0060iranti migrate\u0060 has been run.'
    case 'openai_key':
      return 'OpenAI API key is not set. This is expected if you are using Anthropic as your provider. Only required if you intend to use OpenAI models.'
    default:
      return null
  }
}

/** Sort key: CRITICAL first, then WARNING, then INFO, then HEALTHY */
function severitySortKey(severity: Severity): number {
  switch (severity) {
    case 'CRITICAL': return 0
    case 'WARNING':  return 1
    case 'INFO':     return 2
    case 'HEALTHY':  return 3
  }
}

/**
 * Summary header label based on the highest active severity.
 * CP-T028 spec: must reflect most severe active state.
 */
function getSummaryStatus(checks: HealthCheck[]): { label: string; kind: 'critical' | 'warning' | 'operational' | 'healthy' } {
  const severities = checks.map(c => classifyCheckSeverity(c))
  if (severities.includes('CRITICAL')) return { label: 'Action Required', kind: 'critical' }
  if (severities.includes('WARNING'))  return { label: 'Operational with warnings', kind: 'warning' }
  if (severities.includes('INFO'))     return { label: 'Operational', kind: 'operational' }
  return { label: 'Healthy', kind: 'healthy' }
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
/*  Overall status badge — CP-T028: uses severity taxonomy labels      */
/* ------------------------------------------------------------------ */

function OverallBadge({ checks }: { checks: HealthCheck[] }) {
  const { label, kind } = getSummaryStatus(checks)
  const classMap: Record<typeof kind, string> = {
    critical:    styles.badgeCritical,
    warning:     styles.badgeWarning,
    operational: styles.badgeOperational,
    healthy:     styles.badgeHealthy,
  }
  const iconMap: Record<typeof kind, string> = {
    critical:    '✗',
    warning:     '⚠',
    operational: '✓',
    healthy:     '✓',
  }
  return (
    <span className={`${styles.overallBadge} ${classMap[kind]}`} aria-label={`Overall status: ${label}`}>
      <span aria-hidden="true">{iconMap[kind]}</span>
      {' '}{label}
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
/*  Health check card — CP-T028: four-tier severity taxonomy           */
/* ------------------------------------------------------------------ */

/** Severity badge displayed in the card header */
function SeverityBadge({ severity }: { severity: Severity }) {
  const labelMap: Record<Severity, string> = {
    CRITICAL: 'Critical',
    WARNING:  'Warning',
    INFO:     'Info',
    HEALTHY:  'Healthy',
  }
  const classMap: Record<Severity, string> = {
    CRITICAL: styles.severityBadgeCritical,
    WARNING:  styles.severityBadgeWarning,
    INFO:     styles.severityBadgeInfo,
    HEALTHY:  styles.severityBadgeHealthy,
  }
  return (
    <span className={`${styles.severityBadge} ${classMap[severity]}`} aria-label={`Severity: ${labelMap[severity]}`}>
      {labelMap[severity]}
    </span>
  )
}

function HealthCard({ check }: { check: HealthCheck }) {
  const severity = classifyCheckSeverity(check)
  const remediation = getRemediation(check.name, check.status)
  const normalization = severity === 'INFO' ? getInfoNormalization(check.name) : null
  const label = getCheckLabel(check.name)

  // Icon and class: use severity-based mapping (not raw status) for accessibility
  // Using both icon and text label — do not rely on color alone (CP-T028 a11y req)
  const iconMap: Record<Severity, string> = {
    CRITICAL: '✗',
    WARNING:  '⚠',
    INFO:     'ℹ',
    HEALTHY:  '✓',
  }
  const iconClassMap: Record<Severity, string> = {
    CRITICAL: styles.iconCritical,
    WARNING:  styles.iconWarn,
    INFO:     styles.iconInfo,
    HEALTHY:  styles.iconOk,
  }
  const cardClassMap: Record<Severity, string> = {
    CRITICAL: styles.cardCritical,
    WARNING:  styles.cardWarn,
    INFO:     styles.cardInfo,
    HEALTHY:  styles.cardOk,
  }

  return (
    <div
      className={`${styles.card} ${cardClassMap[severity]}`}
      aria-label={`${label}: ${severity.toLowerCase()}`}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.statusIcon} ${iconClassMap[severity]}`} aria-hidden="true">
          {iconMap[severity]}
        </span>
        <span className={styles.cardName}>{label}</span>
        <SeverityBadge severity={severity} />
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

      {/* INFO: normalization copy — explains why this state is expected */}
      {severity === 'INFO' && normalization && (
        <div className={styles.normalization}>
          <span className={styles.normalizationLabel} aria-hidden="true">ℹ</span>
          <p className={styles.normalizationText}>{normalization}</p>
        </div>
      )}

      {/* CRITICAL / WARNING: remediation copy — explains what to do */}
      {(severity === 'CRITICAL' || severity === 'WARNING') && remediation && (
        <div className={styles.remediation}>
          <span className={styles.remediationLabel}>
            {severity === 'CRITICAL' ? 'Action required' : 'How to fix'}
          </span>
          <p className={styles.remediationText}>{remediation}</p>
        </div>
      )}
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

  // CP-T028: Sort by severity taxonomy — CRITICAL first, then WARNING, then INFO, then HEALTHY
  const sortedChecks = data
    ? [...data.checks].sort(
        (a, b) => severitySortKey(classifyCheckSeverity(a)) - severitySortKey(classifyCheckSeverity(b))
      )
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
          {data && <OverallBadge checks={data.checks} />}
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

      {/* CP-T028: Setup guidance banner — shown only when Critical issues are present */}
      {data && getSummaryStatus(data.checks).kind === 'critical' && (
        <div className={styles.setupBannerCritical}>
          <span className={styles.setupBannerIcon} aria-hidden="true">✗</span>
          <div>
            <strong>Critical issue — Iranti cannot function until this is resolved.</strong>
            {' '}Check the items marked Critical below and follow the remediation steps.
          </div>
        </div>
      )}

      {/* CP-T028: Warning banner — shown only when Warning (but no Critical) issues exist */}
      {data && getSummaryStatus(data.checks).kind === 'warning' && (
        <div className={styles.setupBannerWarning}>
          <span className={styles.setupBannerIcon} aria-hidden="true">⚠</span>
          <div>
            <strong>Operational with warnings.</strong>
            {' '}Iranti is running, but some capabilities may be degraded. Review the items below.
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div
          style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}
          aria-busy="true"
          aria-label="Loading health checks"
        >
          <Spinner size="md" label="Loading health checks" />
        </div>
      )}

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
