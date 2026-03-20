/* Iranti Control Plane — Temporal History */
/* Route: /memory/:entityType/:entityId/:key */
/* CP-T036 — Timeline of all intervals for an entity/key */

import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { TemporalHistoryResponse, HistoryInterval } from '../../api/types'
import { Spinner } from '../ui/Spinner'
import styles from './TemporalHistory.module.css'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

/* ------------------------------------------------------------------ */
/*  History interval card                                               */
/* ------------------------------------------------------------------ */

function IntervalCard({
  interval,
  isCurrent,
}: {
  interval: HistoryInterval
  isCurrent: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const parsedRaw = (() => {
    if (!interval.valueRaw) return null
    try { return JSON.parse(interval.valueRaw) }
    catch { return interval.valueRaw }
  })()

  const confidenceLevel =
    interval.confidence >= 90 ? 'high' : interval.confidence >= 70 ? 'medium' : 'low'

  return (
    <div className={`${styles.intervalCard} ${isCurrent ? styles.intervalCardCurrent : ''}`}>
      {/* Card header — always visible */}
      <div
        className={styles.intervalHeader}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => parsedRaw !== null && setExpanded(e => !e)}
        onKeyDown={e => {
          if ((e.key === 'Enter' || e.key === ' ') && parsedRaw !== null) {
            setExpanded(ev => !ev)
          }
        }}
        style={{ cursor: parsedRaw !== null ? 'pointer' : 'default' }}
      >
        <div className={styles.intervalLeft}>
          {/* Timeline dot */}
          <div className={styles.timelineDot} data-current={isCurrent} aria-hidden="true" />

          <div className={styles.intervalMeta}>
            <div className={styles.intervalTopRow}>
              {isCurrent && (
                <span className={styles.currentBadge} aria-label="Currently active fact">
                  current
                </span>
              )}
              <span
                className={styles.confidence}
                data-level={confidenceLevel}
                title={`Confidence: ${interval.confidence}`}
              >
                {interval.confidence}
              </span>
              {interval.providerSource && (
                <span className={styles.source}>{interval.providerSource}</span>
              )}
              {interval.agentId && (
                <span className={styles.agent}>{interval.agentId}</span>
              )}
            </div>

            <p className={styles.valueSummary}>
              {interval.valueSummary ?? <em className={styles.noValue}>No value summary</em>}
            </p>

            <div className={styles.intervalDates}>
              <span className={styles.dateItem}>
                <span className={styles.dateLabel}>Valid from</span>
                <span className={styles.dateValue}>{formatDate(interval.validFrom)}</span>
              </span>
              <span className={styles.dateSep} aria-hidden="true">→</span>
              <span className={styles.dateItem}>
                <span className={styles.dateLabel}>Valid until</span>
                <span className={styles.dateValue}>
                  {isCurrent ? (
                    <span className={styles.stillActive}>still active</span>
                  ) : (
                    formatDate(interval.validUntil)
                  )}
                </span>
              </span>
            </div>

            {!isCurrent && interval.archivedReason && (
              <div className={styles.archivedRow}>
                <span className={styles.archivedReasonLabel}>Archived reason:</span>
                <span className={styles.archivedReason}>{interval.archivedReason}</span>
                {interval.archivedAt && (
                  <span className={styles.archivedAt}>{formatDate(interval.archivedAt)}</span>
                )}
              </div>
            )}

            {interval.supersededBy && (
              <div className={styles.supersededRow}>
                <span className={styles.supersededLabel}>Superseded by:</span>
                <span className={styles.supersededId}>{interval.supersededBy}</span>
              </div>
            )}
          </div>
        </div>

        {parsedRaw !== null && (
          <div className={styles.expandToggle} aria-hidden="true">
            {expanded ? '▲' : '▼'}
          </div>
        )}
      </div>

      {/* Expanded raw JSON */}
      {expanded && parsedRaw !== null && (
        <div className={styles.rawBlock}>
          <span className={styles.rawLabel}>Raw value</span>
          <pre className={styles.rawPre}>{JSON.stringify(parsedRaw, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function TemporalHistory() {
  const { entityType, entityId, key } = useParams<{
    entityType: string
    entityId: string
    key: string
  }>()

  const decodedType = entityType ? decodeURIComponent(entityType) : ''
  const decodedId = entityId ? decodeURIComponent(entityId) : ''
  const decodedKey = key ? decodeURIComponent(key) : ''

  const { data, isLoading, error, refetch } = useQuery<TemporalHistoryResponse, Error>({
    queryKey: ['temporal-history', decodedType, decodedId, decodedKey],
    queryFn: () =>
      apiFetch<TemporalHistoryResponse>(
        `/entities/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedId)}/history/${encodeURIComponent(decodedKey)}`
      ),
    enabled: Boolean(decodedType && decodedId && decodedKey),
  })

  if (!decodedType || !decodedId || !decodedKey) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBanner}>
          <span className={styles.errorIcon} aria-hidden="true">⚠</span>
          <p className={styles.errorTitle}>Invalid history reference</p>
          <p className={styles.errorBody}>Entity type, entity ID, and key are all required.</p>
          <Link to="/memory" className={styles.backLink}>← Back to Memory Explorer</Link>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingCenter}>
          <Spinner size="md" label="Loading history" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBanner}>
          <span className={styles.errorIcon} aria-hidden="true">⚠</span>
          <p className={styles.errorTitle}>Unable to load history</p>
          <p className={styles.errorBody}>{error.message}</p>
          <div className={styles.errorActions}>
            <Link to="/health" className={styles.ctaLink}>Open Health Dashboard</Link>
            <button className={styles.retryButton} onClick={() => void refetch()} type="button">
              Retry
            </button>
          </div>
          <Link
            to={`/memory/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedId)}`}
            className={styles.backLink}
          >
            ← Back to Entity Detail
          </Link>
        </div>
      </div>
    )
  }

  const current = data?.current ?? null
  const history = data?.history ?? []
  const hasHistory = data?.hasHistory ?? false

  // Build ordered list: current first (newest), then archived intervals
  const allIntervals: Array<{ interval: HistoryInterval; isCurrent: boolean }> = []
  if (current) allIntervals.push({ interval: current, isCurrent: true })
  history.forEach(h => allIntervals.push({ interval: h, isCurrent: false }))

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.breadcrumb}>
          <Link to="/memory" className={styles.breadcrumbLink}>Memory Explorer</Link>
          <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
          <Link
            to={`/memory/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedId)}`}
            className={styles.breadcrumbLink}
          >
            <span className={styles.entityTypePart}>{decodedType}</span>
            <span className={styles.entitySepPart}>/</span>
            <span className={styles.entityIdPart}>{decodedId}</span>
          </Link>
          <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
          <span className={styles.breadcrumbCurrent} aria-current="page">
            <span className={styles.keyPart}>{decodedKey}</span>
          </span>
        </div>

        <div className={styles.headerMeta}>
          <div className={styles.headerMetaItem}>
            <span className={styles.metaLabel}>Total intervals</span>
            <span className={styles.metaValue}>{allIntervals.length}</span>
          </div>
          <div className={styles.headerMetaItem}>
            <span className={styles.metaLabel}>Archived intervals</span>
            <span className={styles.metaValue}>{history.length}</span>
          </div>
          <div className={styles.headerMetaItem}>
            <span className={styles.metaLabel}>Has history</span>
            <span className={`${styles.metaValueBadge} ${hasHistory ? styles.badgeYes : styles.badgeNo}`}>
              {hasHistory ? 'yes' : 'no'}
            </span>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className={styles.timelineRegion}>
        {allIntervals.length === 0 && (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon} aria-hidden="true">⬡</span>
            <p className={styles.emptyTitle}>No history recorded for this key</p>
            <p className={styles.emptyBody}>
              This fact has not been superseded or archived. It may be currently active or may not exist.
            </p>
            <Link
              to={`/memory/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedId)}`}
              className={styles.ctaLink}
            >
              ← Back to Entity Detail
            </Link>
          </div>
        )}

        {allIntervals.length > 0 && (
          <div className={styles.timeline}>
            <div className={styles.timelineLine} aria-hidden="true" />
            {allIntervals.map(({ interval, isCurrent }) => (
              <IntervalCard
                key={interval.id}
                interval={interval}
                isCurrent={isCurrent}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
