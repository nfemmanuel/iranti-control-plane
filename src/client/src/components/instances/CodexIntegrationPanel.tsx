/**
 * CodexIntegrationPanel — CP-T095
 *
 * Instance-level panel showing Codex CLI integration status:
 * - Codex detected on PATH
 * - Iranti MCP server registration in ~/.codex/config.json or mcp.json
 * - Diagnostic issues with actionable descriptions
 * - "Register with Codex" action (runs `iranti codex-setup`)
 * - "Remove Registration" action (runs uninstall or direct config edit)
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchCodexIntegration,
  setupCodexIntegration,
  removeCodexIntegration,
} from '../../api/client'
import type { CodexIntegrationStatus } from '../../api/types'
import styles from './CodexIntegrationPanel.module.css'

/* ------------------------------------------------------------------ */
/*  Small helpers                                                       */
/* ------------------------------------------------------------------ */

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return ok
    ? <span className={styles.chipOk}>&#10003; {label}</span>
    : <span className={styles.chipWarn}>&#10007; {label}</span>
}

/* ------------------------------------------------------------------ */
/*  CodexIntegrationPanel                                               */
/* ------------------------------------------------------------------ */

const QUERY_KEY = ['codex-integration'] as const

export function CodexIntegrationPanel() {
  const queryClient = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery<CodexIntegrationStatus, Error>({
    queryKey: QUERY_KEY,
    queryFn: fetchCodexIntegration,
    staleTime: 30_000,
  })

  const [actionInFlight, setActionInFlight] = useState<'setup' | 'remove' | null>(null)
  const [actionResult, setActionResult] = useState<
    { ok: boolean; output?: string; error?: string } | null
  >(null)

  async function doSetup() {
    setActionInFlight('setup')
    setActionResult(null)
    try {
      const result = await setupCodexIntegration()
      setActionResult(result)
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
        void refetch()
      }
    } catch (err) {
      setActionResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setActionInFlight(null)
    }
  }

  async function doRemove() {
    setActionInFlight('remove')
    setActionResult(null)
    try {
      const result = await removeCodexIntegration()
      setActionResult({ ok: result.ok, output: result.output, error: result.error })
      if (result.ok) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
        void refetch()
      }
    } catch (err) {
      setActionResult({ ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setActionInFlight(null)
    }
  }

  const busy = actionInFlight !== null

  return (
    <div className={styles.panel}>
      {/* Loading */}
      {isLoading && (
        <div className={styles.loadingRow}>
          <span className={styles.spinnerSmall} aria-hidden="true" /> Checking Codex integration…
        </div>
      )}

      {/* Error fetching status */}
      {error && !isLoading && (
        <div className={styles.errorRow}>
          Could not load Codex integration status: {error.message}
        </div>
      )}

      {/* Content */}
      {data && !isLoading && (
        <>
          {/* Detection Section */}
          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>Detection</h4>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Codex CLI</span>
              <span className={styles.fieldValue}>
                <StatusChip ok={data.codexInstalled} label={data.codexInstalled ? 'Found on PATH' : 'Not found'} />
              </span>
            </div>

            {data.codexInstalled && (
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>Iranti registered</span>
                <span className={styles.fieldValue}>
                  <StatusChip
                    ok={data.irantiRegistered}
                    label={data.irantiRegistered ? 'Registered' : 'Not registered'}
                  />
                </span>
              </div>
            )}
          </div>

          {/* Registered config detail */}
          {data.irantiRegistered && data.registeredConfig && (
            <div className={styles.subSection}>
              <h4 className={styles.subTitle}>Registered Config</h4>
              <details className={styles.rawDetails}>
                <summary>Show iranti MCP entry</summary>
                <pre className={styles.rawJson}>
                  {JSON.stringify(data.registeredConfig, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {/* Issues */}
          {data.issues.length > 0 && (
            <div className={styles.subSection}>
              <h4 className={styles.subTitle}>Issues ({data.issues.length})</h4>
              <div className={styles.issuesList}>
                {data.issues.map((issue, i) => (
                  <div key={i} className={styles.issueRow}>
                    <span className={styles.issueIcon}>&#9888;</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action result banner */}
          {actionResult && (
            <div className={actionResult.ok ? styles.successBanner : styles.errorBanner}>
              {actionResult.ok
                ? actionResult.output
                  ? actionResult.output
                  : 'Operation completed successfully.'
                : `Operation failed: ${actionResult.error ?? 'Unknown error'}`
              }
            </div>
          )}

          {/* Actions */}
          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>Actions</h4>
            <div className={styles.actionRow}>
              {/* Always show Register button unless already cleanly registered */}
              {(!data.irantiRegistered || data.issues.length > 0) && (
                <button
                  className={styles.actionBtn}
                  type="button"
                  disabled={busy || !data.codexInstalled}
                  onClick={() => void doSetup()}
                  title={!data.codexInstalled ? 'Install Codex first' : undefined}
                >
                  {actionInFlight === 'setup' && (
                    <span className={styles.spinnerSmall} aria-hidden="true" />
                  )}
                  {actionInFlight === 'setup' ? 'Registering…' : 'Register with Codex'}
                </button>
              )}

              {/* Remove only shown when registered */}
              {data.irantiRegistered && (
                <button
                  className={styles.removeBtn}
                  type="button"
                  disabled={busy}
                  onClick={() => void doRemove()}
                >
                  {actionInFlight === 'remove' && (
                    <span className={styles.spinnerSmall} aria-hidden="true" />
                  )}
                  {actionInFlight === 'remove' ? 'Removing…' : 'Remove Registration'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
