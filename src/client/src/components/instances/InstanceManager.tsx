/* Iranti Control Plane — Instance & Project Manager */
/* Route: /instances and /instances/:instanceId */
/* CP-T015 — Two-column instance list + detail panel */

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../../api/client'
import type { InstanceMetadata, InstanceListResponse } from '../../api/types'
import { useInstanceContext } from '../../hooks/useInstanceContext'
import styles from './InstanceManager.module.css'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(iso).toLocaleDateString()
}

/* ------------------------------------------------------------------ */
/*  Status indicator                                                    */
/* ------------------------------------------------------------------ */

function RunningIndicator({ status }: { status: InstanceMetadata['runningStatus'] }) {
  if (status === 'running') {
    return <span className={styles.dotRunning} aria-label="Running" title="Running" />
  }
  if (status === 'unreachable') {
    return <span className={styles.dotUnreachable} aria-label="Unreachable" title="Unreachable" />
  }
  return <span className={styles.dotUnknown} aria-label="Unknown" title="Unknown" />
}

function StatusBadge({ status }: { status: InstanceMetadata['runningStatus'] }) {
  if (status === 'running') {
    return <span className={styles.badgeRunning}>Running</span>
  }
  if (status === 'unreachable') {
    return <span className={styles.badgeUnreachable}>Unreachable</span>
  }
  return <span className={styles.badgeUnknown}>Unknown</span>
}

/* ------------------------------------------------------------------ */
/*  Status icon for boolean checks                                      */
/* ------------------------------------------------------------------ */

function CheckIcon({ ok, warn = false }: { ok: boolean; warn?: boolean }) {
  if (ok) return <span className={styles.iconOk} aria-label="OK">✓</span>
  if (warn) return <span className={styles.iconWarn} aria-label="Warning">⚠</span>
  return <span className={styles.iconError} aria-label="Missing">✗</span>
}

/* ------------------------------------------------------------------ */
/*  Instance list item                                                  */
/* ------------------------------------------------------------------ */

