/* Iranti Control Plane - UpgradeSection */
/* CP-T073: Upgrade coordination UI - triggers iranti upgrade --yes --restart --instance <name> */

import { useState, useRef, useEffect } from 'react'
import type { UpgradeJobStarted, UpgradeJobStatus } from '../../api/types'
import styles from './UpgradeSection.module.css'

interface UpgradeSectionProps {
  instanceName: string
  runningVersion: string | null
  onUpgradeComplete: () => void
}

type UpgradePhase =
  | { phase: 'idle' }
  | { phase: 'confirming' }
  | { phase: 'upgrading'; jobId: string }
  | { phase: 'complete' }
  | { phase: 'failed'; exitCode: number | null; outputTail: string[] }
  | { phase: 'error'; message: string }

async function parseJsonResponse<T>(res: Response): Promise<T & { error?: string; code?: string }> {
  const raw = await res.text()
  if (!raw.trim()) return {} as T & { error?: string; code?: string }
  try {
    return JSON.parse(raw) as T & { error?: string; code?: string }
  } catch {
    return { error: raw.trim() } as T & { error?: string; code?: string }
  }
}

export function UpgradeSection({ instanceName, runningVersion, onUpgradeComplete }: UpgradeSectionProps) {
  const [state, setState] = useState<UpgradePhase>({ phase: 'idle' })
  const [jobStatus, setJobStatus] = useState<UpgradeJobStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
          const status = await parseJsonResponse<UpgradeJobStatus>(res)
          if (!res.ok) {
            stopPolling()
            setState({
              phase: 'error',
              message: status.error ?? `Could not check upgrade status (HTTP ${res.status}).`,
            })
            return
          }
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
          setState({ phase: 'error', message: 'Could not check upgrade status - connection issue.' })
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
      const body = await parseJsonResponse<UpgradeJobStarted>(res)

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
          setState({ phase: 'error', message: body.error ?? `Failed to start upgrade (HTTP ${res.status}).` })
        }
        return
      }

      if (!body.jobId) {
        setState({ phase: 'error', message: 'Upgrade route returned no job id.' })
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

  return (
    <section className={styles.upgradeSection}>
      <h3 className={styles.upgradeSectionTitle}>Upgrade</h3>

      {runningVersion && (
        <div className={styles.versionDisplay}>
          Running: <span className={styles.versionValue}>v{runningVersion}</span>
        </div>
      )}

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
            <span className={styles.warningIcon}>!</span>
            Upgrading will restart this instance. Active agents will experience a brief interruption.
          </p>
        </>
      )}

      {state.phase === 'confirming' && (
        <div className={styles.confirmBlock}>
          <p className={styles.confirmTitle}>
            Upgrade and restart <code className={styles.confirmCode}>{instanceName}</code>?
          </p>
          <p className={styles.confirmDetail}>
            This will run{' '}
            <code className={styles.confirmCode}>
              iranti upgrade --yes --restart --instance {instanceName}
            </code>
            . The instance will restart. Active agents will experience a brief interruption.
            This may take up to 60 seconds.
          </p>
          <div className={styles.confirmButtons}>
            <button className={styles.cancelBtn} type="button" onClick={resetToIdle}>
              Cancel
            </button>
            <button className={styles.upgradeBtn} type="button" onClick={() => void handleUpgradeClick()}>
              Upgrade
            </button>
          </div>
        </div>
      )}

      {state.phase === 'upgrading' && (
        <div className={styles.upgradingBlock}>
          <div className={styles.upgradingHeader}>
            <span className={styles.spinnerSmall} aria-hidden="true" />
            <span className={styles.upgradingLabel}>Upgrading...</span>
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

      {state.phase === 'complete' && (
        <div className={styles.completeBlock}>
          <div className={styles.statusRow}>
            <span className={`${styles.statusIcon} ${styles.statusIconSuccess}`} aria-label="Success">OK</span>
            <span className={styles.completeMessage}>
              Upgrade complete. The instance has restarted.
            </span>
          </div>
          <button className={styles.doneBtn} type="button" onClick={resetToIdle}>
            Done
          </button>
        </div>
      )}

      {state.phase === 'failed' && (
        <div className={styles.failedBlock}>
          <div className={styles.statusRow}>
            <span className={`${styles.statusIcon} ${styles.statusIconFailure}`} aria-label="Failed">X</span>
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
          <button className={styles.retryBtn} type="button" onClick={resetToIdle}>
            Try again
          </button>
        </div>
      )}

      {state.phase === 'error' && (
        <div className={styles.failedBlock}>
          <div className={styles.statusRow}>
            <span className={`${styles.statusIcon} ${styles.statusIconFailure}`} aria-label="Error">X</span>
            <span className={styles.failedMessage}>{state.message}</span>
          </div>
          <button className={styles.retryBtn} type="button" onClick={resetToIdle}>
            Try again
          </button>
        </div>
      )}
    </section>
  )
}
