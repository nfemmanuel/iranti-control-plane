/* Iranti Control Plane — Archive Explorer */
/* Route: /archive */
/* Displays archived facts with all KB filters plus archive-specific filters. */
/* Queries GET /api/control-plane/archive (no temporal history jump — archive IS the history). */
/* CP-T049: Archivist History, Flag for Review, Flagged filter, Flagged queue, Restore. */

import { Fragment, useState, useReducer, useEffect, useRef, useCallback, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type {
  ArchiveFact,
  ArchiveListResponse,
  ArchiveEventsResponse,
  FlagResponse,
  UnflagResponse,
  RestoreResponse,
  StaffEvent,
  ConflictEntry,
} from '../../api/types'
import styles from './MemoryExplorer.module.css'
import archiveStyles from './ArchiveExplorer.module.css'
import { Spinner } from '../ui/Spinner'
import { ConfirmationModal } from '../ui/ConfirmationModal'

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
  flaggedOnly: boolean
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
  flaggedOnly: false,
}

type FilterAction =
  | { type: 'SET_FIELD'; field: keyof ArchiveFilterState; value: string | number | boolean }
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

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/* ------------------------------------------------------------------ */
/*  ConflictLog helpers (CP-T053 — AC-2)                              */
/* ------------------------------------------------------------------ */

