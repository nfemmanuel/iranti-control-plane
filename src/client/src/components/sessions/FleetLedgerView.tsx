/* Iranti Control Plane — Fleet Ledger View */
/* Cross-instance event stream with human-readable descriptions */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchFleetLedger,
  fetchIngestionHealth,
} from '../../api/fleet-ledger'
import type {
  FleetLedgerEvent,
  FleetLedgerFilters,
  IngestionHealthEntry,
} from '../../api/fleet-ledger'
import styles from './FleetLedgerView.module.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function formatAbsoluteTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

type ActionCategory = 'inject' | 'checkpoint' | 'attend' | 'write' | 'conflict' | 'handshake' | 'error' | 'other'

function categorizeAction(actionType: string): ActionCategory {
  if (actionType.includes('memory_injected') || actionType.includes('memory_injection_scored')) return 'inject'
  if (actionType.includes('checkpoint')) return 'checkpoint'
  if (actionType.includes('attend') || actionType.includes('observe')) return 'attend'
  if (actionType.includes('write') || actionType.includes('created') || actionType.includes('replaced') || actionType.includes('updated')) return 'write'
  if (actionType.includes('conflict')) return 'conflict'
  if (actionType.includes('handshake')) return 'handshake'
  if (actionType.includes('error') || actionType.includes('fail')) return 'error'
  return 'other'
}

function describeAction(event: FleetLedgerEvent): string {
  const meta = event.metadata ?? {}
  switch (event.actionType) {
    case 'memory_injected': {
      const keys = Array.isArray(meta['injectedKeys']) ? meta['injectedKeys'] as string[] : []
      return keys.length > 0
        ? `Injected ${keys.length} fact${keys.length === 1 ? '' : 's'} into context`
        : 'Injected memory into context'
    }
    case 'memory_injection_scored': {
      const used = meta['used'] === true ? 'used' : 'unused'
      const helpful = meta['helpful'] === true ? 'helpful' : 'not helpful'
      return `Scored injection as ${used}, ${helpful}`
    }
    case 'memory_not_injected':
      return meta['attendReason'] === 'memory_needed_no_facts'
        ? 'No matching facts found for this turn'
        : 'Memory not needed for this turn'
    case 'checkpoint_written': {
      const step = typeof meta['currentStep'] === 'string' ? meta['currentStep'] : null
      return step ? `Checkpoint: ${step.slice(0, 100)}` : 'Saved shared checkpoint'
    }
    case 'attend_completed': {
      const reason = event.reason ?? String(meta['attendReason'] ?? '')
      if (reason === 'memory_injected') return 'Attend completed — memory was injected'
      if (reason === 'memory_not_injected') return 'Attend completed — no injection needed'
      return 'Attend cycle completed'
    }
    case 'observe_completed': {
      const type = typeof meta['observeType'] === 'string' ? meta['observeType'] : ''
      if (type === 'facts_retrieved') return 'Retrieved facts from memory'
      if (type === 'no_candidates') return 'No entities to observe'
      return 'Observation cycle completed'
    }
    case 'handshake_completed':
      return `Session started for ${event.agentId ?? 'unknown agent'}`
    case 'write_created':
      return `Created fact: ${typeof meta['key'] === 'string' ? meta['key'] : event.key ?? '?'}`
    case 'write_replaced':
      return `Updated fact: ${typeof meta['key'] === 'string' ? meta['key'] : event.key ?? '?'}`
    case 'write_updated':
      return `Updated fact: ${typeof meta['key'] === 'string' ? meta['key'] : event.key ?? '?'}`
    case 'write_available':
      return `Fact available: ${typeof meta['key'] === 'string' ? meta['key'] : event.key ?? '?'}`
    case 'conflict_detected':
      return `Conflict detected on ${event.entityType ?? '?'}/${event.entityId ?? '?'}`
    default:
      return event.actionType.replace(/_/g, ' ')
  }
}

function actionLabel(actionType: string): string {
  switch (actionType) {
    case 'memory_injected': return 'Injected'
    case 'memory_injection_scored': return 'Scored'
    case 'memory_not_injected': return 'No inject'
    case 'checkpoint_written': return 'Checkpoint'
    case 'attend_completed': return 'Attend'
    case 'observe_completed': return 'Observe'
    case 'handshake_completed': return 'Handshake'
    case 'write_created': return 'Write'
    case 'write_replaced': return 'Update'
    case 'write_updated': return 'Update'
    case 'write_available': return 'Available'
    case 'conflict_detected': return 'Conflict'
    default: return actionType.replace(/_/g, ' ').slice(0, 16)
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: IngestionHealthEntry['status'] }) {
  let cls = styles.badge
  switch (status) {
    case 'healthy': cls += ` ${styles.badgeHealthy}`; break
    case 'degraded': cls += ` ${styles.badgeDegraded}`; break
    case 'failing': cls += ` ${styles.badgeFailing}`; break
    default: cls += ` ${styles.badgeNeverPolled}`; break
  }
  return <span className={cls}>{status.replace('_', ' ')}</span>
}

