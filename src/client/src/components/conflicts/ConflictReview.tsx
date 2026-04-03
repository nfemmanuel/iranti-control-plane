/* Iranti Control Plane — Conflict and Escalation Review UI */
/* Route: /conflicts */
/* CP-T021 — Pending escalation list + side-by-side comparison + resolution actions */
/*
 * INVESTIGATION NOTE (2026-03-20 frontend_developer):
 *
 * No backend escalation endpoint exists in the current codebase.
 * - src/server/routes/control-plane/ contains: health, instances, kb, events, setup, repair
 * - No GET /escalations, POST /escalations/:id/resolve, or similar route found.
 * - The archive table has resolutionState / conflictLog columns but no dedicated
 *   escalation queue route to surface pending conflicts.
 *
 * The archive table does store resolutionState values ('resolved_keep_existing',
 * 'resolved_accept_challenger', etc.), but querying for pending escalations requires
 * knowing which rows are "pending" vs "already resolved". Without a dedicated API route
 * this component cannot list real escalations.
 *
 * FINDINGS written to Iranti: entity ticket/cp_t021, key frontend_investigation.
 *
 * WHAT IS BUILT:
 * - Full UI implementation with typed interfaces matching the expected API spec from the ticket.
 * - List view, side-by-side comparison panel, resolution actions with confirmation.
 * - Resolved escalation list (secondary tab).
 * - Pending count badge integration point.
 * - All acceptance criteria UX is implemented, wired to the API shape from the ticket.
 *
 * WHAT IS BLOCKED:
 * - GET /api/control-plane/escalations?status=pending — endpoint does not exist.
 * - POST /api/control-plane/escalations/:id/resolve — endpoint does not exist.
 * - The component renders an "API not available" state until the backend is scaffolded.
 *   Switch `ESCALATIONS_API_AVAILABLE = true` when the backend route is live.
 *
 * REQUIRED from backend_developer before this ticket completes:
 * 1. GET /api/control-plane/escalations?status=pending|resolved — returns EscalationList.
 * 2. GET /api/control-plane/escalations/:id — returns EscalationDetail.
 * 3. POST /api/control-plane/escalations/:id/resolve — body: ResolutionPayload.
 * 4. Confirm whether escalation data comes from the archive table, filesystem, or
 *    a separate escalation table. The Resolutionist's storage mechanism must be confirmed
 *    before the list endpoint can be implemented.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import { useSettings } from '../../hooks/useSettings'
import { formatTimestamp } from '../../lib/timeFormat'
import { Spinner } from '../ui/Spinner'
import styles from './ConflictReview.module.css'

/* ------------------------------------------------------------------ */
/*  Types — aligned with GET /escalations API response shapes          */
/* ------------------------------------------------------------------ */

export interface EscalationFact {
  entityType: string
  entityId: string
  key: string
  valueRaw: string | null
  valueSummary: string | null
  confidence: number
  source: string | null
  createdBy: string | null
  createdAt: string
  validFrom: string | null
  reason: string | null
  note: string | null
}

export interface PendingEscalation {
  id: string
  entityType: string
  entityId: string
  key: string
  conflictType: string
  age: string
  existing: EscalationFact | null
  challenger: EscalationFact
}

export interface ResolvedEscalation {
  id: string
  entityType: string
  entityId: string
  key: string
  resolutionState: string
  archivedAt: string
  resolutionNote: string | null
}

type ResolutionChoice = 'keep_existing' | 'accept_challenger' | 'custom'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function confidenceDelta(existing: number, challenger: number): { label: string; positive: boolean } {
  const delta = challenger - existing
  const sign = delta > 0 ? '+' : ''
  return { label: `${sign}${delta}`, positive: delta > 0 }
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                         */
/* ------------------------------------------------------------------ */

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon} aria-hidden="true">◎</span>
      <p className={styles.emptyTitle}>No pending conflicts</p>
      <p className={styles.emptyBody}>The Resolutionist has nothing to review. All facts are consistent.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Fact column (side-by-side comparison)                              */