function parseConflictLog(raw: Record<string, unknown> | null): ConflictEntry[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw as ConflictEntry[]
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
            <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: conflictTypeBadgeStyle(entry.type).color ?? 'var(--color-text-tertiary)', marginTop: 5, display: 'inline-block', border: '1px solid var(--color-border-default)' }} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <span style={{ ...conflictTypeBadgeStyle(entry.type), fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em', borderRadius: 'var(--border-radius-sm)', padding: '1px 5px', whiteSpace: 'nowrap' }}>
                  {CONFLICT_TYPE_LABELS[entry.type]}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', cursor: 'default' }} title={entry.at}>
                  {formatRelativeTime(entry.at)}
                </span>
                <span style={{ fontSize: '10px', color: entry.usedLLM ? 'var(--color-staff-attendant)' : 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                  {entry.usedLLM ? 'LLM' : 'Deterministic'}
                </span>
              </div>
              {entry.reason && (
                <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{entry.reason}</span>
              )}
              {entry.existingScore !== undefined && entry.incomingScore !== undefined && (
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  Existing: {entry.existingScore} vs Incoming: {entry.incomingScore}
                </span>
              )}
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

/** POST/DELETE with JSON body via fetch (not apiFetch which only does GET). */
async function apiMutate<T>(
  path: string,
  method: 'POST' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `/api/control-plane${path}`
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
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

/* ------------------------------------------------------------------ */
/*  Archivist History section                                           */
/* ------------------------------------------------------------------ */

function ArchivistHistory({ archiveId }: { archiveId: string }) {
  const [open, setOpen] = useState(false)

  const { data, isLoading } = useQuery<ArchiveEventsResponse, Error>({
    queryKey: ['archive-events', archiveId],
    queryFn: () => apiFetch<ArchiveEventsResponse>(`/archive/${archiveId}/archivist-events`),
    enabled: open,
    staleTime: 30_000,
  })

  const events: StaffEvent[] = data?.events ?? []

  return (
    <div className={archiveStyles.archivistHistory}>
      <button
        className={archiveStyles.archivistHistoryToggle}
        onClick={() => setOpen(o => !o)}
        type="button"
        aria-expanded={open}
      >
        <span className={archiveStyles.archivistHistoryChevron} aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        Archivist History
      </button>

      {open && (
        <div className={archiveStyles.archivistHistoryBody}>
          {isLoading && (
            <div className={archiveStyles.archivistHistoryLoading}>
              <Spinner size="sm" label="Loading Archivist history" />
            </div>
          )}

          {!isLoading && events.length === 0 && (
            <div className={archiveStyles.archivistHistoryEmpty}>
              <span className={archiveStyles.archivistHistoryEmptyTitle}>
                No Archivist events recorded for this fact.
              </span>
              <span className={archiveStyles.archivistHistoryEmptyNote}>
                Full event coverage requires CP-T025 native emitter injection.
              </span>
            </div>
          )}

          {!isLoading && events.length > 0 && (
            <ol className={archiveStyles.historyTimeline} aria-label="Archivist events">
              {events.map(ev => (
                <li key={ev.eventId} className={archiveStyles.historyTimelineItem}>
                  <span className={archiveStyles.historyTimelineDot} aria-hidden="true" />
                  <div className={archiveStyles.historyTimelineContent}>
                    <div className={archiveStyles.historyTimelineHeader}>
                      <span className={archiveStyles.historyTimelineAction}>{ev.actionType}</span>
                      <span className={archiveStyles.historyTimelineTime} title={ev.timestamp}>
                        {formatTimestamp(ev.timestamp)}
                      </span>
                    </div>
                    {ev.reason && (
                      <span className={archiveStyles.historyTimelineReason}>{ev.reason}</span>
                    )}
                    {ev.metadata && (
                      <pre className={archiveStyles.historyTimelineMeta}>
                        {JSON.stringify(ev.metadata, null, 2)}
                      </pre>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Flag for Review inline UI                                           */
/* ------------------------------------------------------------------ */

interface FlagControlProps {
  fact: ArchiveFact
  onFlagged: (updated: Pick<ArchiveFact, 'id' | 'flagged' | 'flagNote' | 'flaggedAt'>) => void
}

function FlagControl({ fact, onFlagged }: FlagControlProps) {
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFlag = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiMutate<FlagResponse>(`/archive/${fact.id}/flag`, 'POST', {
        note: note.trim() || undefined,
      })
      onFlagged({ id: fact.id, flagged: true, flagNote: res.note, flaggedAt: res.flaggedAt })
      setShowNoteInput(false)
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Flag failed')
    } finally {
      setLoading(false)
    }
  }, [fact.id, note, onFlagged])

  const handleUnflag = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await apiMutate<UnflagResponse>(`/archive/${fact.id}/flag`, 'DELETE')
      onFlagged({ id: fact.id, flagged: false, flagNote: null, flaggedAt: null })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove flag failed')
    } finally {
      setLoading(false)
    }
  }, [fact.id, onFlagged])

  if (fact.flagged) {
    return (
      <div className={archiveStyles.flagControl}>
        <button
          className={archiveStyles.unflagButton}
          onClick={() => void handleUnflag()}
          disabled={loading}
          type="button"
        >
          {loading ? 'Removing…' : 'Remove Flag'}
        </button>
        {fact.flagNote && (
          <span className={archiveStyles.flagNoteDisplay} title="Flag note">
            Note: {fact.flagNote}
          </span>
        )}
        {error && <span className={archiveStyles.flagError}>{error}</span>}
      </div>
    )
  }

  if (showNoteInput) {
    return (
      <div className={archiveStyles.flagControl}>
        <input
          type="text"
          className={archiveStyles.flagNoteInput}
          placeholder="Reason for flagging (optional)"
          value={note}
          onChange={e => setNote(e.target.value)}
          aria-label="Flag note"
          maxLength={500}
          autoFocus
        />
        <button
          className={archiveStyles.flagConfirmButton}
          onClick={() => void handleFlag()}
          disabled={loading}
          type="button"
        >
          {loading ? 'Flagging…' : 'Confirm Flag'}
        </button>
        <button
          className={styles.expandedActionButton}
          onClick={() => { setShowNoteInput(false); setNote('') }}
          disabled={loading}
          type="button"
        >
          Cancel
        </button>
        {error && <span className={archiveStyles.flagError}>{error}</span>}
      </div>
    )
  }

  return (
    <div className={archiveStyles.flagControl}>
      <button
        className={archiveStyles.flagButton}
        onClick={() => setShowNoteInput(true)}
        type="button"
      >
        ⚑ Flag for Review
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Expanded archive row                                                */
/* ------------------------------------------------------------------ */

interface ExpandedArchiveRowProps {
  fact: ArchiveFact
  onFlagged: (updated: Pick<ArchiveFact, 'id' | 'flagged' | 'flagNote' | 'flaggedAt'>) => void
}

function ExpandedArchiveRow({ fact, onFlagged }: ExpandedArchiveRowProps) {
  const [showRaw, setShowRaw] = useState(false)
  const parsedRaw = (() => {
    if (!fact.valueRaw) return null
    try { return JSON.parse(fact.valueRaw) }
    catch { return fact.valueRaw }
  })()

  return (
    <tr className={styles.expandedRowContainer}>
      <td colSpan={10} className={styles.expandedRowTd}>
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
              {/* AC-3: Source label with provenance clarification */}
              <span className={styles.expandedLabel} title="Caller-supplied label indicating how this fact was written (e.g. 'mcp', 'git', 'manual')">
                Source (provenance)
              </span>
              <span className={styles.expandedValue}>{fact.source}</span>
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

          {/* AC-2: ConflictLog timeline — replaces raw JSON expand for conflictLog */}
          <ConflictTimeline conflictLog={fact.conflictLog} />

          {/* Archivist History — CP-T049 */}
          <ArchivistHistory archiveId={fact.id} />

          <div className={styles.expandedActions}>
            <button className={styles.expandedActionButton} onClick={() => setShowRaw(r => !r)}>
              {showRaw ? 'Hide Raw JSON' : 'View Raw JSON'}
            </button>
            {/* Flag for Review — CP-T049 */}
            <FlagControl fact={fact} onFlagged={onFlagged} />
          </div>
        </div>
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/*  Flagged Facts queue row with Restore                               */
/* ------------------------------------------------------------------ */

interface FlaggedQueueRowProps {
  fact: ArchiveFact
  onUnflagged: (id: string) => void
  onRestored: (id: string, superseded: boolean) => void
}

function FlaggedQueueRow({ fact, onUnflagged, onRestored }: FlaggedQueueRowProps) {
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [unflagLoading, setUnflagLoading] = useState(false)

  const handleRestore = useCallback(async () => {
    setRestoreLoading(true)
    setRestoreError(null)
    try {
      const res = await apiMutate<RestoreResponse>(`/archive/${fact.id}/restore?confirm=true`, 'POST')
      setShowRestoreModal(false)
      onRestored(fact.id, res.superseded)
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : 'Restore failed')
    } finally {
      setRestoreLoading(false)
    }
  }, [fact.id, onRestored])

  const handleClearFlag = useCallback(async () => {
    setUnflagLoading(true)
    try {
      await apiMutate<UnflagResponse>(`/archive/${fact.id}/flag`, 'DELETE')
      onUnflagged(fact.id)
    } catch {
      // noop — failure visible from lack of row disappearing
    } finally {
      setUnflagLoading(false)
    }
  }, [fact.id, onUnflagged])

  return (
    <>
      <tr className={archiveStyles.flaggedQueueRow}>
        <td className={styles.cellEntity}>
          <span className={styles.entityType}>{fact.entityType}</span>
          <span className={styles.entitySep}>/</span>
          <span className={styles.entityId}>{fact.entityId}</span>
        </td>
        <td className={styles.cellKey}>{fact.key}</td>
        <td className={styles.cellSource}>{fact.archivedReason ?? '—'}</td>
        <td className={archiveStyles.flagNoteCell}>{fact.flagNote ?? '—'}</td>
        <td className={styles.cellMeta}>
          {fact.flaggedAt ? formatRelativeTime(fact.flaggedAt) : '—'}
        </td>
        <td className={archiveStyles.flaggedQueueActions}>
          <button
            className={archiveStyles.restoreButton}
            onClick={() => setShowRestoreModal(true)}
            type="button"
          >
            Restore Fact
          </button>
          <button
            className={styles.expandedActionButton}
            onClick={() => void handleClearFlag()}
            disabled={unflagLoading}
            type="button"
          >
            {unflagLoading ? 'Clearing…' : 'Clear Flag'}
          </button>
        </td>
      </tr>

      {showRestoreModal && (
        <ConfirmationModal
          title="Restore Archived Fact"
          description={
            'This will restore the archived fact to the live knowledge base. If a current active fact exists for this entity and key, it will be superseded. This action is logged and auditable but cannot be automatically undone.'
          }
          warning={
            'This is an operator override. The Archivist may re-archive this fact on its next processing cycle if the same conditions apply.'
          }
          confirmLabel="Restore Fact"
          loading={restoreLoading}
          onConfirm={() => void handleRestore()}
          onCancel={() => { setShowRestoreModal(false); setRestoreError(null) }}
        />
      )}

      {restoreError && (
        <tr>
          <td colSpan={6}>
            <div className={archiveStyles.restoreError}>{restoreError}</div>
          </td>
        </tr>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Flagged Facts queue section                                         */
/* ------------------------------------------------------------------ */

interface FlaggedQueueProps {
  onUnflagged: (id: string) => void
}

function FlaggedQueue({ onUnflagged }: FlaggedQueueProps) {
  const queryClient = useQueryClient()
  const [successMessages, setSuccessMessages] = useState<Record<string, string>>({})

  const { data, isLoading, error } = useQuery<ArchiveListResponse, Error>({
    queryKey: ['archive-flagged'],
    queryFn: () => apiFetch<ArchiveListResponse>('/archive', { flagged: true, limit: 100, offset: 0 }),
    staleTime: 10_000,
  })

  const facts = data?.items ?? []

  const handleRestored = useCallback((id: string, superseded: boolean) => {
    const msg = superseded
      ? 'Fact restored. The previous active fact was superseded.'
      : 'Fact restored to knowledge base.'
    setSuccessMessages(prev => ({ ...prev, [id]: msg }))
    // Remove from flagged queue after a short delay
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['archive-flagged'] })
      void queryClient.invalidateQueries({ queryKey: ['archive'] })
      onUnflagged(id)
    }, 2000)
  }, [queryClient, onUnflagged])

  const handleUnflagged = useCallback((id: string) => {
    void queryClient.invalidateQueries({ queryKey: ['archive-flagged'] })
    void queryClient.invalidateQueries({ queryKey: ['archive'] })
    onUnflagged(id)
  }, [queryClient, onUnflagged])

  return (
    <div className={archiveStyles.flaggedQueue}>
      <h3 className={archiveStyles.flaggedQueueTitle}>
        Flagged for Review
        {facts.length > 0 && (
          <span className={archiveStyles.flaggedQueueCount}>{facts.length}</span>
        )}
      </h3>

      {isLoading && (
        <div className={archiveStyles.flaggedQueueLoading}>
          <Spinner size="sm" label="Loading flagged facts" />
        </div>
      )}

      {!isLoading && error && (
        <div className={archiveStyles.flaggedQueueError}>
          Unable to load flagged facts: {error.message}
        </div>
      )}

      {!isLoading && !error && facts.length === 0 && (
        <div className={archiveStyles.flaggedQueueEmpty}>
          No facts are currently flagged for review.
        </div>
      )}

      {!isLoading && !error && facts.length > 0 && (
        <div className={styles.tableRegion} style={{ maxHeight: '320px' }}>
          <table className={styles.table} aria-label="Flagged facts for review">
            <thead>
              <tr>
                <th>Entity</th>
                <th>Key</th>
                <th>Archived reason</th>
                <th>Flag note</th>
                <th>Flagged</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {facts.map(fact => {
                const successMsg = successMessages[fact.id]
                if (successMsg) {
                  return (
                    <tr key={fact.id} className={archiveStyles.restoreSuccessRow}>
                      <td colSpan={6} className={archiveStyles.restoreSuccessCell}>
                        {successMsg}
                      </td>
                    </tr>
                  )
                }
                return (
                  <FlaggedQueueRow
                    key={fact.id}
                    fact={fact}
                    onUnflagged={handleUnflagged}
                    onRestored={handleRestored}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
  const queryClient = useQueryClient()
  const [filters, dispatch] = useReducer(filterReducer, DEFAULT_FILTERS)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [pagination, setPagination] = useState<PaginationState>({ offset: 0, limit: 25 })
  // CP-T049: optimistic flagging state — override server data for immediate feedback
  const [localFlagOverrides, setLocalFlagOverrides] = useState<
    Record<string, Pick<ArchiveFact, 'flagged' | 'flagNote' | 'flaggedAt'>>
  >({})

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
    ...(filters.flaggedOnly && { flagged: true }),
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

  // Apply local overrides on top of server data
  const facts = (data?.items ?? []).map(fact => {
    const override = localFlagOverrides[fact.id]
    return override ? { ...fact, ...override } : fact
  })
  const total = data?.total ?? 0

  const toggleRow = (id: string) => setExpandedRowId(prev => prev === id ? null : id)

  // When a flag changes, update local state and invalidate queries
  const handleFlagged = useCallback((
    updated: Pick<ArchiveFact, 'id' | 'flagged' | 'flagNote' | 'flaggedAt'>
  ) => {
    setLocalFlagOverrides(prev => ({
      ...prev,
      [updated.id]: { flagged: updated.flagged, flagNote: updated.flagNote, flaggedAt: updated.flaggedAt },
    }))
    void queryClient.invalidateQueries({ queryKey: ['archive-flagged'] })
  }, [queryClient])

  // When a fact is unflagged from the queue, invalidate the main list too
  const handleQueueUnflagged = useCallback((id: string) => {
    setLocalFlagOverrides(prev => ({
      ...prev,
      [id]: { flagged: false, flagNote: null, flaggedAt: null },
    }))
    void queryClient.invalidateQueries({ queryKey: ['archive'] })
  }, [queryClient])

  const hasActiveFilters = Boolean(
    filters.search || filters.entityType || filters.entityId || filters.key ||
    filters.source || filters.createdBy || filters.minConfidence > 0 ||
    filters.archivedReason || filters.resolutionState || filters.flaggedOnly
  )

  return (
    <div className={styles.page}>
      {/* CP-T049: Flagged for Review queue — always visible above main table */}
      <FlaggedQueue onUnflagged={handleQueueUnflagged} />

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

          {/* CP-T049: Flagged only toggle */}
          <label className={styles.filterToggleLabel}>
            <input
              type="checkbox"
              className={styles.filterCheckbox}
              checked={filters.flaggedOnly}
              onChange={e => dispatch({ type: 'SET_FIELD', field: 'flaggedOnly', value: e.target.checked })}
              aria-label="Show flagged facts only"
            />
            <span className={filters.flaggedOnly ? archiveStyles.flaggedFilterActive : ''}>
              Flagged only
            </span>
          </label>

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
            <col style={{ width: '19%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '7%' }} />
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
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr aria-label="Loading archive">
                <td colSpan={10} style={{ textAlign: 'center', padding: '48px 0' }}>
                  <Spinner size="md" label="Loading archive" />
                </td>
              </tr>
            )}

            {/* CP-T027 Condition B — not connected / API error */}
            {!isLoading && error && (
              <tr>
                <td colSpan={10}>
                  <div className={styles.errorState}>
                    <span className={styles.errorStateIcon} aria-hidden="true">⚠</span>
                    <p className={styles.errorStateTitle}>Unable to load archive</p>
                    <p className={styles.errorStateBody}>
                      The control plane could not reach your Iranti instance. Check the Health dashboard for connection details.
                    </p>
                    <p className={styles.errorStateDetail}>{error.message}</p>
                    <div className={styles.errorStateActions}>
                      <Link to="/health" className={styles.errorStateCtaBtn}>
                        Open Health Dashboard
                      </Link>
                      <button className={styles.errorRetryButton} onClick={() => void refetch()} type="button">
                        Retry
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            )}

            {/* CP-T027 Condition C — filtered, no results */}
            {!isLoading && !error && facts.length === 0 && hasActiveFilters && (
              <tr>
                <td colSpan={10}>
                  <div className={styles.emptyState}>
                    <span className={styles.emptyStateIcon} aria-hidden="true">⬡</span>
                    <p className={styles.emptyStateTitle}>No archived facts match your filter</p>
                    <p className={styles.emptyStateBody}>Try adjusting your search or clearing your filters.</p>
                    <button
                      className={styles.emptyStateCtaBtn}
                      onClick={() => dispatch({ type: 'RESET' })}
                      type="button"
                    >
                      Clear filters
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {/* CP-T027 Condition A — connected, no archived facts */}
            {!isLoading && !error && facts.length === 0 && !hasActiveFilters && (
              <tr>
                <td colSpan={10}>
                  <div className={styles.emptyState}>
                    <span className={styles.emptyStateIcon} aria-hidden="true">⬡</span>
                    <p className={styles.emptyStateTitle}>No archived facts</p>
                    <p className={styles.emptyStateBody}>
                      Facts appear here when they are superseded, contradicted, expired, or decayed by the Archivist.
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
                  {/* CP-T049: Flagged badge */}
                  <td className={styles.cellMeta}>
                    {fact.flagged && (
                      <span className={archiveStyles.flaggedBadge} title={fact.flagNote ?? 'Flagged for review'}>
                        ⚑ Flagged
                      </span>
                    )}
                  </td>
                </tr>

                {expandedRowId === fact.id && (
                  <ExpandedArchiveRow fact={fact} onFlagged={handleFlagged} />
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
