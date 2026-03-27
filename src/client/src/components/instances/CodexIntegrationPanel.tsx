/**
 * CodexIntegrationPanel - CP-T095
 *
 * Instance-level panel showing Codex CLI integration status:
 * - Codex detected on PATH
 * - Iranti MCP server registration in Codex global config (config.toml)
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

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return ok
    ? <span className={styles.chipOk}>OK {label}</span>
    : <span className={styles.chipWarn}>Needs setup {label}</span>
}

function getNextAction(data: CodexIntegrationStatus): string {
  if (!data.codexInstalled) {
    return 'Install Codex first. Until the CLI is available, the control plane cannot register Iranti for Codex sessions.'
  }
  if (!data.irantiRegistered) {
    return 'Register Iranti with Codex. That enables exact query, attend, and shared-memory lookups in new Codex sessions.'
  }
  if (data.issues.length > 0) {
    return 'Codex is partially wired. Re-run registration, then reopen the Codex session so it reloads the MCP tool surface.'
  }
  return 'Codex is ready for shared-memory work. Open a fresh session and verify exact lookup or recall before you trust the session.'
}

function getCapabilities(data: CodexIntegrationStatus): Array<{ title: string; state: string; detail: string; ok: boolean }> {
  const cliReady = data.codexInstalled
  const registrationReady = data.codexInstalled && data.irantiRegistered

  return [
    {
      title: 'Codex CLI availability',
      state: cliReady ? 'Ready' : 'Missing',
      detail: cliReady
        ? 'The control plane can inspect or update Codex registration from this machine.'
        : 'Codex is not on PATH yet, so setup and diagnostics stop before MCP registration.',
      ok: cliReady,
    },
    {
      title: 'Iranti MCP registration',
      state: registrationReady ? 'Registered' : 'Not registered',
      detail: registrationReady
        ? 'Codex can discover the Iranti MCP server from its global configuration.'
        : 'Codex sessions will not expose Iranti tools until registration is repaired.',
      ok: registrationReady,
    },
    {
      title: 'Can Codex use Iranti?',
      state: registrationReady ? 'Available' : 'Blocked',
      detail: registrationReady
        ? 'Exact query, attend, and search calls should be available in fresh Codex sessions.'
        : 'Memory lookup remains unavailable because the Codex-to-Iranti bridge is not fully wired.',
      ok: registrationReady,
    },
  ]
}

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
      {isLoading && (
        <div className={styles.loadingRow}>
          <span className={styles.spinnerSmall} aria-hidden="true" /> Checking Codex integration...
        </div>
      )}

      {error && !isLoading && (
        <div className={styles.errorRow}>
          Could not load Codex integration status: {error.message}
        </div>
      )}

      {data && !isLoading && (
        <>
          <div className={styles.capabilitySection}>
            <div className={styles.capabilityHeader}>
              <h4 className={styles.subTitle}>What Works Here</h4>
              <span className={styles.capabilityMeta}>
                {data.codexInstalled && data.irantiRegistered && data.issues.length === 0 ? 'Codex ready' : 'Needs operator attention'}
              </span>
            </div>
            <div className={styles.capabilityGrid}>
              {getCapabilities(data).map((capability) => (
                <div key={capability.title} className={styles.capabilityCard}>
                  <div className={styles.capabilityCardHeader}>
                    <span className={styles.capabilityTitle}>{capability.title}</span>
                    <span className={capability.ok ? styles.capabilityStateOk : styles.capabilityStateWarn}>
                      {capability.state}
                    </span>
                  </div>
                  <p className={styles.capabilityBody}>{capability.detail}</p>
                </div>
              ))}
            </div>
            <div className={styles.nextActionRow}>
              <span className={styles.nextActionLabel}>Next action</span>
              <p className={styles.nextActionBody}>{getNextAction(data)}</p>
            </div>
          </div>

          {data.issues.length > 0 && (
            <div className={styles.subSection}>
              <h4 className={styles.subTitle}>Operator Issues ({data.issues.length})</h4>
              <div className={styles.issuesList}>
                {data.issues.map((issue, i) => (
                  <div key={i} className={styles.issueRow}>
                    <span className={styles.issueIcon}>!</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>Repair / Setup</h4>
            <div className={styles.actionRow}>
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
                  {actionInFlight === 'setup' ? 'Registering...' : 'Register with Codex'}
                </button>
              )}

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
                  {actionInFlight === 'remove' ? 'Removing...' : 'Remove Registration'}
                </button>
              )}
            </div>
            <p className={styles.actionHint}>
              Registration updates Codex global config for fresh sessions. If a session is already open, reopen it after repairing setup so the MCP surface reloads.
            </p>
          </div>

          <details className={styles.advancedDetails}>
            <summary>Advanced details</summary>
            <div className={styles.advancedDetailsBody}>
              <div className={styles.subSection}>
                <h4 className={styles.subTitle}>CLI and registration status</h4>

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

              {data.irantiRegistered && data.registeredConfig && (
                <div className={styles.subSection}>
                  <h4 className={styles.subTitle}>Current registration</h4>
                  <details className={styles.rawDetails}>
                    <summary>Show iranti MCP entry</summary>
                    <pre className={styles.rawJson}>
                      {JSON.stringify(data.registeredConfig, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  )
}