function ActionPill({ actionType }: { actionType: string }) {
  const cat = categorizeAction(actionType)
  const cls = [styles.actionPill, styles[`actionPill_${cat}`]].filter(Boolean).join(' ')
  return <span className={cls}>{actionLabel(actionType)}</span>
}

function HealthCards({ entries, isLoading }: { entries: IngestionHealthEntry[]; isLoading: boolean }) {
  if (isLoading) return <div className={styles.healthCardsLoading}>Loading instance health...</div>
  if (entries.length === 0) return null

  return (
    <div className={styles.healthCards}>
      {entries.map((entry) => (
        <div
          key={entry.instanceId}
          className={`${styles.healthCard} ${
            entry.status === 'healthy' ? styles.healthCardOk
            : entry.status === 'failing' ? styles.healthCardBad
            : styles.healthCardWarn
          }`}
        >
          <div className={styles.healthCardHeader}>
            <span className={styles.healthCardInstance}>{entry.instanceId.slice(0, 8)}</span>
            <StatusBadge status={entry.status} />
          </div>
          <div className={styles.healthCardStats}>
            <span>{entry.totalEventsIngested.toLocaleString()} events</span>
            <span className={styles.muted}>{formatRelativeTime(entry.lastPolledAt)}</span>
          </div>
          {entry.lastPollError && (
            <div className={styles.healthCardError}>{entry.lastPollError.slice(0, 50)}</div>
          )}
        </div>
      ))}
    </div>
  )
}

interface FiltersBarProps {
  filters: FleetLedgerFilters
  onChange: (next: FleetLedgerFilters) => void
  onRefresh: () => void
  isRefreshing: boolean
}

