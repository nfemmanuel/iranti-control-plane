/* Iranti Control Plane — Archive Explorer */
/* Route: /archive */
/* Displays archived facts with all KB filters plus archive-specific filters. */
/* Queries GET /api/control-plane/archive (no temporal history jump — archive IS the history). */

import { Fragment, useState, useReducer, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { ArchiveFact, ArchiveListResponse } from '../../api/types'
import styles from './MemoryExplorer.module.css'

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
/*  Filter state                                                        */
/* ------------------------------------------------------------------ */

interface ArchiveFilterState {
  search: string
  entityType: string
  entityId: string
  key: string
  source: string
  createdBy: string
  minConfidence: number
  archivedReason: string
  resolutionState: string
}

const DEFAULT_FILTERS: ArchiveFilterState = {
  search: '',
  entityType: '',
  entityId: '',
  key: '',
  source: '',
  createdBy: '',
  minConfidence: 0,
  archivedReason: '',
  resolutionState: '',
}

type FilterAction =
  | { type: 'SET_FIELD'; field: keyof ArchiveFilterState; value: string | number }
  | { type: 'RESET' }

function filterReducer(state: ArchiveFilterState, action: FilterAction): ArchiveFilterState {
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
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return Math.floor(hours / 24) + 'd ago'
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
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function ConfidenceBar({ value }: { value: number }) {
  const level = value >= 90 ? 'high' : value >= 70 ? 'medium' : 'low'
  return (
    <span className={styles.confidence} data-level={level} title={`Confidence: ${value}`}>
      {value}
    </span>
  )
}

function ExpandedArchiveRow({ fact }: { fact: ArchiveFact }) {
  const [showRaw, setShowRaw] = useState(false)
  const parsedRaw = (() => {
    if (!fact.valueRaw) return null
    try { return JSON.parse(fact.valueRaw) }
    catch { return fact.valueRaw }
  })()

  return (
    <tr className={styles.expandedRowContainer}>
      <td colSpan={9} className={styles.expandedRowTd}>
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
              <span className={styles.expandedLabel}>Archived reason</span>
              <span className={styles.expandedValue}>{fact.archivedReason ?? '—'}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Valid from</span>
              <span className={styles.expandedValue}>{fact.validFrom ?? '—'}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Valid until</span>
              <span className={styles.expandedValue}>{fact.validUntil ?? '—'}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Resolution state</span>
              <span className={styles.expandedValue}>{fact.resolutionState ?? '—'}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Superseded by</span>
              <span className={styles.expandedValueMono}>{fact.supersededBy ?? '—'}</span>
            </div>
          </div>

          {showRaw && parsedRaw !== null && (
            <div className={styles.expandedRawBlock}>
              <span className={styles.expandedLabel}>Raw JSON</span>
              <pre className={styles.expandedRawPre}>{JSON.stringify(parsedRaw, null, 2)}</pre>
            </div>
          )}

          <div className={styles.expandedActions}>
            <button className={styles.expandedActionButton} onClick={() => setShowRaw(r => !r)}>
              {showRaw ? 'Hide Raw JSON' : 'View Raw JSON'}
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

const SKELETON_WIDTHS = ['140px', '80px', '180px', '32px', '80px', '80px', '80px', '70px', '60px'] as const

function SkeletonRow() {
  return (
    <tr className={styles.skeletonRow} aria-hidden="true">
      {SKELETON_WIDTHS.map((width, i) => (
        <td key={i}><span className={styles.skeleton} style={{ width }} /></td>
      ))}
    </tr>
  )
}

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
        >← Prev</button>
        <span className={styles.paginationPage}>{currentPage} / {totalPages}</span>
        <button
          className={styles.paginationButton}
          onClick={() => onPageChange(offset + limit)}
          disabled={offset + limit >= total}
          aria-label="Next page"
        >Next →</button>
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

export function ArchiveExplorer() {
  const [filters, dispatch] = useReducer(filterReducer, DEFAULT_FILTERS)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({ offset: 0, limit: 25 })

  const debouncedSearch = useDebounced(filters.search, 300)

  const queryParams = {
    ...(filters.entityType && { entityType: filters.entityType }),
    ...(filters.entityId && { entityId: filters.entityId }),
    ...(filters.key && { key: filters.key }),
    ...(filters.source && { source: filters.source }),
    ...(filters.createdBy && { createdBy: filters.createdBy }),
    ...(filters.minConfidence > 0 && { minConfidence: filters.minConfidence }),
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(filters.archivedReason && { archivedReason: filters.archivedReason }),
    ...(filters.resolutionState && { resolutionState: filters.resolutionState }),
    limit: pagination.limit,
    offset: pagination.offset,
  }

  const { data, isLoading, error, refetch } = useQuery<ArchiveListResponse, Error>({
    queryKey: ['archive', queryParams],
    queryFn: () => apiFetch<ArchiveListResponse>('/archive', queryParams as Record<string, string | number | boolean | undefined>),
  })

  const prevFiltersRef = useRef(filters)
  useEffect(() => {
    if (prevFiltersRef.current !== filters) {
      setPagination(p => ({ ...p, offset: 0 }))
      prevFiltersRef.current = filters
    }
  }, [filters])

  const facts = data?.items ?? []
  const total = data?.total ?? 0

  const toggleRow = (id: string) => setExpandedRowId(prev => prev === id ? null : id)

  return (
    <div className={styles.page}>
      {/* Filter bar */}
      <div className={styles.filterBar} role="search" aria-label="Filter archive facts">
        <div className={styles.filterRow}>
          <input
            type="search"
            className={styles.filterInputWide}
            placeholder="Search entity, key, value…"
            value={filters.search}
            onChange={e => dispatch({ type: 'SET_FIELD', field: 'search', value: e.target.value })}
            aria-label="Full-text search"
          />
          <input
            type="text"
            className={styles.filterInput}
            placeholder="Entity type"
            value={filters.entityType}
            onChange={e => dispatch({ type: 'SET_FIELD', field: 'entityType', value: e.target.value })}
          />
          <input
            type="text"
            className={styles.filterInput}
            placeholder="Entity ID"
            value={filters.entityId}
            onChange={e => dispatch({ type: 'SET_FIELD', field: 'entityId', value: e.target.value })}
          />
          <input
            type="text"
            className={styles.filterInput}
            placeholder="Key"
            value={filters.key}
            onChange={e => dispatch({ type: 'SET_FIELD', field: 'key', value: e.target.value })}
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
            />
          </label>
          <select
            className={styles.filterInput}
            value={filters.archivedReason}
            onChange={e => dispatch({ type: 'SET_FIELD', field: 'archivedReason', value: e.target.value })}
            aria-label="Filter by archived reason"
            style={{ cursor: 'pointer' }}
          >
            <option value="">All reasons</option>
            <option value="superseded">superseded</option>
            <option value="decay">decay</option>
            <option value="conflict_resolved">conflict_resolved</option>
          </select>
          <select
            className={styles.filterInput}
            value={filters.resolutionState}
            onChange={e => dispatch({ type: 'SET_FIELD', field: 'resolutionState', value: e.target.value })}
            aria-label="Filter by resolution state"
            style={{ cursor: 'pointer' }}
          >
            <option value="">All states</option>
            <option value="pending">pending</option>
            <option value="resolved">resolved</option>
            <option value="rejected">rejected</option>
          </select>
          <button
            className={styles.filterResetButton}
            onClick={() => dispatch({ type: 'RESET' })}
            type="button"
          >
            Clear ×
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={styles.tableRegion}>
        <table className={styles.table} aria-label="Archived facts" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '7%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Entity</th>
              <th>Key</th>
              <th>Summary</th>
              <th>Conf</th>
              <th>Archived reason</th>
              <th>Resolution</th>
              <th>Archived at</th>
              <th>Valid from</th>
              <th>Agent</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} />)}

            {!isLoading && error && (
              <tr>
                <td colSpan={9}>
                  <div className={styles.errorState}>
                    <span className={styles.errorStateIcon}>⚠</span>
                    <p className={styles.errorStateTitle}>Unable to load archive</p>
                    <p className={styles.errorStateBody}>{error.message}</p>
                    <button className={styles.errorRetryButton} onClick={() => void refetch()} type="button">Retry</button>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && !error && facts.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className={styles.emptyState}>
                    <span className={styles.emptyStateIcon}>⬡</span>
                    <p className={styles.emptyStateTitle}>No archived facts found</p>
                    <p className={styles.emptyStateBody}>
                      The archive is empty or no entries match the current filters.
                      Archived facts appear here when the Archivist supersedes or decays KB entries.
                    </p>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && !error && facts.map(fact => (
              <Fragment key={fact.id}>
                <tr
                  className={`${styles.dataRow} ${expandedRowId === fact.id ? styles.dataRowExpanded : ''}`}
                  onClick={() => toggleRow(fact.id)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedRowId === fact.id}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleRow(fact.id) }}
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
                  <td className={styles.cellSource}>{fact.archivedReason ?? '—'}</td>
                  <td className={styles.cellSource}>{fact.resolutionState ?? '—'}</td>
                  <td className={styles.cellMeta}>{formatRelativeTime(fact.archivedAt)}</td>
                  <td className={styles.cellMeta}>{fact.validFrom ? new Date(fact.validFrom).toLocaleDateString() : '—'}</td>
                  <td className={styles.cellMono}>{fact.agentId}</td>
                </tr>

                {expandedRowId === fact.id && (
                  <ExpandedArchiveRow fact={fact} />
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
