/* Iranti Control Plane — Staff Logs View */
/* Route: /logs */
/* CP-T050 — Persistent, filterable log history over staff_events table */
/*            Distinct from ActivityStream (/activity) which is a live SSE tail. */

import { Fragment, useState, useReducer, useEffect, useRef, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { StaffEvent, EventListResponse } from '../../api/types'
import styles from './StaffLogs.module.css'
import { Spinner } from '../ui/Spinner'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type StaffComponent = 'Librarian' | 'Attendant' | 'Archivist' | 'Resolutionist'
type ExportFormat = 'jsonl' | 'csv'

/** Derived log level — not stored in DB, computed from eventType + payload */
type DerivedLevel = 'info' | 'warning' | 'error'

interface LogFilters {
  components: Set<StaffComponent>
  eventType: string
  agentId: string
  level: 'all' | 'audit' | 'debug'
  derivedLevel: 'all' | 'info' | 'warning' | 'error'
  since: string
  until: string
  search: string
}

interface PaginationState {
  offset: number
  limit: number
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const ALL_COMPONENTS: StaffComponent[] = ['Librarian', 'Attendant', 'Archivist', 'Resolutionist']
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const
type PageSize = typeof PAGE_SIZE_OPTIONS[number]

const DEFAULT_FILTERS: LogFilters = {
  components: new Set(ALL_COMPONENTS),
  eventType: '',
  agentId: '',
  level: 'all',
  derivedLevel: 'all',
  since: '',
  until: '',
  search: '',
}

/* ------------------------------------------------------------------ */
/*  Derived level classification (frontend-only, per CP-T050 spec)     */
/* ------------------------------------------------------------------ */

function classifyEventLevel(event: StaffEvent): DerivedLevel {
  const et = event.actionType.toLowerCase()
  // Error: payload has error field, or eventType contains these keywords
  if (
    (event.metadata && 'error' in event.metadata) ||
    et.includes('failed') ||
    et.includes('rejected') ||
    et.includes('error')
  ) {
    return 'error'
  }
  // Warning: conflict, decay, escalated, superseded
  if (
    et.includes('conflict') ||
    et.includes('decay') ||
    et.includes('escalated') ||
    et.includes('superseded')
  ) {
    return 'warning'
  }
  return 'info'
}

/* ------------------------------------------------------------------ */
/*  Filter reducer                                                      */
/* ------------------------------------------------------------------ */

type FilterAction =
  | { type: 'TOGGLE_COMPONENT'; component: StaffComponent }
  | { type: 'SET_ALL_COMPONENTS' }
  | { type: 'SET_EVENT_TYPE'; value: string }
  | { type: 'SET_AGENT_ID'; value: string }
  | { type: 'SET_LEVEL'; value: LogFilters['level'] }
  | { type: 'SET_DERIVED_LEVEL'; value: LogFilters['derivedLevel'] }
  | { type: 'SET_SINCE'; value: string }
  | { type: 'SET_UNTIL'; value: string }
  | { type: 'SET_SEARCH'; value: string }
  | { type: 'RESET' }
  | { type: 'FROM_PARAMS'; params: URLSearchParams }

function filterReducer(state: LogFilters, action: FilterAction): LogFilters {
  switch (action.type) {
    case 'TOGGLE_COMPONENT': {
      const next = new Set(state.components)
      if (next.has(action.component)) {
        next.delete(action.component)
      } else {
        next.add(action.component)
      }
      return { ...state, components: next }
    }
    case 'SET_ALL_COMPONENTS':
      return { ...state, components: new Set(ALL_COMPONENTS) }
    case 'SET_EVENT_TYPE':
      return { ...state, eventType: action.value }
    case 'SET_AGENT_ID':
      return { ...state, agentId: action.value }
    case 'SET_LEVEL':
      return { ...state, level: action.value }
    case 'SET_DERIVED_LEVEL':
      return { ...state, derivedLevel: action.value }
    case 'SET_SINCE':
      return { ...state, since: action.value }
    case 'SET_UNTIL':
      return { ...state, until: action.value }
    case 'SET_SEARCH':
      return { ...state, search: action.value }
    case 'RESET':
      return { ...DEFAULT_FILTERS, components: new Set(ALL_COMPONENTS) }
    case 'FROM_PARAMS': {
      const p = action.params
      const comps: StaffComponent[] = []
      const raw = p.get('components')
      if (raw) {
        raw.split(',').forEach(c => {
          if (ALL_COMPONENTS.includes(c as StaffComponent)) {
            comps.push(c as StaffComponent)
          }
        })
      }
      const level = p.get('level')
      const derivedLevel = p.get('derivedLevel')
      return {
        components: comps.length > 0 ? new Set(comps) : new Set(ALL_COMPONENTS),
        eventType: p.get('eventType') ?? '',
        agentId: p.get('agentId') ?? '',
        level: (level === 'audit' || level === 'debug') ? level : 'all',
        derivedLevel: (derivedLevel === 'info' || derivedLevel === 'warning' || derivedLevel === 'error') ? derivedLevel : 'all',
        since: p.get('since') ?? '',
        until: p.get('until') ?? '',
        search: p.get('search') ?? '',
      }
    }
    default:
      return state
  }
}

/* ------------------------------------------------------------------ */
/*  URL sync helpers                                                    */
/* ------------------------------------------------------------------ */

function filtersToParams(filters: LogFilters): URLSearchParams {
  const p = new URLSearchParams()
  const comps = Array.from(filters.components)
  if (comps.length > 0 && comps.length < 4) {
    p.set('components', comps.join(','))
  }
  if (filters.eventType) p.set('eventType', filters.eventType)
  if (filters.agentId) p.set('agentId', filters.agentId)
  if (filters.level !== 'all') p.set('level', filters.level)
  if (filters.derivedLevel !== 'all') p.set('derivedLevel', filters.derivedLevel)
  if (filters.since) p.set('since', filters.since)
  if (filters.until) p.set('until', filters.until)
  if (filters.search) p.set('search', filters.search)
  return p
}

/* ------------------------------------------------------------------ */
/*  Debounce hook                                                       */
/* ------------------------------------------------------------------ */

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/* ------------------------------------------------------------------ */
/*  Time helpers                                                        */
/* ------------------------------------------------------------------ */

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatRelative(isoTimestamp: string, now: number): string {
  const diff = now - new Date(isoTimestamp).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(isoTimestamp).toLocaleDateString()
}

/* ------------------------------------------------------------------ */
/*  Component badge color                                               */
/* ------------------------------------------------------------------ */

function getComponentColorVar(component: StaffComponent): string {
  switch (component) {
    case 'Librarian': return 'var(--color-staff-librarian)'
    case 'Attendant': return 'var(--color-staff-attendant)'
    case 'Archivist': return 'var(--color-staff-archivist)'
    case 'Resolutionist': return 'var(--color-staff-resolutionist)'
  }
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function ComponentBadge({ component }: { component: StaffComponent }) {
  return (
    <span
      className={styles.componentBadge}
      style={{ color: getComponentColorVar(component) }}
    >
      {component.toUpperCase().slice(0, 4)}
    </span>
  )
}

function LevelBadge({ level }: { level: DerivedLevel }) {
  const cls =
    level === 'error' ? styles.levelBadgeError
    : level === 'warning' ? styles.levelBadgeWarning
    : styles.levelBadgeInfo

  return (
    <span className={`${styles.levelBadge} ${cls}`}>
      {level}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Expanded row                                                        */
/* ------------------------------------------------------------------ */

function ExpandedEventRow({ event }: { event: StaffEvent }) {
  const hasEntity = Boolean(event.entityType && event.entityId)
  const entityTypeSafe = event.entityType ?? ''
  const entityIdSafe = event.entityId ?? ''

  return (
    <tr className={styles.expandedRowContainer}>
      <td colSpan={8} className={styles.expandedRowTd}>
        <div className={styles.expandedContent}>
          {/* Metadata grid */}
          <div className={styles.expandedGrid}>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Event ID</span>
              <span className={styles.expandedValueMono}>{event.eventId}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Timestamp</span>
              <span className={styles.expandedValue}>{event.timestamp}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Source</span>
              <span className={styles.expandedValue}>{event.source}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Level (raw)</span>
              <span className={styles.expandedValue}>{event.level}</span>
            </div>
            {event.key && (
              <div className={styles.expandedField}>
                <span className={styles.expandedLabel}>Key</span>
                <span className={styles.expandedValueMono}>{event.key}</span>
              </div>
            )}
            {event.reason && (
              <div className={styles.expandedField}>
                <span className={styles.expandedLabel}>Reason (full)</span>
                <span className={styles.expandedValue}>{event.reason}</span>
              </div>
            )}
          </div>

          {/* Payload / metadata JSON */}
          {event.metadata && (
            <div className={styles.expandedPayloadBlock}>
              <span className={styles.expandedLabel}>Metadata payload</span>
              <pre className={styles.expandedPre}>{JSON.stringify(event.metadata, null, 2)}</pre>
            </div>
          )}

          {/* Action links */}
          <div className={styles.expandedActions}>
            {hasEntity && (
              <Link
                to={`/memory/${encodeURIComponent(entityTypeSafe)}/${encodeURIComponent(entityIdSafe)}`}
                className={styles.expandedActionButton}
              >
                View Entity →
              </Link>
            )}
            {hasEntity && (
              <Link
                to={`/archive?entityType=${encodeURIComponent(entityTypeSafe)}&entityId=${encodeURIComponent(entityIdSafe)}`}
                className={styles.expandedActionButton}
              >
                View in Archive →
              </Link>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/*  Data row                                                            */
/* ------------------------------------------------------------------ */

function LogRow({
  event,
  expanded,
  onToggle,
  now,
}: {
  event: StaffEvent
  expanded: boolean
  onToggle: () => void
  now: number
}) {
  const derivedLevel = classifyEventLevel(event)

  const entityDisplay = event.entityType && event.entityId
    ? (
        <>
          <span style={{ color: 'var(--color-text-tertiary)' }}>{event.entityType}</span>
          <span className={styles.entitySep}>/</span>
          <span>{event.entityId}</span>
        </>
      )
    : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>

  return (
    <Fragment>
      <tr
        className={`${styles.dataRow} ${expanded ? styles.dataRowExpanded : ''}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      >
        {/* Timestamp */}
        <td className={styles.cellTimestamp} title={formatRelative(event.timestamp, now)}>
          {formatTimestamp(event.timestamp)}
        </td>

        {/* Component badge */}
        <td className={styles.cellComponent}>
          <ComponentBadge component={event.staffComponent} />
        </td>

        {/* Event / action type */}
        <td className={styles.cellEventType}>
          {event.actionType}
        </td>

        {/* Agent */}
        <td className={styles.cellAgent}>
          {event.agentId}
        </td>

        {/* Entity type / entity ID */}
        <td className={styles.cellEntity}>
          {entityDisplay}
        </td>

        {/* Level */}
        <td className={styles.cellLevel}>
          <LevelBadge level={derivedLevel} />
        </td>

        {/* Reason (truncated) */}
        <td className={styles.cellReason} title={event.reason ?? undefined}>
          {event.reason ?? ''}
        </td>

        {/* Expand toggle */}
        <td className={styles.cellExpand} aria-hidden="true">
          {expanded ? '▼' : '▶'}
        </td>
      </tr>

      {expanded && <ExpandedEventRow event={event} />}
    </Fragment>
  )
}

/* ------------------------------------------------------------------ */
/*  Pagination controls                                                 */
/* ------------------------------------------------------------------ */

function PaginationControls({
  pagination,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  pagination: PaginationState
  total: number
  onPageChange: (offset: number) => void
  onPageSizeChange: (limit: PageSize) => void
}) {
  const { offset, limit } = pagination
  const currentPage = Math.floor(offset / limit) + 1
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const start = total > 0 ? offset + 1 : 0
  const end = Math.min(offset + limit, total)

  return (
    <div className={styles.pagination}>
      <span className={styles.paginationCount}>
        {total > 0 ? `Showing ${start}–${end} of ${total} events` : 'No results'}
      </span>
      <div className={styles.paginationControls}>
        <button
          className={styles.paginationButton}
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          disabled={offset === 0}
          aria-label="Previous page"
          type="button"
        >
          ← Prev
        </button>
        <span className={styles.paginationPage}>{currentPage} / {totalPages}</span>
        <button
          className={styles.paginationButton}
          onClick={() => onPageChange(offset + limit)}
          disabled={offset + limit >= total}
          aria-label="Next page"
          type="button"
        >
          Next →
        </button>
        <select
          className={styles.paginationPageSize}
          value={limit}
          onChange={e => onPageSizeChange(Number(e.target.value) as PageSize)}
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map(size => (
            <option key={size} value={size}>{size} per page</option>
          ))}
        </select>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Empty state sub-component                                           */
/* ------------------------------------------------------------------ */

function EmptyState({
  hasFilters,
  is503,
  onClearFilters,
}: {
  hasFilters: boolean
  is503: boolean
  onClearFilters: () => void
}) {
  if (is503) {
    return (
      <tr>
        <td colSpan={8}>
          <div className={styles.emptyState}>
            <span className={styles.emptyStateIcon} aria-hidden="true">◈</span>
            <p className={styles.emptyStateTitle}>Staff events table not found</p>
            <p className={styles.emptyStateBody}>
              Run <code className={styles.emptyStateCode}>npm run migrate</code> to create the{' '}
              <code className={styles.emptyStateCode}>staff_events</code> table.
            </p>
          </div>
        </td>
      </tr>
    )
  }

  if (hasFilters) {
    return (
      <tr>
        <td colSpan={8}>
          <div className={styles.emptyState}>
            <span className={styles.emptyStateIcon} aria-hidden="true">◈</span>
            <p className={styles.emptyStateTitle}>No events match the current filters</p>
            <p className={styles.emptyStateBody}>Try adjusting your search terms or clearing your filters.</p>
            <button
              className={styles.emptyStateCtaBtn}
              onClick={onClearFilters}
              type="button"
            >
              Clear all filters
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td colSpan={8}>
        <div className={styles.emptyState}>
          <span className={styles.emptyStateIcon} aria-hidden="true">◈</span>
          <p className={styles.emptyStateTitle}>No staff events recorded yet</p>
          <p className={styles.emptyStateBody}>
            Events appear here once the Iranti Staff emitter is active.
            If this is unexpected, run{' '}
            <code className={styles.emptyStateCode}>npm run migrate</code> to ensure the{' '}
            <code className={styles.emptyStateCode}>staff_events</code> table exists.
          </p>
        </div>
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function StaffLogs() {
  const [searchParams, setSearchParams] = useSearchParams()

  // Initialize filters from URL params on first render
  const [filters, dispatch] = useReducer(filterReducer, DEFAULT_FILTERS, (init) => {
    return filterReducer(init, { type: 'FROM_PARAMS', params: searchParams })
  })

  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({ offset: 0, limit: 25 })
  const [exportFormat, setExportFormat] = useState<ExportFormat>('jsonl')
  const [exporting, setExporting] = useState(false)

  const now = useNow(15_000)

  // Debounce free-text inputs before triggering query
  const debouncedSearch = useDebounced(filters.search, 350)
  const debouncedEventType = useDebounced(filters.eventType, 350)
  const debouncedAgentId = useDebounced(filters.agentId, 350)

  // Sync filters to URL whenever they change
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setSearchParams(filtersToParams(filters), { replace: true })
  }, [filters, setSearchParams])

  // Reset to page 1 when filters change
  const prevFiltersRef = useRef(filters)
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      setPagination(p => ({ ...p, offset: 0 }))
      prevFiltersRef.current = filters
    }
  }, [filters])

  // Build API query params
  const comps = Array.from(filters.components)
  const queryParams: Record<string, string | number | boolean | undefined> = {
    limit: pagination.limit,
    offset: pagination.offset,
    ...(comps.length > 0 && comps.length < 4 && { staffComponent: comps.join(',') }),
    ...(debouncedEventType && { eventType: debouncedEventType }),
    ...(debouncedAgentId && { agentId: debouncedAgentId }),
    ...(filters.level !== 'all' && { level: filters.level }),
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(filters.since && { since: filters.since }),
    ...(filters.until && { until: filters.until }),
  }

  const { data, isLoading, error, refetch } = useQuery<EventListResponse, Error>({
    queryKey: ['logs', queryParams],
    queryFn: () => apiFetch<EventListResponse>('/logs', queryParams),
  })

  const events = data?.items ?? []
  const total = data?.total ?? 0

  // Apply client-side derived level filter (not sent to server — derived from event shape)
  const visibleEvents = filters.derivedLevel === 'all'
    ? events
    : events.filter(e => classifyEventLevel(e) === filters.derivedLevel)

  const toggleRow = (id: string) => setExpandedRowId(prev => prev === id ? null : id)

  const hasFilters =
    filters.components.size < 4 ||
    filters.eventType !== '' ||
    filters.agentId !== '' ||
    filters.level !== 'all' ||
    filters.derivedLevel !== 'all' ||
    filters.since !== '' ||
    filters.until !== '' ||
    filters.search !== ''

  const clearFilters = useCallback(() => {
    dispatch({ type: 'RESET' })
    setPagination(p => ({ ...p, offset: 0 }))
  }, [])

  // 503 detection: error message contains 'staff_events' table not found signal
  const is503 = Boolean(error && (error.message.includes('503') || error.message.toLowerCase().includes('staff_events')))

  // Export handler
  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      const exportParams = new URLSearchParams()
      const exportComps = Array.from(filters.components)
      if (exportComps.length > 0 && exportComps.length < 4) {
        exportParams.set('staffComponent', exportComps.join(','))
      }
      if (filters.eventType) exportParams.set('eventType', filters.eventType)
      if (filters.agentId) exportParams.set('agentId', filters.agentId)
      if (filters.level !== 'all') exportParams.set('level', filters.level)
      if (filters.search) exportParams.set('search', filters.search)
      if (filters.since) exportParams.set('since', filters.since)
      if (filters.until) exportParams.set('until', filters.until)
      exportParams.set('format', exportFormat)

      const url = `/api/control-plane/logs/export?${exportParams.toString()}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Export failed: ${res.statusText}`)

      const blob = await res.blob()
      const isoTs = new Date().toISOString().replace(/[:.]/g, '-')
      const compLabel = filters.components.size < 4
        ? Array.from(filters.components).join('-').toLowerCase()
        : 'all'
      const filename = `iranti-staff-logs-${isoTs}-${compLabel}.${exportFormat}`

      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(blob)
      anchor.download = filename
      anchor.click()
      URL.revokeObjectURL(anchor.href)
    } catch (err) {
      // Non-fatal: show console error, don't crash the view
      console.error('[StaffLogs] Export failed:', err)
    } finally {
      setExporting(false)
    }
  }, [filters, exportFormat])

  return (
    <div className={styles.page}>
      {/* ── Filter bar ─────────────────────────────────────────── */}
      <div className={styles.filterBar} role="search" aria-label="Filter staff logs">

        {/* Row 1: Component toggles + level + derived level */}
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Component:</span>
          {ALL_COMPONENTS.map(c => (
            <label
              key={c}
              className={`${styles.componentToggle} ${filters.components.has(c) ? styles.componentToggleChecked : ''}`}
            >
              <input
                type="checkbox"
                className={styles.filterCheckbox}
                checked={filters.components.has(c)}
                onChange={() => dispatch({ type: 'TOGGLE_COMPONENT', component: c })}
                aria-label={`Include ${c} events`}
              />
              <span style={{ color: getComponentColorVar(c) }}>{c}</span>
            </label>
          ))}

          <span className={styles.filterSep} />

          <span className={styles.filterLabel}>Level:</span>
          <select
            className={styles.filterSelect}
            value={filters.level}
            onChange={e => dispatch({ type: 'SET_LEVEL', value: e.target.value as LogFilters['level'] })}
            aria-label="Filter by raw level"
          >
            <option value="all">All levels</option>
            <option value="audit">audit</option>
            <option value="debug">debug</option>
          </select>

          <span className={styles.filterSep} />

          <span className={styles.filterLabel}>Severity:</span>
          <select
            className={styles.filterSelect}
            value={filters.derivedLevel}
            onChange={e => dispatch({ type: 'SET_DERIVED_LEVEL', value: e.target.value as LogFilters['derivedLevel'] })}
            aria-label="Filter by derived severity"
          >
            <option value="all">All severity</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
          </select>
        </div>

        {/* Row 2: Text filters */}
        <div className={styles.filterRow}>
          <input
            type="search"
            className={styles.filterInputWide}
            placeholder="Full-text search (event type, agent, entity…)"
            value={filters.search}
            onChange={e => dispatch({ type: 'SET_SEARCH', value: e.target.value })}
            aria-label="Full-text search"
          />
          <input
            type="text"
            className={styles.filterInput}
            placeholder="Event type"
            value={filters.eventType}
            onChange={e => dispatch({ type: 'SET_EVENT_TYPE', value: e.target.value })}
            aria-label="Filter by event type"
          />
          <input
            type="text"
            className={styles.filterInput}
            placeholder="Agent ID"
            value={filters.agentId}
            onChange={e => dispatch({ type: 'SET_AGENT_ID', value: e.target.value })}
            aria-label="Filter by agent ID"
          />
        </div>

        {/* Row 3: Date range + export + clear */}
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Since:</span>
          <input
            type="datetime-local"
            className={styles.filterDateInput}
            value={filters.since}
            onChange={e => dispatch({ type: 'SET_SINCE', value: e.target.value })}
            aria-label="Events since (datetime)"
          />
          <span className={styles.filterLabel}>Until:</span>
          <input
            type="datetime-local"
            className={styles.filterDateInput}
            value={filters.until}
            onChange={e => dispatch({ type: 'SET_UNTIL', value: e.target.value })}
            aria-label="Events until (datetime)"
          />

          <span className={styles.filterSep} />

          {/* Export format toggle + button */}
          <div className={styles.exportFormatGroup} role="group" aria-label="Export format">
            <button
              type="button"
              className={`${styles.exportFormatBtn} ${exportFormat === 'jsonl' ? styles.exportFormatBtnActive : ''}`}
              onClick={() => setExportFormat('jsonl')}
              aria-pressed={exportFormat === 'jsonl'}
            >
              JSONL
            </button>
            <button
              type="button"
              className={`${styles.exportFormatBtn} ${exportFormat === 'csv' ? styles.exportFormatBtnActive : ''}`}
              onClick={() => setExportFormat('csv')}
              aria-pressed={exportFormat === 'csv'}
            >
              CSV
            </button>
          </div>

          <button
            type="button"
            className={styles.exportBtn}
            onClick={() => void handleExport()}
            disabled={exporting || visibleEvents.length === 0}
            aria-label={`Export current filtered results as ${exportFormat.toUpperCase()}`}
          >
            {exporting ? 'Exporting…' : `Export ${exportFormat.toUpperCase()}`}
          </button>

          <span className={styles.filterSep} />

          <button
            type="button"
            className={styles.clearBtn}
            onClick={clearFilters}
            aria-label="Clear all filters"
          >
            Clear all filters
          </button>
        </div>
      </div>

      {/* ── Status bar ─────────────────────────────────────────── */}
      <div className={styles.statusBar}>
        {isLoading && (
          <Spinner size="sm" label="Loading staff logs" />
        )}
        {!isLoading && !error && (
          <span>{total} total event{total !== 1 ? 's' : ''}</span>
        )}
        {error && !is503 && (
          <span style={{ color: 'var(--color-status-warning)' }}>
            Error loading logs — {error.message}
          </span>
        )}
        <span className={styles.statusCount}>
          {filters.derivedLevel !== 'all'
            ? `${visibleEvents.length} shown (severity filter active)`
            : ''}
        </span>
      </div>

      {/* ── Table region ───────────────────────────────────────── */}
      <div className={styles.tableRegion}>
        <table className={styles.table} aria-label="Staff event logs">
          <colgroup>
            <col style={{ width: '90px' }} />
            <col style={{ width: '88px' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '60px' }} />
            <col />
            <col style={{ width: '28px' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Component</th>
              <th>Event Type</th>
              <th>Agent</th>
              <th>Entity</th>
              <th>Level</th>
              <th>Reason</th>
              <th aria-label="Expand" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr aria-live="polite" aria-label="Loading staff logs">
                <td colSpan={8} style={{ textAlign: 'center', padding: '48px 0' }}>
                  <Spinner size="md" label="Loading staff logs" />
                </td>
              </tr>
            )}

            {!isLoading && error && !is503 && (
              <tr>
                <td colSpan={8}>
                  <div className={styles.errorState}>
                    <span className={styles.errorStateIcon} aria-hidden="true">⚠</span>
                    <p className={styles.errorStateTitle}>Unable to load staff logs</p>
                    <p className={styles.errorStateBody}>
                      The control plane could not reach the logs endpoint.
                    </p>
                    <p className={styles.errorStateDetail}>{error.message}</p>
                    <div className={styles.errorStateActions}>
                      <Link to="/health" className={styles.errorStateCtaBtn}>
                        Open Health Dashboard
                      </Link>
                      <button
                        className={styles.errorRetryButton}
                        onClick={() => void refetch()}
                        type="button"
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && (error ? is503 : visibleEvents.length === 0) && (
              <EmptyState
                hasFilters={hasFilters && !is503}
                is503={is503}
                onClearFilters={clearFilters}
              />
            )}

            {!isLoading && !error && visibleEvents.map(event => (
              <LogRow
                key={event.eventId}
                event={event}
                expanded={expandedRowId === event.eventId}
                onToggle={() => toggleRow(event.eventId)}
                now={now}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ─────────────────────────────────────────── */}
      <PaginationControls
        pagination={pagination}
        total={total}
        onPageChange={offset => setPagination(p => ({ ...p, offset }))}
        onPageSizeChange={limit => setPagination({ limit, offset: 0 })}
      />
    </div>
  )
}
