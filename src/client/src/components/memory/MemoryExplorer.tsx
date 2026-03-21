/* Iranti Control Plane — Memory Explorer */
/* Route: /memory */
/* CP-T013 — Wired to GET /api/control-plane/kb via TanStack Query v5 */

import { Fragment, useState, useReducer, useEffect, useRef, type CSSProperties } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { KBFact, KBListResponse, ConflictEntry } from '../../api/types'
import styles from './MemoryExplorer.module.css'
import { Spinner } from '../ui/Spinner'

export type { KBFact }

/* ------------------------------------------------------------------ */
/*  Query params / filter state                                        */
/* ------------------------------------------------------------------ */

interface FilterState {
  search: string
  entityType: string
  entityId: string
  key: string
  source: string
  createdBy: string
  minConfidence: number
  activeOnly: boolean
}

const DEFAULT_FILTERS: FilterState = {
  search: '',
  entityType: '',
  entityId: '',
  key: '',
  source: '',
  createdBy: '',
  minConfidence: 0,
  activeOnly: true,
}

type FilterAction =
  | { type: 'SET_FIELD'; field: keyof FilterState; value: string | number | boolean }
  | { type: 'RESET' }

function filterReducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value }
    case 'RESET':
      return { ...DEFAULT_FILTERS }
    default:
      return state
  }
}

/* ------------------------------------------------------------------ */
/*  Sort state                                                          */
/* ------------------------------------------------------------------ */

type SortColumn = 'updatedAt' | 'confidence' | 'entityType' | 'key' | 'source'

interface SortState {
  column: SortColumn
  dir: 'asc' | 'desc'
}

/* ------------------------------------------------------------------ */
/*  Pagination                                                          */
/* ------------------------------------------------------------------ */

interface PaginationState {
  offset: number
  limit: number
}

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const
type PageSize = typeof PAGE_SIZE_OPTIONS[number]

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
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/* ------------------------------------------------------------------ */
/*  ConflictLog helpers (CP-T053)                                      */
/* ------------------------------------------------------------------ */

/** Cast the raw server value (Record<string, unknown> | null) to ConflictEntry[]. */
function parseConflictLog(raw: Record<string, unknown> | null): ConflictEntry[] {
  if (!raw) return []
  // The server serialises conflictLog as an array stored under a numeric-keyed object
  // when Prisma returns it, or it may arrive as a plain JSON array depending on the
  // serialisation path. We handle both shapes defensively.
  if (Array.isArray(raw)) return raw as ConflictEntry[]
  // Prisma Json fields sometimes come back as a plain object with numeric string keys
  const maybeArray = Object.values(raw)
  if (maybeArray.length > 0 && typeof maybeArray[0] === 'object' && maybeArray[0] !== null && 'type' in (maybeArray[0] as object)) {
    return maybeArray as ConflictEntry[]
  }
  return []
}

const CONFLICT_TYPE_LABELS: Record<ConflictEntry['type'], string> = {
  CONFLICT_ESCALATED: 'Escalated',
  CONFLICT_REJECTED: 'Rejected',
  CONFLICT_RESOLVED: 'Resolved',
  IDEMPOTENT_SKIP: 'Skipped',
}

function conflictTypeBadgeStyle(type: ConflictEntry['type']): CSSProperties {
  switch (type) {
    case 'CONFLICT_ESCALATED':
      return { color: 'var(--color-status-warning)', background: 'var(--color-status-warning-bg)', border: '1px solid var(--color-status-warning)' }
    case 'CONFLICT_REJECTED':
      return { color: 'var(--color-status-error)', background: 'var(--color-status-error-bg)', border: '1px solid var(--color-status-error)' }
    case 'CONFLICT_RESOLVED':
      return { color: 'var(--color-status-success)', background: 'var(--color-status-success-bg)', border: '1px solid var(--color-status-success)' }
    case 'IDEMPOTENT_SKIP':
      return { color: 'var(--color-text-tertiary)', background: 'var(--color-bg-sunken)', border: '1px solid var(--color-border-subtle)' }
  }
}

