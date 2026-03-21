/* Iranti Control Plane — Health & Diagnostics Dashboard */
/* Route: /health */
/* CP-T016 — All 10 health checks, auto-refresh, remediation guidance */
/* CP-T028 — Four-tier severity taxonomy: CRITICAL / WARNING / INFO / HEALTHY */

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../api/client'
import type { HealthResponse, HealthCheck, HealthDecay, HealthVectorBackend, HealthAttendant, ProvidersResponse, RepairMcpJsonResponse, RepairClaudeMdResponse } from '../../api/types'
import { getRemediation } from './remediationText'
import { ConfirmationModal } from '../ui/ConfirmationModal'
import { ProviderStatusSection } from './ProviderStatus'
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

/* ------------------------------------------------------------------ */
/*  CP-T033: Repair action mapping per health check                    */
/* ------------------------------------------------------------------ */

/**
 * Maps health check names to their repair endpoints.
 * Uses 'local' as the Phase 1 instanceId. 'default' as projectId placeholder.
 * Only checks with actionable filesystem repair actions are listed here.
 */
const REPAIR_ENDPOINTS: Partial<Record<string, { url: string; label: string; kind: 'mcp-json' | 'claude-md' }>> = {
  mcp_integration: {
    url: '/api/control-plane/instances/local/projects/default/repair/mcp-json',
    label: 'Regenerate .mcp.json',
    kind: 'mcp-json',
  },
  claude_md_integration: {
    url: '/api/control-plane/instances/local/projects/default/repair/claude-md',
    label: 'Update CLAUDE.md integration block',
    kind: 'claude-md',
  },
}

type RepairKind = 'mcp-json' | 'claude-md'

interface RepairResult {
  kind: RepairKind
  data: RepairMcpJsonResponse | RepairClaudeMdResponse
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
  const repairInfo = REPAIR_ENDPOINTS[check.name]

