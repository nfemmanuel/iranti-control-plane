/* Iranti Control Plane — Instance & Project Manager */
/* Route: /instances and /instances/:instanceId */
/* CP-T015 — Two-column instance list + detail panel */
/* CP-T029 — Last-checked timestamp, staleness indicator, precise status labels */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, deleteInstance, fetchInstallState, fetchVersionSync, startInstance, stopInstance, fetchInstanceProjects, restartInstance } from '../../api/client'
import type { InstanceMetadata, InstanceListResponse, DoctorResponse, IrantiRuntimeMetadata, RuntimeStatus, InstallStateResult, VersionSyncResult, UpgradeJobStarted, UpgradeJobStatus, BoundProject, ProjectBinding } from '../../api/types'
import { useInstanceContext } from '../../hooks/useInstanceContext'
import { useSettings } from '../../hooks/useSettings'
import { DoctorDrawer } from './DoctorDrawer'
import { UpgradeSection } from './UpgradeSection'
import { ApiKeyManager } from './ApiKeyManager'
import { CreateInstanceForm } from './CreateInstanceForm'
import { ConfigureInstancePanel } from './ConfigureInstancePanel'
import { BindProjectForm } from './BindProjectForm'
import { ClaudeIntegrationPanel, IntegrationOverviewSection } from './ClaudeIntegrationPanel'
import { CodexIntegrationPanel } from './CodexIntegrationPanel'
import styles from './InstanceManager.module.css'
import { Spinner } from '../ui/Spinner'
import { CommandAction } from '../ui/CommandAction'
import { buildIrantiRunCommand } from '../ui/commandText'

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

/**
 * CP-T029: Returns age of a probe timestamp in minutes.
 * Used to drive staleness warnings.
 */
function probeAgeMinutes(checkedAt: string | null): number | null {
  if (!checkedAt) return null
  return (Date.now() - new Date(checkedAt).getTime()) / 60_000
}

/**
 * CP-T029: Staleness level for a probe timestamp.
 * - 'fresh': < 5 minutes
 * - 'stale': 5–10 minutes
 * - 'very-stale': > 10 minutes
 * - null: no timestamp available
 */
function getStalenesLevel(checkedAt: string | null): 'fresh' | 'stale' | 'very-stale' | null {
  const age = probeAgeMinutes(checkedAt)
  if (age === null) return null
  if (age < 5) return 'fresh'
  if (age < 10) return 'stale'
  return 'very-stale'
}

function suggestNextAvailablePort(instances: InstanceMetadata[], startPort = 3001): number {
  const used = new Set(
    instances
      .map((instance) => instance.configuredPort)
      .filter((port) => Number.isFinite(port) && port > 0)
  )

  let candidate = startPort
  while (used.has(candidate)) {
    candidate += 1
  }
  return candidate
}

/**
 * CP-T029: Hook that re-renders every 30 seconds so staleness labels stay current.
 */
function useTimeTick(intervalMs: number): number {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return tick
}

async function parseJsonResponse<T>(res: Response): Promise<T & { error?: string; code?: string }> {
  const raw = await res.text()
  if (!raw.trim()) return {} as T & { error?: string; code?: string }
  try {
    return JSON.parse(raw) as T & { error?: string; code?: string }
  } catch {
    return { error: raw.trim() } as T & { error?: string; code?: string }
  }
}

/* ------------------------------------------------------------------ */
/*  Status indicator — CP-T029: precise four-state vocabulary          */
/* ------------------------------------------------------------------ */

/**
 * CP-T029: Map internal runningStatus enum to display label.
 * "unreachable" → "Could not connect" (internal value unchanged)
 * "unknown" is never displayed — it shows as "Checking..." or "Could not connect"
 * "stopped" treated as an alias for "unreachable" in Phase 1 (no shutdown event yet)
 */
function getStatusDisplayLabel(status: InstanceMetadata['runningStatus'], hasConnectionInfo: boolean): string {
  if (!hasConnectionInfo) return 'Not configured'
  switch (status) {
    case 'running':     return 'Running'
    case 'unreachable': return 'Could not connect'
    case 'stopped':     return 'Could not connect'
    case 'unknown':     return 'Could not connect'
  }
}

function RunningIndicator({ status, hasConnectionInfo }: {
  status: InstanceMetadata['runningStatus']
  hasConnectionInfo: boolean
}) {
  const label = getStatusDisplayLabel(status, hasConnectionInfo)
  if (status === 'running') {
    return <span className={styles.dotRunning} aria-label={label} title={label} />
  }
  if (status === 'unreachable' || status === 'stopped') {
    return <span className={styles.dotUnreachable} aria-label={label} title={label} />
  }
  return <span className={styles.dotUnknown} aria-label={label} title={label} />
}

function getSetupStateLabel(setupState: InstanceMetadata['setupState']): string | null {
  switch (setupState) {
    case 'running':
      return null
    case 'configured':
      return 'Stopped'
    case 'incomplete':
      return 'Needs setup'
    default:
      return null
  }
}

function runtimeRootBadgeLabel(runtimeRoot: string): string {
  const normalized = runtimeRoot.replace(/\\/g, '/').toLowerCase()
  if (normalized.endsWith('/.iranti-runtime')) return 'Primary root'
  if (normalized.endsWith('/.iranti')) return 'Legacy root'
  return 'Custom root'
}

function StatusBadge({ status, hasConnectionInfo }: {
  status: InstanceMetadata['runningStatus']
  hasConnectionInfo: boolean
}) {
  const label = getStatusDisplayLabel(status, hasConnectionInfo)
  if (status === 'running') {
    return <span className={styles.badgeRunning}>{label}</span>
  }
  if (status === 'unreachable' || status === 'stopped') {
    return <span className={styles.badgeUnreachable}>{label}</span>
  }
  if (!hasConnectionInfo) {
    return <span className={styles.badgeNotConfigured}>{label}</span>
  }
  return <span className={styles.badgeUnknown}>{label}</span>
}

/* ------------------------------------------------------------------ */
/*  Status icon for boolean checks                                      */
/* ------------------------------------------------------------------ */

