/* Iranti Control Plane — Getting Started Screen */
/* Route: /getting-started */
/* CP-T035 — Guided first-run onboarding flow */

import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SetupStatusResponse, SetupStep } from '../../api/types'
import styles from './GettingStarted.module.css'
import { Spinner } from '../ui/Spinner'
import { useInstanceContext } from '../../hooks/useInstanceContext'
import { CommandAction } from '../ui/CommandAction'
import { canRunCommand } from '../ui/commandText'
import { migrateInstanceRoot } from '../../api/client'

/* ------------------------------------------------------------------ */
/*  API helpers                                                         */
/* ------------------------------------------------------------------ */

async function fetchSetupStatus(instanceId: string): Promise<SetupStatusResponse> {
  const res = await fetch(`/api/control-plane/instances/${encodeURIComponent(instanceId)}/setup-status`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<SetupStatusResponse>
}

async function markSetupComplete(instanceId: string): Promise<{ success: boolean; completedAt: string }> {
  const res = await fetch(
    `/api/control-plane/instances/${encodeURIComponent(instanceId)}/setup-status/complete`,
    { method: 'POST' }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<{ success: boolean; completedAt: string }>
}

async function refreshSetupStatus(instanceId: string): Promise<SetupStatusResponse> {
  const res = await fetch(
    `/api/control-plane/instances/${encodeURIComponent(instanceId)}/setup-status/refresh`,
    { method: 'POST' }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((body as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<SetupStatusResponse>
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                        */
/* ------------------------------------------------------------------ */

function StepStatusBadge({ status }: { status: SetupStep['status'] }) {
  const map: Record<SetupStep['status'], { label: string; className: string }> = {
    complete:       { label: 'Complete ✓',    className: styles.badgeComplete },
    incomplete:     { label: 'Incomplete',    className: styles.badgeIncomplete },
    warning:        { label: 'Warning',       className: styles.badgeWarning },
    not_applicable: { label: 'Not applicable', className: styles.badgeNA },
  }
  const { label, className } = map[status]
  return <span className={`${styles.stepBadge} ${className}`}>{label}</span>
}

/* ------------------------------------------------------------------ */
/*  Individual step row                                                 */
/* ------------------------------------------------------------------ */

interface StepRowProps {
  step: SetupStep
  stepNumber: number
  expanded: boolean
  onToggle: () => void
  onRepair: (repairAction: string) => void
  repairLoading: boolean
}

function repairActionLabel(repairAction: string): string {
  if (repairAction === 'control-plane:migrate-root') return 'Migrate to primary root'
  if (repairAction === 'control-plane:open-configure-db') return 'Repair database target'
  return 'Run repair'
}

function StepRow({ step, stepNumber, expanded, onToggle, onRepair, repairLoading }: StepRowProps) {
  const isActionable = step.status === 'incomplete' || step.status === 'warning'
  const isDone = step.status === 'complete'
  const cliCommand = step.cliCommand ?? null

  return (
    <div
      className={`${styles.stepRow} ${isDone ? styles.stepRowDone : ''} ${expanded ? styles.stepRowExpanded : ''}`}
    >
      <button
        className={styles.stepHeader}
        onClick={onToggle}
        type="button"
        aria-expanded={expanded}
      >
        <span className={`${styles.stepNumber} ${isDone ? styles.stepNumberDone : isActionable ? styles.stepNumberActive : styles.stepNumberNA}`}>
          {isDone ? '✓' : stepNumber}
        </span>
        <span className={styles.stepLabel}>{step.label}</span>
        <StepStatusBadge status={step.status} />
        <span className={styles.stepCaret} aria-hidden="true">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className={styles.stepBody}>
          <p className={styles.stepMessage}>{step.message}</p>

          {isActionable && step.actionRequired && (
            <div className={styles.stepAction}>
              <span className={styles.stepActionLabel}>Action required</span>
              <p className={styles.stepActionText}>{step.actionRequired}</p>
              {cliCommand && (
                <CommandAction
                  command={cliCommand}
                  allowRun={canRunCommand(cliCommand)}
                />
              )}
              {step.repairAction && (
                <button
                  className={styles.repairBtn}
                  type="button"
                  disabled={repairLoading}
                  onClick={() => onRepair(step.repairAction!)}
                >
                  {repairLoading ? 'Working…' : repairActionLabel(step.repairAction)}
                </button>
              )}
            </div>
          )}

          {step.status === 'not_applicable' && (
            <p className={styles.stepNA}>Complete the previous step first.</p>
          )}
        </div>
      )}
    </div>
  )
}

function runtimeRootKindLabel(kind: SetupStatusResponse['runtimeRootKind']): string | null {
  switch (kind) {
    case 'primary':
      return 'Primary runtime root'
    case 'legacy':
      return 'Legacy runtime root'
    case 'custom':
      return 'Custom runtime root'
    default:
      return null
  }
}

function databaseIntentLabel(intent: SetupStatusResponse['databaseIntent']): string | null {
  if (!intent) return null
  const strategy =
    intent.strategy === 'dedicated-local'
      ? 'Dedicated local database'
      : intent.strategy === 'shared-local'
        ? 'Shared local database'
        : 'External existing database'
  const provisioning =
    intent.provisioning === 'docker'
      ? 'Docker-managed'
      : intent.provisioning === 'managed'
        ? 'Managed'
        : 'Local'
  return `${strategy} (${provisioning})`
}

/* ------------------------------------------------------------------ */
/*  Success state                                                       */
/* ------------------------------------------------------------------ */

function SuccessState({ onGoToMemory }: { onGoToMemory: () => void }) {
  return (
    <div className={styles.successState}>
      <span className={styles.successIcon} aria-hidden="true">✓</span>
      <h2 className={styles.successTitle}>Iranti is ready</h2>
      <p className={styles.successBody}>All setup steps are complete. Your Iranti instance is fully configured.</p>
      <button
        className={styles.primaryBtn}
        onClick={onGoToMemory}
        type="button"
      >
        Go to Memory Explorer →
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function GettingStarted() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeInstance } = useInstanceContext()
  const [dismissed, setDismissed] = useState(false)
  const instanceId = activeInstance?.id ?? activeInstance?.name ?? 'local'

  const { data, isLoading, error } = useQuery<SetupStatusResponse, Error>({
    queryKey: ['setup-status', instanceId],
    queryFn: () => fetchSetupStatus(instanceId),
    staleTime: 0,
  })

  // Track which step is expanded — default to first incomplete
  const firstIncompleteIndex = data?.steps.findIndex(
    s => s.status === 'incomplete' || s.status === 'warning'
  ) ?? -1

  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  // Resolve effective expanded index — local state takes priority, fallback to first incomplete
  const effectiveExpanded = expandedIndex !== null ? expandedIndex : firstIncompleteIndex

  const handleToggle = (idx: number) => {
    setExpandedIndex(prev => (prev === idx ? null : idx))
  }

  // Refresh all — re-runs setup status from server (POST refresh endpoint)
  const [refreshing, setRefreshing] = useState(false)
  const [repairError, setRepairError] = useState<string | null>(null)
  const [repairLoadingAction, setRepairLoadingAction] = useState<string | null>(null)
  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true)
    try {
      const fresh = await refreshSetupStatus(instanceId)
      queryClient.setQueryData(['setup-status', instanceId], fresh)
    } finally {
      setRefreshing(false)
    }
  }, [instanceId, queryClient])

  const handleRepairAction = useCallback(async (repairAction: string) => {
    setRepairError(null)
    setRepairLoadingAction(repairAction)
    try {
      if (repairAction === 'control-plane:open-configure-db') {
        const targetId = data?.scope?.instanceId ?? instanceId
        navigate(`/instances/${encodeURIComponent(targetId)}?configure=1&focus=database`)
        return
      }

      if (repairAction === 'control-plane:migrate-root') {
        const instanceName = data?.scope?.instanceName ?? activeInstance?.name ?? null
        if (!instanceName) throw new Error('Instance name unavailable for migration.')
        const result = await migrateInstanceRoot(instanceName)
        await queryClient.invalidateQueries({ queryKey: ['instances'] })
        navigate(`/instances/${encodeURIComponent(result.instanceId)}`)
        return
      }

      if (repairAction.startsWith('/api/control-plane/')) {
        const res = await fetch(`${repairAction}?confirm=true`, { method: 'POST' })
        const body = await res.json().catch(() => ({ error: res.statusText }))
        if (!res.ok) {
          throw new Error((body as { error?: string }).error ?? res.statusText)
        }
        const fresh = await refreshSetupStatus(instanceId)
        queryClient.setQueryData(['setup-status', instanceId], fresh)
        return
      }

      throw new Error(`Unknown repair action: ${repairAction}`)
    } catch (error) {
      setRepairError(error instanceof Error ? error.message : String(error))
    } finally {
      setRepairLoadingAction(null)
    }
  }, [activeInstance?.name, data?.scope?.instanceId, data?.scope?.instanceName, instanceId, navigate, queryClient])

  // Mark complete mutation
  const completeMutation = useMutation({
    mutationFn: () => markSetupComplete(instanceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      navigate('/memory')
    },
  })

  if (!dismissed && isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingCenter}>
          <Spinner size="md" label="Checking setup status" />
          <span className={styles.loadingLabel}>Checking setup status…</span>
        </div>
      </div>
    )
  }

  if (!dismissed && error) {
    return (
      <div className={styles.page}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon} aria-hidden="true">⚠</span>
          <h2 className={styles.errorTitle}>Could not load setup status</h2>
          <p className={styles.errorBody}>{error.message}</p>
          <button
            className={styles.secondaryBtn}
            onClick={() => void handleRefreshAll()}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const steps = data?.steps ?? []
  const allComplete = data?.isFullyConfigured ?? false
  const incompleteCount = steps.filter(s => s.status === 'incomplete').length

  if (allComplete) {
    return (
      <div className={styles.page}>
        <SuccessState onGoToMemory={() => navigate('/memory')} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Getting Started</h1>
          <p className={styles.subtitle}>
            Complete these steps to set up your Iranti instance.
            {data?.scope ? ` Current scope: ${data.scope.instanceName}.` : ''}
            {incompleteCount > 0 && (
              <span className={styles.incompleteCount}> {incompleteCount} step{incompleteCount !== 1 ? 's' : ''} remaining.</span>
            )}
          </p>
        </div>
        <button
          className={`${styles.secondaryBtn} ${refreshing ? styles.btnSpinning : ''}`}
          onClick={() => void handleRefreshAll()}
          disabled={refreshing}
          type="button"
          aria-label="Refresh all setup checks"
        >
          {refreshing ? '↺ Refreshing…' : '↺ Refresh all'}
        </button>
      </div>

      {data?.runtimeRoot && (
        <div className={styles.scopeNote}>
          <div className={styles.scopeNoteHeader}>
            <span className={styles.scopeNoteTitle}>Instance storage</span>
            {runtimeRootKindLabel(data.runtimeRootKind) && (
              <span
                className={`${styles.scopeNoteBadge} ${
                  data.runtimeRootKind === 'legacy'
                    ? styles.scopeNoteBadgeLegacy
                    : data.runtimeRootKind === 'custom'
                      ? styles.scopeNoteBadgeCustom
                      : styles.scopeNoteBadgePrimary
                }`}
              >
                {runtimeRootKindLabel(data.runtimeRootKind)}
              </span>
            )}
          </div>
          <p className={styles.scopeNoteBody}>
            This instance is currently stored under <code className={styles.inlineCode}>{data.runtimeRoot}</code>.
            {data.runtimeRootKind === 'legacy' && (
              <> Newer Iranti instances usually live under <code className={styles.inlineCode}>~/.iranti-runtime</code>, so Control Plane may show both locations until older instances are migrated.</>
            )}
          </p>
          {databaseIntentLabel(data.databaseIntent) && (
            <p className={styles.scopeNoteBody}>
              Database strategy: <code className={styles.inlineCode}>{databaseIntentLabel(data.databaseIntent)}</code>.
            </p>
          )}
        </div>
      )}

      {/* Step list */}
      <div className={styles.stepList} role="list" aria-label="Setup steps">
        {steps.map((step, idx) => (
          <div key={step.id} role="listitem">
            <StepRow
              step={step}
              stepNumber={idx + 1}
              expanded={effectiveExpanded === idx}
              onToggle={() => handleToggle(idx)}
              onRepair={handleRepairAction}
              repairLoading={repairLoadingAction === step.repairAction}
            />
          </div>
        ))}
      </div>

      {/* Footer actions */}
      <div className={styles.footer}>
        <button
          className={styles.primaryBtn}
          onClick={() => completeMutation.mutate()}
          disabled={completeMutation.isPending}
          type="button"
          aria-busy={completeMutation.isPending}
        >
          {completeMutation.isPending ? 'Saving…' : 'Mark setup complete'}
        </button>

        {completeMutation.isError && (
          <p className={styles.footerError}>{completeMutation.error.message}</p>
        )}

        {repairError && (
          <p className={styles.footerError}>{repairError}</p>
        )}

        <button
          className={styles.skipLink}
          onClick={() => setDismissed(true)}
          type="button"
        >
          Skip for now
        </button>

        <p className={styles.footerNote}>
          Skipping will not mark setup complete — this screen reappears on next load until dismissed.
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Exported hook for shell integration                                 */
/* ------------------------------------------------------------------ */

/**
 * Returns the number of incomplete setup steps for badge display.
 * Used by AppShell nav badge and header banner.
 */
export function useSetupStatus() {
  const { activeInstance } = useInstanceContext()
  const instanceId = activeInstance?.id ?? activeInstance?.name ?? 'local'
  const { data, isLoading } = useQuery<SetupStatusResponse, Error>({
    queryKey: ['setup-status', instanceId],
    queryFn: () => fetchSetupStatus(instanceId),
    staleTime: 60_000,
  })

  const incompleteCount = data?.steps.filter(
    s => s.status === 'incomplete'
  ).length ?? 0

  return {
    incompleteCount,
    firstRunDetected: data?.firstRunDetected ?? false,
    isFullyConfigured: data?.isFullyConfigured ?? false,
    isLoading,
  }
}
