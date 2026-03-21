/* Iranti Control Plane — Home Overview Dashboard */
/* Route: /overview */
/* CP-T068 — Iranti Desktop landing page */
/* Docker Desktop-style at-a-glance system picture: */
/*   system state + recent activity + active agents + quick actions */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { OverviewResponse, OverviewRecentEvent, OverviewActiveAgent, OverviewHealthCheck } from '../../api/types'
import styles from './OverviewDashboard.module.css'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Format a large number with commas: 12345 → "12,345" */
function formatNumber(n: number): string {
  return n.toLocaleString()
}

/** Human-readable relative time from an ISO timestamp */
function relativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then
  if (isNaN(diffMs)) return ''
  const secs = Math.floor(diffMs / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/** snake_case / kebab-case → Title Case: "write_created" → "Write Created" */
function humanizeActionType(raw: string): string {
  return raw
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Truncate a string to maxLen characters with ellipsis */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
}

/* ------------------------------------------------------------------ */
/*  Alert Banner                                                        */
/* ------------------------------------------------------------------ */

interface AlertBannerProps {
  overall: string
  checkCount: number
  onDismiss: () => void
}

function AlertBanner({ overall, checkCount, onDismiss }: AlertBannerProps) {
  const severity = overall === 'error' ? 'error' : 'warn'
  const icon = severity === 'error' ? '✕' : '⚠'

  const message =
    severity === 'error'
      ? 'Iranti is reporting critical health issues.'
      : `Iranti is degraded — ${checkCount} check${checkCount !== 1 ? 's' : ''} are warning.`

  return (
    <div className={styles.alertBanner} data-severity={severity} role="alert">
      <span className={styles.alertIcon} aria-hidden="true">{icon}</span>
      <span className={styles.alertText}>
        {message}{' '}
        <Link to="/health" className={styles.alertLink}>
          View Health Dashboard →
        </Link>
      </span>
      <button
        type="button"
        className={styles.alertDismiss}
        onClick={onDismiss}
        aria-label="Dismiss alert"
      >
        ×
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  System Status Strip                                                 */
/* ------------------------------------------------------------------ */

interface SystemStatusStripProps {
  checks: OverviewHealthCheck[]
  loading: boolean
}

function SystemStatusStrip({ checks, loading }: SystemStatusStripProps) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>System Status</h2>
        <Link to="/health" className={styles.cardLink}>Details →</Link>
      </div>
      <div className={styles.cardBody}>
        {loading ? (
          <div className={styles.skeleton}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={styles.skeletonRow} style={{ width: `${60 + i * 8}%` }} />
            ))}
          </div>
        ) : (
          <Link to="/health" className={styles.statusClickable} aria-label="View full health dashboard">
            <div className={styles.statusStrip}>
              {checks.map((check) => (
                <span key={check.name} className={styles.statusPill}>
                  <span
                    className={styles.statusDot}
                    data-status={check.status}
                    aria-label={check.status}
                  />
                  {check.name.replace(/_/g, ' ')}
                </span>
              ))}
              {checks.length === 0 && (
                <span className={styles.emptyState}>No health data</span>
              )}
            </div>
          </Link>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  KB Summary Card                                                     */
/* ------------------------------------------------------------------ */

interface KBSummaryCardProps {
  totalFacts: number
  factsLast24h: number
  activeAgentsLast7d: number
  truncated: boolean
  loading: boolean
}

function KBSummaryCard({ totalFacts, factsLast24h, activeAgentsLast7d, truncated, loading }: KBSummaryCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Knowledge Base</h2>
        <Link to="/metrics" className={styles.cardLink}>View Metrics →</Link>
      </div>
      <div className={styles.cardBody}>
        {loading ? (
          <div className={styles.skeleton}>
            <div className={styles.skeletonRow} />
            <div className={styles.skeletonRow} style={{ width: '80%' }} />
          </div>
        ) : (
          <>
            <div className={styles.statsRow}>
              <div className={styles.statCell}>
                <span className={styles.statValue}>{formatNumber(totalFacts)}</span>
                <span className={styles.statLabel}>total facts</span>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statValue}>{formatNumber(factsLast24h)}</span>
                <span className={styles.statLabel}>last 24 hours</span>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statValue}>{formatNumber(activeAgentsLast7d)}</span>
                <span className={styles.statLabel}>active this week</span>
              </div>
            </div>
            {truncated && (
              <span className={styles.truncatedNote}>
                Activity data requires <code>npm run migrate</code>
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Recent Activity Feed                                                */
/* ------------------------------------------------------------------ */

interface RecentActivityFeedProps {
  events: OverviewRecentEvent[]
  loading: boolean
}

function RecentActivityFeed({ events, loading }: RecentActivityFeedProps) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Recent Activity</h2>
        <Link to="/logs" className={styles.cardLink}>View All Logs →</Link>
      </div>
      <div className={styles.cardBody}>
        {loading ? (
          <div className={styles.skeleton}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.skeletonRow} />
            ))}
          </div>
        ) : events.length === 0 ? (
          <span className={styles.emptyState}>
            No recent Staff activity. Run <code>npm run migrate</code> to enable the event stream.
          </span>
        ) : (
          <div className={styles.eventList}>
            {events.map((event) => (
              <div key={event.id} className={styles.eventRow}>
                <span
                  className={styles.componentBadge}
                  data-component={event.staffComponent}
                  title={event.staffComponent}
                >
                  {event.staffComponent.slice(0, 3).toUpperCase()}
                </span>
                <span className={styles.eventAction} title={event.actionType}>
                  {humanizeActionType(event.actionType)}
                </span>
                {event.agentId && (
                  <span className={styles.eventAgent} title={event.agentId}>
                    {truncate(event.agentId, 18)}
                  </span>
                )}
                <span className={styles.eventTime}>{relativeTime(event.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Active Agents Card                                                  */
/* ------------------------------------------------------------------ */

interface ActiveAgentsCardProps {
  agents: OverviewActiveAgent[]
  loading: boolean
}

function ActiveAgentsCard({ agents, loading }: ActiveAgentsCardProps) {
  const displayAgents = agents.slice(0, 6)
  const hasMore = agents.length > 6

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Active Agents</h2>
        <Link to="/agents" className={styles.cardLink}>All Agents →</Link>
      </div>
      <div className={styles.cardBody}>
        {loading ? (
          <div className={styles.skeleton}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={styles.skeletonRow} />
            ))}
          </div>
        ) : displayAgents.length === 0 ? (
          <span className={styles.emptyState}>No agents seen recently.</span>
        ) : (
          <div className={styles.agentList}>
            {displayAgents.map((agent) => (
              <div key={agent.agentId} className={styles.agentRow}>
                <span
                  className={styles.agentDot}
                  data-active={String(agent.isActive)}
                  aria-label={agent.isActive ? 'Active' : 'Inactive'}
                />
                <span className={styles.agentId} title={agent.agentId}>
                  {agent.agentId}
                </span>
                <span className={styles.agentWrites}>
                  {formatNumber(agent.totalWrites)} writes
                </span>
                {agent.lastSeen && (
                  <span className={styles.agentLastSeen}>{relativeTime(agent.lastSeen)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {hasMore && (
        <div className={styles.cardFooter}>
          <Link to="/agents" className={styles.cardFooterLink}>
            View all agents →
          </Link>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Quick Actions Row                                                   */
/* ------------------------------------------------------------------ */

interface QuickAction {
  icon: string
  label: string
  description: string
  to: string
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: '⊕',
    label: 'Search KB',
    description: 'Full-text and semantic search across all facts',
    to: '/memory',
  },
  {
    icon: '⊡',
    label: 'Run Diagnostics',
    description: 'Actively probe system health and get fix suggestions',
    to: '/health',
  },
  {
    icon: '▦',
    label: 'Browse Memory',
    description: 'Explore the live knowledge base by entity type',
    to: '/memory',
  },
  {
    icon: '≡',
    label: 'View Logs',
    description: 'Persistent, queryable Staff event history',
    to: '/logs',
  },
]

function QuickActionsRow() {
  return (
    <section className={styles.quickActionsSection} aria-label="Quick actions">
      <h2 className={styles.quickActionsTitle}>Quick Actions</h2>
      <div className={styles.quickActionsRow}>
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.label}
            to={action.to}
            className={styles.quickActionCard}
            aria-label={action.label}
          >
            <span className={styles.quickActionIcon} aria-hidden="true">{action.icon}</span>
            <span className={styles.quickActionLabel}>{action.label}</span>
            <span className={styles.quickActionDesc}>{action.description}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Overview Dashboard                                                  */
/* ------------------------------------------------------------------ */

export function OverviewDashboard() {
  const [alertDismissed, setAlertDismissed] = useState(false)

  const { data, isLoading } = useQuery<OverviewResponse>({
    queryKey: ['overview'],
    queryFn: () => apiFetch<OverviewResponse>('/overview'),
    refetchInterval: 30_000,
    // Never throw — the backend always returns 200 with partial data
    retry: false,
  })

  const overallHealth = data?.health.overall ?? 'healthy'
  const healthChecks = data?.health.checks ?? []
  const showAlert = !alertDismissed && (overallHealth === 'degraded' || overallHealth === 'error')
  const warnCount = healthChecks.filter((c) => c.status === 'warn' || c.status === 'error').length

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        {/* Alert banner — only when health is degraded or error */}
        {showAlert && (
          <AlertBanner
            overall={overallHealth}
            checkCount={warnCount}
            onDismiss={() => setAlertDismissed(true)}
          />
        )}

        {/* Card grid */}
        <div className={styles.cardGrid}>
          <SystemStatusStrip
            checks={healthChecks}
            loading={isLoading}
          />
          <KBSummaryCard
            totalFacts={data?.kb.totalFacts ?? 0}
            factsLast24h={data?.kb.factsLast24h ?? 0}
            activeAgentsLast7d={data?.kb.activeAgentsLast7d ?? 0}
            truncated={data?.kb.truncated ?? false}
            loading={isLoading}
          />
          <RecentActivityFeed
            events={data?.recentEvents ?? []}
            loading={isLoading}
          />
          <ActiveAgentsCard
            agents={data?.activeAgents ?? []}
            loading={isLoading}
          />
        </div>

        {/* Quick actions */}
        <QuickActionsRow />
      </div>
    </div>
  )
}