function CheckIcon({ ok, warn = false }: { ok: boolean; warn?: boolean }) {
  if (ok) return <span className={styles.iconOk} aria-label="OK">OK</span>
  if (warn) return <span className={styles.iconWarn} aria-label="Warning">!</span>
  return <span className={styles.iconError} aria-label="Missing">X</span>
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
  _tick: number  // time tick — causes re-render so staleness stays current; not read directly
}) {
  const hasConnectionInfo = Boolean(instance.database)
  const dbSummary = instance.database
    ? `${instance.database.host}:${instance.database.port}/${instance.database.name}`
    : 'No database configured'
  const setupStateLabel = getSetupStateLabel(instance.setupState)
  const staleLevel = getStalenesLevel(instance.runningStatusCheckedAt)

  return (
    <button
      className={`${styles.instanceItem} ${selected ? styles.instanceItemSelected : ''}`}
      onClick={onClick}
      type="button"
      aria-selected={selected}
    >
      <div className={styles.instanceItemHeader}>
        <RunningIndicator status={instance.runningStatus} hasConnectionInfo={hasConnectionInfo} />
        <span className={styles.instanceName}>{instance.name}</span>
        <span className={styles.instancePort}>:{instance.configuredPort}</span>
        {(staleLevel === 'stale' || staleLevel === 'very-stale') && (
          <span className={styles.stalenessIndicatorSmall} aria-label="Status may be stale" title="Status may be stale">!</span>
        )}
      </div>
      <div className={styles.instanceItemMeta}>
        <span className={styles.instanceDbSummary}>{dbSummary}</span>
        {setupStateLabel && <span className={styles.badgeNotConfigured}>{setupStateLabel}</span>}
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

/* ------------------------------------------------------------------ */
/*  CP-T072: Runtime Lifecycle section                                  */
/* ------------------------------------------------------------------ */

function RuntimeStatusBadge({ runtimeStatus }: { runtimeStatus: RuntimeStatus }) {
  const badgeStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '11px',
    fontWeight: 600,
    borderRadius: 'var(--border-radius-sm)',
    padding: '2px 7px',
  } as const

  switch (runtimeStatus) {
    case 'running':
      return (
        <span style={{
          ...badgeStyle,
          color: 'var(--color-status-success)',
          background: 'var(--color-status-success-bg)',
          border: '1px solid color-mix(in srgb, var(--color-status-success) 30%, transparent)',
        }}>
          <span style={{
            display: 'inline-block',
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: 'var(--color-status-success)',
            boxShadow: '0 0 4px var(--color-status-success)',
          }} aria-hidden="true" />
          RUNNING
        </span>
      )
    case 'stale':
      return (
        <span style={{
          ...badgeStyle,
          color: 'var(--color-status-warning)',
          background: 'var(--color-status-warning-bg)',
          border: '1px solid color-mix(in srgb, var(--color-status-warning) 30%, transparent)',
        }}>
          WARN STALE
        </span>
      )
    case 'unhealthy':
      return (
        <span style={{
          ...badgeStyle,
          color: 'var(--color-status-warning)',
          background: 'color-mix(in srgb, var(--color-status-warning-bg) 65%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-status-warning) 35%, transparent)',
        }}>
          WARN UNHEALTHY
        </span>
      )
    case 'stopped':
      return (
        <span style={{
          ...badgeStyle,
          color: 'var(--color-text-tertiary)',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-subtle)',
        }}>
          STOPPED
        </span>
      )
    case 'missing':
      return (
        <span style={{
          ...badgeStyle,
          color: 'var(--color-text-tertiary)',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-subtle)',
        }}>
          MISSING
        </span>
      )
    case 'invalid':
      return (
        <span style={{
          ...badgeStyle,
          color: 'var(--color-status-error)',
          background: 'color-mix(in srgb, var(--color-status-error) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-status-error) 30%, transparent)',
        }}>
          INVALID
        </span>
      )
    case 'unknown':
    default:
      return null
  }
}

