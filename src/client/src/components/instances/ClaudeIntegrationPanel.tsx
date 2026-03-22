/**
 * ClaudeIntegrationPanel — CP-T092 + CP-T093
 *
 * Per-project panel showing Claude Code integration status:
 * - MCP server registration (.mcp.json)
 * - Claude hooks (.claude/settings.local.json)
 * - Diagnostic issues with actionable descriptions
 * - Scaffold action that writes missing files
 * - Raw JSON view of each config file
 *
 * Also exports IntegrationOverviewSection (CP-T093) which renders an
 * aggregated table for all bound projects in the DetailPanel.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchClaudeIntegration,
  scaffoldClaudeIntegration,
  fetchIntegrationSummary,
} from '../../api/client'
import type { ClaudeIntegrationStatus, IntegrationSummaryResponse } from '../../api/types'
import styles from './ClaudeIntegrationPanel.module.css'

/* ------------------------------------------------------------------ */
/*  Props                                                               */
/* ------------------------------------------------------------------ */

export interface ClaudeIntegrationPanelProps {
  instanceName: string
  projectPath: string
  onClose: () => void
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                       */
/* ------------------------------------------------------------------ */

function StatusChip({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) {
    return <span className={styles.chipMissing}>{label}</span>
  }
  return ok
    ? <span className={styles.chipOk}>✓ {label}</span>
    : <span className={styles.chipWarn}>✗ {label}</span>
}

/* ------------------------------------------------------------------ */
/*  ClaudeIntegrationPanel                                              */
/* ------------------------------------------------------------------ */

export function ClaudeIntegrationPanel({ instanceName, projectPath, onClose }: ClaudeIntegrationPanelProps) {
  const queryClient = useQueryClient()

  const queryKey = ['claude-integration', instanceName, projectPath]
  const { data, isLoading, error, refetch } = useQuery<ClaudeIntegrationStatus, Error>({
    queryKey,
    queryFn: () => fetchClaudeIntegration(instanceName, projectPath),
    staleTime: 30_000,
  })

  // Scaffold state
  const [scaffolding, setScaffolding] = useState(false)
  const [scaffoldResult, setScaffoldResult] = useState<{ ok: boolean; written: string[]; output?: string; error?: string } | null>(null)
  const [confirmScaffold, setConfirmScaffold] = useState(false)

  const filesExist = data && (data.mcpJsonPath !== null || data.hooksJsonPath !== null)

  async function doScaffold(force: boolean) {
    setConfirmScaffold(false)
    setScaffolding(true)
    setScaffoldResult(null)
    try {
      const result = await scaffoldClaudeIntegration(instanceName, projectPath, force)
      setScaffoldResult(result)
      if (result.ok) {
        // Invalidate integration query so status refreshes
        void queryClient.invalidateQueries({ queryKey })
        void queryClient.invalidateQueries({ queryKey: ['integration-summary', instanceName] })
        void refetch()
      }
    } catch (err) {
      setScaffoldResult({ ok: false, written: [], error: err instanceof Error ? err.message : String(err) })
    } finally {
      setScaffolding(false)
    }
  }

  function handleScaffoldClick() {
    if (filesExist) {
      setConfirmScaffold(true)
    } else {
      void doScaffold(false)
    }
  }

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Claude Code Integration</span>
        <span className={styles.panelPath}>{projectPath}</span>
        <button className={styles.closeBtn} type="button" onClick={onClose} title="Close panel">
          Close
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className={styles.loadingRow}>
          <span className={styles.spinnerSmall} aria-hidden="true" /> Checking integration files…
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className={styles.errorRow}>
          Could not load integration status: {error.message}
        </div>
      )}

      {/* Content */}
      {data && !isLoading && (
        <>
          {/* MCP Section */}
          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>MCP Server (.mcp.json)</h4>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>File</span>
              <span className={styles.fieldValue}>
                {data.mcpJsonPath
                  ? <span className={styles.monoValue}>{data.mcpJsonPath}</span>
                  : <span className={styles.dimValue}>not found</span>
                }
              </span>
            </div>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Iranti server</span>
              <span className={styles.fieldValue}>
                <StatusChip ok={data.irantiMcpEntry !== null} label={data.irantiMcpEntry ? 'Registered' : 'Not registered'} />
                {data.irantiMcpEntry && (
                  <span className={styles.monoValue}>
                    {data.irantiMcpEntry.command} {data.irantiMcpEntry.args.join(' ')}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Hooks Section */}
          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>Claude Hooks (.claude/settings.local.json)</h4>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>File</span>
              <span className={styles.fieldValue}>
                {data.hooksJsonPath
                  ? <span className={styles.monoValue}>{data.hooksJsonPath}</span>
                  : <span className={styles.dimValue}>not found</span>
                }
              </span>
            </div>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>SessionStart</span>
              <span className={styles.fieldValue}>
                <StatusChip ok={data.irantiHooks.sessionStart !== null} label={data.irantiHooks.sessionStart ? 'Registered' : 'Not registered'} />
                {data.irantiHooks.sessionStart && (
                  <span className={styles.monoValue}>{data.irantiHooks.sessionStart}</span>
                )}
              </span>
            </div>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>UserPromptSubmit</span>
              <span className={styles.fieldValue}>
                <StatusChip ok={data.irantiHooks.userPromptSubmit !== null} label={data.irantiHooks.userPromptSubmit ? 'Registered' : 'Not registered'} />
                {data.irantiHooks.userPromptSubmit && (
                  <span className={styles.monoValue}>{data.irantiHooks.userPromptSubmit}</span>
                )}
              </span>
            </div>
          </div>

          {/* Issues */}
          {data.issues.length > 0 && (
            <div className={styles.subSection}>
              <h4 className={styles.subTitle}>Issues ({data.issues.length})</h4>
              <div className={styles.issuesList}>
                {data.issues.map((issue, i) => (
                  <div key={i} className={styles.issueRow}>
                    <span className={styles.issueIcon}>⚠</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Scaffold */}
          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>Scaffold Integration</h4>

            {scaffoldResult && scaffoldResult.ok && (
              <div className={styles.scaffoldSuccess}>
                Integration scaffolded successfully.
                {scaffoldResult.written.length > 0 && (
                  <div className={styles.scaffoldSuccessFiles}>
                    {scaffoldResult.written.map((f) => (
                      <span key={f} className={styles.scaffoldSuccessFile}>{f}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {scaffoldResult && !scaffoldResult.ok && (
              <div className={styles.scaffoldError}>
                Scaffold failed: {scaffoldResult.error ?? 'Unknown error'}
              </div>
            )}

            {confirmScaffold ? (
              <div className={styles.confirmRow}>
                <span>Some integration files already exist. Overwrite with updated content?</span>
                <button
                  className={styles.confirmOkBtn}
                  type="button"
                  onClick={() => void doScaffold(true)}
                >
                  Yes, overwrite
                </button>
                <button
                  className={styles.confirmCancelBtn}
                  type="button"
                  onClick={() => setConfirmScaffold(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className={styles.scaffoldRow}>
                <button
                  className={styles.scaffoldBtn}
                  type="button"
                  disabled={scaffolding}
                  onClick={handleScaffoldClick}
                >
                  {scaffolding && <span className={styles.spinnerSmall} aria-hidden="true" />}
                  {scaffolding ? 'Scaffolding…' : 'Scaffold Integration'}
                </button>
                <span className={styles.scaffoldNote}>
                  Writes .mcp.json and .claude/settings.local.json for Claude Code.
                </span>
              </div>
            )}
          </div>

          {/* Raw file views */}
          {(data.mcpJson || data.hooksJson) && (
            <div className={styles.subSection}>
              <h4 className={styles.subTitle}>Raw Config Files</h4>

              {data.mcpJson && (
                <details className={styles.rawDetails}>
                  <summary>.mcp.json</summary>
                  <pre className={styles.rawJson}>{JSON.stringify(data.mcpJson, null, 2)}</pre>
                </details>
              )}

              {data.hooksJson && (
                <details className={styles.rawDetails}>
                  <summary>.claude/settings.local.json</summary>
                  <pre className={styles.rawJson}>{JSON.stringify(data.hooksJson, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  IntegrationOverviewSection — CP-T093                               */
/* ------------------------------------------------------------------ */

export interface IntegrationOverviewSectionProps {
  instanceName: string
}

export function IntegrationOverviewSection({ instanceName }: IntegrationOverviewSectionProps) {
  const { data, isLoading, error } = useQuery<IntegrationSummaryResponse, Error>({
    queryKey: ['integration-summary', instanceName],
    queryFn: () => fetchIntegrationSummary(instanceName),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className={styles.loadingRow}>
        <span className={styles.spinnerSmall} aria-hidden="true" /> Loading integration overview…
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.errorRow}>
        Could not load integration summary: {error.message}
      </div>
    )
  }

  if (!data || data.projects.length === 0) {
    return (
      <p className={styles.overviewEmpty}>No bound projects — bind a project to see integration status.</p>
    )
  }

  return (
    <table className={styles.overviewTable}>
      <thead>
        <tr>
          <th>Project</th>
          <th>MCP</th>
          <th>Hooks</th>
          <th>Issues</th>
        </tr>
      </thead>
      <tbody>
        {data.projects.map((p) => (
          <tr key={p.projectPath}>
            <td className={styles.overviewPathCell} title={p.projectPath}>
              {p.projectPath.split(/[/\\]/).pop() ?? p.projectPath}
            </td>
            <td>
              {p.irantiMcpRegistered
                ? <span className={styles.chipOk}>✓</span>
                : p.mcpPresent
                  ? <span className={styles.chipWarn}>✗ not registered</span>
                  : <span className={styles.chipMissing}>missing</span>
              }
            </td>
            <td>
              {p.irantiHooksCount > 0
                ? <span className={styles.chipOk}>✓ {p.irantiHooksCount}/2</span>
                : p.hooksPresent
                  ? <span className={styles.chipWarn}>✗ not configured</span>
                  : <span className={styles.chipMissing}>missing</span>
              }
            </td>
            <td>
              {p.issues.length === 0
                ? <span className={styles.issueBadgeOk}>OK</span>
                : <span className={styles.issueBadge}>{p.issues.length} issue{p.issues.length > 1 ? 's' : ''}</span>
              }
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