function ConflictTimeline({ conflictLog }: { conflictLog: Record<string, unknown> | null }) {
  const entries = parseConflictLog(conflictLog)
  if (entries.length === 0) return null

  return (
    <div style={{ marginTop: 'var(--space-3)', borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-3)' }}>
      <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 'var(--space-2)' }}>
        Conflict History
      </span>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
        {entries.map((entry, i) => (
          <li key={i} style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: i < entries.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
            {/* Timeline dot */}
            <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: conflictTypeBadgeStyle(entry.type).color ?? 'var(--color-text-tertiary)', marginTop: 5, display: 'inline-block', border: '1px solid var(--color-border-default)' }} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {/* Header: badge + timestamp */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <span
                  style={{
                    ...conflictTypeBadgeStyle(entry.type),
                    fontSize: '10px',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    borderRadius: 'var(--border-radius-sm)',
                    padding: '1px 5px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {CONFLICT_TYPE_LABELS[entry.type]}
                </span>
                <span
                  style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', cursor: 'default' }}
                  title={entry.at}
                >
                  {formatRelativeTime(entry.at)}
                </span>
                {/* LLM indicator */}
                <span style={{ fontSize: '10px', color: entry.usedLLM ? 'var(--color-staff-attendant)' : 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                  {entry.usedLLM ? 'LLM' : 'Deterministic'}
                </span>
              </div>
              {/* Reason */}
              {entry.reason && (
                <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{entry.reason}</span>
              )}
              {/* Score comparison */}
              {entry.existingScore !== undefined && entry.incomingScore !== undefined && (
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  Existing: {entry.existingScore} vs Incoming: {entry.incomingScore}
                </span>
              )}
              {/* Incoming source */}
              {entry.incomingSource && (
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                  Incoming source: {entry.incomingSource}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function SortIndicator({ column, sort }: { column: SortColumn; sort: SortState }) {
  if (sort.column !== column) {
    return <span className={styles.sortInactive} aria-hidden="true">⇅</span>
  }
  return (
    <span className={styles.sortActive} aria-label={sort.dir === 'asc' ? 'sorted ascending' : 'sorted descending'}>
      {sort.dir === 'asc' ? '↑' : '↓'}
    </span>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const level = value >= 90 ? 'high' : value >= 70 ? 'medium' : 'low'
  return (
    <span className={styles.confidence} data-level={level} title={`Confidence: ${value}`}>
      {value}
    </span>
  )
}

function ExpandedRowDetail({
  fact,
  onViewHistory,
}: {
  fact: KBFact
  onViewHistory: (fact: KBFact) => void
}) {
  const [showRaw, setShowRaw] = useState(false)
  const navigate = useNavigate()

  const handleViewRelated = () => {
    navigate(`/memory/${encodeURIComponent(fact.entityType)}/${encodeURIComponent(fact.entityId)}`)
  }

  const parsedRaw = (() => {
    if (!fact.valueRaw) return null
    try { return JSON.parse(fact.valueRaw) }
    catch { return fact.valueRaw }
  })()

  return (
    <tr className={styles.expandedRowContainer}>
      <td colSpan={8} className={styles.expandedRowTd}>
        <div className={styles.expandedRowContent}>
          <div className={styles.expandedGrid}>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Entity</span>
              <span className={styles.expandedValueMono}>{fact.entityType}/{fact.entityId}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Key</span>
              <span className={styles.expandedValueMono}>{fact.key}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Value</span>
              <span className={styles.expandedValue}>{fact.valueSummary ?? '—'}</span>
            </div>
            <div className={styles.expandedField}>
              {/* AC-3: Source label with provenance clarification */}
              <span className={styles.expandedLabel} title="Caller-supplied label indicating how this fact was written (e.g. 'mcp', 'git', 'manual')">
                Source (provenance)
              </span>
              <span className={styles.expandedValue}>{fact.source}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Confidence</span>
              <span className={styles.expandedValue}>{fact.confidence}</span>
            </div>
            <div className={styles.expandedField}>
              {/* AC-3: createdBy renamed to "Written by" */}
              <span className={styles.expandedLabel}>Written by</span>
              <span className={styles.expandedValueMono}>{fact.agentId}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Valid from</span>
              <span className={styles.expandedValue}>{fact.validFrom ?? '—'}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Valid until</span>
              <span className={styles.expandedValue}>{fact.validUntil ?? '— (currently valid)'}</span>
            </div>
            {/* AC-4: stability — show if non-null */}
            {fact.stability != null && (
              <div className={styles.expandedField}>
                <span className={styles.expandedLabel}>Stability</span>
                <span className={styles.expandedValue}>{fact.stability} days</span>
              </div>
            )}
            {/* AC-4: lastAccessedAt — show if non-null */}
            {fact.lastAccessedAt != null && (
              <div className={styles.expandedField}>
                <span className={styles.expandedLabel}>Last accessed</span>
                <span
                  className={styles.expandedValue}
                  title={fact.lastAccessedAt}
                >
                  {formatRelativeTime(fact.lastAccessedAt)}
                </span>
              </div>
            )}
          </div>

          {showRaw && parsedRaw !== null && (
            <div className={styles.expandedRawBlock}>
              <span className={styles.expandedLabel}>
                Raw JSON{fact.valueRawTruncated ? ' (truncated — view entity for full value)' : ''}
              </span>
              <pre className={styles.expandedRawPre}>{JSON.stringify(parsedRaw, null, 2)}</pre>
            </div>
          )}

          {/* AC-1: ConflictLog timeline — replaces raw JSON expand for conflictLog */}
          <ConflictTimeline conflictLog={fact.conflictLog} />

          <div className={styles.expandedActions}>
            <button className={styles.expandedActionButton} onClick={() => onViewHistory(fact)}>
              View History
            </button>
            <button className={styles.expandedActionButton} onClick={() => setShowRaw(r => !r)}>
              {showRaw ? 'Hide Raw JSON' : 'View Raw JSON'}
            </button>
            <button className={styles.expandedActionButton} onClick={handleViewRelated}>
              View Related Entities →
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

function FilterBar({
  filters,
  dispatch,
}: {
  filters: FilterState
  dispatch: React.Dispatch<FilterAction>
}) {
  const setField = (field: keyof FilterState) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value
      dispatch({ type: 'SET_FIELD', field, value: val as string | number | boolean })
    }

  return (
    <div className={styles.filterBar} role="search" aria-label="Filter facts">
      <div className={styles.filterRow}>
        <input
          type="search"
          className={styles.filterInputWide}
          placeholder="Search entity, key, value…"
          value={filters.search}
          onChange={setField('search')}
          aria-label="Full-text search"
        />
        <input
          type="text"
          className={styles.filterInput}
          placeholder="Entity type"
          value={filters.entityType}
          onChange={setField('entityType')}
          aria-label="Filter by entity type"
        />
        <input
          type="text"
          className={styles.filterInput}
          placeholder="Entity ID"
          value={filters.entityId}
          onChange={setField('entityId')}
          aria-label="Filter by entity ID"
        />
        <input
          type="text"
          className={styles.filterInput}
          placeholder="Key"
          value={filters.key}
          onChange={setField('key')}
          aria-label="Filter by key"
        />
        <input
          type="text"
          className={styles.filterInput}
          placeholder="Source"
          value={filters.source}
          onChange={setField('source')}
          aria-label="Filter by source"
        />
      </div>
      <div className={styles.filterRow}>
        <label className={styles.filterSliderLabel}>
          <span>Min confidence: {filters.minConfidence}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minConfidence}
            onChange={e => dispatch({ type: 'SET_FIELD', field: 'minConfidence', value: Number(e.target.value) })}
            className={styles.filterSlider}
            aria-label="Minimum confidence score"
          />
        </label>
        <input
          type="text"
          className={styles.filterInput}
          placeholder="Created by"
          value={filters.createdBy}
          onChange={setField('createdBy')}
          aria-label="Filter by creator agent"
        />
        <label className={styles.filterToggleLabel}>
          <input
            type="checkbox"
            checked={filters.activeOnly}
            onChange={setField('activeOnly')}
            className={styles.filterCheckbox}
          />
          <span>Active only</span>
        </label>
        <button
          className={styles.filterResetButton}
          onClick={() => dispatch({ type: 'RESET' })}
          type="button"
          aria-label="Clear all filters"
        >
          Clear ×
        </button>
      </div>
    </div>
  )
}

/* CP-T027: Three distinct empty state variants for Memory Explorer */

function EmptyState({
  filters,
  onClearFilters,
}: {
  filters: FilterState
  onClearFilters: () => void
}) {
  const hasFilters =
    filters.search ||
    filters.entityType ||
    filters.entityId ||
    filters.key ||
    filters.source ||
    filters.createdBy ||
    filters.minConfidence > 0

  if (hasFilters) {
    /* Condition C — filtered, no results */
    return (
      <tr>
        <td colSpan={8}>
          <div className={styles.emptyState}>
            <span className={styles.emptyStateIcon} aria-hidden="true">⬡</span>
            <p className={styles.emptyStateTitle}>No facts match your filter</p>
            <p className={styles.emptyStateBody}>
              Try adjusting your search or clearing your filters.
              {filters.activeOnly && ' You can also disable "Active only" to include archived facts.'}
            </p>
            <button className={styles.emptyStateCtaBtn} onClick={onClearFilters} type="button">
              Clear filters
            </button>
          </div>
        </td>
      </tr>
    )
  }

  /* Condition A — connected, no data yet */
  return (
    <tr>
      <td colSpan={8}>
        <div className={styles.emptyState}>
          <span className={styles.emptyStateIcon} aria-hidden="true">⬡</span>
          <p className={styles.emptyStateTitle}>No facts in memory yet</p>
          <p className={styles.emptyStateBody}>
            Your Iranti instance is connected. Write your first fact using{' '}
            <code className={styles.inlineCode}>iranti write</code> or open Iranti Chat.
          </p>
        </div>
      </td>
    </tr>
  )
}

/* Condition B — not connected / API error */
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <tr>
      <td colSpan={8}>
        <div className={styles.errorState}>
          <span className={styles.errorStateIcon} aria-hidden="true">⚠</span>
          <p className={styles.errorStateTitle}>Unable to load memory</p>
          <p className={styles.errorStateBody}>
            The control plane could not reach your Iranti instance. Check the Health dashboard for connection details.
          </p>
          <p className={styles.errorStateDetail}>{message}</p>
          <div className={styles.errorStateActions}>
            <Link to="/health" className={styles.errorStateCtaBtn}>
              Open Health Dashboard
            </Link>
            <button className={styles.errorRetryButton} onClick={onRetry} type="button">
              Retry
            </button>
          </div>
        </div>
      </td>
    </tr>
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
        {total > 0 ? `Showing ${start}–${end} of ${total}` : 'No results'}
      </span>
      <div className={styles.paginationControls}>
        <button
          className={styles.paginationButton}
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          disabled={offset === 0}
          aria-label="Previous page"
        >
          ← Prev
        </button>
        <span className={styles.paginationPage}>{currentPage} / {totalPages}</span>
        <button
          className={styles.paginationButton}
          onClick={() => onPageChange(offset + limit)}
          disabled={offset + limit >= total}
          aria-label="Next page"
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
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function MemoryExplorer() {
  const navigate = useNavigate()
  const [filters, dispatch] = useReducer(filterReducer, DEFAULT_FILTERS)
  const [sort, setSort] = useState<SortState>({ column: 'updatedAt', dir: 'desc' })
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({ offset: 0, limit: 25 })

  // Debounce the search field to avoid a new request on every keystroke
  const debouncedSearch = useDebounced(filters.search, 300)

  // Build the effective query params (use debounced search)
  const queryParams = {
    ...(filters.entityType && { entityType: filters.entityType }),
    ...(filters.entityId && { entityId: filters.entityId }),
    ...(filters.key && { key: filters.key }),
    ...(filters.source && { source: filters.source }),
    ...(filters.createdBy && { createdBy: filters.createdBy }),
    ...(filters.minConfidence > 0 && { minConfidence: filters.minConfidence }),
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(filters.activeOnly && { activeOnly: true }),
    limit: pagination.limit,
    offset: pagination.offset,
  }

  const { data, isLoading, error, refetch } = useQuery<KBListResponse, Error>({
    queryKey: ['kb', queryParams],
    queryFn: () => apiFetch<KBListResponse>('/kb', queryParams as Record<string, string | number | boolean | undefined>),
  })

  // Reset to page 1 when filters change
  const prevFiltersRef = useRef(filters)
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      setPagination(p => ({ ...p, offset: 0 }))
      prevFiltersRef.current = filters
    }
  }, [filters])

  const facts = data?.items ?? []
  const total = data?.total ?? 0

  const handleSort = (column: SortColumn) => {
    setSort(prev =>
      prev.column === column
        ? { ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: 'desc' }
    )
    setPagination(p => ({ ...p, offset: 0 }))
  }

  const handleRowClick = (id: string) => {
    setExpandedRowId(prev => (prev === id ? null : id))
  }

  const handleViewHistory = (fact: KBFact) => {
    navigate(
      `/memory/${encodeURIComponent(fact.entityType)}/${encodeURIComponent(fact.entityId)}/${encodeURIComponent(fact.key)}`
    )
  }

  return (
    <div className={styles.page}>
      <FilterBar filters={filters} dispatch={dispatch} />

      <div className={styles.tableRegion}>
        <table className={styles.table} aria-label="Knowledge base facts">
          <thead>
            <tr>
              <th
                className={styles.thSortable}
                onClick={() => handleSort('entityType')}
                aria-sort={sort.column === 'entityType' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Entity <SortIndicator column="entityType" sort={sort} />
              </th>
              <th
                className={styles.thSortable}
                onClick={() => handleSort('key')}
                aria-sort={sort.column === 'key' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Key <SortIndicator column="key" sort={sort} />
              </th>
              <th>Summary</th>
              <th
                className={styles.thSortable}
                onClick={() => handleSort('confidence')}
                aria-sort={sort.column === 'confidence' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Conf <SortIndicator column="confidence" sort={sort} />
              </th>
              <th
                className={styles.thSortable}
                onClick={() => handleSort('source')}
                aria-sort={sort.column === 'source' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Source <SortIndicator column="source" sort={sort} />
              </th>
              <th>Created by</th>
              <th>Valid from</th>
              <th
                className={styles.thSortable}
                onClick={() => handleSort('updatedAt')}
                aria-sort={sort.column === 'updatedAt' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                Updated <SortIndicator column="updatedAt" sort={sort} />
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr aria-label="Loading memory">
                <td colSpan={8} style={{ textAlign: 'center', padding: '48px 0' }}>
                  <Spinner size="md" label="Loading memory" />
                </td>
              </tr>
            )}

            {!isLoading && error && (
              <ErrorState message={error.message} onRetry={() => void refetch()} />
            )}

            {!isLoading && !error && facts.length === 0 && (
              <EmptyState
                filters={filters}
                onClearFilters={() => dispatch({ type: 'RESET' })}
              />
            )}

            {!isLoading && !error && facts.map(fact => (
              <Fragment key={fact.id}>
                <tr
                  className={`${styles.dataRow} ${expandedRowId === fact.id ? styles.dataRowExpanded : ''}`}
                  onClick={() => handleRowClick(fact.id)}
                  aria-expanded={expandedRowId === fact.id}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleRowClick(fact.id) }}
                >
                  <td className={styles.cellEntity}>
                    <span className={styles.entityType}>{fact.entityType}</span>
                    <span className={styles.entitySep}>/</span>
                    <span className={styles.entityId}>{fact.entityId}</span>
                  </td>
                  <td className={styles.cellKey}>{fact.key}</td>
                  <td className={styles.cellSummary}>
                    <span className={styles.summaryText}>{fact.valueSummary ?? '—'}</span>
                  </td>
                  <td className={styles.cellConfidence}>
                    <ConfidenceBar value={fact.confidence} />
                  </td>
                  <td className={styles.cellSource}>{fact.source}</td>
                  <td className={styles.cellMono}>{fact.agentId}</td>
                  <td className={styles.cellMeta}>
                    {fact.validFrom ? new Date(fact.validFrom).toLocaleDateString() : '—'}
                  </td>
                  <td className={styles.cellMeta}>
                    {fact.updatedAt ? formatRelativeTime(fact.updatedAt) : fact.createdAt ? formatRelativeTime(fact.createdAt) : '—'}
                  </td>
                </tr>

                {expandedRowId === fact.id && (
                  <ExpandedRowDetail
                    fact={fact}
                    onViewHistory={handleViewHistory}
                  />
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <PaginationControls
        pagination={pagination}
        total={total}
        onPageChange={offset => setPagination(p => ({ ...p, offset }))}
        onPageSizeChange={limit => setPagination(p => ({ ...p, limit, offset: 0 }))}
      />
    </div>
  )
}
