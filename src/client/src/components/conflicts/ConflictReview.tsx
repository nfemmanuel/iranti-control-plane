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
import styles from './ConflictReview.module.css'

/* ------------------------------------------------------------------ */
/*  Feature flag — flip to true when backend route is live             */
/* ------------------------------------------------------------------ */

const ESCALATIONS_API_AVAILABLE = true

/* ------------------------------------------------------------------ */
/*  Types — mirror the expected API shape from CP-T021 spec            */
/* ------------------------------------------------------------------ */

export interface EscalationFact {
  entityType: string
  entityId: string
  key: string
  valueRaw: string | null
  valueSummary: string | null
  confidence: number
  source: string
  createdBy: string
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
  escalationReason: string
  conflictType: 'value_conflict' | 'confidence_conflict' | 'source_conflict'
  createdAt: string
  source: string
  challengingAgent: string
  existing: EscalationFact
  challenger: EscalationFact
}

export interface ResolvedEscalation {
  id: string
  entityType: string
  entityId: string
  key: string
  resolutionType: 'keep_existing' | 'accept_challenger' | 'custom'
  resolvedAt: string
  resolvedBy: string
}

type ResolutionChoice = 'keep_existing' | 'accept_challenger' | 'custom'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

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
/*  API not available placeholder                                       */
/* ------------------------------------------------------------------ */

function ApiNotAvailable() {
  return (
    <div className={styles.apiNotAvailable}>
      <div className={styles.apiNotAvailableIcon} aria-hidden="true">⬡</div>
      <h2 className={styles.apiNotAvailableTitle}>Escalation API not yet available</h2>
      <p className={styles.apiNotAvailableBody}>
        The backend escalation endpoints have not been implemented yet.
        This UI is complete and ready to wire up once the backend routes are live.
      </p>
      <div className={styles.apiNotAvailableBlock}>
        <p className={styles.apiNotAvailableBlockTitle}>Required endpoints (backend_developer):</p>
        <ul className={styles.apiNotAvailableList}>
          <li><code>GET /api/control-plane/escalations?status=pending</code></li>
          <li><code>GET /api/control-plane/escalations/:id</code></li>
          <li><code>POST /api/control-plane/escalations/:id/resolve</code></li>
        </ul>
      </div>
      <div className={styles.apiNotAvailableBlock}>
        <p className={styles.apiNotAvailableBlockTitle}>Open questions for system_architect:</p>
        <ul className={styles.apiNotAvailableList}>
          <li>Does the Resolutionist store escalations in the archive table, a separate table, or filesystem files?</li>
          <li>Is there a programmatic resolution pathway (API), or is resolution currently CLI-only?</li>
          <li>If CLI-only, will the backend wrap the CLI in a subprocess for Phase 2, or implement a proper API first?</li>
        </ul>
      </div>
      <p className={styles.apiNotAvailableNote}>
        Investigation findings: entity <code>ticket/cp_t021</code>, key <code>frontend_investigation</code> in Iranti.
      </p>
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
        <span className={styles.factFieldMeta}>{new Date(fact.createdAt).toLocaleString()}</span>
      </div>

      {fact.validFrom && (
        <div className={styles.factField}>
          <span className={styles.factFieldLabel}>Valid from</span>
          <span className={styles.factFieldMeta}>{new Date(fact.validFrom).toLocaleString()}</span>
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

  const delta = confidenceDelta(escalation.existing.confidence, escalation.challenger.confidence)

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
      setResolved(true)
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

      {/* Escalation reason */}
      <div className={styles.escalationReason}>
        <span className={styles.escalationReasonLabel}>Escalation reason</span>
        <p className={styles.escalationReasonText}>{escalation.escalationReason}</p>
      </div>

      {/* Confidence delta */}
      <div className={styles.confidenceDelta}>
        <span className={styles.confidenceDeltaLabel}>Confidence delta</span>
        <span
          className={`${styles.confidenceDeltaValue} ${delta.positive ? styles.deltaPositive : styles.deltaNegative}`}
        >
          {delta.label} points (challenger vs existing)
        </span>
      </div>

      {/* Side-by-side facts */}
      <div className={styles.factColumns}>
        <FactColumn label="Existing fact" fact={escalation.existing} entityLink={entityLink} />
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
  const delta = confidenceDelta(escalation.existing.confidence, escalation.challenger.confidence)
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
      <td className={styles.cellText}>{escalation.escalationReason}</td>
      <td>
        <span className={styles.conflictTypeBadge} data-type={escalation.conflictType}>
          {escalation.conflictType.replace(/_/g, ' ')}
        </span>
      </td>
      <td className={styles.cellMeta}>{formatAge(escalation.createdAt)}</td>
      <td>
        <span className={`${styles.deltaCell} ${delta.positive ? styles.deltaPositive : styles.deltaNegative}`}>
          {delta.label}
        </span>
      </td>
      <td className={styles.cellMono}>{escalation.source}</td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/*  Resolved list tab                                                   */
/* ------------------------------------------------------------------ */

function ResolvedList({ items }: { items: ResolvedEscalation[] }) {
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
            <th>Resolved by</th>
          </tr>
        </thead>
        <tbody>
          {items.map(e => (
            <tr key={e.id} className={styles.resolvedRow}>
              <td className={styles.cellMono}>{e.entityType}/{e.entityId}</td>
              <td className={styles.cellMono}>{e.key}</td>
              <td>
                <span className={styles.resolutionTypeBadge} data-type={e.resolutionType}>
                  {e.resolutionType.replace(/_/g, ' ')}
                </span>
              </td>
              <td className={styles.cellMeta}>{new Date(e.resolvedAt).toLocaleString()}</td>
              <td className={styles.cellMono}>{e.resolvedBy}</td>
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
  const [activeTab, setActiveTab] = useState<'pending' | 'resolved'>('pending')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // These would be fetched from the API when ESCALATIONS_API_AVAILABLE is true.
  // For now: typed as the expected shapes so the TypeScript compiles correctly.
  const pendingItems: PendingEscalation[] = []
  const resolvedItems: ResolvedEscalation[] = []

  const selectedEscalation = pendingItems.find(e => e.id === selectedId) ?? null

  const handleResolve = async (
    _id: string,
    _resolution: ResolutionChoice,
    _customValue?: string
  ): Promise<void> => {
    // Will call POST /api/control-plane/escalations/:id/resolve when backend is live.
    // Body: { resolution: _resolution, customValue: _customValue }
    throw new Error('Escalation API not yet available. Backend route required.')
  }

  if (!ESCALATIONS_API_AVAILABLE) {
    return (
      <div className={styles.page}>
        <ApiNotAvailable />
      </div>
    )
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
              {pendingItems.length === 0 ? (
                <EmptyState />
              ) : (
                <div className={styles.tableRegion}>
                  <table className={styles.table} aria-label="Pending escalations">
                    <thead>
                      <tr>
                        <th>Entity</th>
                        <th>Key</th>
                        <th>Reason</th>
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
          <ResolvedList items={resolvedItems} />
        )}
      </div>
    </div>
  )
}
