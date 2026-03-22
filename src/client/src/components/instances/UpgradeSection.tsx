/* Iranti Control Plane — UpgradeSection */
/* CP-T073: Upgrade coordination UI — triggers iranti upgrade --restart --instance <name> */

import { useState, useRef, useEffect } from 'react'
import type { UpgradeJobStarted, UpgradeJobStatus } from '../../api/types'
import styles from './UpgradeSection.module.css'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface UpgradeSectionProps {
  instanceName: string      // the instance's name/id (used in API path)
  runningVersion: string | null  // from runtime.version — show in UI
  onUpgradeComplete: () => void  // called when upgrade succeeds — triggers refetch
}

type UpgradePhase =
  | { phase: 'idle' }
  | { phase: 'confirming' }
  | { phase: 'upgrading'; jobId: string }
  | { phase: 'complete' }
  | { phase: 'failed'; exitCode: number | null; outputTail: string[] }
  | { phase: 'error'; message: string }

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function UpgradeSection({ instanceName, runningVersion, onUpgradeComplete }: UpgradeSectionProps) {
  const [state, setState] = useState<UpgradePhase>({ phase: 'idle' })
  const [jobStatus, setJobStatus] = useState<UpgradeJobStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const startPolling = (jobId: string, name: string) => {
    stopPolling()
    pollRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/control-plane/instances/${encodeURIComponent(name)}/upgrade/${encodeURIComponent(jobId)}`
          )
          if (!res.ok) {
            stopPolling()
            setState({ phase: 'error', message: 'Could not check upgrade status — connection issue.' })
            return
          }
          const status = await res.json() as UpgradeJobStatus
          setJobStatus(status)
          if (status.status === 'complete' || status.status === 'failed') {
            stopPolling()
            if (status.status === 'complete') {
              setState({ phase: 'complete' })
              onUpgradeComplete()
            } else {
              setState({
                phase: 'failed',
                exitCode: status.exitCode,
                outputTail: status.output.slice(-10),
              })
            }
          }
        } catch {
          stopPolling()
          setState({ phase: 'error', message: 'Could not check upgrade status — connection issue.' })
        }
      })()
    }, 2000)
  }

  const handleUpgradeClick = async () => {
    setState({ phase: 'upgrading', jobId: '' })
    setJobStatus(null)
    try {
      const res = await fetch(
        `/api/control-plane/instances/${encodeURIComponent(instanceName)}/upgrade`,
        { method: 'POST' }
      )
      const body = await res.json() as UpgradeJobStarted & { error?: string; code?: string }

      if (!res.ok) {
        const code = body.code
        if (code === 'CLI_NOT_FOUND') {
          setState({
            phase: 'error',
            message: `iranti CLI not found on PATH. Run \`iranti upgrade --restart --instance ${instanceName}\` manually.`,
          })
        } else if (code === 'INVALID_PARAM') {
          setState({ phase: 'error', message: 'Invalid instance name.' })
        } else {
          setState({ phase: 'error', message: body.error ?? 'Failed to start upgrade.' })
        }
        return
      }

      setState({ phase: 'upgrading', jobId: body.jobId })
      startPolling(body.jobId, instanceName)
    } catch {
      setState({ phase: 'error', message: 'Could not reach the control plane API. Try again.' })
    }
  }

  const resetToIdle = () => {
    stopPolling()
    setJobStatus(null)
    setState({ phase: 'idle' })
  }

  /* ----------------------------------------------------------------
     Render
     ---------------------------------------------------------------- */

  return (
    <section className={styles.upgradeSection}>
      <h3 className={styles.upgradeSectionTitle}>Upgrade</h3>

      {/* Version line — always visible */}
      {runningVersion && (
        <div className={styles.versionDisplay}>
          Running: <span className={styles.versionValue}>v{runningVersion}</span>
        </div>
      )}

      {/* ── Idle ── */}
      {state.phase === 'idle' && (
        <>
          <div className={styles.upgradeControls}>
            <button
              className={styles.upgradeBtn}
              type="button"
              onClick={() => setState({ phase: 'confirming' })}
            >
              Upgrade &amp; Restart
            </button>
          </div>
          <p className={styles.upgradeWarning}>
            <span className={styles.warningIcon}>⚠</span>
            Upgrading will restart this instance. Active agents will experience a brief interruption.
          </p>
        </>
      )}

      {/* ── Confirming ── */}
      {state.phase === 'confirming' && (
        <div className={styles.confirmBlock}>
          <p className={styles.confirmTitle}>
            Upgrade and restart <code className={styles.confirmCode}>{instanceName}</code>?
          </p>
          <p className={styles.confirmDetail}>
            This will run{' '}
            <code className={styles.confirmCode}>
              iranti upgrade --restart --instance {instanceName}
            </code>
            . The instance will restart. Active agents will experience a brief interruption.
            This may take up to 60 seconds.
          </p>
          <div className={styles.confirmButtons}>
            <button
              className={styles.cancelBtn}
              type="button"
              onClick={resetToIdle}
            >
              Cancel
            </button>
            <button
              className={styles.upgradeBtn}
              type="button"
              onClick={() => void handleUpgradeClick()}
            >
              Upgrade
            </button>
          </div>
        </div>
      )}

      {/* ── Upgrading ── */}
      {state.phase === 'upgrading' && (
        <div className={styles.upgradingBlock}>
          <div className={styles.upgradingHeader}>
            <span className={styles.spinnerSmall} aria-hidden="true" />
            <span className={styles.upgradingLabel}>Upgrading…</span>
          </div>
          {jobStatus && jobStatus.output.length > 0 && (
            <div className={styles.outputBlock} aria-label="Upgrade output">
              {jobStatus.output.slice(-20).map((line, i) => (
                <div key={i} className={styles.outputLine}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Complete ── */}
      {state.phase === 'complete' && (
        <div className={styles.completeBlock}>
          <div className={styles.statusRow}>
            <span className={`${styles.statusIcon} ${styles.statusIconSuccess}`} aria-label="Success">✓</span>
            <span className={styles.completeMessage}>
              Upgrade complete. The instance has restarted.
            </span>
          </div>
          <button
            className={styles.doneBtn}
            type="button"
            onClick={resetToIdle}
          >
            Done
          </button>
        </div>
      )}

      {/* ── Failed ── */}
      {state.phase === 'failed' && (
        <div className={styles.failedBlock}>
          <div className={styles.statusRow}>
            <span className={`${styles.statusIcon} ${styles.statusIconFailure}`} aria-label="Failed">✗</span>
            <span className={styles.failedMessage}>
              Upgrade failed{state.exitCode !== null ? ` (exit code: ${state.exitCode})` : ''}.
            </span>
          </div>
          {state.outputTail.length > 0 && (
            <div className={styles.outputBlock} aria-label="Upgrade output">
              {state.outputTail.map((line, i) => (
                <div key={i} className={styles.outputLine}>{line}</div>
              ))}
            </div>
          )}
          <button
            className={styles.retryBtn}
            type="button"
            onClick={resetToIdle}
          >
            Try again
          </button>
        </div>
      )}

      {/* ── Error (API / network error) ── */}
      {state.phase === 'error' && (
        <div className={styles.failedBlock}>
          <div className={styles.statusRow}>
            <span className={`${styles.statusIcon} ${styles.statusIconFailure}`} aria-label="Error">✗</span>
            <span className={styles.failedMessage}>{state.message}</span>
          </div>
          <button
            className={styles.retryBtn}
            type="button"
            onClick={resetToIdle}
          >
            Try again
          </button>
        </div>
      )}
    </section>
  )
}
