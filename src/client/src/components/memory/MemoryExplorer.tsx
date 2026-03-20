/* Iranti Control Plane — Memory Explorer */
/* Route: /memory */
/* Displays the KB facts table with filter bar, sortable columns, row expansion, */
/* temporal history links, entity jump links, and raw JSON toggle. */
/*                                                                               */
/* CP-T013 SCAFFOLD — API connection stubbed. Wire to CP-T010 when ready.       */
/* TODO: connect to GET /api/control-plane/kb                                   */

import { useState, useCallback, useReducer } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './MemoryExplorer.module.css'

/* ------------------------------------------------------------------ */
/*  Types — mirror the CP-T010 API response shape                      */
/* ------------------------------------------------------------------ */

export interface KBFact {
  id: string
  entityType: string
  entityId: string
  key: string
  valueSummary: string
  valueRaw: string           // JSON string — full value
  confidence: number         // 0–100
  source: string
  agentId: string
  validFrom: string | null
  validUntil: string | null
  updatedAt: string
  conflictLog?: string | null
}

export interface KBQueryParams {
  entityType?: string
  entityId?: string
  key?: string
  source?: string
  createdBy?: string
  minConfidence?: number
  search?: string
  activeOnly?: boolean
  limit?: number
  offset?: number
  sortBy?: SortColumn
  sortDir?: 'asc' | 'desc'
}

/* ------------------------------------------------------------------ */
/*  Filter state                                                        */
/* ------------------------------------------------------------------ */

interface FilterState extends Omit<KBQueryParams, 'limit' | 'offset' | 'sortBy' | 'sortDir'> {
  search: string
  activeOnly: boolean
  minConfidence: number
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
  total: number
}

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const
type PageSize = typeof PAGE_SIZE_OPTIONS[number]

/* ------------------------------------------------------------------ */
/*  Stub data — removed when CP-T010 API is wired                      */
/* ------------------------------------------------------------------ */

// TODO(CP-T013): Remove stub data once GET /api/control-plane/kb is connected
const STUB_FACTS: KBFact[] = [
  {
    id: '1',
    entityType: 'agent',
    entityId: 'product_manager',
    key: 'role',
    valueSummary: 'Product Manager',
    valueRaw: '"Product Manager"',
    confidence: 92,
    source: 'handshake',
    agentId: 'product_manager',
    validFrom: '2026-03-18T09:00:00.000Z',
    validUntil: null,
    updatedAt: '2026-03-20T09:58:00.000Z',
  },
  {
    id: '2',
    entityType: 'project',
    entityId: 'iranti_control_plane',
    key: 'phase',
    valueSummary: 'Phase 1',
    valueRaw: '"Phase 1"',
    confidence: 95,
    source: 'product_manager',
    agentId: 'product_manager',
    validFrom: '2026-03-20T00:00:00.000Z',
    validUntil: null,
    updatedAt: '2026-03-20T10:45:00.000Z',
  },
  {
    id: '3',
    entityType: 'decision',
    entityId: 'visual_direction',
    key: 'decision',
    valueSummary: 'Option B: Terminals — emerald/mint on near-black, system font stack',
    valueRaw: '{"option":"B","name":"Terminals","approved_by":"product_manager"}',
    confidence: 99,
    source: 'product_manager_review',
    agentId: 'product_manager',
    validFrom: '2026-03-20T10:46:36.000Z',
    validUntil: null,
    updatedAt: '2026-03-20T10:46:36.000Z',
  },
]

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

function formatConfidence(conf: number): string {
  return String(conf)
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

// Sort indicator
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

// Confidence bar
function ConfidenceBar({ value }: { value: number }) {
  const level = value >= 90 ? 'high' : value >= 70 ? 'medium' : 'low'
  return (
    <span className={styles.confidence} data-level={level} title={`Confidence: ${value}`}>
      {formatConfidence(value)}
    </span>
  )
}

// Expanded row detail
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
              <span className={styles.expandedValue}>{fact.valueSummary}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Source</span>
              <span className={styles.expandedValue}>{fact.source}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Confidence</span>
              <span className={styles.expandedValue}>{fact.confidence}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Created by</span>
              <span className={styles.expandedValueMono}>{fact.agentId}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Valid from</span>
              <span className={styles.expandedValue}>{fact.validFrom ?? '—'}</span>
            </div>
            <div className={styles.expandedField}>
              <span className={styles.expandedLabel}>Valid until</span>
              <span className={styles.expandedValue}>{fact.validUntil ?? '—  (currently valid)'}</span>
            </div>
          </div>

          {showRaw && (
            <div className={styles.expandedRawBlock}>
              <span className={styles.expandedLabel}>Raw JSON</span>
              <pre className={styles.expandedRawPre}>{JSON.stringify(JSON.parse(fact.valueRaw), null, 2)}</pre>
            </div>
          )}

          <div className={styles.expandedActions}>
            <button
              className={styles.expandedActionButton}
              onClick={() => onViewHistory(fact)}
            >
              View History
            </button>
            <button
              className={styles.expandedActionButton}
              onClick={() => setShowRaw(r => !r)}
            >
              {showRaw ? 'Hide Raw JSON' : 'View Raw JSON'}
            </button>
            <button
              className={styles.expandedActionButton}
              onClick={handleViewRelated}
            >
              View Related Entities →
            </button>
          </div>
        </div>
      </td>
    </tr>
  )
}

