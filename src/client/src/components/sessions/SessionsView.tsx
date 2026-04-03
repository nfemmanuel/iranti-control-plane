/* Iranti Control Plane - Sessions View */
/* Route: /sessions */
/* CP-T071 - Session Recovery visibility */

import { Fragment, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type {
  SessionActionResponse,
  SessionComplianceStatus,
  SessionLedgerEvent,
  SessionLedgerResponse,
  SessionOperatorState,
  SessionRecord,
  SessionsResponse,
} from '../../api/types'
import { useSettings } from '../../hooks/useSettings'
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/timeFormat'
import { Spinner } from '../ui/Spinner'
import styles from './SessionsView.module.css'

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text).catch(() => {})
}

function truncate(str: string | null, len: number): string {
  if (!str) return '—'
  return str.length > len ? `${str.slice(0, len)}…` : str
}

type FilterState = 'all' | 'interrupted' | 'active' | 'completed' | 'abandoned'

interface FilterTab {
  value: FilterState
  label: string
}

const FILTER_TABS: FilterTab[] = [
  { value: 'all', label: 'All' },
  { value: 'interrupted', label: 'Interrupted' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'abandoned', label: 'Abandoned' },
]

function isValidFilterState(value: string | null): value is FilterState {
  return value === 'all' || value === 'interrupted' || value === 'active'
    || value === 'completed' || value === 'abandoned'
}

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

function shortEventId(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 12 ? `${value.slice(0, 12)}…` : value
}

function readMetadataString(event: SessionLedgerEvent, key: string): string | null {
  const value = event.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readMetadataStringArray(event: SessionLedgerEvent, key: string): string[] {
  const value = event.metadata?.[key]
  if (!Array.isArray(value)) return []
  return value.map((entry) => String(entry)).filter(Boolean)
}

function readMetadataNumberArray(event: SessionLedgerEvent, key: string): number[] {
  const value = event.metadata?.[key]
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry))
}

function countAction(events: SessionLedgerEvent[], actionType: string): number {
  return events.filter((event) => event.actionType === actionType).length
}

function countHelpfulInjections(events: SessionLedgerEvent[]): number {
  return events.filter(
    (event) => event.actionType === 'memory_injection_scored' && event.metadata?.['helpful'] === true,
  ).length
}

function describeLedgerEvent(event: SessionLedgerEvent): string {
  switch (event.actionType) {
    case 'memory_injected': {
      const injectedKeys = readMetadataStringArray(event, 'injectedKeys')
      const injectionId = readMetadataString(event, 'injectionId')
      const count = injectedKeys.length
      if (count > 0 && injectionId) {
        return `Surfaced ${count} fact${count === 1 ? '' : 's'} for this turn via injection ${shortEventId(injectionId)}.`
      }
      if (count > 0) {
        return `Surfaced ${count} fact${count === 1 ? '' : 's'} for this turn.`
      }
      return 'Surfaced memory for this turn.'
    }
    case 'memory_evidence_observed': {
      const evidenceKinds = readMetadataStringArray(event, 'evidenceKinds')
      return evidenceKinds.length > 0
        ? `Observed memory follow-through: ${evidenceKinds.join(', ')}.`
        : 'Observed follow-through evidence for injected memory.'
    }
    case 'memory_injection_scored': {
      const used = event.metadata?.['used'] === true ? 'used' : 'not used'
      const helpful = event.metadata?.['helpful'] === true ? 'helpful' : 'not helpful'
      return `Scored injected memory as ${used} and ${helpful}.`
    }
    case 'checkpoint_written': {
      const currentStep = readMetadataString(event, 'currentStep')
      const nextStep = readMetadataString(event, 'nextStep')
      if (currentStep || nextStep) {
        return `Checkpoint updated${currentStep ? ` current step: ${currentStep}.` : '.'}${nextStep ? ` Next: ${nextStep}.` : ''}`
      }
      return 'Checkpoint persisted to the ledger.'
    }
    case 'summary_written':
      return 'Stored a durable response summary.'
    case 'write_available':
      return 'Confirmed write path availability.'
    case 'write_rejected':
      return 'Write was rejected by the memory layer.'
    default:
      return event.reason ?? event.actionType.replace(/_/g, ' ')
  }
}