function FiltersBar({ filters, onChange, onRefresh, isRefreshing }: FiltersBarProps) {
  const set = (key: keyof FleetLedgerFilters, value: string) => {
    onChange({ ...filters, [key]: value || undefined })
  }

  return (
    <div className={styles.filtersBar}>
      <input
        className={styles.filterInput}
        type="text"
        placeholder="Agent ID"
        value={filters.agentId ?? ''}
        onChange={(e) => set('agentId', e.target.value)}
        aria-label="Filter by agent ID"
      />
      <input
        className={styles.filterInput}
        type="text"
        placeholder="Action type"
        value={filters.actionType ?? ''}
        onChange={(e) => set('actionType', e.target.value)}
        aria-label="Filter by action type"
      />
      <input
        className={styles.filterInput}
        type="text"
        placeholder="Instance ID"
        value={filters.instanceId ?? ''}
        onChange={(e) => set('instanceId', e.target.value)}
        aria-label="Filter by instance ID"
      />
      <select
        className={styles.filterInput}
        value={filters.level ?? ''}
        onChange={(e) => {
          const v = e.target.value
          onChange({
            ...filters,
            level: v === 'audit' || v === 'debug' ? v : undefined,
          })
        }}
        aria-label="Filter by level"
      >
        <option value="">All levels</option>
        <option value="audit">audit</option>
        <option value="debug">debug</option>
      </select>
      <div style={{ flex: 1 }} />
      <button
        className={styles.refreshButton}
        onClick={onRefresh}
        disabled={isRefreshing}
        type="button"
      >
        {isRefreshing ? 'Refreshing...' : 'Refresh'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Event list (card-style, not raw table)
// ---------------------------------------------------------------------------

function EventRow({ event, isExpanded, onToggle }: {
  event: FleetLedgerEvent
  isExpanded: boolean
  onToggle: () => void
}) {
  const cat = categorizeAction(event.actionType)
  const hasMetadata = event.metadata !== null && Object.keys(event.metadata).length > 0

  return (
    <div
      className={`${styles.eventRow} ${styles[`eventRow_${cat}`] ?? ''} ${isExpanded ? styles.eventRowExpanded : ''}`}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
    >
      <div className={styles.eventMain}>
        <div className={styles.eventLeft}>
          <span className={styles.eventTime} title={formatAbsoluteTime(event.timestamp)}>
            {formatRelativeTime(event.timestamp)}
          </span>
          <ActionPill actionType={event.actionType} />
        </div>
        <div className={styles.eventDescription}>
          {describeAction(event)}
        </div>
        <div className={styles.eventMeta}>
          {event.agentId && <span className={styles.eventAgent}>{event.agentId}</span>}
          <span className={styles.eventInstance} title={event.instanceId}>{event.instanceId.slice(0, 8)}</span>
        </div>
      </div>
      {isExpanded && hasMetadata && (
        <div className={styles.eventExpanded}>
          <div className={styles.eventExpandedGrid}>
            {event.entityType && <div className={styles.expandedField}><span className={styles.expandedLabel}>Entity</span> {event.entityType}/{event.entityId}</div>}
            {event.key && <div className={styles.expandedField}><span className={styles.expandedLabel}>Key</span> {event.key}</div>}
            {event.reason && <div className={styles.expandedField}><span className={styles.expandedLabel}>Reason</span> {event.reason}</div>}
            {event.sessionId && <div className={styles.expandedField}><span className={styles.expandedLabel}>Session</span> {event.sessionId}</div>}
            {event.host && <div className={styles.expandedField}><span className={styles.expandedLabel}>Host</span> {event.host}</div>}
            {event.source && <div className={styles.expandedField}><span className={styles.expandedLabel}>Source</span> {event.source}</div>}
          </div>
          <pre className={styles.metadataPre}>
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------

function LedgerSummary({ events }: { events: FleetLedgerEvent[] }) {
  const injections = events.filter(e => e.actionType === 'memory_injected').length
  const checkpoints = events.filter(e => e.actionType === 'checkpoint_written').length
  const writes = events.filter(e => e.actionType.startsWith('write_')).length
  const conflicts = events.filter(e => e.actionType === 'conflict_detected').length
  const handshakes = events.filter(e => e.actionType === 'handshake_completed').length

  return (
    <div className={styles.summaryBar}>
      <div className={styles.summaryStat}>
        <span className={styles.summaryValue}>{events.length}</span>
        <span className={styles.summaryLabel}>events</span>
      </div>
      <div className={styles.summaryStat}>
        <span className={styles.summaryValue}>{injections}</span>
        <span className={styles.summaryLabel}>injections</span>
      </div>
      <div className={styles.summaryStat}>
        <span className={styles.summaryValue}>{checkpoints}</span>
        <span className={styles.summaryLabel}>checkpoints</span>
      </div>
      <div className={styles.summaryStat}>
        <span className={styles.summaryValue}>{writes}</span>
        <span className={styles.summaryLabel}>writes</span>
      </div>
      {conflicts > 0 && (
        <div className={`${styles.summaryStat} ${styles.summaryStatWarn}`}>
          <span className={styles.summaryValue}>{conflicts}</span>
          <span className={styles.summaryLabel}>conflicts</span>
        </div>
      )}
      <div className={styles.summaryStat}>
        <span className={styles.summaryValue}>{handshakes}</span>
        <span className={styles.summaryLabel}>sessions</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FleetLedgerView(): JSX.Element {
  const [filters, setFilters] = useState<FleetLedgerFilters>({ limit: 100 })
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const {
    data: ledger,
    isLoading: ledgerLoading,
    error: ledgerError,
    refetch: refetchLedger,
    isFetching: ledgerFetching,
  } = useQuery({
    queryKey: ['fleet-ledger', filters],
    queryFn: () => fetchFleetLedger(filters),
    refetchInterval: 30_000,
  })

  const {
    data: health,
    isLoading: healthLoading,
    refetch: refetchHealth,
  } = useQuery({
    queryKey: ['fleet-ledger-health'],
    queryFn: fetchIngestionHealth,
    refetchInterval: 60_000,
  })

  const events = ledger?.items ?? []
  const healthEntries = health?.instances ?? []

  const handleRefresh = () => {
    void refetchLedger()
    void refetchHealth()
  }

  const handleFiltersChange = (next: FleetLedgerFilters) => {
    setFilters({ ...next, limit: filters.limit ?? 100 })
    setExpandedId(null)
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <span className={styles.pageIcon} aria-hidden="true">⊛</span>
          <div>
            <h1 className={styles.pageTitle}>Fleet Ledger</h1>
            <p className={styles.pageSubtitle}>
              What your Iranti instances are doing — memory operations across all connected instances
            </p>
          </div>
        </div>
        {ledger && !ledgerLoading && (
          <span className={styles.eventCount}>
            {ledger.total.toLocaleString()} event{ledger.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Instance health cards — always visible at top */}
      <HealthCards entries={healthEntries} isLoading={healthLoading} />

      {/* Filters */}
      <FiltersBar
        filters={filters}
        onChange={handleFiltersChange}
        onRefresh={handleRefresh}
        isRefreshing={ledgerFetching}
      />

      {/* Error */}
      {ledgerError && (
        <div className={styles.errorState} role="alert">
          Could not load fleet ledger — {(ledgerError as Error).message}
        </div>
      )}

      {/* Summary stats */}
      {!ledgerLoading && events.length > 0 && (
        <LedgerSummary events={events} />
      )}

      {/* Event stream */}
      <div className={styles.contentRegion}>
        {ledgerLoading && (
          <div className={styles.spinnerWrapper} role="status">
            <span className={styles.spinner} />
            <span>Loading events...</span>
          </div>
        )}

        {!ledgerLoading && !ledgerError && events.length === 0 && (
          <div className={styles.emptyState}>
            <p className={styles.emptyStateTitle}>No events found</p>
            <p className={styles.emptyStateBody}>
              Events are ingested from connected Iranti instances.
              Try adjusting filters or verify that at least one instance is being polled.
            </p>
          </div>
        )}

        {!ledgerLoading && events.length > 0 && (
          <div className={styles.eventList}>
            {events.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                isExpanded={expandedId === event.id}
                onToggle={() => setExpandedId(prev => prev === event.id ? null : event.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
