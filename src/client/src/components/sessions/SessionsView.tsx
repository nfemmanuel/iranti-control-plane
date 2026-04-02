/* Iranti Control Plane — Sessions View */
/* Route: /sessions */
/* CP-T071 — Session Recovery visibility */

import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type {
  SessionRecord,
  SessionsResponse,
  SessionOperatorState,
  SessionComplianceStatus,
  SessionActionResponse,
} from '../../api/types'
import styles from './SessionsView.module.css'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text).catch(() => {
    // Clipboard unavailable — silently skip
  })
}

function truncate(str: string | null, len: number): string {
  if (!str) return '—'
  return str.length > len ? str.slice(0, len) + '…' : str
}

/* ------------------------------------------------------------------ */
/*  State filter definitions                                            */
/* ------------------------------------------------------------------ */

type FilterState = 'all' | 'interrupted' | 'active' | 'completed' | 'abandoned'

interface FilterTab {
  value: FilterState
  label: string
}

const FILTER_TABS: FilterTab[] = [
  { value: 'all',         label: 'All'         },
  { value: 'interrupted', label: 'Interrupted'  },
  { value: 'active',      label: 'Active'       },
  { value: 'completed',   label: 'Completed'    },
  { value: 'abandoned',   label: 'Abandoned'    },
]

function isValidFilterState(value: string | null): value is FilterState {
  return value === 'all' || value === 'interrupted' || value === 'active'
    || value === 'completed' || value === 'abandoned'
}

/* ------------------------------------------------------------------ */
/*  State badge                                                         */
/* ------------------------------------------------------------------ */

function displayState(session: SessionRecord): SessionOperatorState {
  return session.operatorState
}

function StateBadge({ state }: { state: SessionOperatorState }) {
  let className = styles.stateBadge
  let label = state

  switch (state) {
    case 'interrupted':
      className += ` ${styles.stateBadgeAmber}`
      break
    case 'active':
      className += ` ${styles.stateBadgeEmerald}`
      break
    case 'completed':
      className += ` ${styles.stateBadgeEmerald}`
      break
    case 'abandoned':
      className += ` ${styles.stateBadgeMuted}`
      break
    case 'none':
    default:
      className += ` ${styles.stateBadgeRose}`
      break
  }

  return <span className={className}>{label}</span>
}

function ComplianceBadge({ status }: { status: SessionComplianceStatus }) {
  let className = styles.complianceBadge
  let label: string = status

  switch (status) {
    case 'healthy':
      className += ` ${styles.complianceHealthy}`
      label = 'healthy'
      break
    case 'degraded':
      className += ` ${styles.complianceDegraded}`
      label = 'degraded'
      break
    case 'non_compliant':
    default:
      className += ` ${styles.complianceNonCompliant}`
      label = 'non-compliant'
      break
  }

  return <span className={className}>{label}</span>
}

/* ------------------------------------------------------------------ */
/*  Session action buttons — Resume / Abandon with inline confirmation */
/* ------------------------------------------------------------------ */

type ConfirmMode = 'resume' | 'abandon' | null