function InstanceListItem({
  instance,
  selected,
  onClick,
}: {
  instance: InstanceMetadata
  selected: boolean
  onClick: () => void
}) {
  const dbSummary = instance.database
    ? `${instance.database.host}:${instance.database.port}/${instance.database.name}`
    : 'No database'

  return (
    <button
      className={`${styles.instanceItem} ${selected ? styles.instanceItemSelected : ''}`}
      onClick={onClick}
      type="button"
      aria-selected={selected}
    >
      <div className={styles.instanceItemHeader}>
        <RunningIndicator status={instance.runningStatus} />
        <span className={styles.instanceName}>{instance.name}</span>
        <span className={styles.instancePort}>:{instance.configuredPort}</span>
      </div>
      <div className={styles.instanceItemMeta}>
        <span className={styles.instanceDbSummary}>{dbSummary}</span>
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Detail panel sections                                               */
/* ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className={styles.sectionTitle}>{children}</h3>
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{children}</span>
    </div>
  )
}

function RuntimeSection({ instance }: { instance: InstanceMetadata }) {
  return (
    <section className={styles.detailSection}>
      <SectionTitle>Runtime</SectionTitle>
      <FieldRow label="Root">
        <span className={styles.monoValue}>{instance.runtimeRoot}</span>
      </FieldRow>
      <FieldRow label="Port">
        <span className={styles.monoValue}>{instance.configuredPort}</span>
      </FieldRow>
      <FieldRow label="Status">
        <StatusBadge status={instance.runningStatus} />
      </FieldRow>
      <FieldRow label="Version">
        {instance.irantVersion ?? <span className={styles.dimValue}>Version unknown</span>}
      </FieldRow>
      {instance.runningStatusCheckedAt && (
        <FieldRow label="Checked">
          <span className={styles.dimValue}>
            {formatRelativeTime(instance.runningStatusCheckedAt)}
            {' '}
            <span className={styles.helpText}>(status may be stale)</span>
          </span>
        </FieldRow>
      )}
    </section>
  )
}

function DatabaseSection({ instance }: { instance: InstanceMetadata }) {
  if (!instance.database) {
    return (
      <section className={styles.detailSection}>
        <SectionTitle>Database</SectionTitle>
        <div className={styles.warningNote}>
          Database unreachable — check DATABASE_URL in .env.iranti
        </div>
      </section>
    )
  }
  const db = instance.database
  return (
    <section className={styles.detailSection}>
      <SectionTitle>Database</SectionTitle>
      <FieldRow label="Host">
        <span className={styles.monoValue}>{db.host}:{db.port}</span>
      </FieldRow>
      <FieldRow label="Database">
        <span className={styles.monoValue}>{db.name}</span>
      </FieldRow>
      <FieldRow label="Connection">
        <span className={styles.monoValue}>{db.urlRedacted}</span>
      </FieldRow>
    </section>
  )
}

function EnvironmentSection({ instance }: { instance: InstanceMetadata }) {
  const { envFile } = instance
  return (
    <section className={styles.detailSection}>
      <SectionTitle>Environment</SectionTitle>
      <FieldRow label=".env.iranti">
        {envFile.present
          ? <><CheckIcon ok={true} /> <span className={styles.monoValue}>{envFile.path ?? 'present'}</span></>
          : <><CheckIcon ok={false} /> <span className={styles.errorValue}>No .env.iranti found — check runtime root</span></>
        }
      </FieldRow>
      {envFile.present && (
        <>
          {envFile.keysPresent.length > 0 && (
            <FieldRow label="Keys present">
              <span className={styles.keyList}>
                {envFile.keysPresent.map(k => (
                  <span key={k} className={styles.keyPresent}>{k}</span>
                ))}
              </span>
            </FieldRow>
          )}
          {envFile.keysMissing.length > 0 && (
            <FieldRow label="Keys missing">
              <span className={styles.keyList}>
                {envFile.keysMissing.map(k => (
                  <span key={k} className={styles.keyMissing}>{k}</span>
                ))}
              </span>
            </FieldRow>
          )}
        </>
      )}
    </section>
  )
}

function IntegrationsSection({ instance }: { instance: InstanceMetadata }) {
  const { integration } = instance
  return (
    <section className={styles.detailSection}>
      <SectionTitle>Integrations</SectionTitle>
      <FieldRow label="Provider">
        {integration.defaultProvider
          ? <span className={styles.monoValue}>{integration.defaultProvider}</span>
          : <span className={styles.dimValue}>not configured</span>}
      </FieldRow>
      <FieldRow label="Model">
        {integration.defaultModel
          ? <span className={styles.monoValue}>{integration.defaultModel}</span>
          : <span className={styles.dimValue}>not configured</span>}
      </FieldRow>
      <FieldRow label="Anthropic key">
        {integration.providerKeys.anthropic
          ? <><CheckIcon ok={true} /> <span className={styles.dimValue}>present</span></>
          : <><CheckIcon ok={false} warn={true} /> <span className={styles.warnValue}>absent</span></>
        }
      </FieldRow>
      <FieldRow label="OpenAI key">
        {integration.providerKeys.openai
          ? <><CheckIcon ok={true} /> <span className={styles.dimValue}>present</span></>
          : <><CheckIcon ok={false} warn={true} /> <span className={styles.dimValue}>absent</span></>
        }
      </FieldRow>
    </section>
  )
}

function ProjectsSection({ instance }: { instance: InstanceMetadata }) {
  const hasProjects = instance.projects && instance.projects.length > 0
  return (
    <section className={styles.detailSection}>
      <SectionTitle>Projects</SectionTitle>
      {!hasProjects ? (
        <div className={styles.stubNote}>
          <span className={styles.stubIcon}>ℹ</span>
          Project binding data unavailable in Phase 1 — run CP-T006 spike.
          Full project binding display will be implemented in Phase 2.
        </div>
      ) : (
        <div className={styles.projectList}>
          {instance.projects.map(p => (
            <div key={p.projectId} className={styles.projectCard}>
              <div className={styles.projectHeader}>
                <span className={styles.monoValue}>{p.projectRoot}</span>
              </div>
              <div className={styles.projectIntegrations}>
                <span className={styles.integrationItem}>
                  <CheckIcon ok={p.integration.claudeMdPresent} warn={true} />
                  <span>CLAUDE.md</span>
                </span>
                <span className={styles.integrationItem}>
                  <CheckIcon ok={p.integration.mcpConfigPresent} warn={true} />
                  <span>.mcp.json</span>
                </span>
                <span className={styles.integrationItem}>
                  <CheckIcon ok={p.integration.mcpConfigHasIranti} warn={true} />
                  <span>MCP Iranti</span>
                </span>
                <span className={styles.integrationItem}>
                  <CheckIcon ok={p.integration.codexIntegration.configPresent} warn={true} />
                  <span>Codex</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function DetailPanel({ instance }: { instance: InstanceMetadata }) {
  const { setActiveInstance, activeInstance } = useInstanceContext()
  const navigate = useNavigate()
  const isActive = activeInstance?.id === instance.instanceId

  // Map InstanceMetadata to the Instance type expected by context
  const handleSetActive = () => {
    setActiveInstance({
      id: instance.instanceId,
      name: instance.name,
      port: instance.configuredPort,
      host: instance.database?.host ?? 'localhost',
      status: instance.runningStatus === 'running' ? 'running'
        : instance.runningStatus === 'unreachable' ? 'unreachable'
        : 'stopped',
    })
    navigate(`/instances/${encodeURIComponent(instance.instanceId)}`)
  }

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <RunningIndicator status={instance.runningStatus} />
          <h2 className={styles.detailTitle}>{instance.name}</h2>
          {isActive && <span className={styles.activeBadge}>Active</span>}
        </div>
        <div className={styles.detailActions}>
          <span className={styles.discoveredAt}>
            Last discovered: {formatRelativeTime(instance.discoveredAt)}
          </span>
          {!isActive && (
            <button className={styles.setActiveBtn} onClick={handleSetActive} type="button">
              Set as Active
            </button>
          )}
        </div>
      </div>

      {instance.runningStatus === 'unreachable' && (
        <div className={styles.errorBanner}>
          Instance offline as of {instance.runningStatusCheckedAt
            ? formatRelativeTime(instance.runningStatusCheckedAt)
            : 'unknown time'
          }
        </div>
      )}

      <div className={styles.detailSections}>
        <RuntimeSection instance={instance} />
        <DatabaseSection instance={instance} />
        <EnvironmentSection instance={instance} />
        <IntegrationsSection instance={instance} />
        <ProjectsSection instance={instance} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function InstanceManager() {
  const { id: routeInstanceId } = useParams<{ id?: string }>()

  const { data, isLoading, error, refetch } = useQuery<InstanceListResponse, Error>({
    queryKey: ['instances'],
    queryFn: () => apiFetch<InstanceListResponse>('/instances'),
    staleTime: 0, // Always re-fetch on mount since instance state can change
  })

  const instances = data?.instances ?? []

  // Determine which instance is selected: route param takes priority
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)
  const selectedId = routeInstanceId ?? localSelectedId ?? instances[0]?.instanceId ?? null
  const selectedInstance = instances.find(i => i.instanceId === selectedId) ?? null

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingState}>
          <span className={styles.spinner} aria-hidden="true" />
          <span>Discovering instances…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>⚠</span>
          <p className={styles.errorTitle}>Unable to load instances</p>
          <p className={styles.errorBody}>{error.message}</p>
          <button className={styles.retryBtn} onClick={() => void refetch()} type="button">
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (instances.length === 0) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>◈</span>
          <p className={styles.emptyTitle}>No instances discovered</p>
          <p className={styles.emptyBody}>
            Check that Iranti is installed and that the runtime root is accessible.
            The control plane looks for Iranti instances at known registry paths.
          </p>
          <button className={styles.retryBtn} onClick={() => void refetch()} type="button">
            Refresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Left: instance list */}
      <div className={styles.instanceList}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>Instances</span>
          <button
            className={styles.refreshBtn}
            onClick={() => void refetch()}
            type="button"
            aria-label="Refresh instance list"
            title="Refresh"
          >
            ↺
          </button>
        </div>
        {instances.map(inst => (
          <InstanceListItem
            key={inst.instanceId}
            instance={inst}
            selected={inst.instanceId === selectedId}
            onClick={() => setLocalSelectedId(inst.instanceId)}
          />
        ))}
        {data?.discoveredAt && (
          <div className={styles.listFooter}>
            Discovered {formatRelativeTime(data.discoveredAt)}
          </div>
        )}
      </div>

      {/* Right: detail panel */}
      <div className={styles.detailColumn}>
        {selectedInstance ? (
          <DetailPanel instance={selectedInstance} />
        ) : (
          <div className={styles.noSelection}>
            <span className={styles.noSelectionText}>Select an instance to view details</span>
          </div>
        )}
      </div>
    </div>
  )
}