function buildLedgerTags(event: SessionLedgerEvent): string[] {
  const tags: string[] = []
  const host = readMetadataString(event, 'host')
  const phase = readMetadataString(event, 'phase')
  const sessionId = readMetadataString(event, 'sessionId')
  const injectionId = readMetadataString(event, 'injectionId')
  const used = event.metadata?.['used']
  const helpful = event.metadata?.['helpful']
  const evidenceKinds = readMetadataStringArray(event, 'evidenceKinds')

  if (host) tags.push(`host:${host}`)
  if (phase) tags.push(`phase:${phase}`)
  if (sessionId) tags.push(`session:${shortEventId(sessionId)}`)
  if (injectionId) tags.push(`injection:${shortEventId(injectionId)}`)
  if (used === true) tags.push('used')
  if (used === false) tags.push('unused')
  if (helpful === true) tags.push('helpful')
  if (helpful === false) tags.push('not-helpful')
  if (evidenceKinds.length > 0) tags.push(...evidenceKinds.map((kind) => `evidence:${kind}`))

  return tags
}

function ledgerActionTone(actionType: string): string {
  if (actionType === 'memory_injection_scored') return styles.ledgerEventScored
  if (actionType === 'memory_injected') return styles.ledgerEventInjected
  if (actionType === 'memory_evidence_observed') return styles.ledgerEventEvidence
  if (actionType === 'checkpoint_written' || actionType === 'summary_written') return styles.ledgerEventPersistence
  return ''
}

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
        if (!res.ok) console.error(`[sessions] ${mode} failed`, body)
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
        <span className={styles.confirmText}>Mark as abandoned? This cannot be undone.</span>
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
        <button className={styles.resumeBtn} onClick={() => setConfirmMode('resume')} type="button">
          Resume
        </button>
      )}
      {canAbandon && (
        <button className={styles.abandonBtn} onClick={() => setConfirmMode('abandon')} type="button">
          Abandon
        </button>
      )}
    </div>
  )
}