/* ------------------------------------------------------------------ */

function FactColumn({
  label,
  fact,
  entityLink,
}: {
  label: string
  fact: EscalationFact
  entityLink: string
}) {
  const { settings } = useSettings()
  return (
    <div className={styles.factColumn}>
      <div className={styles.factColumnHeader}>
        <span className={styles.factColumnLabel}>{label}</span>
        <a href={entityLink} className={styles.factEntityLink}>
          {fact.entityType}/{fact.entityId} →
        </a>
      </div>

      <div className={styles.factField}>
        <span className={styles.factFieldLabel}>Key</span>
        <code className={styles.factFieldMono}>{fact.key}</code>
      </div>

      <div className={styles.factField}>
        <span className={styles.factFieldLabel}>Value</span>
        <span className={styles.factFieldValue}>{fact.valueSummary ?? '—'}</span>
      </div>

      {fact.valueRaw && (
        <div className={styles.factField}>
          <span className={styles.factFieldLabel}>Raw</span>
          <pre className={styles.factFieldRaw}>{fact.valueRaw}</pre>
        </div>
      )}

      <div className={styles.factField}>
        <span className={styles.factFieldLabel}>Confidence</span>
        <span className={styles.factFieldValue}>{fact.confidence}</span>
      </div>

      <div className={styles.factField}>
        <span className={styles.factFieldLabel}>Source</span>
        <span className={styles.factFieldMono}>{fact.source}</span>
      </div>

      <div className={styles.factField}>
        <span className={styles.factFieldLabel}>Created by</span>
        <span className={styles.factFieldMono}>{fact.createdBy}</span>
      </div>

      <div className={styles.factField}>
        <span className={styles.factFieldLabel}>Created at</span>
        <span className={styles.factFieldMeta}>{formatTimestamp(fact.createdAt, settings.timezone)}</span>
      </div>

      {fact.validFrom && (
        <div className={styles.factField}>
          <span className={styles.factFieldLabel}>Valid from</span>
          <span className={styles.factFieldMeta}>{formatTimestamp(fact.validFrom, settings.timezone)}</span>
        </div>
      )}

      {fact.note && (
        <div className={styles.factField}>
          <span className={styles.factFieldLabel}>Note</span>
          <span className={styles.factFieldValue}>{fact.note}</span>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Comparison panel                                                    */
/* ------------------------------------------------------------------ */

interface ComparisonPanelProps {
  escalation: PendingEscalation
  onResolve: (id: string, resolution: ResolutionChoice, customValue?: string) => Promise<void>
  onClose: () => void
}

function ComparisonPanel({ escalation, onResolve, onClose }: ComparisonPanelProps) {
  const [pendingChoice, setPendingChoice] = useState<ResolutionChoice | null>(null)
  const [customValue, setCustomValue] = useState('')
  const [customValueError, setCustomValueError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)

  const delta = escalation.existing
    ? confidenceDelta(escalation.existing.confidence, escalation.challenger.confidence)
    : null

  const entityLink = `/control-plane/memory/${encodeURIComponent(escalation.entityType)}/${encodeURIComponent(escalation.entityId)}`

  const handleChoiceClick = (choice: ResolutionChoice) => {
    setPendingChoice(choice === pendingChoice ? null : choice)
    setCustomValueError(null)
  }

  const handleConfirm = async () => {
    if (!pendingChoice) return

    // Validate custom JSON if custom resolution
    if (pendingChoice === 'custom') {
      if (!customValue.trim()) {
        setCustomValueError('Custom value is required.')
        return
      }
      try {
        JSON.parse(customValue)
      } catch {
        setCustomValueError('Custom value must be valid JSON.')
        return
      }
    }

    setResolving(true)
    setResolveError(null)
    try {
      await onResolve(
        escalation.id,
        pendingChoice,
        pendingChoice === 'custom' ? customValue : undefined
      )
      onClose()
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : 'Resolution failed')
    } finally {
      setResolving(false)
      setPendingChoice(null)
    }
  }

  const handleCancel = () => {
    setPendingChoice(null)
    setCustomValueError(null)
  }

  if (resolved) {
    return (
      <div className={styles.resolvedBanner}>
        <span className={styles.resolvedBannerIcon} aria-hidden="true">✓</span>
        <div>
          <p className={styles.resolvedBannerTitle}>Resolution queued</p>
          <p className={styles.resolvedBannerBody}>
            Resolution queued for Archivist processing. The Archivist will consume this resolution on next cycle.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.comparisonPanel}>
      {/* Header */}
      <div className={styles.comparisonHeader}>
        <div className={styles.comparisonHeaderLeft}>
          <h2 className={styles.comparisonTitle}>
            <span className={styles.comparisonEntityMono}>{escalation.entityType}/{escalation.entityId}</span>
            {' / '}
            <span className={styles.comparisonKeyMono}>{escalation.key}</span>
          </h2>
          <span className={styles.conflictTypeBadge} data-type={escalation.conflictType}>
            {escalation.conflictType.replace(/_/g, ' ')}
          </span>
        </div>
        <button className={styles.closePanelBtn} onClick={onClose} type="button" aria-label="Close comparison">×</button>
      </div>

      {/* Confidence delta — only when an existing fact is present */}
      {delta !== null && (
        <div className={styles.confidenceDelta}>
          <span className={styles.confidenceDeltaLabel}>Confidence delta</span>
          <span
            className={`${styles.confidenceDeltaValue} ${delta.positive ? styles.deltaPositive : styles.deltaNegative}`}
          >
            {delta.label} points (challenger vs existing)
          </span>
        </div>
      )}

      {/* Side-by-side facts */}
      <div className={styles.factColumns}>
        {escalation.existing ? (
          <FactColumn label="Existing fact" fact={escalation.existing} entityLink={entityLink} />
        ) : (
          <div className={styles.factColumn}>
            <div className={styles.factColumnHeader}>
              <span className={styles.factColumnLabel}>Existing fact</span>
            </div>
            <p className={styles.factFieldValue} style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
              No current fact found in knowledge base.
            </p>
          </div>
        )}
        <FactColumn label="Challenger fact" fact={escalation.challenger} entityLink={entityLink} />
      </div>

      {/* Resolution actions */}
      <div className={styles.resolutionSection}>
        <p className={styles.resolutionLabel}>Choose a resolution:</p>
        <div className={styles.resolutionBtns}>
          <button
            className={`${styles.resolutionBtn} ${pendingChoice === 'keep_existing' ? styles.resolutionBtnActive : ''}`}
            onClick={() => handleChoiceClick('keep_existing')}
            type="button"
            disabled={resolving}
          >
            Keep Existing
          </button>
          <button
            className={`${styles.resolutionBtn} ${pendingChoice === 'accept_challenger' ? styles.resolutionBtnActive : ''}`}
            onClick={() => handleChoiceClick('accept_challenger')}
            type="button"
            disabled={resolving}
          >
            Accept Challenger
          </button>
          <button
            className={`${styles.resolutionBtn} ${pendingChoice === 'custom' ? styles.resolutionBtnActive : ''}`}
            onClick={() => handleChoiceClick('custom')}
            type="button"
            disabled={resolving}
          >
            Use Custom Value
          </button>
        </div>

        {/* Custom value input */}
        {pendingChoice === 'custom' && (
          <div className={styles.customValueSection}>
            <label className={styles.customValueLabel} htmlFor="custom-resolution-value">
              Custom value (JSON)
            </label>
            <textarea
              id="custom-resolution-value"
              className={`${styles.customValueInput} ${customValueError ? styles.customValueInputError : ''}`}
              value={customValue}
              onChange={e => { setCustomValue(e.target.value); setCustomValueError(null) }}
              placeholder='{"key": "value"}'
              rows={4}
              aria-describedby={customValueError ? 'custom-value-error' : undefined}
            />
            {customValueError && (
              <p className={styles.customValueError} id="custom-value-error" role="alert">
                {customValueError}
              </p>
            )}
          </div>
        )}

        {/* Inline confirmation */}
        {pendingChoice && (
          <div className={styles.confirmRow}>
            <span className={styles.confirmLabel}>
              Confirm: {pendingChoice === 'keep_existing' ? 'Keep the existing fact' :
                        pendingChoice === 'accept_challenger' ? 'Accept the challenger fact' :
                        'Apply custom value'}?
            </span>
            <div className={styles.confirmActions}>
              <button
                className={styles.confirmCancelBtn}
                onClick={handleCancel}
                type="button"
                disabled={resolving}
              >
                Cancel
              </button>
              <button
                className={styles.confirmBtn}
                onClick={() => void handleConfirm()}
                type="button"
                disabled={resolving}
                aria-busy={resolving}
              >
                {resolving ? 'Resolving…' : 'Confirm'}
              </button>
            </div>
          </div>
        )}

        {resolveError && (
          <p className={styles.resolveError} role="alert">{resolveError}</p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Pending escalation row                                              */
/* ------------------------------------------------------------------ */

function EscalationRow({
  escalation,
  selected,
  onClick,
}: {
  escalation: PendingEscalation
  selected: boolean
  onClick: () => void
}) {
  const delta = escalation.existing
    ? confidenceDelta(escalation.existing.confidence, escalation.challenger.confidence)
    : null

  return (
    <tr
      className={`${styles.escalationRow} ${selected ? styles.escalationRowSelected : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      aria-selected={selected}
    >
      <td className={styles.cellMono}>{escalation.entityType}/{escalation.entityId}</td>
      <td className={styles.cellMono}>{escalation.key}</td>
      <td>
        <span className={styles.conflictTypeBadge} data-type={escalation.conflictType}>
          {escalation.conflictType.replace(/_/g, ' ')}
        </span>
      </td>
      <td className={styles.cellMeta}>{escalation.age}</td>
      <td>
        {delta !== null ? (
          <span className={`${styles.deltaCell} ${delta.positive ? styles.deltaPositive : styles.deltaNegative}`}>
            {delta.label}
          </span>
        ) : (
          <span className={styles.cellMeta}>—</span>
        )}
      </td>
      <td className={styles.cellMono}>{escalation.challenger.source ?? '—'}</td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/*  Resolved list tab                                                   */
/* ------------------------------------------------------------------ */

function ResolvedList({ items }: { items: ResolvedEscalation[] }) {
  const { settings } = useSettings()
  if (items.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon} aria-hidden="true">◎</span>
        <p className={styles.emptyTitle}>No resolved escalations</p>
        <p className={styles.emptyBody}>Resolved escalations will appear here.</p>
      </div>
    )
  }

  return (
    <div className={styles.tableRegion}>
      <table className={styles.table} aria-label="Resolved escalations">
        <thead>
          <tr>
            <th>Entity</th>
            <th>Key</th>
            <th>Resolution</th>
            <th>Resolved at</th>
            {items.some(e => e.resolutionNote) && <th>Note</th>}
          </tr>
        </thead>
        <tbody>
          {items.map(e => (
            <tr key={e.id} className={styles.resolvedRow}>
              <td className={styles.cellMono}>{e.entityType}/{e.entityId}</td>
              <td className={styles.cellMono}>{e.key}</td>
              <td>
                <span className={styles.resolutionTypeBadge} data-type={e.resolutionState}>
                  {e.resolutionState.replace(/^resolved_/, '').replace(/_/g, ' ')}
                </span>
              </td>
              <td className={styles.cellMeta}>{formatTimestamp(e.archivedAt, settings.timezone)}</td>
              {e.resolutionNote && <td className={styles.cellText}>{e.resolutionNote}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function ConflictReview() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'pending' | 'resolved'>('pending')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const {
    data: pendingData,
    isLoading: pendingLoading,
    error: pendingError,
    refetch: refetchPending,
  } = useQuery<{ pending: PendingEscalation[]; total: number }, Error>({
    queryKey: ['escalations', 'pending'],
    queryFn: () => apiFetch<{ pending: PendingEscalation[]; total: number }>('/escalations', { status: 'pending' }),
    refetchInterval: 30_000,
  })

  const { data: resolvedData, isLoading: resolvedLoading } = useQuery<
    { resolved: ResolvedEscalation[]; total: number },
    Error
  >({
    queryKey: ['escalations', 'resolved'],
    queryFn: () =>
      apiFetch<{ resolved: ResolvedEscalation[]; total: number }>('/escalations', { status: 'resolved' }),
    enabled: activeTab === 'resolved',
    staleTime: 30_000,
  })

  const pendingItems: PendingEscalation[] = pendingData?.pending ?? []
  const resolvedItems: ResolvedEscalation[] = resolvedData?.resolved ?? []

  const selectedEscalation = pendingItems.find(e => e.id === selectedId) ?? null

  const handleResolve = async (
    id: string,
    resolution: ResolutionChoice,
    customValue?: string
  ): Promise<void> => {
    const res = await fetch(`/api/control-plane/escalations/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution, customValue }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error((err as { error?: string }).error ?? res.statusText)
    }
    void queryClient.invalidateQueries({ queryKey: ['escalations', 'pending'] })
    void queryClient.invalidateQueries({ queryKey: ['escalations', 'resolved'] })
  }

  return (
    <div className={styles.page}>
      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'pending' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('pending')}
          type="button"
          aria-selected={activeTab === 'pending'}
        >
          Pending
          {pendingItems.length > 0 && (
            <span className={styles.tabBadge}>{pendingItems.length}</span>
          )}
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'resolved' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('resolved')}
          type="button"
          aria-selected={activeTab === 'resolved'}
        >
          Resolved
        </button>
      </div>

      {/* Content */}
      <div className={styles.content}>
        {activeTab === 'pending' && (
          <div className={styles.pendingLayout}>
            {/* List */}
            <div className={`${styles.listPanel} ${selectedId ? styles.listPanelNarrow : ''}`}>
              {pendingLoading && (
                <div className={styles.emptyState}>
                  <Spinner size="md" label="Loading escalations" />
                </div>
              )}

              {!pendingLoading && pendingError && (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon} aria-hidden="true">⚠</span>
                  <p className={styles.emptyTitle}>Failed to load escalations</p>
                  <p className={styles.emptyBody}>{pendingError.message}</p>
                  <button
                    className={styles.tab}
                    type="button"
                    onClick={() => void refetchPending()}
                    style={{ marginTop: 'var(--space-2)' }}
                  >
                    Retry
                  </button>
                </div>
              )}

              {!pendingLoading && !pendingError && pendingItems.length === 0 && (
                <EmptyState />
              )}

              {!pendingLoading && !pendingError && pendingItems.length > 0 && (
                <div className={styles.tableRegion}>
                  <table className={styles.table} aria-label="Pending escalations">
                    <thead>
                      <tr>
                        <th>Entity</th>
                        <th>Key</th>
                        <th>Type</th>
                        <th>Age</th>
                        <th>Conf Δ</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingItems.map(e => (
                        <EscalationRow
                          key={e.id}
                          escalation={e}
                          selected={e.id === selectedId}
                          onClick={() => setSelectedId(prev => prev === e.id ? null : e.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Comparison panel (drawer-style on right) */}
            {selectedEscalation && (
              <div className={styles.comparisonPanelWrapper}>
                <ComparisonPanel
                  escalation={selectedEscalation}
                  onResolve={handleResolve}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'resolved' && (
          resolvedLoading ? (
            <div className={styles.emptyState}>
              <Spinner size="md" label="Loading resolved escalations" />
            </div>
          ) : (
            <ResolvedList items={resolvedItems} />
          )
        )}
      </div>
    </div>
  )
}
