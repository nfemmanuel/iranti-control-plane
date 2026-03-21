/* Iranti Control Plane — Temporal History */
/* Route: /memory/:entityType/:entityId/:key */
/* CP-T036 — Timeline of all intervals for an entity/key */
/* CP-T056 — Point-in-time asOf query via date/time picker */

import { useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { TemporalHistoryResponse, HistoryInterval, AsOfQueryResult } from '../../api/types'
import { Spinner } from '../ui/Spinner'
import styles from './TemporalHistory.module.css'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

/**
 * Convert a datetime-local string (e.g. "2026-03-15T14:30") to an ISO 8601
 * timestamp string in UTC.
 */
function datetimeLocalToIso(value: string): string {
  // datetime-local strings have no timezone — treat as local time
  return new Date(value).toISOString()
}

/**
 * Convert an ISO timestamp to a datetime-local value string for the native
 * input (format: "YYYY-MM-DDTHH:MM").
 */
function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/**
 * Given a list of history intervals and the current fact, find which interval's
 * [validFrom, validUntil) range contains the given asOf date.
 * Returns the interval id if found, else null.
 */
function findMatchingIntervalId(
  allIntervals: Array<{ interval: HistoryInterval; isCurrent: boolean }>,
  asOfIso: string
): string | null {
  const asOfMs = new Date(asOfIso).getTime()
  for (const { interval } of allIntervals) {
    const from = interval.validFrom ? new Date(interval.validFrom).getTime() : -Infinity
    const until = interval.validUntil ? new Date(interval.validUntil).getTime() : Infinity
    if (asOfMs >= from && asOfMs < until) {
      return interval.id
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  asOf callout                                                        */
/* ------------------------------------------------------------------ */

function AsOfCallout({
  result,
  isLoading,
  error,
  asOf,
}: {
  result: AsOfQueryResult | null
  isLoading: boolean
  error: Error | null
  asOf: string
}) {
  if (isLoading) {
    return (
      <div className={styles.asOfCallout} role="status" aria-live="polite">
        <Spinner size="sm" label="Querying point in time…" />
        <span className={styles.asOfCalloutText}>Querying {formatDate(asOf)}…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`${styles.asOfCallout} ${styles.asOfCalloutError}`} role="alert">
        <span className={styles.asOfCalloutLabel}>Query error</span>
        <p className={styles.asOfCalloutText}>{error.message}</p>
      </div>
    )
  }

  if (!result) return null

  if (!result.fact) {
    return (
      <div className={`${styles.asOfCallout} ${styles.asOfCalloutEmpty}`} role="status" aria-live="polite">
        <span className={styles.asOfCalloutLabel}>Point in time</span>
        <p className={styles.asOfCalloutText}>No fact existed at this time.</p>
        <span className={styles.asOfCalloutTimestamp}>{formatDate(result.asOf)}</span>
      </div>
    )
  }

  const { fact } = result
  const parsedRaw = (() => {
    if (!fact.valueRaw) return null
    try { return JSON.parse(fact.valueRaw) } catch { return fact.valueRaw }
  })()

  const confidenceLevel =
    fact.confidence >= 90 ? 'high' : fact.confidence >= 70 ? 'medium' : 'low'

  return (
    <div className={`${styles.asOfCallout} ${styles.asOfCalloutResult}`} role="status" aria-live="polite">
      <div className={styles.asOfCalloutHeader}>
        <span className={styles.asOfCalloutLabel}>Fact at point in time</span>
        <span className={styles.asOfCalloutTimestamp}>{formatDate(result.asOf)}</span>
      </div>

      <div className={styles.asOfCalloutGrid}>
        {/* Value */}
        <span className={styles.asOfCalloutFieldLabel}>Value</span>
        <span className={styles.asOfCalloutFieldValue}>
          {fact.valueSummary ?? (parsedRaw !== null ? JSON.stringify(parsedRaw) : '—')}
        </span>

        {/* Confidence */}
        <span className={styles.asOfCalloutFieldLabel}>Confidence</span>
        <span
          className={`${styles.asOfCalloutFieldValue} ${styles.asOfConfidence}`}
          data-level={confidenceLevel}
        >
          {fact.confidence}
        </span>

        {/* Source */}
        <span className={styles.asOfCalloutFieldLabel}>Source</span>
        <span className={`${styles.asOfCalloutFieldValue} ${styles.asOfMono}`}>
          {fact.providerSource ?? '—'}
        </span>

        {/* Created by */}
        <span className={styles.asOfCalloutFieldLabel}>Created by</span>
        <span className={`${styles.asOfCalloutFieldValue} ${styles.asOfMono}`}>
          {fact.agentId ?? '—'}
        </span>

        {/* Interval */}
        <span className={styles.asOfCalloutFieldLabel}>Interval</span>
        <span className={`${styles.asOfCalloutFieldValue} ${styles.asOfMono}`}>
          {formatDate(fact.validFrom)}
          <span className={styles.asOfIntervalArrow} aria-hidden="true"> → </span>
          {fact.validUntil ? formatDate(fact.validUntil) : <span className={styles.asOfStillActive}>still active</span>}
        </span>
      </div>

      {parsedRaw !== null && (
        <details className={styles.asOfRawDetails}>
          <summary className={styles.asOfRawSummary}>Raw value</summary>
          <pre className={styles.rawPre}>{JSON.stringify(parsedRaw, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  History interval card                                               */
/* ------------------------------------------------------------------ */

function IntervalCard({
  interval,
  isCurrent,
  isAsOfMatch,
}: {
  interval: HistoryInterval
  isCurrent: boolean
  isAsOfMatch: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const parsedRaw = (() => {
    if (!interval.valueRaw) return null
    try { return JSON.parse(interval.valueRaw) }
    catch { return interval.valueRaw }
  })()

  const confidenceLevel =
    interval.confidence >= 90 ? 'high' : interval.confidence >= 70 ? 'medium' : 'low'

  const cardClass = [
    styles.intervalCard,
    isCurrent ? styles.intervalCardCurrent : '',
    isAsOfMatch ? styles.intervalCardAsOfMatch : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={cardClass}>
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
          <div
            className={styles.timelineDot}
            data-current={isCurrent}
            data-asofmatch={isAsOfMatch}
            aria-hidden="true"
          />

          <div className={styles.intervalMeta}>
            <div className={styles.intervalTopRow}>
              {isCurrent && (
                <span className={styles.currentBadge} aria-label="Currently active fact">
                  current
                </span>
              )}
              {isAsOfMatch && (
                <span className={styles.asOfMatchBadge} aria-label="Active at selected point in time">
                  active at query time
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

  // ---- asOf picker state ----
  // pickerValue: the raw string from the datetime-local input (e.g. "2026-03-15T14:30")
  // asOfIso: derived ISO timestamp used for the API call (null when picker is empty)
  const [pickerValue, setPickerValue] = useState<string>('')
  const asOfIso = pickerValue ? datetimeLocalToIso(pickerValue) : null

  const handlePickerChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPickerValue(e.target.value)
  }, [])

  const handlePickerClear = useCallback(() => {
    setPickerValue('')
  }, [])

  // ---- Full history query ----
  const { data, isLoading, error, refetch } = useQuery<TemporalHistoryResponse, Error>({
    queryKey: ['temporal-history', decodedType, decodedId, decodedKey],
    queryFn: () =>
      apiFetch<TemporalHistoryResponse>(
        `/entities/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedId)}/history/${encodeURIComponent(decodedKey)}`
      ),
    enabled: Boolean(decodedType && decodedId && decodedKey),
  })

  // ---- asOf point-in-time query ----
  const {
    data: asOfData,
    isLoading: asOfLoading,
    error: asOfError,
  } = useQuery<AsOfQueryResult, Error>({
    queryKey: ['temporal-asof', decodedType, decodedId, decodedKey, asOfIso],
    queryFn: () =>
      apiFetch<AsOfQueryResult>(
        `/entities/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedId)}/query/${encodeURIComponent(decodedKey)}`,
        { asOf: asOfIso!, includeExpired: 'true' }
      ),
    enabled: Boolean(decodedType && decodedId && decodedKey && asOfIso),
    // Don't retry on 400/404 — these are expected when no fact exists
    retry: (failureCount, err) => {
      const msg = (err as Error).message ?? ''
      if (msg.includes('INVALID_PARAM') || msg.includes('NOT_FOUND')) return false
      return failureCount < 2
    },
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

  // Determine which interval to highlight based on asOf result
  // Prefer server-confirmed match from asOfData; fall back to client-side interval scan
  const asOfMatchId: string | null = (() => {
    if (!asOfIso) return null
    if (asOfData?.fact) return asOfData.fact.id
    // If server returned null fact, no match
    if (asOfData && !asOfData.fact) return null
    // Still loading or errored: use client-side pre-computation as optimistic hint
    return findMatchingIntervalId(allIntervals, asOfIso)
  })()

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

        {/* CP-T056: Point in Time picker */}
        <div className={styles.asOfRow}>
          <label htmlFor="asof-picker" className={styles.asOfLabel}>
            Point in Time
          </label>
          <div className={styles.asOfInputGroup}>
            <input
              id="asof-picker"
              type="datetime-local"
              className={styles.asOfInput}
              value={pickerValue}
              max={isoToDatetimeLocal(new Date().toISOString())}
              onChange={handlePickerChange}
              aria-describedby="asof-desc"
            />
            {pickerValue && (
              <button
                type="button"
                className={styles.asOfClearButton}
                onClick={handlePickerClear}
                aria-label="Clear point-in-time selection"
              >
                ✕
              </button>
            )}
          </div>
          <span id="asof-desc" className={styles.asOfHint}>
            Select a date and time to see which fact was active at that moment.
          </span>
        </div>
      </div>

      {/* asOf callout — shown when picker has a value */}
      {asOfIso && (
        <div className={styles.asOfCalloutRegion}>
          <AsOfCallout
            result={asOfData ?? null}
            isLoading={asOfLoading}
            error={asOfError ?? null}
            asOf={asOfIso}
          />
        </div>
      )}

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
                isAsOfMatch={asOfMatchId === interval.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
