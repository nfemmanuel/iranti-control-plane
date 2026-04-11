/**
 * CommandAction.tsx — Inline command runner widget.
 *
 * Renders a shell command as a code snippet with a copy or run button,
 * depending on the `commandRunnerMode` setting (copy_and_run | copy_only).
 * Used throughout the UI wherever remediation commands are surfaced.
 */

import { useMemo, useRef, useState } from 'react'
import { runCommand } from '../../api/client'
import type { RunCommandResult } from '../../api/types'
import { useSettings } from '../../hooks/useSettings'
import styles from './CommandAction.module.css'

interface CommandActionProps {
  command: string
  cwd?: string | null
  allowRun?: boolean
  compact?: boolean
  onAfterRun?: (result: RunCommandResult) => void
}

function trimOutput(value: string): string {
  return value.trim()
}

export function CommandAction({
  command,
  cwd,
  allowRun = true,
  compact = false,
  onAfterRun,
}: CommandActionProps) {
  const { settings } = useSettings()
  const [copied, setCopied] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunCommandResult | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canExecute = allowRun && settings.commandRunnerMode === 'copy_and_run'

  const hasOutput = useMemo(() => {
    if (!result) return false
    return trimOutput(result.stdout) !== '' || trimOutput(result.stderr) !== ''
  }, [result])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command)
    setCopied(true)
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
  }

  const handleRun = async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      const nextResult = await runCommand({
        command,
        ...(cwd ? { cwd } : {}),
      })
      setResult(nextResult)
      onAfterRun?.(nextResult)
    } catch (err) {
      setResult(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={`${styles.commandCard} ${compact ? styles.commandCardCompact : ''}`}>
      <code className={styles.commandText}>{command}</code>
      <div className={styles.commandActions}>
        <button className={styles.commandBtn} type="button" onClick={() => void handleCopy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {canExecute && (
          <button className={styles.commandBtnPrimary} type="button" onClick={() => void handleRun()} disabled={running}>
            {running ? 'Running...' : 'Run'}
          </button>
        )}
      </div>

      {cwd && <div className={styles.cwdLabel}>Run in: <code>{cwd}</code></div>}

      {error && (
        <div className={styles.commandError} role="alert">
          {error}
        </div>
      )}

      {result && (
        <div className={`${styles.commandResult} ${result.ok ? styles.commandResultOk : styles.commandResultError}`}>
          <div className={styles.commandResultHeader}>
            <strong>{result.ok ? 'Command succeeded' : 'Command failed'}</strong>
            <span>
              exit {result.exitCode ?? 'unknown'} - {result.durationMs}ms
            </span>
          </div>
          {hasOutput && (
            <pre className={styles.commandOutput}>
              {trimOutput(result.stdout) && `stdout:\n${trimOutput(result.stdout)}`}
              {trimOutput(result.stdout) && trimOutput(result.stderr) ? '\n\n' : ''}
              {trimOutput(result.stderr) && `stderr:\n${trimOutput(result.stderr)}`}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
