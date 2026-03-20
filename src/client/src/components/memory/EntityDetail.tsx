/* Iranti Control Plane — Entity Detail */
/* Route: /memory/:entityType/:entityId */
/* CP-T036 — Entity detail page with current facts, archived facts, and relationships */

import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { EntityDetailResponse, KBFact, ArchiveFact, Relationship } from '../../api/types'
import { Spinner } from '../ui/Spinner'
import styles from './EntityDetail.module.css'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return Math.floor(hours / 24) + 'd ago'
}

function ConfidenceBar({ value }: { value: number }) {
  const level = value >= 90 ? 'high' : value >= 70 ? 'medium' : 'low'
  return (
    <span className={styles.confidence} data-level={level} title={`Confidence: ${value}`}>
      {value}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Current Facts Table                                                 */
/* ------------------------------------------------------------------ */

function CurrentFactsTable({
  facts,
  entityType,
  entityId,
}: {
  facts: KBFact[]
  entityType: string
  entityId: string
}) {
  const navigate = useNavigate()

  if (facts.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon} aria-hidden="true">⬡</span>
        <p className={styles.emptyTitle}>No current facts</p>
        <p className={styles.emptyBody}>This entity has no active knowledge base entries.</p>
      </div>
    )
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table} aria-label="Current facts">
        <thead>
          <tr>
            <th>Key</th>
            <th>Summary</th>
            <th>Conf</th>
            <th>Source</th>
            <th>Agent</th>
            <th>Valid from</th>
            <th>Updated</th>
            <th>History</th>
          </tr>
        </thead>
        <tbody>
          {facts.map(fact => (
            <tr
              key={fact.id}
              className={styles.dataRow}
            >
              <td className={styles.cellKey}>
                <button
                  className={styles.keyLink}
                  onClick={() => navigate(`/memory/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/${encodeURIComponent(fact.key)}`)}
                  title={`View temporal history for ${fact.key}`}
                >
                  {fact.key}
                </button>
              </td>
              <td className={styles.cellSummary}>
                <span className={styles.summaryText}>{fact.valueSummary ?? '—'}</span>
              </td>
              <td className={styles.cellConfidence}>
                <ConfidenceBar value={fact.confidence} />
              </td>
              <td className={styles.cellMeta}>{fact.source ?? '—'}</td>
              <td className={styles.cellMono}>{fact.agentId ?? '—'}</td>
              <td className={styles.cellMeta}>
                {fact.validFrom ? new Date(fact.validFrom).toLocaleDateString() : '—'}
              </td>
              <td className={styles.cellMeta}>
                {fact.updatedAt
                  ? formatRelativeTime(fact.updatedAt)
                  : fact.createdAt
                    ? formatRelativeTime(fact.createdAt)
                    : '—'}
              </td>
              <td className={styles.cellAction}>
                <Link
                  to={`/memory/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/${encodeURIComponent(fact.key)}`}
                  className={styles.historyLink}
                  title={`View history for ${fact.key}`}
                >
                  History →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Archived Facts Table                                                */
/* ------------------------------------------------------------------ */

function ArchivedFactsTable({ facts }: { facts: ArchiveFact[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (facts.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon} aria-hidden="true">⬡</span>
        <p className={styles.emptyTitle}>No archived facts</p>
        <p className={styles.emptyBody}>No facts have been superseded, expired, or decayed for this entity.</p>
      </div>
    )
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table} aria-label="Archived facts">
        <thead>
          <tr>
            <th>Key</th>
            <th>Summary</th>
            <th>Conf</th>
            <th>Archived reason</th>
            <th>Archived at</th>
            <th>Valid from</th>
            <th>Valid until</th>
            <th>Agent</th>
          </tr>
        </thead>
        <tbody>
          {facts.map(fact => (
            <tr
              key={fact.id}
              className={`${styles.dataRow} ${expandedId === fact.id ? styles.dataRowExpanded : ''}`}
              onClick={() => setExpandedId(prev => prev === fact.id ? null : fact.id)}
              role="button"
              tabIndex={0}
              aria-expanded={expandedId === fact.id}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setExpandedId(prev => prev === fact.id ? null : fact.id) }}
            >
              <td className={styles.cellKey}>{fact.key}</td>
              <td className={styles.cellSummary}>
                <span className={styles.summaryText}>{fact.valueSummary ?? '—'}</span>
              </td>
              <td className={styles.cellConfidence}>
                <ConfidenceBar value={fact.confidence} />
              </td>
              <td className={styles.cellArchivedReason}>{fact.archivedReason ?? '—'}</td>
              <td className={styles.cellMeta}>{formatRelativeTime(fact.archivedAt)}</td>
              <td className={styles.cellMeta}>
                {fact.validFrom ? new Date(fact.validFrom).toLocaleDateString() : '—'}
              </td>
              <td className={styles.cellMeta}>
                {fact.validUntil ? new Date(fact.validUntil).toLocaleDateString() : '—'}
              </td>
              <td className={styles.cellMono}>{fact.agentId ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Relationships List                                                  */
/* ------------------------------------------------------------------ */

function RelationshipsList({
  relationships,
  entityType,
  entityId,
}: {
  relationships: Relationship[]
  entityType: string
  entityId: string
}) {
  if (relationships.length === 0) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon} aria-hidden="true">⬡</span>
        <p className={styles.emptyTitle}>No relationships</p>
        <p className={styles.emptyBody}>This entity has no recorded relationships to other entities.</p>
      </div>
    )
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table} aria-label="Entity relationships">
        <thead>
          <tr>
            <th>Direction</th>
            <th>Relationship</th>
            <th>Other entity</th>
            <th>Conf</th>
            <th>Source</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {relationships.map(rel => {
            const isFrom = rel.fromEntityType === entityType && rel.fromEntityId === entityId
            const otherType = isFrom ? rel.toEntityType : rel.fromEntityType
            const otherId = isFrom ? rel.toEntityId : rel.fromEntityId
            return (
              <tr key={rel.id} className={styles.dataRow}>
                <td className={styles.cellDirection}>
                  <span className={isFrom ? styles.dirFrom : styles.dirTo}>
                    {isFrom ? 'outgoing' : 'incoming'}
                  </span>
                </td>
                <td className={styles.cellRelType}>{rel.relationshipType}</td>
                <td className={styles.cellEntity}>
                  <Link
                    to={`/memory/${encodeURIComponent(otherType)}/${encodeURIComponent(otherId)}`}
                    className={styles.entityLink}
                  >
                    <span className={styles.entityType}>{otherType}</span>
                    <span className={styles.entitySep}>/</span>
                    <span className={styles.entityIdText}>{otherId}</span>
                  </Link>
                </td>
                <td className={styles.cellConfidence}>
                  {rel.confidence != null ? <ConfidenceBar value={rel.confidence} /> : '—'}
                </td>
                <td className={styles.cellMeta}>{rel.source ?? '—'}</td>
                <td className={styles.cellMeta}>{formatRelativeTime(rel.createdAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Tab types                                                           */
/* ------------------------------------------------------------------ */

type Tab = 'facts' | 'archived' | 'relationships'

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function EntityDetail() {
  const { entityType, entityId } = useParams<{ entityType: string; entityId: string }>()
  const [activeTab, setActiveTab] = useState<Tab>('facts')

  const decodedType = entityType ? decodeURIComponent(entityType) : ''
  const decodedId = entityId ? decodeURIComponent(entityId) : ''

  const { data, isLoading, error, refetch } = useQuery<EntityDetailResponse, Error>({
    queryKey: ['entity-detail', decodedType, decodedId],
    queryFn: () =>
      apiFetch<EntityDetailResponse>(`/entities/${encodeURIComponent(decodedType)}/${encodeURIComponent(decodedId)}`),
    enabled: Boolean(decodedType && decodedId),
  })

  if (!decodedType || !decodedId) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBanner}>
          <span className={styles.errorIcon} aria-hidden="true">⚠</span>
          <p className={styles.errorTitle}>Invalid entity reference</p>
          <p className={styles.errorBody}>Entity type and ID are required.</p>
          <Link to="/memory" className={styles.backLink}>← Back to Memory Explorer</Link>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingCenter}>
          <Spinner size="md" label="Loading entity" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorBanner}>
          <span className={styles.errorIcon} aria-hidden="true">⚠</span>
          <p className={styles.errorTitle}>Unable to load entity</p>
          <p className={styles.errorBody}>{error.message}</p>
          <div className={styles.errorActions}>
            <Link to="/health" className={styles.ctaLink}>Open Health Dashboard</Link>
            <button className={styles.retryButton} onClick={() => void refetch()} type="button">
              Retry
            </button>
          </div>
          <Link to="/memory" className={styles.backLink}>← Back to Memory Explorer</Link>
        </div>
      </div>
    )
  }

  const currentFacts = data?.currentFacts ?? []
  const archivedFacts = data?.archivedFacts ?? []
  const relationships = data?.relationships ?? []

  // Derive last updated from the most recently updated current fact
  const lastUpdated = currentFacts.reduce<string | null>((latest, fact) => {
    const ts = fact.updatedAt ?? fact.createdAt
    if (!ts) return latest
    if (!latest) return ts
    return new Date(ts) > new Date(latest) ? ts : latest
  }, null)

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.breadcrumb}>
          <Link to="/memory" className={styles.breadcrumbLink}>Memory Explorer</Link>
          <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
          <span className={styles.breadcrumbCurrent} aria-current="page">
            <span className={styles.entityTypePart}>{decodedType}</span>
            <span className={styles.entitySepPart}>/</span>
            <span className={styles.entityIdPart}>{decodedId}</span>
          </span>
        </div>

        <div className={styles.entityMeta}>
          <div className={styles.entityMetaItem}>
            <span className={styles.metaLabel}>Current facts</span>
            <span className={styles.metaValue}>{currentFacts.length}</span>
          </div>
          <div className={styles.entityMetaItem}>
            <span className={styles.metaLabel}>Archived facts</span>
            <span className={styles.metaValue}>{archivedFacts.length}</span>
          </div>
          <div className={styles.entityMetaItem}>
            <span className={styles.metaLabel}>Relationships</span>
            <span className={styles.metaValue}>{relationships.length}</span>
          </div>
          {lastUpdated && (
            <div className={styles.entityMetaItem}>
              <span className={styles.metaLabel}>Last updated</span>
              <span className={styles.metaValueMuted}>{formatDate(lastUpdated)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs} role="tablist" aria-label="Entity detail sections">
        <button
          role="tab"
          aria-selected={activeTab === 'facts'}
          className={`${styles.tab} ${activeTab === 'facts' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('facts')}
        >
          Current facts
          {currentFacts.length > 0 && (
            <span className={styles.tabBadge}>{currentFacts.length}</span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'archived'}
          className={`${styles.tab} ${activeTab === 'archived' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('archived')}
        >
          Archived facts
          {archivedFacts.length > 0 && (
            <span className={styles.tabBadge}>{archivedFacts.length}</span>
          )}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'relationships'}
          className={`${styles.tab} ${activeTab === 'relationships' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('relationships')}
        >
          Relationships
          {relationships.length > 0 && (
            <span className={styles.tabBadge}>{relationships.length}</span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className={styles.tabContent} role="tabpanel">
        {activeTab === 'facts' && (
          <CurrentFactsTable
            facts={currentFacts}
            entityType={decodedType}
            entityId={decodedId}
          />
        )}
        {activeTab === 'archived' && (
          <ArchivedFactsTable facts={archivedFacts} />
        )}
        {activeTab === 'relationships' && (
          <RelationshipsList
            relationships={relationships}
            entityType={decodedType}
            entityId={decodedId}
          />
        )}
      </div>
    </div>
  )
}