function RuntimeLifecycleSection({
  runtime,
  runtimeStatus,
  runtimeRoot,
}: {
  runtime: IrantiRuntimeMetadata | null | undefined
  runtimeStatus: RuntimeStatus | undefined
  runtimeRoot: string
}) {
  // No runtime fields at all means backend hasn't been updated yet — skip section entirely
  if (runtime === undefined && runtimeStatus === undefined) return null

  if (runtime === null || runtimeStatus === 'unknown') {
    return (
      <div style={{
        fontSize: '12px',
        color: 'var(--color-text-tertiary)',
        fontStyle: 'italic',
        marginTop: '4px',
      }}>
        Runtime metadata unavailable - instance started without{' '}
        <code style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          background: 'var(--color-bg-elevated)',
          padding: '1px 4px',
          borderRadius: 'var(--border-radius-sm)',
          color: 'var(--color-accent-primary)',
        }}>
          iranti run
        </code>
      </div>
    )
  }

  const isStale = runtimeStatus === 'stale'
  const effectiveStatus: RuntimeStatus = runtimeStatus ?? 'unknown'
  const runCommand = runtime?.instanceName
    ? buildIrantiRunCommand(runtime.instanceName, runtimeRoot)
    : 'iranti run'
  const warningText = runtimeStatus === 'unhealthy'
    ? 'This instance is running but failing health checks. Use doctor and logs before treating it as healthy.'
    : runtimeStatus === 'invalid'
      ? 'Runtime metadata exists but does not describe a valid Iranti process. Recreate or repair this instance before trusting it.'
      : runtimeStatus === 'missing'
        ? 'Instance configuration exists without runtime metadata. Start the instance with `iranti run --instance <name>` if it should be active.'
        : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Runtime status badge row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <RuntimeStatusBadge runtimeStatus={effectiveStatus} />
        {runtime?.version && (
          <span style={{
            fontSize: '11px',
            color: 'var(--color-text-tertiary)',
            fontFamily: 'var(--font-mono)',
          }}>
            v{runtime.version}
          </span>
        )}
      </div>

      {/* PID, started, heartbeat, port metadata row — only shown when runtime object is present */}
      {runtime && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 16px',
          fontSize: '11px',
          color: 'var(--color-text-secondary)',
          fontFamily: 'var(--font-mono)',
        }}>
          <span>PID: {runtime.pid}</span>
          <span>started {formatRelativeTime(runtime.startedAt)}</span>
          <span style={{ color: isStale ? 'var(--color-status-warning)' : 'var(--color-text-secondary)' }}>
            heartbeat {formatRelativeTime(runtime.lastHeartbeatAt)}
            {isStale && ' !'}
          </span>
          <span>port: {runtime.port}</span>
        </div>
      )}

      {/* Stale warning callout */}
      {isStale && runtime && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--color-status-warning-bg)',
          border: '1px solid color-mix(in srgb, var(--color-status-warning) 30%, transparent)',
          borderRadius: 'var(--border-radius-md)',
          fontSize: '12px',
          color: 'var(--color-status-warning)',
          lineHeight: 1.5,
        }}>
          <strong>Stale runtime signal.</strong>{' '}
          This instance&apos;s heartbeat has not updated in over 60 seconds - the process may have crashed.
          Try running{' '}
          <code style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            background: 'color-mix(in srgb, var(--color-status-warning-bg) 60%, transparent)',
            padding: '1px 4px',
            borderRadius: 'var(--border-radius-sm)',
          }}>
            {runCommand}
          </code>
          {' '}to restart.
        </div>
      )}

      {warningText && (
        <div style={{
          padding: '8px 12px',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--border-radius-md)',
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          lineHeight: 1.5,
        }}>
          {warningText}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  CP-T079: Install State bar                                          */
/* ------------------------------------------------------------------ */

function InstallStateBar({ installState }: { installState: InstallStateResult | null }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText('npm install -g iranti').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [])

  if (installState === null) {
    // Still loading — render nothing to avoid flash
    return null
  }

  if (installState.installed) {
    return (
      <div className={styles.installStateSection}>
        <div className={styles.installStateHeader}>
          <span className={styles.installStateLabel}>Iranti CLI</span>
          <span className={styles.installStateBadgeInstalled}>
            Installed{installState.version ? ` - v${installState.version}` : ''}
          </span>
        </div>
        {installState.executablePath && (
          <div className={styles.installStatePath}>
            Path: {installState.executablePath}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.installStateSection}>
      <div className={styles.installStateHeader}>
        <span className={styles.installStateLabel}>Iranti CLI</span>
        <span className={styles.installStateBadgeNotFound}>Not found</span>
      </div>
      <div className={styles.installStateInstallRow}>
        <span>Install with:</span>
        <code className={styles.installStateCommand}>npm install -g iranti</code>
        <button
          className={`${styles.copyBtn} ${copied ? styles.copyBtnConfirm : ''}`}
          type="button"
          onClick={handleCopy}
          aria-label="Copy install command"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  CP-T081: Upgrade promotion banner                                   */
/* ------------------------------------------------------------------ */

type UpgradeBannerPhase =
  | { phase: 'idle' }
  | { phase: 'confirming' }
  | { phase: 'upgrading'; jobId: string }
  | { phase: 'complete' }
  | { phase: 'failed'; message: string }
  | { phase: 'error'; message: string }

function UpgradePromoBanner({
  versionSync,
  activeInstanceName,
  onUpgradeComplete,
}: {
  versionSync: VersionSyncResult
  activeInstanceName: string
  onUpgradeComplete: () => void
}) {
  const queryClient = useQueryClient()
  const [bannerState, setBannerState] = useState<UpgradeBannerPhase>({ phase: 'idle' })
  const [jobStatus, setJobStatus] = useState<UpgradeJobStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // If version is no longer behind (e.g. after upgrade) reset to idle
  useEffect(() => {
    if (versionSync.status !== 'behind' && bannerState.phase === 'complete') {
      setBannerState({ phase: 'idle' })
    }
  }, [versionSync.status, bannerState.phase])

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const startPolling = (jobId: string) => {
    stopPolling()
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/control-plane/instances/${encodeURIComponent(activeInstanceName)}/upgrade/${encodeURIComponent(jobId)}`
          )
          const status = await parseJsonResponse<UpgradeJobStatus>(res)
          if (!res.ok) {
            stopPolling()
            setBannerState({
              phase: 'error',
              message: status.error ?? `Could not check upgrade status (HTTP ${res.status}).`,
            })
            return
          }
          setJobStatus(status)
          if (status.status === 'complete') {
            stopPolling()
            setBannerState({ phase: 'complete' })
            onUpgradeComplete()
            // Re-fetch version sync so button disappears
            void queryClient.invalidateQueries({ queryKey: ['version-sync'] })
          } else if (status.status === 'failed') {
            stopPolling()
            setBannerState({
              phase: 'failed',
              message: `Upgrade failed (exit code: ${status.exitCode ?? 'unknown'}). Check the output below.`,
            })
          }
        } catch {
          stopPolling()
          setBannerState({ phase: 'error', message: 'Connection lost while checking upgrade status.' })
        }
      })()
    }, 2000)
  }

  const handleConfirmUpgrade = async () => {
    setBannerState({ phase: 'upgrading', jobId: '' })
    setJobStatus(null)
    try {
      const res = await fetch(
        `/api/control-plane/instances/${encodeURIComponent(activeInstanceName)}/upgrade`,
        { method: 'POST' }
      )
      const body = await parseJsonResponse<UpgradeJobStarted>(res)
      if (!res.ok) {
        setBannerState({
          phase: 'error',
          message: body.error ?? `Failed to start upgrade (HTTP ${res.status}).`,
        })
        return
      }
      if (!body.jobId) {
        setBannerState({ phase: 'error', message: 'Upgrade route returned no job id.' })
        return
      }
      setBannerState({ phase: 'upgrading', jobId: body.jobId })
      startPolling(body.jobId)
    } catch {
      setBannerState({ phase: 'error', message: 'Could not reach the control plane API.' })
    }
  }

  const reset = () => {
    stopPolling()
    setJobStatus(null)
    setBannerState({ phase: 'idle' })
  }

  const latestVersion = versionSync.latestVersion ?? ''
  const installedVersion = versionSync.installedVersion ?? 'unknown'

  if (bannerState.phase === 'idle') {
    return (
      <div className={styles.upgradeBanner}>
        <span className={styles.upgradeBannerIcon} aria-hidden="true">^</span>
        <span className={styles.upgradeBannerText}>
          Runtime update available for <strong>{activeInstanceName}</strong>: v{installedVersion} to v{latestVersion}
        </span>
        <button
          className={styles.upgradeBannerBtn}
          type="button"
          onClick={() => setBannerState({ phase: 'confirming' })}
        >
          Upgrade runtime to v{latestVersion}
        </button>
      </div>
    )
  }

  if (bannerState.phase === 'confirming') {
    return (
      <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="upgrade-modal-title">
        <div className={styles.modalBox}>
          <p className={styles.modalTitle} id="upgrade-modal-title">
            Upgrade {activeInstanceName} to v{latestVersion}?
          </p>
          <p className={styles.modalBody}>
            This will run{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
              iranti upgrade --restart --instance {activeInstanceName}
            </code>
            {' '}for the selected instance runtime. This does not change the globally installed CLI version.
            {' '}Active agents will experience a brief interruption.
            This may take up to 60 seconds.
          </p>
          <div className={styles.modalActions}>
            <button className={styles.modalCancelBtn} type="button" onClick={reset}>
              Cancel
            </button>
            <button
              className={styles.upgradeConfirmBtn}
              type="button"
              onClick={() => void handleConfirmUpgrade()}
            >
              Upgrade
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (bannerState.phase === 'upgrading') {
    return (
      <div className={styles.upgradeBanner}>
        <span className={styles.spinnerSmall} aria-hidden="true" />
        <span className={styles.upgradeBannerText}>
          Upgrading {activeInstanceName} to v{latestVersion}...
          {jobStatus && jobStatus.output.length > 0 && (
            <span className={styles.upgradeBannerOutput}>
              {jobStatus.output[jobStatus.output.length - 1]}
            </span>
          )}
        </span>
      </div>
    )
  }

  if (bannerState.phase === 'complete') {
    return (
      <div className={`${styles.upgradeBanner} ${styles.upgradeBannerSuccess}`}>
        <span aria-hidden="true">OK</span>
        <span className={styles.upgradeBannerText}>
          Upgrade complete - Iranti restarted successfully.
        </span>
        <button className={styles.upgradeBannerDismissBtn} type="button" onClick={reset}>
          Dismiss
        </button>
      </div>
    )
  }

  if (bannerState.phase === 'failed' || bannerState.phase === 'error') {
    return (
      <div className={`${styles.upgradeBanner} ${styles.upgradeBannerError}`}>
        <span aria-hidden="true">X</span>
        <span className={styles.upgradeBannerText}>{bannerState.message}</span>
        <button className={styles.upgradeBannerDismissBtn} type="button" onClick={reset}>
          Try again
        </button>
      </div>
    )
  }

  return null
}

/* ------------------------------------------------------------------ */
/*  CP-T080: Stop confirmation modal                                    */
/* ------------------------------------------------------------------ */

function StopConfirmModal({
  instanceName,
  onConfirm,
  onCancel,
}: {
  instanceName: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="stop-modal-title">
      <div className={styles.modalBox}>
        <p className={styles.modalTitle} id="stop-modal-title">Stop {instanceName}?</p>
        <p className={styles.modalBody}>
          This will terminate the Iranti process. Agents using this instance will lose connectivity.
        </p>
        <div className={styles.modalActions}>
          <button className={styles.modalCancelBtn} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.modalStopBtn} type="button" onClick={onConfirm}>
            Stop
          </button>
        </div>
      </div>
    </div>
  )
}

function DeleteInstanceModal({
  instance,
  onDeleted,
  onCancel,
}: {
  instance: InstanceMetadata
  onDeleted: () => void
  onCancel: () => void
}) {
  const [confirmName, setConfirmName] = useState('')
  const [removeProjectBindings, setRemoveProjectBindings] = useState(true)
  const [dropDatabase, setDropDatabase] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = confirmName.trim() === instance.name && !submitting

  const handleDelete = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await deleteInstance(instance.name, {
        confirmName: confirmName.trim(),
        removeProjectBindings,
        dropDatabase,
      })
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, confirmName, dropDatabase, instance.name, onDeleted, removeProjectBindings])

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="delete-instance-title">
      <div className={styles.deleteModalBox}>
        <p className={styles.modalTitle} id="delete-instance-title">Delete {instance.name}?</p>
        <div className={styles.modalBody}>
          <p className={styles.deleteModalLead}>
            This removes the instance directory from <code className={styles.inlineCode}>{instance.runtimeRoot}</code>.
          </p>
          <ul className={styles.deleteModalList}>
            <li>Runtime files will be deleted.</li>
            <li>Deletion will be refused if the instance is still running.</li>
            <li>Dropping the PostgreSQL database is optional and irreversible.</li>
          </ul>
          <label className={styles.deleteOptionRow}>
            <input
              type="checkbox"
              checked={removeProjectBindings}
              onChange={(event) => setRemoveProjectBindings(event.target.checked)}
            />
            <span>Remove bound project <code className={styles.inlineCode}>.env.iranti</code> files</span>
          </label>
          <label className={styles.deleteOptionRow}>
            <input
              type="checkbox"
              checked={dropDatabase}
              onChange={(event) => setDropDatabase(event.target.checked)}
            />
            <span>
              Drop PostgreSQL database
              {instance.database?.name ? ` (${instance.database.name})` : ' from DATABASE_URL'}
            </span>
          </label>
          <div className={styles.deleteConfirmBlock}>
            <label className={styles.fieldLabel} htmlFor="delete-confirm-name">
              Type <code className={styles.inlineCode}>{instance.name}</code> to confirm
            </label>
            <input
              id="delete-confirm-name"
              className={styles.deleteConfirmInput}
              type="text"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {error && (
            <div className={styles.deleteError} role="alert">
              {error}
            </div>
          )}
        </div>
        <div className={styles.modalActions}>
          <button className={styles.modalCancelBtn} type="button" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            className={styles.modalDeleteBtn}
            type="button"
            onClick={() => void handleDelete()}
            disabled={!canSubmit}
          >
            {submitting ? 'Deleting...' : 'Delete instance'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  CP-T080: Lifecycle controls (Start / Stop buttons)                  */
/* ------------------------------------------------------------------ */

function LifecycleControls({
  instance,
  onStatusChange,
}: {
  instance: InstanceMetadata
  onStatusChange: () => void
}) {
  const [inFlight, setInFlight] = useState(false)
  const [lifecycleError, setLifecycleError] = useState<string | null>(null)
  const [lifecycleInfo, setLifecycleInfo] = useState<string | null>(null)
  const [showStopConfirm, setShowStopConfirm] = useState(false)

  const isRunning = instance.runningStatus === 'running'
  const isRecoverable = instance.runtimeStatus === 'invalid' || instance.runtimeStatus === 'stale'
  const isUnreachable =
    instance.runningStatus === 'unreachable' ||
    instance.runningStatus === 'stopped' ||
    instance.runningStatus === 'unknown'

  const handleStart = useCallback(async () => {
    if (inFlight) return
    setInFlight(true)
    setLifecycleError(null)
    setLifecycleInfo('Starting...')

    try {
      const result = await startInstance(instance.name)
      if (result.started === false) {
        // 409 — already running externally; just refresh status
        setLifecycleInfo(result.reason ?? 'Already running')
        setTimeout(() => {
          onStatusChange()
          setTimeout(() => setLifecycleInfo(null), 2000)
        }, 500)
      } else {
        // The backend already confirmed a durable start; refresh the UI state.
        setTimeout(() => {
          setLifecycleInfo(result.recovered ? (result.note ?? 'Recovered and started') : 'Started')
          onStatusChange()
          setTimeout(() => setLifecycleInfo(null), 3000)
        }, 2000)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLifecycleError(msg)
      setLifecycleInfo(null)
    } finally {
      setInFlight(false)
    }
  }, [inFlight, instance.name, onStatusChange])

  const handleRecover = useCallback(async () => {
    if (inFlight) return
    setInFlight(true)
    setLifecycleError(null)
    setLifecycleInfo('Recovering runtime...')

    try {
      await restartInstance(instance.name)
      setTimeout(() => {
        setLifecycleInfo('Recovery triggered')
        onStatusChange()
        setTimeout(() => setLifecycleInfo(null), 3000)
      }, 1500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLifecycleError(msg)
      setLifecycleInfo(null)
    } finally {
      setInFlight(false)
    }
  }, [inFlight, instance.name, onStatusChange])

  const handleStopConfirm = useCallback(async () => {
    setShowStopConfirm(false)
    if (inFlight) return
    setInFlight(true)
    setLifecycleError(null)
    setLifecycleInfo(null)

    try {
      await stopInstance(instance.name)
      // Immediately re-poll — the instance should show unreachable quickly
      setTimeout(() => {
        onStatusChange()
      }, 500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLifecycleError(msg)
    } finally {
      setInFlight(false)
    }
  }, [inFlight, instance.name, onStatusChange])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {isRecoverable ? (
          <button
            className={`${styles.lifecycleBtn} ${styles.recoverBtn}`}
            type="button"
            disabled={inFlight}
            onClick={() => void handleRecover()}
          >
            {inFlight ? (
              <><span className={styles.spinnerSmall} aria-hidden="true" /> Recovering...</>
            ) : (
              <>Recover</>
            )}
          </button>
        ) : isUnreachable && (
          <button
            className={`${styles.lifecycleBtn} ${styles.startBtn}`}
            type="button"
            disabled={inFlight}
            onClick={() => void handleStart()}
            title={instance.runningStatus === 'unknown' ? 'Status unknown - starting may create a duplicate process' : undefined}
          >
            {inFlight ? (
              <><span className={styles.spinnerSmall} aria-hidden="true" /> Starting...</>
            ) : (
              <>Start</>
            )}
          </button>
        )}
        {isRunning && (
          <button
            className={`${styles.lifecycleBtn} ${styles.stopBtn}`}
            type="button"
            disabled={inFlight}
            onClick={() => setShowStopConfirm(true)}
          >
            {inFlight ? (
              <><span className={styles.spinnerSmall} aria-hidden="true" /> Stopping...</>
            ) : (
              <>Stop</>
            )}
          </button>
        )}
        {lifecycleInfo && (
          <span className={styles.lifecycleInfo}>{lifecycleInfo}</span>
        )}
      </div>
      {lifecycleError && (
        <div className={styles.lifecycleError}>{lifecycleError}</div>
      )}
      {showStopConfirm && (
        <StopConfirmModal
          instanceName={instance.name}
          onConfirm={() => void handleStopConfirm()}
          onCancel={() => setShowStopConfirm(false)}
        />
      )}
    </>
  )
}

function RuntimeSection({ instance, onRefresh, isRefreshing }: {
  instance: InstanceMetadata
  onRefresh: () => void
  isRefreshing: boolean
}) {
  const hasConnectionInfo = Boolean(instance.database)
  const staleLevel = getStalenesLevel(instance.runningStatusCheckedAt)

  return (
    <section className={styles.detailSection}>
      <SectionTitle>Runtime</SectionTitle>
      <FieldRow label="Root">
        <span className={styles.runtimeRootValue}>
          <span className={styles.monoValue}>{instance.runtimeRoot}</span>
          <span
            className={`${styles.rootBadge} ${
              runtimeRootBadgeLabel(instance.runtimeRoot) === 'Legacy root'
                ? styles.rootBadgeLegacy
                : runtimeRootBadgeLabel(instance.runtimeRoot) === 'Custom root'
                  ? styles.rootBadgeCustom
                  : styles.rootBadgePrimary
            }`}
          >
            {runtimeRootBadgeLabel(instance.runtimeRoot)}
          </span>
        </span>
      </FieldRow>
      <FieldRow label="Port">
        <span className={styles.monoValue}>{instance.configuredPort}</span>
      </FieldRow>
      <FieldRow label="Status">
        <StatusBadge status={instance.runningStatus} hasConnectionInfo={hasConnectionInfo} />
      </FieldRow>
      <FieldRow label="Version">
        {instance.irantVersion ?? <span className={styles.dimValue}>Version unknown</span>}
      </FieldRow>

      {/* CP-T029: Last-checked timestamp — always visible when available */}
      <FieldRow label="Last checked">
        {instance.runningStatusCheckedAt ? (
          <span className={styles.dimValue}>
            {formatRelativeTime(instance.runningStatusCheckedAt)}
            {staleLevel === 'stale' && (
              <span className={styles.stalenessWarning} aria-label="Status may be stale"> - Status may be stale</span>
            )}
            {staleLevel === 'very-stale' && (
              <span className={styles.stalenessWarningStrong} aria-label="Status is stale">{' '}- Status is stale</span>
            )}
          </span>
        ) : (
          <span className={styles.dimValue}>Not yet checked</span>
        )}
      </FieldRow>

      {/* CP-T029: Refresh button — debounced, shows spinner while probe is in flight */}
      <FieldRow label="">
        <button
          className={`${styles.refreshProbeBtn} ${isRefreshing ? styles.refreshProbeBtnActive : ''}`}
          onClick={onRefresh}
          disabled={isRefreshing}
          type="button"
          aria-label="Refresh instance health probe"
        >
          {isRefreshing ? (
            <><span className={styles.spinnerSmall} aria-hidden="true" /> Checking...</>
          ) : (
            <>Refresh status</>
          )}
        </button>
        {staleLevel === 'very-stale' && !isRefreshing && (
          <span className={styles.stalenessCtaHint}>Probe data is over 10 minutes old</span>
        )}
      </FieldRow>

      {/* CP-T072: Runtime lifecycle — additive section below existing probe fields */}
      {(instance.runtime !== undefined || instance.runtimeStatus !== undefined) && (
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--color-border-subtle)' }}>
          <RuntimeLifecycleSection
            runtime={instance.runtime}
            runtimeStatus={instance.runtimeStatus}
            runtimeRoot={instance.runtimeRoot}
          />
        </div>
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
          Database unreachable - check DATABASE_URL in the live instance env
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
  const projectMode = instance.projectMode

  // Human-readable project mode annotation
  const projectModeNote: string | null =
    projectMode === 'isolated'
      ? 'Each project gets its own isolated memory context.'
      : projectMode === 'shared'
        ? 'All projects share a single memory context.'
        : null

  return (
    <section className={styles.detailSection}>
      <SectionTitle>Environment</SectionTitle>
      <FieldRow label="Project binding">
        {(envFile.bindingPresent ?? envFile.present) && envFile.path
          ? <><CheckIcon ok={true} /> <span className={styles.monoValue}>{envFile.path}</span></>
          : envFile.instanceEnvPath
            ? <><CheckIcon ok={true} /> <span className={styles.dimValue}>No current project binding in this workspace</span></>
            : <><CheckIcon ok={false} /> <span className={styles.errorValue}>No .env.iranti found - check the current project binding</span></>
        }
      </FieldRow>
      {envFile.instanceEnvPath && (
        <FieldRow label="Instance env">
          <><CheckIcon ok={true} /> <span className={styles.monoValue}>{envFile.instanceEnvPath}</span></>
        </FieldRow>
      )}
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
      {/* CP-T058 AC-3 (H8) — Project Mode field */}
      <FieldRow label="Project Mode">
        {projectMode ? (
          <span className={styles.monoValue} title={projectModeNote ?? undefined}>
            {projectMode}
            {projectModeNote && (
              <span className={styles.helpText}> - {projectModeNote}</span>
            )}
          </span>
        ) : (
          <span className={styles.dimValue}>-</span>
        )}
      </FieldRow>
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
      <FieldRow label="Claude key">
        {integration.providerKeys.claude
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
      {integration.providerKeys.otherKeys && integration.providerKeys.otherKeys.length > 0 && (
        <FieldRow label="Other provider keys">
          <span className={styles.monoValue}>{integration.providerKeys.otherKeys.join(', ')}</span>
        </FieldRow>
      )}
    </section>
  )
}

function ProjectsSection({
  instance,
  instances,
  onBindSuccess,
}: {
  instance: InstanceMetadata
  instances: InstanceMetadata[]
  onBindSuccess: () => void
}) {
  const [showBindForm, setShowBindForm] = useState(false)
  const [rebindTarget, setRebindTarget] = useState<string | null>(null)
  // CP-T092: which project path has the integration panel open (null = none)
  const [integrationOpen, setIntegrationOpen] = useState<string | null>(null)

  const { data: projectsData, isLoading: projectsLoading, error: projectsError } = useQuery({
    queryKey: ['instance-projects', instance.name],
    queryFn: () => fetchInstanceProjects(instance.name),
    staleTime: 30_000,
  })

  const boundProjects: BoundProject[] = projectsData?.projects ?? []
  const projectBindingsByPath = new Map(instance.projects.map((project) => [project.projectRoot, project]))
  const readyProjects = boundProjects.filter((project) => {
    const binding = projectBindingsByPath.get(project.projectPath)
    return binding ? getProjectReadiness(binding) === 'ready' : false
  }).length
  const partialProjects = boundProjects.filter((project) => {
    const binding = projectBindingsByPath.get(project.projectPath)
    return binding ? getProjectReadiness(binding) === 'partial' : false
  }).length
  const missingProjects = boundProjects.filter((project) => {
    const binding = projectBindingsByPath.get(project.projectPath)
    return binding ? getProjectReadiness(binding) === 'missing' : true
  }).length

  const handleBindSuccess = () => {
    setShowBindForm(false)
    setRebindTarget(null)
    onBindSuccess()
  }

  if (showBindForm || rebindTarget !== null) {
    return (
      <section className={styles.detailSection}>
        <SectionTitle>Projects</SectionTitle>
        <BindProjectForm
          instanceName={instance.name}
          instances={instances}
          onSuccess={handleBindSuccess}
          onCancel={() => { setShowBindForm(false); setRebindTarget(null) }}
        />
      </section>
    )
  }

  return (
    <section className={styles.detailSection}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
        <SectionTitle>Projects</SectionTitle>
        <button
          className={styles.bindProjectBtn}
          type="button"
          onClick={() => setShowBindForm(true)}
          title="Bind a project to this instance"
        >
          + Bind Project
        </button>
      </div>

      <div className={styles.projectsSummaryCard}>
        <div className={styles.projectsSummaryHeader}>
          <span className={styles.projectsSummaryTitle}>Project readiness</span>
          <span className={styles.projectsSummaryMeta}>
            {boundProjects.length === 0 ? 'No projects bound yet' : `${boundProjects.length} bound project${boundProjects.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className={styles.projectsSummaryStats}>
          <span className={`${styles.projectsSummaryPill} ${styles.projectsSummaryPillReady}`}>{readyProjects} ready</span>
          <span className={`${styles.projectsSummaryPill} ${styles.projectsSummaryPillWarning}`}>{partialProjects} partial</span>
          <span className={`${styles.projectsSummaryPill} ${styles.projectsSummaryPillMuted}`}>{missingProjects} missing</span>
        </div>
        <p className={styles.projectsSummaryBody}>
          Start here when Claude or Codex behavior feels off. Bind the project first, then inspect per-project wiring only where the summary says it is incomplete.
        </p>
      </div>

      {projectsLoading && (
        <div className={styles.projectsLoading}>
          <span className={styles.spinnerSmall} aria-hidden="true" /> Loading projects...
        </div>
      )}

      {projectsError && !projectsLoading && (
        <div className={styles.warningNote} style={{ fontSize: '12px' }}>
          Could not load bound projects: {projectsError instanceof Error ? projectsError.message : String(projectsError)}
        </div>
      )}

      {!projectsLoading && !projectsError && boundProjects.length === 0 && (
        <div className={styles.stubNote}>
          <span className={styles.stubIcon}>i</span>
          No projects bound. Bind a project to connect Claude Code or other agents.
        </div>
      )}

      {!projectsLoading && !projectsError && boundProjects.length > 0 && (
        <div className={styles.projectList}>
          {boundProjects.map(p => {
            const binding = projectBindingsByPath.get(p.projectPath)
            const readiness = binding ? getProjectReadiness(binding) : 'missing'
            return (
            <div key={p.projectPath} className={styles.projectCard}>
              <div className={styles.boundProjectHeader}>
                <span className={`${styles.monoValue} ${styles.boundProjectPath}`}>{p.projectPath}</span>
                <span
                  className={`${styles.projectReadinessBadge} ${
                    readiness === 'ready'
                      ? styles.projectReadinessBadgeReady
                      : readiness === 'partial'
                        ? styles.projectReadinessBadgeWarning
                        : styles.projectReadinessBadgeMuted
                  }`}
                >
                  {readiness === 'ready'
                    ? 'Ready'
                    : readiness === 'partial'
                      ? 'Partial'
                      : 'Needs setup'}
                </span>
              </div>
              <div className={styles.boundProjectMeta}>
                <span className={styles.boundProjectTag}>{p.mode}</span>
                <span className={styles.boundProjectAgent}>{p.agentId}</span>
                {p.boundAt && (
                  <span className={styles.boundProjectAt}>
                    bound {new Date(p.boundAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <div className={styles.boundProjectActions}>
                <button
                  className={styles.rebindBtn}
                  type="button"
                  onClick={() => { setShowBindForm(true) }}
                  title="Rebind this project"
                >
                  Rebind project
                </button>
                <button
                  className={styles.rebindBtn}
                  type="button"
                  onClick={() => setIntegrationOpen(prev => prev === p.projectPath ? null : p.projectPath)}
                  title="Set up or inspect Claude Code integration for this project"
                  aria-pressed={integrationOpen === p.projectPath}
                >
                  {integrationOpen === p.projectPath ? 'Hide details' : 'View project details'}
                </button>
              </div>
              {/* CP-T092: inline integration panel */}
              {integrationOpen === p.projectPath && (
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <ClaudeIntegrationPanel
                    instanceName={instance.name}
                    projectPath={p.projectPath}
                    onClose={() => setIntegrationOpen(null)}
                  />
                </div>
              )}
            </div>
          )})}
        </div>
      )}
    </section>
  )
}

type PriorityTone = 'ready' | 'warning' | 'critical'
type PriorityAction =
  | { label: string; type: 'start' | 'recover' | 'doctor' | 'configure' | 'scroll'; target?: string }
  | null

interface PriorityCardDescriptor {
  key: string
  title: string
  tone: PriorityTone
  summary: string
  detail: string
  action: PriorityAction
}

function getProjectWiringState(instance: InstanceMetadata): { total: number; fullyWired: number; partiallyWired: number } {
  const total = instance.projects.length
  let fullyWired = 0
  let partiallyWired = 0

  for (const project of instance.projects) {
    const hasClaude = project.integration.claudeMdPresent && project.integration.mcpConfigHasIranti
    const hasCodex = project.integration.codexIntegration.configPresent
    if (hasClaude && hasCodex) {
      fullyWired += 1
    } else if (hasClaude || hasCodex || project.integration.mcpConfigPresent) {
      partiallyWired += 1
    }
  }

  return { total, fullyWired, partiallyWired }
}

function hasUsableProvider(instance: InstanceMetadata): boolean {
  const provider = instance.integration.defaultProvider
  if (!provider) return false
  if (provider === 'claude') return instance.integration.providerKeys.claude
  if (provider === 'openai') return instance.integration.providerKeys.openai
  if (provider === 'mock') return true
  return (instance.integration.providerKeys.otherKeys?.length ?? 0) > 0 || Boolean(instance.integration.defaultModel)
}

type ProjectReadiness = 'ready' | 'partial' | 'missing'

function getProjectReadiness(project: ProjectBinding): ProjectReadiness {
  const hasClaude = project.integration.claudeMdPresent && project.integration.mcpConfigHasIranti
  const hasCodex = project.integration.codexIntegration.configPresent
  if (hasClaude && hasCodex) return 'ready'
  if (hasClaude || hasCodex || project.integration.mcpConfigPresent) return 'partial'
  return 'missing'
}

function getOperatorPriorities(instance: InstanceMetadata): PriorityCardDescriptor[] {
  const runtimeStale = getStalenesLevel(instance.runningStatusCheckedAt)
  const projectState = getProjectWiringState(instance)
  const providerReady = hasUsableProvider(instance)

  const runtimePriority: PriorityCardDescriptor =
    instance.runtimeStatus === 'invalid'
      ? {
          key: 'runtime',
          title: 'Runtime first',
          tone: 'critical',
          summary: 'Runtime metadata is invalid.',
          detail: 'Control Plane can recover this instance for you. Use recovery before trusting doctor output or project wiring below.',
          action: { label: 'Recover runtime', type: 'recover' },
        }
      : instance.runningStatus !== 'running'
      ? {
          key: 'runtime',
          title: 'Runtime first',
          tone: 'critical',
          summary: 'Instance is not reachable.',
          detail: 'Start the runtime before spending time on bindings, MCP wiring, or client setup.',
          action: { label: 'Start instance', type: 'start' },
        }
      : runtimeStale === 'very-stale'
        ? {
            key: 'runtime',
            title: 'Runtime first',
            tone: 'warning',
            summary: 'Heartbeat looks stale.',
            detail: 'The instance is up, but the runtime signal may be lagging. Run Doctor before you trust the rest of the page.',
            action: { label: 'Run Doctor', type: 'doctor' },
          }
        : {
            key: 'runtime',
            title: 'Runtime first',
            tone: 'ready',
            summary: 'Runtime is reachable.',
            detail: 'The core instance looks healthy enough to move on to projects and client wiring.',
            action: { label: 'Review configuration', type: 'configure' },
          }

  const projectsPriority: PriorityCardDescriptor =
    projectState.total === 0
      ? {
          key: 'projects',
          title: 'Projects next',
          tone: 'warning',
          summary: 'No projects are bound.',
          detail: 'Bind at least one project so Claude or Codex sessions have a repo to work from.',
          action: { label: 'Bind a project', type: 'scroll', target: 'projects-section' },
        }
      : projectState.fullyWired === projectState.total
        ? {
            key: 'projects',
            title: 'Projects next',
            tone: 'ready',
            summary: `${projectState.total} project${projectState.total === 1 ? '' : 's'} bound and wired.`,
            detail: 'Project-level MCP and client setup are in a good place.',
            action: { label: 'Review project bindings', type: 'scroll', target: 'projects-section' },
          }
        : {
            key: 'projects',
            title: 'Projects next',
            tone: 'warning',
            summary: `${projectState.fullyWired}/${projectState.total} project${projectState.total === 1 ? '' : 's'} fully wired.`,
            detail: 'Some projects are only partially ready. Fix the project wiring before testing client memory behavior.',
            action: { label: 'Fix project wiring', type: 'scroll', target: 'claude-overview-section' },
          }

  const clientsPriority: PriorityCardDescriptor =
    !providerReady
      ? {
          key: 'clients',
          title: 'Clients last',
          tone: 'warning',
          summary: 'Provider setup is incomplete.',
          detail: 'Set a default provider and make sure the active provider key exists before trusting client-side tests.',
          action: { label: 'Configure instance', type: 'configure' },
        }
      : projectState.total === 0
        ? {
            key: 'clients',
            title: 'Clients last',
            tone: 'warning',
            summary: 'Clients are blocked by missing project bindings.',
            detail: 'The instance is ready, but Claude and Codex still need at least one bound project to feel usable.',
            action: { label: 'Bind a project', type: 'scroll', target: 'projects-section' },
          }
        : {
            key: 'clients',
            title: 'Clients last',
            tone: projectState.fullyWired === projectState.total ? 'ready' : 'warning',
            summary: projectState.fullyWired === projectState.total ? 'Client setup looks usable.' : 'Client setup is only partially ready.',
            detail: projectState.fullyWired === projectState.total
              ? 'Claude and Codex should have the wiring they need; verify the exact session you care about.'
              : 'Use the Claude and Codex sections below to finish the wiring that matters for real sessions.',
            action: { label: 'Review client setup', type: 'scroll', target: 'codex-integration-section' },
          }

  return [runtimePriority, projectsPriority, clientsPriority]
}

function DetailPanel({ instance, instances, onRefresh, isRefreshing, onRunDoctor, onUpgradeComplete, onLifecycleChange, onRefetchInstances }: {
  instance: InstanceMetadata
  /** All discovered instances — passed through to ApiKeyManager for syncToProject dropdown */
  instances: InstanceMetadata[]
  onRefresh: () => void
  isRefreshing: boolean
  onRunDoctor: (instanceId: string) => void
  onUpgradeComplete: () => void
  onLifecycleChange: () => void
  onRefetchInstances: () => void
}) {
  const { setActiveInstance, activeInstance } = useInstanceContext()
  const navigate = useNavigate()
  const isActive = activeInstance?.id === instance.instanceId
  const hasConnectionInfo = Boolean(instance.database)
  const [priorityActionBusy, setPriorityActionBusy] = useState(false)

  // CP-T090: Configure panel inline state
  const [showConfigure, setShowConfigure] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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

  const scrollToSection = useCallback((target: string) => {
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const handlePriorityAction = useCallback(async (action: PriorityAction) => {
    if (!action) return
    if (action.type === 'scroll' && action.target) {
      scrollToSection(action.target)
      return
    }
    if (action.type === 'configure') {
      setShowConfigure(true)
      return
    }
    if (action.type === 'doctor') {
      onRunDoctor(instance.instanceId)
      return
    }
    if (action.type === 'recover') {
      setPriorityActionBusy(true)
      try {
        await restartInstance(instance.name)
        onLifecycleChange()
      } finally {
        setPriorityActionBusy(false)
      }
      return
    }
    if (action.type === 'start') {
      setPriorityActionBusy(true)
      try {
        await startInstance(instance.name)
        onLifecycleChange()
      } finally {
        setPriorityActionBusy(false)
      }
    }
  }, [instance.instanceId, instance.name, onLifecycleChange, onRunDoctor, scrollToSection])

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <RunningIndicator status={instance.runningStatus} hasConnectionInfo={hasConnectionInfo} />
          <h2 className={styles.detailTitle}>{instance.name}</h2>
          {isActive && <span className={styles.activeBadge}>Active</span>}
          {/* CP-T072: Runtime lifecycle badge — shown when backend provides runtimeStatus */}
          {instance.runtimeStatus !== undefined && instance.runtimeStatus !== 'unknown' && (
            <RuntimeStatusBadge runtimeStatus={instance.runtimeStatus} />
          )}
        </div>
        <div className={styles.detailActions}>
          <span className={styles.discoveredAt}>
            Last discovered: {formatRelativeTime(instance.discoveredAt)}
          </span>
          {/* CP-T080: Start / Stop lifecycle controls — aligned right in header */}
          <LifecycleControls instance={instance} onStatusChange={onLifecycleChange} />
          {/* CP-T090: Configure button — gear icon */}
          <button
            className={styles.runDoctorBtn}
            onClick={() => setShowConfigure(v => !v)}
            type="button"
            title="Configure instance settings"
            aria-pressed={showConfigure}
          >
            Configure
          </button>
          <button
            className={styles.runDoctorBtn}
            onClick={() => onRunDoctor(instance.instanceId)}
            type="button"
          >
            Run Doctor
          </button>
          <button
            className={styles.deleteBtn}
            onClick={() => setShowDeleteConfirm(true)}
            type="button"
          >
            Delete
          </button>
          {!isActive && (
            <button className={styles.setActiveBtn} onClick={handleSetActive} type="button">
              Set as Active
            </button>
          )}
        </div>
      </div>

      {/* CP-T029: Specific message for unreachable instances */}
      {(instance.runningStatus === 'unreachable' || instance.runningStatus === 'stopped' || instance.runtimeStatus === 'invalid') && (
        <div className={styles.errorBanner}>
          {(() => {
            const actionLabel = instance.runtimeStatus === 'invalid' ? 'Recover' : 'Start'
            return (
              <>
          <strong>{instance.runtimeStatus === 'invalid' ? 'Runtime metadata is invalid.' : 'Runtime is not reachable.'}</strong>{' '}
          Use <code className={styles.inlineCode}>{actionLabel}</code> above to let Control Plane recover or start the instance for you.
          {instance.runningStatusCheckedAt && (
            <span className={styles.errorBannerTime}>
              {' '}Last checked {formatRelativeTime(instance.runningStatusCheckedAt)}.
            </span>
          )}
              </>
            )
          })()}
        </div>
      )}

      {/* CP-T090: Configure panel — shown inline when gear button is active */}
      {showConfigure && (
        <div style={{ padding: 'var(--space-3) var(--section-padding)', borderBottom: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-base)' }}>
          <ConfigureInstancePanel
            key={instance.instanceId}
            instanceName={instance.name}
            currentPort={instance.configuredPort}
            currentProvider={instance.integration.defaultProvider}
            currentDbUrlRedacted={instance.database?.urlRedacted ?? null}
            onSuccess={() => { setShowConfigure(false); onRefetchInstances() }}
            onCancel={() => setShowConfigure(false)}
          />
        </div>
      )}

      {showDeleteConfirm && (
        <DeleteInstanceModal
          instance={instance}
          onDeleted={() => {
            setShowDeleteConfirm(false)
            void onRefetchInstances()
            void navigate('/instances')
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      <div className={styles.detailSections}>
        <section className={styles.detailSection}>
          <h3 className={styles.sectionTitle}>Do This Now</h3>
          <div className={styles.priorityGrid}>
            {getOperatorPriorities(instance).map((priority) => (
              <div
                key={priority.key}
                className={`${styles.priorityCard} ${
                  priority.tone === 'ready'
                    ? styles.priorityCardReady
                    : priority.tone === 'warning'
                      ? styles.priorityCardWarning
                      : styles.priorityCardCritical
                }`}
              >
                <div className={styles.priorityCardHeader}>
                  <span className={styles.priorityCardTitle}>{priority.title}</span>
                  <span className={styles.priorityCardState}>
                    {priority.tone === 'ready' ? 'Ready' : priority.tone === 'warning' ? 'Needs attention' : 'Blocking'}
                  </span>
                </div>
                <p className={styles.prioritySummary}>{priority.summary}</p>
                <p className={styles.priorityBody}>{priority.detail}</p>
                {priority.action && (
                  <button
                    className={styles.priorityActionBtn}
                    type="button"
                    disabled={priorityActionBusy}
                    onClick={() => void handlePriorityAction(priority.action)}
                  >
                    {priorityActionBusy && priority.action.type === 'start'
                      ? 'Starting...'
                      : priorityActionBusy && priority.action.type === 'recover'
                        ? 'Recovering...'
                        : priority.action.label}
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className={styles.workflowNote}>
            The order matters: runtime first, then project wiring, then client validation.
          </p>
        </section>
        <div id="runtime-section">
          <RuntimeSection instance={instance} onRefresh={onRefresh} isRefreshing={isRefreshing} />
        </div>
        <div id="database-section">
          <DatabaseSection instance={instance} />
        </div>
        <div id="environment-section">
          <EnvironmentSection instance={instance} />
        </div>
        <div id="integrations-section">
          <IntegrationsSection instance={instance} />
        </div>
        <div id="projects-section">
          <ProjectsSection
            instance={instance}
            instances={instances}
            onBindSuccess={onRefetchInstances}
          />
        </div>
        {/* CP-T093: Integration Overview — aggregated MCP/hooks status across all bound projects */}
        <section id="claude-overview-section" className={styles.detailSection}>
          <h3 className={styles.sectionTitle}>Claude Code Setup & Overview</h3>
          <IntegrationOverviewSection instanceName={instance.name} />
        </section>
        {/* CP-T095: Codex Integration Manager — instance-level Codex MCP registration */}
        <section id="codex-integration-section" className={styles.detailSection}>
          <h3 className={styles.sectionTitle}>Codex Integration</h3>
          <CodexIntegrationPanel />
        </section>
        {/* CP-T088: API Key Manager — registry-backed keys for this instance */}
        <section className={styles.detailSection}>
          <ApiKeyManager instances={instances} />
        </section>
        <UpgradeSection
          instanceName={instance.name}
          runningVersion={instance.runtime?.version ?? null}
          onUpgradeComplete={onUpgradeComplete}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function InstanceManager() {
  const { id: routeInstanceId } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const { settings } = useSettings()

  // CP-T029: Track whether a manual per-instance probe refresh is in flight
  const [isRefreshing, setIsRefreshing] = useState(false)

  // CP-T033: Doctor drawer state
  const [doctorDrawerData, setDoctorDrawerData] = useState<{ instanceId: string; data: DoctorResponse } | null>(null)
  const [doctorRunning, setDoctorRunning] = useState<string | null>(null)

  // CP-T089: Create Instance modal state
  const [showCreateForm, setShowCreateForm] = useState(false)

  // CP-T029: Time tick — forces re-render every 30s so relative timestamps and
  // staleness indicators stay current without a full API refetch
  const tick = useTimeTick(30_000)

  // CP-T079: Install state detection
  const [installState, setInstallState] = useState<InstallStateResult | null>(null)
  useEffect(() => {
    fetchInstallState()
      .then((result) => setInstallState(result))
      .catch(() => {
        // Non-fatal — leave installState null (bar hidden)
      })
  }, [])

  // Determine which instance is selected: route param takes priority
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null)

  // CP-T081: Version sync for the selected/active instance runtime.
  // This is intentionally separate from install-state, which reflects the global CLI on PATH.
  const { activeInstance } = useInstanceContext()
  const versionSyncInstanceId = routeInstanceId ?? localSelectedId ?? activeInstance?.id
  const { data: versionSync } = useQuery<VersionSyncResult, Error>({
    queryKey: ['version-sync', 'instances-page', versionSyncInstanceId ?? 'default'],
    queryFn: () => fetchVersionSync(versionSyncInstanceId),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  })

  const { data, isLoading, error, refetch } = useQuery<InstanceListResponse, Error>({
    queryKey: ['instances'],
    queryFn: () => apiFetch<InstanceListResponse>('/instances'),
    staleTime: 0, // Always re-fetch on mount since instance state can change
  })

  const instances = data?.instances ?? []

  const selectedId = routeInstanceId ?? localSelectedId ?? instances[0]?.instanceId ?? null
  const selectedInstance = instances.find(i => i.instanceId === selectedId) ?? null

  // CP-T029: Manual probe refresh — triggers a full refetch and shows spinner
  // Debounced: button is disabled while probe is in flight (no parallel probes)
  const handleProbeRefresh = async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await refetch()
    } finally {
      setIsRefreshing(false)
    }
  }

  // CP-T033: Run Doctor for a specific instance
  const handleRunDoctor = async (instanceId: string) => {
    if (doctorRunning) return
    setDoctorRunning(instanceId)
    try {
      const res = await fetch(
        `/api/control-plane/instances/${encodeURIComponent(instanceId)}/doctor`,
        { method: 'POST' }
      )
      const body = await res.json() as DoctorResponse
      if (!res.ok) {
        console.error('[doctor] failed', body)
        return
      }
      setDoctorDrawerData({ instanceId, data: body })
    } catch (err) {
      console.error('[doctor] unexpected error', err)
    } finally {
      setDoctorRunning(null)
    }
  }

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.stateShell}>
        <div className={styles.loadingState}>
          <Spinner size="md" label="Loading instances" />
            <span>Discovering instances...</span>
        </div>
        </div>
      </div>
    )
  }

  if (error) {
    const apiUnavailable =
      error.message.toLowerCase().includes('failed to fetch') ||
      error.message.toLowerCase().includes('networkerror')

    return (
      <div className={styles.page}>
        <div className={styles.stateShell}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>!</span>
          <p className={styles.errorTitle}>
            {apiUnavailable ? 'Control plane API unavailable' : 'Unable to load instances'}
          </p>
          <p className={styles.errorBody}>
            {apiUnavailable
              ? 'The browser cannot reach the control-plane backend. Instance discovery and start/stop controls are unavailable until the backend is running.'
              : error.message}
          </p>
          {apiUnavailable && (
            <div className={styles.commandHintBlock}>
              <p className={styles.commandHintLabel}>Start the control-plane backend:</p>
              <code className={styles.commandHint}>node src\server\dist\index.js</code>
              <CommandAction command="node src\\server\\dist\\index.js" allowRun={false} compact />
            </div>
          )}
          <button className={styles.retryBtn} onClick={() => void refetch()} type="button">
            Retry
          </button>
        </div>
        </div>
      </div>
    )
  }

  if (instances.length === 0) {
    const notInstalled = installState !== null && !installState.installed
    return (
      <div className={styles.page}>
        <div className={styles.stateShell}>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>[]</span>
          <p className={styles.emptyTitle}>No instances discovered</p>
          <p className={styles.emptyBody}>
            {notInstalled
              ? 'Iranti is not installed on this machine. Install it to create and manage instances.'
              : 'No instance folders were discovered under the known runtime roots. If an instance is configured but stopped, it should appear here with a Start action.'}
          </p>
          {notInstalled && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <p className={styles.emptyBody}>
                Install Iranti to create and manage instances.
              </p>
              <CommandAction command="npm install -g iranti" allowRun={false} compact />
            </div>
          )}
          {!notInstalled && (
            <p className={styles.emptyBody}>
              The control plane scans registered runtime roots and `instances/*` folders.
            </p>
          )}
          <button className={styles.retryBtn} onClick={() => void refetch()} type="button">
            Refresh
          </button>
        </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--color-bg-base)' }}>
      {/* CP-T079: Install state bar — spans full width above the two-column layout */}
      <InstallStateBar installState={installState} />

      {/* CP-T081: Upgrade promotion banner - shown only when installed version is behind npm latest */}
      {versionSync && versionSync.status === 'behind' && versionSync.latestVersion !== null && (
        <UpgradePromoBanner
          versionSync={versionSync}
          activeInstanceName={
            selectedInstance?.name ?? activeInstance?.name ?? instances[0]?.name ?? 'local'
          }
          onUpgradeComplete={() => void refetch()}
        />
      )}

      {/* Two-column layout */}
      <div className={styles.page} style={{ flex: 1, overflow: 'hidden' }}>
      {/* Left: instance list */}
      <div className={styles.instanceList}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>Instances</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            {/* CP-T089: Create Instance button */}
            <button
              className={styles.createInstanceBtn}
              type="button"
              onClick={() => setShowCreateForm(true)}
              title="Create a new Iranti instance"
              aria-label="Create instance"
            >
              +
            </button>
            <button
              className={styles.refreshBtn}
              onClick={() => void refetch()}
              type="button"
              aria-label="Refresh instance list"
              title="Refresh"
            >
              Refresh
            </button>
          </div>
        </div>
        {instances.map(inst => (
          <InstanceListItem
            key={inst.instanceId}
            instance={inst}
            selected={inst.instanceId === selectedId}
            onClick={() => {
              setLocalSelectedId(inst.instanceId)
              void navigate(`/instances/${encodeURIComponent(inst.instanceId)}`)
            }}
            _tick={tick}
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
          <DetailPanel
            instance={selectedInstance}
            instances={instances}
            onRefresh={() => void handleProbeRefresh()}
            isRefreshing={isRefreshing}
            onRunDoctor={instanceId => void handleRunDoctor(instanceId)}
            onUpgradeComplete={() => void refetch()}
            onLifecycleChange={() => void refetch()}
            onRefetchInstances={() => void refetch()}
          />
        ) : (
          <div className={styles.noSelection}>
            <span className={styles.noSelectionText}>Select an instance to view details</span>
          </div>
        )}
        {/* CP-T033: Doctor running indicator */}
        {doctorRunning && (
          <div className={styles.doctorRunning}>
            <Spinner size="sm" label="Running doctor" />
            <span>Running doctor checks...</span>
          </div>
        )}
      </div>

      {/* CP-T033: Doctor results drawer */}
      {doctorDrawerData && (
        <DoctorDrawer
          instanceId={doctorDrawerData.instanceId}
          data={doctorDrawerData.data}
          onClose={() => setDoctorDrawerData(null)}
        />
      )}
      </div>

      {/* CP-T089: Create Instance modal overlay */}
      {showCreateForm && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="Create instance">
          <div className={styles.createModalBox}>
            <CreateInstanceForm
              suggestedPort={suggestNextAvailablePort(data?.instances ?? [], settings.createInstanceDefaults.startPort)}
              instances={data?.instances ?? []}
              onSuccess={(newName) => {
                setShowCreateForm(false)
                void refetch().then((result) => {
                  // Select the newly created instance by name
                  const newInstance = result.data?.instances.find(i => i.name === newName)
                  if (newInstance) setLocalSelectedId(newInstance.instanceId)
                })
              }}
              onCancel={() => setShowCreateForm(false)}
            />
          </div>
        </div>
      )}

      {/* CP-T080 AC-6: session-based PID tracking disclaimer */}
      <div className={styles.lifecycleTrackingNote}>
        Process tracking is session-based — if the control plane restarts, use Start to reconnect to running instances.
      </div>
    </div>
  )
}