function SessionActions({
  session,
  onDone,
}: {
  session: SessionRecord
  onDone: () => void
}) {
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(null)
  const [busy, setBusy] = useState(false)

  const canResume = session.operatorState === 'interrupted'
  const canAbandon = session.operatorState === 'interrupted' || session.operatorState === 'active'
  if (!canResume && !canAbandon) return null

  const handleConfirm = async (mode: 'resume' | 'abandon') => {
    setBusy(true)
    try {
      const endpoint = `/sessions/${encodeURIComponent(session.sessionId)}/${mode}`
      await fetch(`/api/control-plane${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: session.agentId }),
      }).then(async (res) => {
        const body = await res.json() as SessionActionResponse
        if (!res.ok) {
          console.error(`[sessions] ${mode} failed`, body)
        }
      })
    } catch (err) {
      console.error(`[sessions] ${mode} unexpected error`, err)
    } finally {
      setBusy(false)
      setConfirmMode(null)
      onDone()
    }
  }

  if (confirmMode === 'resume') {
    return (
      <div className={styles.confirmInline}>
        <span className={styles.confirmText}>Resume this session?</span>
        <button
          className={styles.confirmYesBtn}
          onClick={() => void handleConfirm('resume')}
          disabled={busy}
          type="button"
        >
          {busy ? 'Resuming…' : 'Confirm'}
        </button>
        <button
          className={styles.confirmNoBtn}
          onClick={() => setConfirmMode(null)}
          disabled={busy}
          type="button"
        >
          Cancel
        </button>
      </div>
    )
  }

  if (confirmMode === 'abandon') {
    return (
      <div className={styles.confirmInline}>
        <span className={styles.confirmText}>
          Mark as abandoned? This cannot be undone.
        </span>
        <button
          className={`${styles.confirmYesBtn} ${styles.confirmYesBtnDestructive}`}
          onClick={() => void handleConfirm('abandon')}
          disabled={busy}
          type="button"
        >
          {busy ? 'Abandoning…' : 'Confirm'}
        </button>
        <button
          className={styles.confirmNoBtn}
          onClick={() => setConfirmMode(null)}
          disabled={busy}
          type="button"
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className={styles.actionRow}>
      {canResume && (
        <button
          className={styles.resumeBtn}
          onClick={() => setConfirmMode('resume')}
          type="button"
        >
          ↺ Resume
        </button>
      )}
      {canAbandon && (
        <button
          className={styles.abandonBtn}
          onClick={() => setConfirmMode('abandon')}
          type="button"
        >
          ✕ Abandon
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Expanded detail panel (inline accordion)                           */
/* ------------------------------------------------------------------ */

function SessionDetailPanel({
  session,
  onRefetch,
}: {
  session: SessionRecord
  onRefetch: () => void
}) {
  return (
    <div className={styles.detailPanel}>
      {/* Grid: session ID + agent ID */}
      <div className={styles.detailGrid}>
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Session ID</span>
          <div className={styles.sessionIdRow}>
            <span className={styles.detailValueMono}>{session.sessionId}</span>
            <button
              className={styles.copyBtn}
              onClick={() => copyToClipboard(session.sessionId)}
              type="button"
              title="Copy session ID"
              aria-label="Copy session ID to clipboard"
            >
              ⎘ Copy
            </button>
          </div>
        </div>
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Agent ID</span>
          <span className={styles.detailValueMono}>
            <Link
              to={`/agents`}
              style={{ color: 'var(--color-accent-primary)', textDecoration: 'none' }}
            >
              {session.agentId}
            </Link>
          </span>
        </div>
      </div>

      {/* Full task text */}
      {session.task && (
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Task</span>
          <pre className={styles.taskFull}>{session.task}</pre>
        </div>
      )}

      {/* Timeline */}
      <div className={styles.detailField}>
        <span className={styles.detailLabel}>Timeline</span>
        <div className={styles.timeline}>
          <div className={styles.timelineStep}>
            <span className={styles.timelineLabel}>Started</span>
            <span className={styles.timelineValue}>{formatRelativeTime(session.startedAt)}</span>
          </div>
          {(session.updatedAt || session.lastHeartbeatAt) && (
            <>
              <span className={styles.timelineArrow}>→</span>
              <div className={styles.timelineStep}>
                <span className={styles.timelineLabel}>Last update</span>
                <span className={styles.timelineValue}>{formatRelativeTime(session.updatedAt ?? session.lastHeartbeatAt)}</span>
              </div>
            </>
          )}
          {session.completedAt && (
            <>
              <span className={styles.timelineArrow}>→</span>
              <div className={styles.timelineStep}>
                <span className={styles.timelineLabel}>Completed</span>
                <span className={styles.timelineValue}>{formatRelativeTime(session.completedAt)}</span>
              </div>
            </>
          )}
          {session.abandonedAt && (
            <>
              <span className={styles.timelineArrow}>→</span>
              <div className={styles.timelineStep}>
                <span className={styles.timelineLabel}>Abandoned</span>
                <span className={styles.timelineValue}>{formatRelativeTime(session.abandonedAt)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {session.compliance && (
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Compliance</span>
          <div className={styles.compliancePanel}>
            <div className={styles.complianceHeader}>
              <ComplianceBadge status={session.compliance.status} />
              <span className={styles.detailValue}>{session.compliance.summary}</span>
            </div>
            <div className={styles.complianceCounters}>
              <span>attends since persist: {session.compliance.counters.attendsWithoutPersist}</span>
              <span>pre-response misses: {session.compliance.counters.consecutivePreResponseWithoutPost}</span>
              <span>pending post-response: {session.compliance.counters.pendingPostResponse ? 'yes' : 'no'}</span>
            </div>
            {session.compliance.issues.length > 0 && (
              <ul className={styles.complianceIssueList}>
                {session.compliance.issues.map((issue) => (
                  <li key={`${issue.code}-${issue.count}`} className={styles.complianceIssue}>
                    <span className={styles.complianceIssueMessage}>{issue.message}</span>
                    <span className={styles.complianceIssueAction}>{issue.requiredAction}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Raw checkpoint JSON — collapsible */}
      {session.checkpoint && (
        <div className={styles.detailField}>
          <details className={styles.checkpointDetails}>
            <summary className={styles.checkpointSummary}>
              Raw checkpoint data
            </summary>
            <pre className={styles.checkpointPre}>
              {JSON.stringify(session.checkpoint, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {session.checkpointSummary && (
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Checkpoint summary</span>
          <pre className={styles.taskFull}>
            {JSON.stringify(session.checkpointSummary, null, 2)}
          </pre>
        </div>
      )}

      {/* Resume / Abandon actions */}
      <SessionActions session={session} onDone={onRefetch} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Skeleton loading rows                                               */
/* ------------------------------------------------------------------ */

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3].map(i => (
        <tr key={i} className={styles.skeletonRow}>
          <td><div className={styles.skeletonBar} style={{ width: '60px' }} /></td>
          <td><div className={styles.skeletonBar} style={{ width: '80%' }} /></td>
          <td><div className={styles.skeletonBar} style={{ width: '70%' }} /></td>
          <td><div className={styles.skeletonBar} style={{ width: '90%' }} /></td>
          <td><div className={styles.skeletonBar} style={{ width: '55px' }} /></td>
          <td><div className={styles.skeletonBar} style={{ width: '55px' }} /></td>
        </tr>
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Main view                                                           */
/* ------------------------------------------------------------------ */

export function SessionsView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Read state filter from URL — default to 'all'
  const rawState = searchParams.get('state')
  const activeFilter: FilterState = isValidFilterState(rawState) ? rawState : 'all'

  // Map our UI filter values to the API param
  const apiState = activeFilter === 'all' ? undefined : activeFilter

  const { data, isLoading, error } = useQuery<SessionsResponse, Error>({
    queryKey: ['sessions', activeFilter],
    queryFn: () => apiFetch<SessionsResponse>('/sessions', {
      operatorState: apiState,
      limit: 50,
    }),
    staleTime: 30_000,
  })

  const sessions: SessionRecord[] = data?.sessions ?? []

  const handleTabClick = (filter: FilterState) => {
    const next = new URLSearchParams(searchParams)
    if (filter === 'all') {
      next.delete('state')
    } else {
      next.set('state', filter)
    }
    setSearchParams(next, { replace: true })
    setExpandedId(null)
  }

  const handleRowClick = (sessionId: string) => {
    setExpandedId(prev => prev === sessionId ? null : sessionId)
  }

  const handleRefetch = () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  // Non-fatal error from the API (Iranti unreachable)
  const apiError = data?.error

  return (
    <div className={styles.page}>
      {/* Page header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <span className={styles.pageIcon} aria-hidden="true">⊙</span>
          <div>
            <h1 className={styles.pageTitle}>Session Recovery</h1>
            <p className={styles.pageSubtitle}>
                Agent sessions and recovery state from the current Iranti session API
            </p>
          </div>
        </div>
        {data && !isLoading && (
          <span className={styles.sessionCount}>
            {data.total} session{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* State filter tabs */}
      <div className={styles.filterBar} role="tablist" aria-label="Filter sessions by state">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={activeFilter === tab.value}
            className={`${styles.filterTab} ${activeFilter === tab.value ? styles.filterTabActive : ''}`}
            onClick={() => handleTabClick(tab.value)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Non-fatal API error banner */}
      {(error ?? apiError) && (
        <div className={styles.errorBanner} role="alert">
          <span className={styles.errorBannerIcon} aria-hidden="true">⚠</span>
          <span>
            {error
              ? 'Could not load sessions — Iranti may be unreachable.'
              : `Sessions endpoint returned a warning: ${apiError}`
            }
          </span>
        </div>
      )}

      {/* Content region */}
      <div className={styles.contentRegion}>
        {isLoading && (
          <table className={styles.table} aria-label="Sessions loading">
            <thead>
              <tr>
                <th>State</th>
                <th>Session ID</th>
                <th>Agent</th>
                <th>Task</th>
                <th>Started</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              <SkeletonRows />
            </tbody>
          </table>
        )}

        {!isLoading && !error && sessions.length === 0 && (
          <div className={styles.emptyState}>
            <span className={styles.emptyStateIcon} aria-hidden="true">⊙</span>
            <p className={styles.emptyStateTitle}>No sessions found</p>
            <p className={styles.emptyStateBody}>
              Sessions appear when agents persist checkpoint state through the Iranti SDK or{' '}
              <code className={styles.inlineCode}>POST /memory/checkpoint</code>.{' '}
              <Link to="/getting-started" style={{ color: 'var(--color-accent-primary)' }}>
                View the Getting Started guide
              </Link>
              .
            </p>
          </div>
        )}

        {!isLoading && sessions.length > 0 && (
          <table className={styles.table} aria-label="Sessions list">
            <thead>
              <tr>
                <th>State</th>
                <th>Session ID</th>
                <th>Agent</th>
                <th>Task</th>
                <th>Started</th>
                <th>Last update</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map(session => {
                const isExpanded = expandedId === session.sessionId
                return (
                  <>
                    <tr
                      key={session.sessionId}
                      className={`${styles.dataRow} ${isExpanded ? styles.dataRowExpanded : ''}`}
                      onClick={() => handleRowClick(session.sessionId)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleRowClick(session.sessionId)
                        }
                      }}
                    >
                      <td className={styles.cellBadge}>
                        <StateBadge state={displayState(session)} />
                      </td>
                      <td className={styles.cellSessionId}>
                        {truncate(session.sessionId, 24)}
                      </td>
                      <td className={styles.cellAgentId}>{session.agentId}</td>
                      <td className={styles.cellTask}>
                        {truncate(session.task, 60)}
                      </td>
                      <td className={styles.cellMeta}>
                        {formatRelativeTime(session.startedAt)}
                      </td>
                      <td className={styles.cellMeta}>
                        {formatRelativeTime(session.updatedAt ?? session.lastHeartbeatAt)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className={styles.detailRow} key={`${session.sessionId}-detail`}>
                        <td colSpan={6}>
                          <SessionDetailPanel
                            session={session}
                            onRefetch={handleRefetch}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