  // CP-T033: Repair modal state for this card
  const [showRepairModal, setShowRepairModal] = useState(false)
  const [repairLoading, setRepairLoading] = useState(false)
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)

  const handleRepairConfirm = async () => {
    if (!repairInfo) return
    setRepairLoading(true)
    setRepairError(null)
    try {
      const res = await fetch(`${repairInfo.url}?confirm=true`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        const errBody = body as { error?: string }
        throw new Error(errBody.error ?? res.statusText)
      }
      setRepairResult({ kind: repairInfo.kind, data: body as RepairMcpJsonResponse | RepairClaudeMdResponse })
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : 'Repair failed')
    } finally {
      setRepairLoading(false)
      setShowRepairModal(false)
    }
  }

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
        {/* CP-T033: Repair button — only shown for WARNING/CRITICAL checks with a repair action */}
        {(severity === 'WARNING' || severity === 'CRITICAL') && repairInfo && !repairResult && (
          <button
            className={styles.repairBtn}
            onClick={() => { setRepairResult(null); setRepairError(null); setShowRepairModal(true) }}
            type="button"
            aria-label={`Repair: ${repairInfo.label}`}
          >
            Repair
          </button>
        )}
      </div>
      <p className={styles.cardMessage}>{check.message}</p>

      {/* CP-T033: Repair success result */}
      {repairResult && (
        <div className={styles.repairSuccess}>
          <span className={styles.repairSuccessIcon} aria-hidden="true">✓</span>
          <div>
            <span className={styles.repairSuccessTitle}>Repair complete — </span>
            <code className={styles.repairSuccessPath}>{repairResult.data.filePath}</code>
            <span className={styles.repairSuccessAction}> ({repairResult.data.action})</span>
            <p className={styles.repairSuccessWarning}>This action is not revertable.</p>
          </div>
        </div>
      )}

      {/* CP-T033: Repair error */}
      {repairError && (
        <div className={styles.repairError}>
          <span aria-hidden="true">✗</span> {repairError}
        </div>
      )}

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

      {/* CP-T033: Repair confirmation modal */}
      {showRepairModal && repairInfo && (
        <ConfirmationModal
          title={repairInfo.label}
          description={`This will write to:\n${repairInfo.url}\n\nThe file will be generated using the current instance configuration.`}
          warning="This action is not revertable. The file will be written immediately to the project directory."
          confirmLabel="Run Repair"
          loading={repairLoading}
          onConfirm={() => void handleRepairConfirm()}
          onCancel={() => setShowRepairModal(false)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  CP-T052: Capability Health — severity mapping for vectorBackend    */
/* ------------------------------------------------------------------ */

/**
 * Map the vectorBackend API status string to the four-tier Severity enum.
 * vectorBackend.status is independent of the overall health field and
 * must not affect the page-level OverallBadge.
 *
 *   ok    → HEALTHY (green)
 *   warn  → WARNING (amber) — backend type set but URL not configured
 *   error → CRITICAL (red)  — external service unreachable
 */
function mapVectorBackendSeverity(status: 'ok' | 'warn' | 'error'): Severity {
  switch (status) {
    case 'ok':    return 'HEALTHY'
    case 'warn':  return 'WARNING'
    case 'error': return 'CRITICAL'
  }
}

/* ------------------------------------------------------------------ */
/*  CP-T052: Memory Decay card                                         */
/* ------------------------------------------------------------------ */

function MemoryDecayCard({ decay }: { decay: HealthDecay }) {
  const { enabled, stabilityBase, stabilityMax, decayThreshold } = decay

  // Amber = enabled (intentional — decay active is a notable operator state)
  // Green = disabled
  const iconClass = enabled ? styles.iconWarn : styles.iconOk
  const icon      = enabled ? '~' : '✓'
  const dotLabel  = enabled ? 'Enabled' : 'Disabled'
  const cardClass = enabled ? styles.cardWarn : styles.cardOk
  const badge     = enabled ? <SeverityBadge severity="WARNING" /> : <SeverityBadge severity="HEALTHY" />

  return (
    <div
      className={`${styles.card} ${cardClass}`}
      aria-label={`Memory Decay: ${dotLabel}`}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.statusIcon} ${iconClass}`} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.cardName}>Memory Decay</span>
        {badge}
      </div>

      {/* Color direction note — operators must not mistake amber for a warning */}
      <p className={styles.cardMessage}>
        {enabled
          ? 'Decay is active — facts below the stability threshold will be archived automatically. Amber indicates decay is enabled, not an error.'
          : 'Memory decay is disabled. Facts are archived only by expiry, low confidence (< 30), or Resolutionist resolution.'}
      </p>

      {enabled && (
        <dl className={styles.cardDetail}>
          <div className={styles.cardDetailRow}>
            <dt className={styles.cardDetailKey}>stability base</dt>
            <dd className={styles.cardDetailVal}>{stabilityBase} days until first decay cycle</dd>
          </div>
          <div className={styles.cardDetailRow}>
            <dt className={styles.cardDetailKey}>stability range</dt>
            <dd className={styles.cardDetailVal}>{stabilityBase}–{stabilityMax} days</dd>
          </div>
          <div className={styles.cardDetailRow}>
            <dt className={styles.cardDetailKey}>decay threshold</dt>
            <dd className={styles.cardDetailVal}>Archived below confidence {decayThreshold}</dd>
          </div>
        </dl>
      )}

      {/* Always-visible note clarifying amber color direction */}
      <div className={styles.normalization}>
        <span className={styles.normalizationLabel} aria-hidden="true">ℹ</span>
        <p className={styles.normalizationText}>
          {enabled
            ? 'Amber here means decay is on — this is an operator-visible state, not an error.'
            : 'Green means decay is off. No automatic archival by time/access pattern. Explicit actions (expiry, confidence threshold, Resolutionist) still apply.'}
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  CP-T052: Vector Backend card                                       */
/* ------------------------------------------------------------------ */

function VectorBackendCard({ vectorBackend }: { vectorBackend: HealthVectorBackend }) {
  const { type, url, status } = vectorBackend
  const severity = mapVectorBackendSeverity(status)

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

  const typeLabel =
    type === 'unknown'
      ? 'unknown (defaulting to pgvector)'
      : type

  // Actionable hint when vector search may be inactive
  const showActionableHint = status === 'warn' || status === 'error'
  const actionableHint =
    type === 'pgvector'
      ? 'Check DB Reachability and pgvector extension. Run: SELECT * FROM pg_extension WHERE extname = \'vector\';'
      : `Confirm the ${type} service is running at: ${url ?? '[URL not configured]'}. Check DB Reachability if using a local service.`

  // pgvector hybrid fallback note (v0.2.13+)
  const showHybridFallback = (type === 'pgvector' || type === 'unknown') && status === 'ok'

  return (
    <div
      className={`${styles.card} ${cardClassMap[severity]}`}
      aria-label={`Vector Backend: ${typeLabel} — ${severity.toLowerCase()}`}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.statusIcon} ${iconClassMap[severity]}`} aria-hidden="true">
          {iconMap[severity]}
        </span>
        <span className={styles.cardName}>Vector Backend</span>
        <SeverityBadge severity={severity} />
      </div>

      <dl className={styles.cardDetail}>
        <div className={styles.cardDetailRow}>
          <dt className={styles.cardDetailKey}>backend</dt>
          <dd className={styles.cardDetailVal}>{typeLabel}</dd>
        </div>
        {url && (
          <div className={styles.cardDetailRow}>
            <dt className={styles.cardDetailKey}>url</dt>
            <dd className={styles.cardDetailVal}>{url}</dd>
          </div>
        )}
        {(type === 'pgvector' || type === 'unknown') && (
          <div className={styles.cardDetailRow}>
            <dt className={styles.cardDetailKey}>connection</dt>
            <dd className={styles.cardDetailVal}>Uses primary database connection — see DB Reachability check</dd>
          </div>
        )}
      </dl>

      {/* Hybrid fallback note — informational, not a warning */}
      {showHybridFallback && (
        <div className={styles.normalization}>
          <span className={styles.normalizationLabel} aria-hidden="true">ℹ</span>
          <p className={styles.normalizationText}>
            Iranti v0.2.13+ falls back to in-process semantic scoring if pgvector is unavailable. Search quality may be reduced in fallback mode.
          </p>
        </div>
      )}

      {/* Actionable hint for warn/error states */}
      {showActionableHint && (
        <div className={styles.remediation}>
          <span className={styles.remediationLabel}>
            {severity === 'CRITICAL' ? 'Action required' : 'How to fix'}
          </span>
          <p className={styles.remediationText}>{actionableHint}</p>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  CP-T052: Attendant Status card                                     */
/* ------------------------------------------------------------------ */

function AttendantStatusCard({ attendant }: { attendant: HealthAttendant }) {
  return (
    <div
      className={`${styles.card} ${styles.cardInfo}`}
      aria-label="Attendant Status: Informational"
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.statusIcon} ${styles.iconInfo}`} aria-hidden="true">
          ℹ
        </span>
        <span className={styles.cardName}>Attendant Status</span>
        <SeverityBadge severity="INFO" />
      </div>

      <p className={styles.cardMessage}>{attendant.message}</p>

      <dl className={styles.cardDetail}>
        <div className={styles.cardDetailRow}>
          <dt className={styles.cardDetailKey}>upstream PR</dt>
          <dd className={styles.cardDetailVal}>{attendant.upstreamPRRequired}</dd>
        </div>
      </dl>

      {/* Workaround callout — always shown; operators need this regardless of Attendant state */}
      <div className={styles.normalization}>
        <span className={styles.normalizationLabel} aria-hidden="true">ℹ</span>
        <p className={styles.normalizationText}>
          Workaround: call <code className={styles.capabilityInlineCode}>iranti_attend</code> with{' '}
          <code className={styles.capabilityInlineCode}>forceInject: true</code> to bypass the classifier and always inject working memory.
        </p>
      </div>
      <pre className={styles.capabilityCodeBlock}>{`{
  "agent": "<your_agent_id>",
  "currentContext": "...",
  "forceInject": true
}`}</pre>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  CP-T052: Capability Health section wrapper                        */
/* ------------------------------------------------------------------ */

function CapabilityHealthSection({
  decay,
  vectorBackend,
  attendant,
}: {
  decay?: HealthDecay
  vectorBackend?: HealthVectorBackend
  attendant?: HealthAttendant
}) {
  const hasAny = decay !== undefined || vectorBackend !== undefined || attendant !== undefined
  if (!hasAny) return null

  return (
    <section className={styles.capabilitySection} aria-labelledby="capability-health-heading">
      <div className={styles.capabilitySectionHeader}>
        <h2 id="capability-health-heading" className={styles.capabilitySectionTitle}>
          Capability Health
        </h2>
        <span className={styles.capabilitySectionMeta}>Decay · Vector · Attendant</span>
      </div>
      <div className={styles.grid}>
        {decay       !== undefined && <MemoryDecayCard   decay={decay} />}
        {vectorBackend !== undefined && <VectorBackendCard vectorBackend={vectorBackend} />}
        {attendant   !== undefined && <AttendantStatusCard attendant={attendant} />}
      </div>
    </section>
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

  // CP-T046: Providers query for the unreachable-provider banner
  const { data: providersData } = useQuery<ProvidersResponse, Error>({
    queryKey: ['providers'],
    queryFn: () => apiFetch<ProvidersResponse>('/providers'),
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })

  // Configured providers that have a key but are not reachable
  const unreachableProviders = (providersData?.providers ?? []).filter(
    p => p.keyPresent && !p.reachable
  )

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

      {/* CP-T046: Unreachable provider banner — shown when any configured provider cannot be reached */}
      {unreachableProviders.length > 0 && (
        <div className={styles.setupBannerWarning} role="alert">
          <span className={styles.setupBannerIcon} aria-hidden="true">⚠</span>
          <div>
            <strong>One or more providers are unreachable</strong>
            {' '}— check your API keys and network.
            {' '}
            <Link to="/providers" className={styles.providerBannerLink}>
              Open Provider Manager
            </Link>
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

      {/* CP-T052: Capability Health section — Decay, Vector Backend, Attendant */}
      {!isLoading && data && (
        <CapabilityHealthSection
          decay={data.decay}
          vectorBackend={data.vectorBackend}
          attendant={data.attendant}
        />
      )}

      {/* CP-T034: Provider status section — key presence, reachability, models */}
      {!isLoading && <ProviderStatusSection />}
    </div>
  )
}