function SessionLedgerPanel({ session }: { session: SessionRecord }) {
  const { settings } = useSettings()
  const { data, isLoading, error, refetch, isFetching } = useQuery<SessionLedgerResponse, Error>({
    queryKey: ['session-ledger', session.sessionId, session.agentId],
    queryFn: () => apiFetch<SessionLedgerResponse>(
      `/sessions/${encodeURIComponent(session.sessionId)}/ledger`,
      {
        agentId: session.agentId,
        limit: 50,
        ...(session.startedAt ? { startedAt: session.startedAt } : {}),
        ...(session.lastHeartbeatAt ? { lastHeartbeatAt: session.lastHeartbeatAt } : {}),
      },
    ),
    staleTime: 15_000,
  })

  const items = data?.items ?? []
  const apiError = data?.error

  return (
    <div className={styles.detailField}>
      <div className={styles.sectionHeader}>
        <span className={styles.detailLabel}>Session ledger</span>
        <div className={styles.sectionHeaderActions}>
          {data?.note && <span className={styles.sectionNote}>{data.note}</span>}
          <button
            className={styles.refreshBtn}
            onClick={() => void refetch()}
            type="button"
            disabled={isFetching}
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {(error ?? apiError) && (
        <div className={styles.inlineWarning} role="alert">
          {error ? error.message : apiError}
        </div>
      )}

      {isLoading && (
        <div className={styles.ledgerLoading}>
          <Spinner size="sm" label="Loading session ledger" />
          <span className={styles.detailValueMuted}>Loading recent ledger events…</span>
        </div>
      )}

      {!isLoading && !error && items.length > 0 && (
        <>
          <div className={styles.ledgerStats}>
            <div className={styles.ledgerStatCard}>
              <span className={styles.ledgerStatValue}>{items.length}</span>
              <span className={styles.ledgerStatLabel}>events</span>
            </div>
            <div className={styles.ledgerStatCard}>
              <span className={styles.ledgerStatValue}>{countAction(items, 'memory_injected')}</span>
              <span className={styles.ledgerStatLabel}>injections</span>
            </div>
            <div className={styles.ledgerStatCard}>
              <span className={styles.ledgerStatValue}>{countHelpfulInjections(items)}</span>
              <span className={styles.ledgerStatLabel}>helpful</span>
            </div>
            <div className={styles.ledgerStatCard}>
              <span className={styles.ledgerStatValue}>{formatRelativeTime(items[0]?.timestamp ?? null)}</span>
              <span className={styles.ledgerStatLabel}>last event</span>
            </div>
          </div>

          <div className={styles.ledgerTimeline}>
            {items.map((event) => {
              const tags = buildLedgerTags(event)
              const injectedKeys = readMetadataStringArray(event, 'injectedKeys')
              const injectedEntryIds = readMetadataNumberArray(event, 'injectedEntryIds')

              return (
                <article
                  key={event.eventId}
                  className={`${styles.ledgerEvent} ${ledgerActionTone(event.actionType)}`}
                >
                  <div className={styles.ledgerEventMeta}>
                    <span className={styles.ledgerEventTime}>{formatAbsoluteTime(event.timestamp, settings.timezone)}</span>
                    <span className={styles.ledgerEventRelative}>{formatRelativeTime(event.timestamp)}</span>
                  </div>
                  <div className={styles.ledgerEventBody}>
                    <div className={styles.ledgerEventHeader}>
                      <span className={styles.ledgerEventAction}>{event.actionType}</span>
                      <span className={styles.ledgerEventComponent}>{event.staffComponent}</span>
                      <span className={styles.ledgerEventSource}>{event.source}</span>
                    </div>
                    <p className={styles.ledgerEventSummary}>{describeLedgerEvent(event)}</p>
                    {tags.length > 0 && (
                      <div className={styles.ledgerTagRow}>
                        {tags.map((tag) => (
                          <span key={tag} className={styles.ledgerTag}>{tag}</span>
                        ))}
                      </div>
                    )}
                    {(event.entityType || event.entityId || event.key) && (
                      <div className={styles.ledgerContextRow}>
                        {event.entityType && event.entityId && (
                          <span className={styles.ledgerContextItem}>{event.entityType}/{event.entityId}</span>
                        )}
                        {event.key && <span className={styles.ledgerContextItem}>key:{event.key}</span>}
                      </div>
                    )}
                    {(injectedKeys.length > 0 || injectedEntryIds.length > 0) && (
                      <div className={styles.ledgerDetailBlock}>
                        {injectedKeys.length > 0 && (
                          <div className={styles.ledgerDetailRow}>
                            <span className={styles.ledgerDetailLabel}>Injected keys</span>
                            <span className={styles.ledgerDetailValue}>{injectedKeys.join(', ')}</span>
                          </div>
                        )}
                        {injectedEntryIds.length > 0 && (
                          <div className={styles.ledgerDetailRow}>
                            <span className={styles.ledgerDetailLabel}>Fact IDs</span>
                            <span className={styles.ledgerDetailValue}>{injectedEntryIds.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </>
      )}

      {!isLoading && !error && items.length === 0 && !apiError && (
        <div className={styles.emptyLedger}>No ledger events were returned for this session yet.</div>
      )}
    </div>
  )
}

function SessionDetailPanel({
  session,
  onRefetch,
}: {
  session: SessionRecord
  onRefetch: () => void
}) {
  return (
    <div className={styles.detailPanel}>
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
              Copy
            </button>
          </div>
        </div>
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Agent ID</span>
          <span className={styles.detailValueMono}>
            <Link to="/agents" style={{ color: 'var(--color-accent-primary)', textDecoration: 'none' }}>
              {session.agentId}
            </Link>
          </span>
        </div>
      </div>

      {session.task && (
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Task</span>
          <pre className={styles.taskFull}>{session.task}</pre>
        </div>
      )}

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

      {session.checkpoint && (
        <div className={styles.detailField}>
          <details className={styles.checkpointDetails}>
            <summary className={styles.checkpointSummary}>Raw checkpoint data</summary>
            <pre className={styles.checkpointPre}>{JSON.stringify(session.checkpoint, null, 2)}</pre>
          </details>
        </div>
      )}

      {session.checkpointSummary && (
        <div className={styles.detailField}>
          <span className={styles.detailLabel}>Checkpoint summary</span>
          <pre className={styles.taskFull}>{JSON.stringify(session.checkpointSummary, null, 2)}</pre>
        </div>
      )}

      <SessionLedgerPanel session={session} />
      <SessionActions session={session} onDone={onRefetch} />
    </div>
  )
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3].map((i) => (
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

export function SessionsView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const rawState = searchParams.get('state')
  const activeFilter: FilterState = isValidFilterState(rawState) ? rawState : 'all'
  const apiState = activeFilter === 'all' ? undefined : activeFilter

  const { data, isLoading, error } = useQuery<SessionsResponse, Error>({
    queryKey: ['sessions', activeFilter],
    queryFn: () => apiFetch<SessionsResponse>('/sessions', {
      operatorState: apiState,
      limit: 50,
    }),
    staleTime: 30_000,
  })

  const sessions = data?.sessions ?? []

  const handleTabClick = (filter: FilterState) => {
    const next = new URLSearchParams(searchParams)
    if (filter === 'all') next.delete('state')
    else next.set('state', filter)
    setSearchParams(next, { replace: true })
    setExpandedId(null)
  }

  const handleRowClick = (sessionId: string) => {
    setExpandedId((prev) => (prev === sessionId ? null : sessionId))
  }

  const handleRefetch = () => {
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  const apiError = data?.error

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <span className={styles.pageIcon} aria-hidden="true">⊙</span>
          <div>
            <h1 className={styles.pageTitle}>Session Recovery</h1>
            <p className={styles.pageSubtitle}>
              Agent sessions, recovery state, and ledger-backed memory traces
            </p>
          </div>
        </div>
        {data && !isLoading && (
          <span className={styles.sessionCount}>
            {data.total} session{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className={styles.filterBar} role="tablist" aria-label="Filter sessions by state">
        {FILTER_TABS.map((tab) => (
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
              {sessions.map((session) => {
                const isExpanded = expandedId === session.sessionId
                return (
                  <Fragment key={session.sessionId}>
                    <tr
                      className={`${styles.dataRow} ${isExpanded ? styles.dataRowExpanded : ''}`}
                      onClick={() => handleRowClick(session.sessionId)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleRowClick(session.sessionId)
                        }
                      }}
                    >
                      <td className={styles.cellBadge}>
                        <StateBadge state={displayState(session)} />
                      </td>
                      <td className={styles.cellSessionId}>{truncate(session.sessionId, 24)}</td>
                      <td className={styles.cellAgentId}>{session.agentId}</td>
                      <td className={styles.cellTask}>{truncate(session.task, 60)}</td>
                      <td className={styles.cellMeta}>{formatRelativeTime(session.startedAt)}</td>
                      <td className={styles.cellMeta}>{formatRelativeTime(session.updatedAt ?? session.lastHeartbeatAt)}</td>
                    </tr>
                    {isExpanded && (
                      <tr className={styles.detailRow}>
                        <td colSpan={6}>
                          <SessionDetailPanel session={session} onRefetch={handleRefetch} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
