/* Iranti Control Plane — Agent Registry */
/* Route: /agents */
/* CP-T051 — Read-only view of all registered agents via GET /api/control-plane/agents */

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { AgentsListResponse, AgentRecord } from '../../api/types'
import styles from './AgentRegistry.module.css'
import { Spinner } from '../ui/Spinner'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text).catch(() => {
    // Clipboard unavailable — silently skip
  })
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function ActiveDot({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={styles.activeDot}
      data-active={isActive}
      aria-label={isActive ? 'Active' : 'Inactive'}
      title={isActive ? 'Active' : 'Inactive'}
    />
  )
}

function JsonExpand({ label, data }: { label: string; data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.jsonExpand}>
      <button
        className={styles.jsonExpandToggle}
        onClick={() => setOpen(o => !o)}
        type="button"
        aria-expanded={open}
      >
        <span className={styles.jsonExpandChevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
        {label}
      </button>
      {open && (
        <pre className={styles.jsonExpandPre}>{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Agent detail panel                                                  */
/* ------------------------------------------------------------------ */

function AgentDetailPanel({ agent, onClose }: { agent: AgentRecord; onClose: () => void }) {
  const displayName = agent.name ?? agent.agentId

  return (
    <aside className={styles.detailPanel} aria-label={`${displayName} detail`}>
      <div className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <div className={styles.detailTitleMeta}>
            <span className={styles.detailAgentId}>{agent.agentId}</span>
            {agent.name && agent.name !== agent.agentId && (
              <span className={styles.detailAgentName}>{agent.name}</span>
            )}
          </div>
          <div className={styles.detailHeaderRight}>
            <ActiveDot isActive={agent.stats.isActive} />
            <button
              className={styles.detailCloseBtn}
              onClick={onClose}
              type="button"
              aria-label="Close detail panel"
            >
              ×
            </button>
          </div>
        </div>

        {agent.description && (
          <p className={styles.detailDescription}>{agent.description}</p>
        )}
      </div>

      {/* Stats section */}
      <section className={styles.detailSection}>
        <h3 className={styles.detailSectionTitle}>Stats</h3>
        <div className={styles.detailStatGrid}>
          <div className={styles.detailStatCell}>
            <span className={styles.detailStatLabel}>Last seen</span>
            <span
              className={styles.detailStatValue}
              title={agent.stats.lastSeen ?? undefined}
            >
              {agent.stats.lastSeen ? formatRelativeTime(agent.stats.lastSeen) : 'Never'}
            </span>
          </div>
          <div className={styles.detailStatCell}>
            <span className={styles.detailStatLabel}>Total writes</span>
            <span className={styles.detailStatValue}>{agent.stats.totalWrites}</span>
          </div>
          <div className={styles.detailStatCell}>
            <span className={styles.detailStatLabel}>Rejections</span>
            <span
              className={styles.detailStatValue}
              data-warn={agent.stats.totalRejections > 0}
            >
              {agent.stats.totalRejections}
            </span>
          </div>
          <div className={styles.detailStatCell}>
            <span className={styles.detailStatLabel}>Escalations</span>
            <span
              className={styles.detailStatValue}
              data-escalation={agent.stats.totalEscalations > 0}
            >
              {agent.stats.totalEscalations}
            </span>
          </div>
          <div className={styles.detailStatCell}>
            <span className={styles.detailStatLabel}>Avg confidence</span>
            <span className={styles.detailStatValue}>{agent.stats.avgConfidence}%</span>
          </div>
        </div>
      </section>

      {/* Model */}
      {agent.model && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Model</h3>
          <code className={styles.detailModel}>{agent.model}</code>
        </section>
      )}

      {/* Team */}
      {agent.team && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Team</h3>
          <span className={styles.detailTeam}>{agent.team}</span>
        </section>
      )}

      {/* Capabilities */}
      {agent.capabilities.length > 0 && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Capabilities</h3>
          <div className={styles.capabilityTags}>
            {agent.capabilities.map(cap => (
              <span key={cap} className={styles.capabilityTag}>{cap}</span>
            ))}
          </div>
        </section>
      )}

      {/* Properties */}
      {agent.properties && Object.keys(agent.properties).length > 0 && (
        <section className={styles.detailSection}>
          <h3 className={styles.detailSectionTitle}>Properties</h3>
          <JsonExpand label="Raw JSON" data={agent.properties} />
        </section>
      )}
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                         */
/* ------------------------------------------------------------------ */

function AgentEmptyState({ is503 }: { is503: boolean }) {
  if (is503) {
    return (
      <div className={styles.emptyState}>
        <span className={styles.emptyStateIcon} aria-hidden="true">◈</span>
        <p className={styles.emptyStateTitle}>Agent registry unavailable</p>
        <p className={styles.emptyStateBody}>
          The agents endpoint returned a 503. This usually means the connected Iranti instance
          does not have an API key with <code className={styles.inlineCode}>agents:read</code> scope,
          or the instance is unreachable.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyStateIcon} aria-hidden="true">◈</span>
      <p className={styles.emptyStateTitle}>No agents registered yet</p>
      <p className={styles.emptyStateBody}>
        Agents appear here after their first{' '}
        <code className={styles.inlineCode}>iranti_handshake</code> call.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Agent row                                                           */
/* ------------------------------------------------------------------ */

interface AgentRowProps {
  agent: AgentRecord
  isSelected: boolean
  onSelect: () => void
}

function AgentRow({ agent, isSelected, onSelect }: AgentRowProps) {
  const displayName = agent.name && agent.name !== agent.agentId ? agent.name : null
  const { stats } = agent

  return (
    <tr
      className={`${styles.dataRow} ${isSelected ? styles.dataRowSelected : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
    >
      {/* Agent ID — monospace, copyable */}
      <td className={styles.cellAgentId}>
        <button
          className={styles.copyableId}
          onClick={e => { e.stopPropagation(); copyToClipboard(agent.agentId) }}
          title="Click to copy agent ID"
          type="button"
          aria-label={`Copy agent ID: ${agent.agentId}`}
        >
          {agent.agentId}
        </button>
      </td>

      {/* Display name */}
      <td className={styles.cellName}>
        {displayName ?? <span className={styles.cellNameFallback}>—</span>}
      </td>

      {/* Last seen */}
      <td
        className={styles.cellMeta}
        title={stats.lastSeen ?? undefined}
      >
        {stats.lastSeen ? formatRelativeTime(stats.lastSeen) : 'Never'}
      </td>

      {/* Active */}
      <td className={styles.cellActive}>
        <ActiveDot isActive={stats.isActive} />
      </td>

      {/* Total writes */}
      <td className={styles.cellNumber}>{stats.totalWrites}</td>

      {/* Rejections */}
      <td
        className={styles.cellNumber}
        data-warn={stats.totalRejections > 0}
      >
        {stats.totalRejections}
      </td>

      {/* Escalations */}
      <td
        className={styles.cellNumber}
        data-escalation={stats.totalEscalations > 0}
      >
        {stats.totalEscalations}
      </td>

      {/* Avg confidence */}
      <td className={styles.cellNumber}>{stats.avgConfidence}%</td>
    </tr>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function AgentRegistry() {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery<AgentsListResponse, Error>({
    queryKey: ['agents'],
    queryFn: () => apiFetch<AgentsListResponse>('/agents'),
    staleTime: 30_000,
    refetchInterval: 5 * 60 * 1000,
  })

  const agents: AgentRecord[] = data?.agents ?? []

  // Sort: lastSeen descending (nulls last), then by agentId
  const sortedAgents = [...agents].sort((a, b) => {
    if (a.stats.lastSeen && b.stats.lastSeen) {
      return new Date(b.stats.lastSeen).getTime() - new Date(a.stats.lastSeen).getTime()
    }
    if (a.stats.lastSeen) return -1
    if (b.stats.lastSeen) return 1
    return a.agentId.localeCompare(b.agentId)
  })

  const selectedAgent = agents.find(a => a.agentId === selectedAgentId) ?? null

  // Auto-close detail panel if selected agent disappears from results
  useEffect(() => {
    if (selectedAgentId && !agents.find(a => a.agentId === selectedAgentId)) {
      setSelectedAgentId(null)
    }
  }, [agents, selectedAgentId])

  // Detect 503-class error: AGENTS_UNAVAILABLE code or HTTP 503 message
  const is503 = Boolean(
    error && (
      error.message.includes('AGENTS_UNAVAILABLE') ||
      error.message.includes('503') ||
      error.message.includes('agents:read')
    )
  )

  return (
    <div className={styles.page}>
      {/* Page header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <span className={styles.pageIcon} aria-hidden="true">◉</span>
          <div>
            <h1 className={styles.pageTitle}>Agent Registry</h1>
            <p className={styles.pageSubtitle}>
              Registered agents and their activity stats
            </p>
          </div>
        </div>
        {data && (
          <span className={styles.agentCount}>
            {data.total} agent{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Content area: table + optional detail panel */}
      <div className={`${styles.contentArea} ${selectedAgent ? styles.contentAreaWithPanel : ''}`}>
        {/* Table region */}
        <div className={styles.tableRegion}>
          {isLoading && (
            <div className={styles.loadingState}>
              <Spinner size="md" label="Loading agents" />
            </div>
          )}

          {!isLoading && (error || agents.length === 0) && (
            <AgentEmptyState is503={is503 || (!!error && !is503)} />
          )}

          {!isLoading && !error && agents.length > 0 && (
            <table className={styles.table} aria-label="Registered agents">
              <thead>
                <tr>
                  <th className={styles.thMono}>Agent ID</th>
                  <th>Display Name</th>
                  <th>Last Seen</th>
                  <th>Active</th>
                  <th className={styles.thNumber}>Writes</th>
                  <th className={styles.thNumber}>Rejections</th>
                  <th className={styles.thNumber}>Escalations</th>
                  <th className={styles.thNumber}>Avg Conf</th>
                </tr>
              </thead>
              <tbody>
                {sortedAgents.map(agent => (
                  <AgentRow
                    key={agent.agentId}
                    agent={agent}
                    isSelected={selectedAgentId === agent.agentId}
                    onSelect={() => setSelectedAgentId(
                      prev => prev === agent.agentId ? null : agent.agentId
                    )}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail panel */}
        {selectedAgent && (
          <AgentDetailPanel
            agent={selectedAgent}
            onClose={() => setSelectedAgentId(null)}
          />
        )}
      </div>
    </div>
  )
}
