/* Iranti Control Plane — Fleet Ledger View */
/* Minimum Operator UI slice: cross-instance event stream + ingestion health */

import { Fragment, useState } from 'react'
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

function truncate(str: string | null | undefined, len: number): string {
  if (!str) return '—'
  return str.length > len ? `${str.slice(0, len)}…` : str
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: IngestionHealthEntry['status'] }) {
  let cls = styles.badge
  switch (status) {
    case 'healthy':
      cls += ` ${styles.badgeHealthy}`
      break
    case 'degraded':
      cls += ` ${styles.badgeDegraded}`
      break
    case 'failing':
      cls += ` ${styles.badgeFailing}`
      break
    case 'never_polled':
    default:
      cls += ` ${styles.badgeNeverPolled}`
      break
  }
  return <span className={cls}>{status.replace('_', ' ')}</span>
}

function LedgerSkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <tr key={i} className={styles.skeletonRow}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j}>
              <div className={styles.skeletonBar} style={{ width: `${55 + (j * 7) % 40}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

interface ExpandedMetadataRowProps {
  event: FleetLedgerEvent
  colSpan: number
}

function ExpandedMetadataRow({ event, colSpan }: ExpandedMetadataRowProps) {
  const hasMetadata = event.metadata !== null && Object.keys(event.metadata).length > 0
  return (
    <tr className={styles.metadataRow}>
      <td colSpan={colSpan}>
        <div className={styles.metadataExpanded}>
          <p className={styles.metadataLabel}>Event metadata</p>
          {hasMetadata ? (
            <pre className={styles.metadataPre}>
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          ) : (
            <span className={styles.metadataNull}>null</span>
          )}
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Filters bar
// ---------------------------------------------------------------------------

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
        className={`${styles.filterInput} ${styles.filterInputWide}`}
        type="text"
        placeholder="Instance ID"
        value={filters.instanceId ?? ''}
        onChange={(e) => set('instanceId', e.target.value)}
        aria-label="Filter by instance ID"
      />
      <input
        className={`${styles.filterInput} ${styles.filterInputWide}`}
        type="text"
        placeholder="Agent ID"
        value={filters.agentId ?? ''}
        onChange={(e) => set('agentId', e.target.value)}
        aria-label="Filter by agent ID"
      />
      <input
        className={`${styles.filterInput} ${styles.filterInputWide}`}
        type="text"
        placeholder="Session ID"
        value={filters.sessionId ?? ''}
        onChange={(e) => set('sessionId', e.target.value)}
        aria-label="Filter by session ID"
      />
      <input
        className={`${styles.filterInput} ${styles.filterInputNarrow}`}
        type="text"
        placeholder="Action type"
        value={filters.actionType ?? ''}
        onChange={(e) => set('actionType', e.target.value)}
        aria-label="Filter by action type"
      />
      <input
        className={`${styles.filterInput} ${styles.filterInputNarrow}`}
        type="text"
        placeholder="Host"
        value={filters.host ?? ''}
        onChange={(e) => set('host', e.target.value)}
        aria-label="Filter by host"
      />
      <input
        className={`${styles.filterInput} ${styles.filterInputNarrow}`}
        type="text"
        placeholder="Source"
        value={filters.source ?? ''}
        onChange={(e) => set('source', e.target.value)}
        aria-label="Filter by source"
      />
      <select
        className={`${styles.filterInput} ${styles.filterInputNarrow}`}
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
      <div className={styles.filterSeparator} />
      <button
        className={styles.refreshButton}
        onClick={onRefresh}
        disabled={isRefreshing}
        type="button"
      >
        {isRefreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ledger stream table
// ---------------------------------------------------------------------------

interface LedgerTableProps {
  events: FleetLedgerEvent[]
  isLoading: boolean
  expandedId: number | null
  onToggle: (id: number) => void
}

const LEDGER_COLS = 8

function LedgerTable({ events, isLoading, expandedId, onToggle }: LedgerTableProps) {
  return (
    <table
      className={`${styles.table} ${styles.ledgerTable}`}
      aria-label="Fleet ledger events"
    >
      <thead>
        <tr>
          <th className={styles.headerCell}>Time</th>
          <th className={styles.headerCell}>Instance</th>
          <th className={styles.headerCell}>Component</th>
          <th className={styles.headerCell}>Action Type</th>
          <th className={styles.headerCell}>Agent</th>
          <th className={styles.headerCell}>Host</th>
          <th className={styles.headerCell}>Source</th>
          <th className={styles.headerCell}>Session</th>
        </tr>
      </thead>
      <tbody>
        {isLoading && <LedgerSkeletonRows cols={LEDGER_COLS} />}
        {!isLoading && events.map((event) => {
          const isExpanded = expandedId === event.id
          const rowCls = [
            styles.row,
            isExpanded ? styles.rowExpanded : '',
            event.level === 'debug' ? styles.rowDebug : '',
          ].filter(Boolean).join(' ')

          return (
            <Fragment key={event.id}>
              <tr
                className={rowCls}
                onClick={() => onToggle(event.id)}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onToggle(event.id)
                  }
                }}
              >
                <td className={`${styles.cell} ${styles.cellMono}`} title={event.timestamp}>
                  {formatAbsoluteTime(event.timestamp)}
                </td>
                <td className={`${styles.cell} ${styles.cellMono}`} title={event.instanceId}>
                  {truncate(event.instanceId, 14)}
                </td>
                <td className={`${styles.cell} ${styles.cellMono} ${styles.cellPrimary}`}>
                  {truncate(event.staffComponent, 16)}
                </td>
                <td className={`${styles.cell} ${styles.cellMono}`}>
                  {truncate(event.actionType, 18)}
                </td>
                <td className={`${styles.cell} ${styles.cellMono}`}>
                  {truncate(event.agentId, 14)}
                </td>
                <td className={`${styles.cell} ${styles.cellMono}`}>
                  {truncate(event.host, 12)}
                </td>
                <td className={`${styles.cell} ${styles.cellMono}`}>
                  {truncate(event.source, 12)}
                </td>
                <td className={`${styles.cell} ${styles.cellMono}`} title={event.sessionId ?? ''}>
                  {truncate(event.sessionId, 20)}
                </td>
              </tr>
              {isExpanded && (
                <ExpandedMetadataRow event={event} colSpan={LEDGER_COLS} />
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Ingestion health table
// ---------------------------------------------------------------------------

interface HealthTableProps {
  entries: IngestionHealthEntry[]
  isLoading: boolean
}

function HealthTable({ entries, isLoading }: HealthTableProps) {
  return (
    <table
      className={`${styles.table} ${styles.healthTable}`}
      aria-label="Ingestion health per instance"
    >
      <thead>
        <tr>
          <th className={styles.headerCell}>Instance</th>
          <th className={styles.headerCell}>Status</th>
          <th className={styles.headerCell}>Last Polled</th>
          <th className={styles.headerCell}>Failures</th>
          <th className={styles.headerCell}>Total Events</th>
          <th className={styles.headerCell}>Last Error</th>
        </tr>
      </thead>
      <tbody>
        {isLoading && <LedgerSkeletonRows cols={6} />}
        {!isLoading && entries.map((entry) => (
          <tr key={entry.instanceId} className={styles.row}>
            <td className={`${styles.cell} ${styles.cellMono} ${styles.cellPrimary}`}>
              {entry.instanceId}
            </td>
            <td className={styles.cell}>
              <StatusBadge status={entry.status} />
            </td>
            <td className={`${styles.cell} ${styles.cellMono}`} title={entry.lastPolledAt ?? ''}>
              {formatRelativeTime(entry.lastPolledAt)}
            </td>
            <td className={`${styles.cell} ${styles.cellMono}`}>
              {entry.consecutiveFailures > 0 ? (
                <span style={{ color: 'var(--color-status-error)' }}>
                  {entry.consecutiveFailures}
                </span>
              ) : (
                <span className={styles.muted}>0</span>
              )}
            </td>
            <td className={`${styles.cell} ${styles.cellMono}`}>
              {entry.totalEventsIngested.toLocaleString()}
            </td>
            <td className={`${styles.cell} ${styles.errorCell}`} title={entry.lastPollError ?? ''}>
              {entry.lastPollError ? truncate(entry.lastPollError, 60) : <span className={styles.muted}>—</span>}
            </td>
          </tr>
        ))}
        {!isLoading && entries.length === 0 && (
          <tr>
            <td colSpan={6} className={styles.cell}>
              <span className={styles.muted}>No instances tracked yet.</span>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FleetLedgerView(): JSX.Element {
  const [filters, setFilters] = useState<FleetLedgerFilters>({ limit: 100 })
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [healthExpanded, setHealthExpanded] = useState(true)

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
  const isRefreshing = ledgerFetching

  const handleRefresh = () => {
    void refetchLedger()
    void refetchHealth()
  }

  const handleToggleRow = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  const handleFiltersChange = (next: FleetLedgerFilters) => {
    setFilters({ ...next, limit: filters.limit ?? 100 })
    setExpandedId(null)
  }

  return (
    <div className={styles.page}>
      {/* ── Page header ── */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <span className={styles.pageIcon} aria-hidden="true">⊛</span>
          <div>
            <h1 className={styles.pageTitle}>Fleet Ledger</h1>
            <p className={styles.pageSubtitle}>
              Cross-instance event stream and ingestion health
            </p>
          </div>
        </div>
        {ledger && !ledgerLoading && (
          <span className={styles.eventCount}>
            {ledger.total.toLocaleString()} event{ledger.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Filters ── */}
      <FiltersBar
        filters={filters}
        onChange={handleFiltersChange}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {/* ── Error state ── */}
      {ledgerError && (
        <div className={styles.errorState} role="alert">
          <span className={styles.errorStateIcon} aria-hidden="true">⚠</span>
          <span>
            Could not load fleet ledger events — {(ledgerError as Error).message}
          </span>
        </div>
      )}

      {/* ── Content ── */}
      <div className={styles.contentRegion}>

        {/* ── Ledger stream section ── */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Event stream
            {ledger?.note && (
              <span className={styles.sectionNoteInline}>{ledger.note}</span>
            )}
          </h2>

          {ledgerLoading && (
            <div className={styles.spinnerWrapper} role="status" aria-label="Loading ledger events">
              <span className={styles.spinner} />
              <span>Loading ledger events…</span>
            </div>
          )}

          {!ledgerLoading && !ledgerError && events.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyStateIcon} aria-hidden="true">⊛</span>
              <p className={styles.emptyStateTitle}>No events found</p>
              <p className={styles.emptyStateBody}>
                Fleet ledger events are ingested from connected Iranti instances.
                Try adjusting your filters or verify that at least one instance is actively polled.
              </p>
            </div>
          )}

          {!ledgerLoading && events.length > 0 && (
            <LedgerTable
              events={events}
              isLoading={false}
              expandedId={expandedId}
              onToggle={handleToggleRow}
            />
          )}
        </div>

        {/* ── Ingestion health section ── */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Ingestion health
            <button
              className={styles.sectionToggleBtn}
              onClick={() => setHealthExpanded((v) => !v)}
              type="button"
              aria-expanded={healthExpanded}
            >
              {healthExpanded ? '▾ collapse' : '▸ expand'}
            </button>
          </h2>

          {healthExpanded && (
            <>
              {healthLoading && (
                <div className={styles.spinnerWrapper} role="status" aria-label="Loading ingestion health">
                  <span className={styles.spinner} />
                  <span>Loading ingestion health…</span>
                </div>
              )}
              {!healthLoading && (
                <HealthTable entries={healthEntries} isLoading={false} />
              )}
            </>
          )}
        </div>

      </div>
    </div>
  )
}