// Filter bar
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
          value={filters.entityType ?? ''}
          onChange={setField('entityType')}
          aria-label="Filter by entity type"
        />
        <input
          type="text"
          className={styles.filterInput}
          placeholder="Entity ID"
          value={filters.entityId ?? ''}
          onChange={setField('entityId')}
          aria-label="Filter by entity ID"
        />
        <input
          type="text"
          className={styles.filterInput}
          placeholder="Key"
          value={filters.key ?? ''}
          onChange={setField('key')}
          aria-label="Filter by key"
        />
        <input
          type="text"
          className={styles.filterInput}
          placeholder="Source"
          value={filters.source ?? ''}
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
          value={filters.createdBy ?? ''}
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

// Skeleton row (loading state)
function SkeletonRow() {
  return (
    <tr className={styles.skeletonRow} aria-hidden="true">
      <td><span className={styles.skeleton} style={{ width: '140px' }} /></td>
      <td><span className={styles.skeleton} style={{ width: '80px' }} /></td>
      <td><span className={styles.skeleton} style={{ width: '200px' }} /></td>
      <td><span className={styles.skeleton} style={{ width: '32px' }} /></td>
      <td><span className={styles.skeleton} style={{ width: '80px' }} /></td>
      <td><span className={styles.skeleton} style={{ width: '90px' }} /></td>
      <td><span className={styles.skeleton} style={{ width: '60px' }} /></td>
      <td><span className={styles.skeleton} style={{ width: '60px' }} /></td>
    </tr>
  )
}

// Empty state
function EmptyState({ filters }: { filters: FilterState }) {
  const hasFilters =
    filters.search ||
    filters.entityType ||
    filters.entityId ||
    filters.key ||
    filters.source ||
    filters.createdBy ||
    filters.minConfidence > 0

  return (
    <tr>
      <td colSpan={8}>
        <div className={styles.emptyState}>
          <span className={styles.emptyStateIcon} aria-hidden="true">⬡</span>
          <p className={styles.emptyStateTitle}>No facts found</p>
          {hasFilters ? (
            <p className={styles.emptyStateBody}>
              No results match the current filters.
              {filters.activeOnly && ' Try disabling "Active only" to include archived facts.'}
            </p>
          ) : (
            <p className={styles.emptyStateBody}>
              The knowledge base is empty. Facts appear here once Iranti agents begin writing memory.
            </p>
          )}
        </div>
      </td>
    </tr>
  )
}

// Error state
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <tr>
      <td colSpan={8}>
        <div className={styles.errorState}>
          <span className={styles.errorStateIcon} aria-hidden="true">⚠</span>
          <p className={styles.errorStateTitle}>Unable to load facts</p>
          <p className={styles.errorStateBody}>{message}</p>
          <button className={styles.errorRetryButton} onClick={onRetry} type="button">
            Retry
          </button>
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
  onPageChange,
  onPageSizeChange,
}: {
  pagination: PaginationState
  onPageChange: (offset: number) => void
  onPageSizeChange: (limit: PageSize) => void
}) {
  const { offset, limit, total } = pagination
  const currentPage = Math.floor(offset / limit) + 1
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const start = offset + 1
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
  const [pagination, setPagination] = useState<PaginationState>({
    offset: 0,
    limit: 25,
    total: STUB_FACTS.length,
  })

  // TODO(CP-T013): Replace with useQuery from TanStack Query once CP-T010 API is ready
  // const { data, isLoading, error, refetch } = useQuery({
  //   queryKey: ['kb', filters, sort, pagination.offset, pagination.limit],
  //   queryFn: () => fetchKBFacts({ ...filters, sortBy: sort.column, sortDir: sort.dir,
  //                                  limit: pagination.limit, offset: pagination.offset }),
  // })
  const isLoading = false
  const error: string | null = null
  const facts = STUB_FACTS
  const refetch = useCallback(() => { /* TODO */ }, [])

  const handleSort = (column: SortColumn) => {
    setSort(prev =>
      prev.column === column
        ? { ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: 'desc' }
    )
    // Reset to first page on sort change
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
      {/* Sticky filter bar */}
      <FilterBar filters={filters} dispatch={dispatch} />

      {/* Scrollable table region */}
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
            {isLoading && Array.from({ length: 8 }, (_, i) => <SkeletonRow key={i} />)}

            {!isLoading && error && (
              <ErrorState message={error} onRetry={refetch} />
            )}

            {!isLoading && !error && facts.length === 0 && (
              <EmptyState filters={filters} />
            )}

            {!isLoading && !error && facts.map(fact => (
              <>
                <tr
                  key={fact.id}
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
                    <span className={styles.summaryText}>{fact.valueSummary}</span>
                  </td>
                  <td className={styles.cellConfidence}>
                    <ConfidenceBar value={fact.confidence} />
                  </td>
                  <td className={styles.cellSource}>{fact.source}</td>
                  <td className={styles.cellMono}>{fact.agentId}</td>
                  <td className={styles.cellMeta}>
                    {fact.validFrom ? new Date(fact.validFrom).toLocaleDateString() : '—'}
                  </td>
                  <td className={styles.cellMeta}>{formatRelativeTime(fact.updatedAt)}</td>
                </tr>

                {expandedRowId === fact.id && (
                  <ExpandedRowDetail
                    key={`${fact.id}-expanded`}
                    fact={fact}
                    onViewHistory={handleViewHistory}
                  />
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <PaginationControls
        pagination={pagination}
        onPageChange={offset => setPagination(p => ({ ...p, offset }))}
        onPageSizeChange={limit => setPagination(p => ({ ...p, limit, offset: 0, total: p.total }))}
      />
    </div>
  )
}
