/**
 * ClaudeIntegrationPanel - CP-T092 + CP-T093
 *
 * Per-project panel showing Claude Code integration status:
 * - MCP server registration (.mcp.json and .vscode/mcp.json)
 * - Claude hooks (.claude/settings.local.json)
 * - Diagnostic issues with actionable descriptions
 * - Scaffold action that runs the installed `iranti claude-setup`
 * - Raw JSON view of each config file
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

export interface ClaudeIntegrationPanelProps {
  instanceName: string
  projectPath: string
  onClose: () => void
}

function StatusChip({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) {
    return <span className={styles.chipMissing}>{label}</span>
  }
  return ok
    ? <span className={styles.chipOk}>OK {label}</span>
    : <span className={styles.chipWarn}>Needs setup</span>
}

type CapabilityTone = 'ready' | 'partial' | 'missing'

interface CapabilityDescriptor {
  key: string
  title: string
  tone: CapabilityTone
  body: string
}

function getCapabilityDescriptors(data: ClaudeIntegrationStatus): CapabilityDescriptor[] {
  const hasRootMcp = data.irantiMcpEntry !== null
  const hasWorkspaceMcp = data.irantiWorkspaceMcpEntry !== null
  const hasAnyMcp = hasRootMcp || hasWorkspaceMcp
  const hasSessionStart = data.irantiHooks.sessionStart !== null
  const hasPromptCapture = data.irantiHooks.userPromptSubmit !== null
  const hasStop = data.irantiHooks.stop !== null

  return [
    {
      key: 'tool-access',
      title: 'Claude tool access',
      tone: hasAnyMcp ? 'ready' : (data.mcpJsonPath || data.workspaceMcpJsonPath ? 'partial' : 'missing'),
      body: hasAnyMcp
        ? 'Claude can discover Iranti tools from this project.'
        : 'Claude will not be able to call Iranti tools until MCP wiring is added.',
    },
    {
      key: 'workspace-mcp',
      title: 'VS Code workspace wiring',
      tone: hasWorkspaceMcp ? 'ready' : (hasRootMcp ? 'partial' : 'missing'),
      body: hasWorkspaceMcp
        ? 'VS Code workspace MCP is present, so editor sessions should discover Iranti directly from the repo.'
        : hasRootMcp
          ? 'Root MCP exists, but the workspace MCP file is missing. VS Code sessions may be less predictable.'
          : 'No workspace MCP wiring found yet.',
    },
    {
      key: 'session-bootstrap',
      title: 'Session bootstrap',
      tone: hasSessionStart ? 'ready' : 'missing',
      body: hasSessionStart
        ? 'Claude can load Iranti context when a session starts.'
        : 'SessionStart is missing, so Claude will start colder than it needs to.',
    },
    {
      key: 'prompt-capture',
      title: 'Prompt memory capture',
      tone: hasPromptCapture ? 'ready' : 'missing',
      body: hasPromptCapture
        ? 'Explicit user facts can be captured from prompts in this project.'
        : 'Prompt-side memory capture is off until UserPromptSubmit is added.',
    },
    {
      key: 'response-persistence',
      title: 'Response summary persistence',
      tone: hasStop ? 'ready' : 'missing',
      body: hasStop
        ? 'Structured summaries like next step and blocker can auto-persist after Claude replies.'
        : 'Stop is missing, so Claude response summaries will not auto-persist.',
    },
  ]
}

function getNextAction(data: ClaudeIntegrationStatus): string {
  const hasAnyMcp = data.irantiMcpEntry !== null || data.irantiWorkspaceMcpEntry !== null
  const hasAllHooks = Boolean(data.irantiHooks.sessionStart && data.irantiHooks.userPromptSubmit && data.irantiHooks.stop)
  if (!hasAnyMcp) {
    return 'Run Scaffold Integration to add Iranti MCP wiring for this project.'
  }
  if (!hasAllHooks) {
    return data.irantiHooks.stop === null
      ? 'Re-run Scaffold Integration to add the Stop hook for response summary persistence.'
      : 'Re-run Scaffold Integration to fill in the missing Claude hooks.'
  }
  if (data.irantiWorkspaceMcpEntry === null) {
    return 'Add workspace MCP wiring so VS Code sessions discover Iranti directly from the repo.'
  }
  return 'No action needed. This project is fully wired for Claude setup, prompt capture, and response summaries.'
}

function capabilityToneLabel(tone: CapabilityTone): string {
  switch (tone) {
    case 'ready':
      return 'Ready'
    case 'partial':
      return 'Partial'
    case 'missing':
      return 'Missing'
  }
}

type OverviewReadiness = 'ready' | 'partial' | 'missing'

function getOverviewReadiness(project: IntegrationSummaryResponse['projects'][number]): OverviewReadiness {
  const anyMcpRegistered = Boolean(project.irantiMcpRegistered || project.irantiWorkspaceMcpRegistered)
  if (anyMcpRegistered && project.irantiHooksCount === 3) {
    return 'ready'
  }
  if ((anyMcpRegistered && project.irantiHooksCount < 3) || (!anyMcpRegistered && (project.mcpPresent || project.workspaceMcpPresent || project.hooksPresent))) {
    return 'partial'
  }
  return 'missing'
}

function getOverviewWorks(project: IntegrationSummaryResponse['projects'][number]): string {
  const anyMcpRegistered = Boolean(project.irantiMcpRegistered || project.irantiWorkspaceMcpRegistered)
  if (anyMcpRegistered && project.irantiHooksCount === 3) {
    return 'Prompt capture and response summaries are both wired.'
  }
  if (anyMcpRegistered && project.irantiHooksCount === 2) {
    return 'Prompt capture is wired, but response summaries are still missing.'
  }
  if (anyMcpRegistered && project.irantiHooksCount === 1) {
    return 'Claude can reach Iranti, but only one hook is active.'
  }
  if (anyMcpRegistered) {
    return 'Claude can reach Iranti, but hook wiring is still missing.'
  }
  if (project.mcpPresent || project.workspaceMcpPresent || project.hooksPresent) {
    return 'Some files exist, but the project is not registered cleanly yet.'
  }
  return 'No Claude integration wiring detected yet.'
}

function getOverviewAction(project: IntegrationSummaryResponse['projects'][number]): string {
  const anyMcpRegistered = Boolean(project.irantiMcpRegistered || project.irantiWorkspaceMcpRegistered)
  if (!anyMcpRegistered) {
    return 'Run scaffold to add MCP wiring.'
  }
  if (project.irantiHooksCount < 3) {
    return project.irantiHooksCount === 2
      ? 'Add the Stop hook for summaries.'
      : 'Re-run scaffold to fill in the missing hooks.'
  }
  if (!project.irantiWorkspaceMcpRegistered) {
    return 'Add workspace MCP for VS Code sessions.'
  }
  return 'No action needed.'
}

function readinessLabel(readiness: OverviewReadiness): string {
  switch (readiness) {
    case 'ready':
      return 'Ready'
    case 'partial':
      return 'Partial'
    case 'missing':
      return 'Missing'
  }
}

export function ClaudeIntegrationPanel({ instanceName, projectPath, onClose }: ClaudeIntegrationPanelProps) {
  const queryClient = useQueryClient()

  const queryKey = ['claude-integration', instanceName, projectPath]
  const { data, isLoading, error, refetch } = useQuery<ClaudeIntegrationStatus, Error>({
    queryKey,
    queryFn: () => fetchClaudeIntegration(instanceName, projectPath),
    staleTime: 30_000,
  })

  const [scaffolding, setScaffolding] = useState(false)
  const [scaffoldResult, setScaffoldResult] = useState<{ ok: boolean; written: string[]; output?: string; error?: string } | null>(null)
  const [confirmScaffold, setConfirmScaffold] = useState(false)

  const filesExist = data && (data.mcpJsonPath !== null || data.workspaceMcpJsonPath !== null || data.hooksJsonPath !== null)

  async function doScaffold(force: boolean) {
    setConfirmScaffold(false)
    setScaffolding(true)
    setScaffoldResult(null)
    try {
      const result = await scaffoldClaudeIntegration(instanceName, projectPath, force)
      setScaffoldResult(result)
      if (result.ok) {
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
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Claude Code Integration</span>
        <span className={styles.panelPath}>{projectPath}</span>
        <button className={styles.closeBtn} type="button" onClick={onClose} title="Close panel">
          Close
        </button>
      </div>

      {isLoading && (
        <div className={styles.loadingRow}>
          <span className={styles.spinnerSmall} aria-hidden="true" /> Checking integration files...
        </div>
      )}

      {error && !isLoading && (
        <div className={styles.errorRow}>
          Could not load integration status: {error.message}
        </div>
      )}

      {data && !isLoading && (
        <>
          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>What Works Here</h4>
            <div className={styles.capabilityGrid}>
              {getCapabilityDescriptors(data).map((capability) => (
                <div
                  key={capability.key}
                  className={`${styles.capabilityCard} ${
                    capability.tone === 'ready'
                      ? styles.capabilityCardReady
                      : capability.tone === 'partial'
                        ? styles.capabilityCardPartial
                        : styles.capabilityCardMissing
                  }`}
                >
                  <div className={styles.capabilityHeader}>
                    <span className={styles.capabilityTitle}>{capability.title}</span>
                    <span className={styles.capabilityState}>{capabilityToneLabel(capability.tone)}</span>
                  </div>
                  <p className={styles.capabilityBody}>{capability.body}</p>
                </div>
              ))}
            </div>
            <div className={styles.capabilityAction}>
              <span className={styles.capabilityActionLabel}>Next action</span>
              <span>{getNextAction(data)}</span>
            </div>
          </div>

          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>MCP Server (.mcp.json)</h4>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>File</span>
              <span className={styles.fieldValue}>
                {data.mcpJsonPath
                  ? <span className={styles.monoValue}>{data.mcpJsonPath}</span>
                  : <span className={styles.dimValue}>not found</span>}
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

          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>VS Code Workspace MCP (.vscode/mcp.json)</h4>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>File</span>
              <span className={styles.fieldValue}>
                {data.workspaceMcpJsonPath
                  ? <span className={styles.monoValue}>{data.workspaceMcpJsonPath}</span>
                  : <span className={styles.dimValue}>not found</span>}
              </span>
            </div>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Iranti server</span>
              <span className={styles.fieldValue}>
                <StatusChip ok={data.irantiWorkspaceMcpEntry !== null} label={data.irantiWorkspaceMcpEntry ? 'Registered' : 'Not registered'} />
                {data.irantiWorkspaceMcpEntry && (
                  <span className={styles.monoValue}>
                    {data.irantiWorkspaceMcpEntry.command} {data.irantiWorkspaceMcpEntry.args.join(' ')}
                  </span>
                )}
              </span>
            </div>
          </div>

          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>Claude Hooks (.claude/settings.local.json)</h4>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>File</span>
              <span className={styles.fieldValue}>
                {data.hooksJsonPath
                  ? <span className={styles.monoValue}>{data.hooksJsonPath}</span>
                  : <span className={styles.dimValue}>not found</span>}
              </span>
            </div>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>SessionStart</span>
              <span className={styles.fieldValue}>
                <StatusChip ok={data.irantiHooks.sessionStart !== null} label={data.irantiHooks.sessionStart ? 'Registered' : 'Not registered'} />
                {data.irantiHooks.sessionStart && <span className={styles.monoValue}>{data.irantiHooks.sessionStart}</span>}
              </span>
            </div>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>UserPromptSubmit</span>
              <span className={styles.fieldValue}>
                <StatusChip ok={data.irantiHooks.userPromptSubmit !== null} label={data.irantiHooks.userPromptSubmit ? 'Registered' : 'Not registered'} />
                {data.irantiHooks.userPromptSubmit && <span className={styles.monoValue}>{data.irantiHooks.userPromptSubmit}</span>}
              </span>
            </div>

            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Stop</span>
              <span className={styles.fieldValue}>
                <StatusChip ok={data.irantiHooks.stop !== null} label={data.irantiHooks.stop ? 'Registered' : 'Not registered'} />
                {data.irantiHooks.stop && <span className={styles.monoValue}>{data.irantiHooks.stop}</span>}
              </span>
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

          <div className={styles.subSection}>
            <h4 className={styles.subTitle}>Repair / Setup</h4>

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
                <button className={styles.confirmOkBtn} type="button" onClick={() => void doScaffold(true)}>
                  Yes, overwrite
                </button>
                <button className={styles.confirmCancelBtn} type="button" onClick={() => setConfirmScaffold(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className={styles.scaffoldRow}>
                <button className={styles.scaffoldBtn} type="button" disabled={scaffolding} onClick={handleScaffoldClick}>
                  {scaffolding && <span className={styles.spinnerSmall} aria-hidden="true" />}
                  {scaffolding ? 'Scaffolding...' : 'Scaffold Integration'}
                </button>
                <span className={styles.scaffoldNote}>
                  Runs the installed `iranti claude-setup` flow and writes `.mcp.json`, `.vscode/mcp.json`, and `.claude/settings.local.json`.
                </span>
              </div>
            )}
          </div>

          <details className={styles.advancedDetails}>
            <summary>Advanced file details</summary>
            <div className={styles.advancedDetailsBody}>
              <div className={styles.subSection}>
                <h4 className={styles.subTitle}>MCP Server (.mcp.json)</h4>

                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>File</span>
                  <span className={styles.fieldValue}>
                    {data.mcpJsonPath
                      ? <span className={styles.monoValue}>{data.mcpJsonPath}</span>
                      : <span className={styles.dimValue}>not found</span>}
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

              <div className={styles.subSection}>
                <h4 className={styles.subTitle}>VS Code Workspace MCP (.vscode/mcp.json)</h4>

                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>File</span>
                  <span className={styles.fieldValue}>
                    {data.workspaceMcpJsonPath
                      ? <span className={styles.monoValue}>{data.workspaceMcpJsonPath}</span>
                      : <span className={styles.dimValue}>not found</span>}
                  </span>
                </div>

                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Iranti server</span>
                  <span className={styles.fieldValue}>
                    <StatusChip ok={data.irantiWorkspaceMcpEntry !== null} label={data.irantiWorkspaceMcpEntry ? 'Registered' : 'Not registered'} />
                    {data.irantiWorkspaceMcpEntry && (
                      <span className={styles.monoValue}>
                        {data.irantiWorkspaceMcpEntry.command} {data.irantiWorkspaceMcpEntry.args.join(' ')}
                      </span>
                    )}
                  </span>
                </div>
              </div>

              <div className={styles.subSection}>
                <h4 className={styles.subTitle}>Claude Hooks (.claude/settings.local.json)</h4>

                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>File</span>
                  <span className={styles.fieldValue}>
                    {data.hooksJsonPath
                      ? <span className={styles.monoValue}>{data.hooksJsonPath}</span>
                      : <span className={styles.dimValue}>not found</span>}
                  </span>
                </div>

                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>SessionStart</span>
                  <span className={styles.fieldValue}>
                    <StatusChip ok={data.irantiHooks.sessionStart !== null} label={data.irantiHooks.sessionStart ? 'Registered' : 'Not registered'} />
                    {data.irantiHooks.sessionStart && <span className={styles.monoValue}>{data.irantiHooks.sessionStart}</span>}
                  </span>
                </div>

                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>UserPromptSubmit</span>
                  <span className={styles.fieldValue}>
                    <StatusChip ok={data.irantiHooks.userPromptSubmit !== null} label={data.irantiHooks.userPromptSubmit ? 'Registered' : 'Not registered'} />
                    {data.irantiHooks.userPromptSubmit && <span className={styles.monoValue}>{data.irantiHooks.userPromptSubmit}</span>}
                  </span>
                </div>

                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>Stop</span>
                  <span className={styles.fieldValue}>
                    <StatusChip ok={data.irantiHooks.stop !== null} label={data.irantiHooks.stop ? 'Registered' : 'Not registered'} />
                    {data.irantiHooks.stop && <span className={styles.monoValue}>{data.irantiHooks.stop}</span>}
                  </span>
                </div>
              </div>

              {(data.mcpJson || data.workspaceMcpJson || data.hooksJson) && (
                <div className={styles.subSection}>
                  <h4 className={styles.subTitle}>Raw Config Files</h4>

                  {data.mcpJson && (
                    <details className={styles.rawDetails}>
                      <summary>.mcp.json</summary>
                      <pre className={styles.rawJson}>{JSON.stringify(data.mcpJson, null, 2)}</pre>
                    </details>
                  )}

                  {data.workspaceMcpJson && (
                    <details className={styles.rawDetails}>
                      <summary>.vscode/mcp.json</summary>
                      <pre className={styles.rawJson}>{JSON.stringify(data.workspaceMcpJson, null, 2)}</pre>
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
            </div>
          </details>
        </>
      )}
    </div>
  )
}

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
        <span className={styles.spinnerSmall} aria-hidden="true" /> Loading integration overview...
      </div>
    )
  }

  if (error) {
    return <div className={styles.errorRow}>Could not load integration summary: {error.message}</div>
  }

  if (!data || data.projects.length === 0) {
    return <p className={styles.overviewEmpty}>No bound projects - bind a project to see integration status.</p>
  }

  const readyCount = data.projects.filter((project) => {
    const anyMcpRegistered = Boolean(project.irantiMcpRegistered || project.irantiWorkspaceMcpRegistered)
    return anyMcpRegistered && project.irantiHooksCount === 3
  }).length
  const partialCount = data.projects.filter((project) => {
    const anyMcpRegistered = Boolean(project.irantiMcpRegistered || project.irantiWorkspaceMcpRegistered)
    return (anyMcpRegistered && project.irantiHooksCount < 3) || (!anyMcpRegistered && (project.mcpPresent || project.workspaceMcpPresent || project.hooksPresent))
  }).length
  const missingCount = data.projects.length - readyCount - partialCount
  const nextActionSummary = missingCount > 0
    ? 'Start with the missing projects so Claude can discover Iranti at all.'
    : partialCount > 0
      ? 'The remaining work is hook completion, especially the Stop hook for summaries.'
      : 'Everything here is Claude-ready. Move on only if you are checking behavior, not wiring.'

  return (
    <div className={styles.overviewSection}>
      <div className={styles.overviewSummaryCard}>
        <div className={styles.overviewSummaryHeader}>
          <span className={styles.overviewSummaryTitle}>Claude project readiness</span>
          <span className={styles.overviewSummaryMeta}>{data.projects.length} bound project{data.projects.length === 1 ? '' : 's'}</span>
        </div>
        <div className={styles.overviewSummaryStats}>
          <span className={`${styles.overviewSummaryPill} ${styles.overviewSummaryPillReady}`}>{readyCount} ready</span>
          <span className={`${styles.overviewSummaryPill} ${styles.overviewSummaryPillWarning}`}>{partialCount} partial</span>
          <span className={`${styles.overviewSummaryPill} ${styles.overviewSummaryPillMuted}`}>{missingCount} missing</span>
        </div>
        <p className={styles.overviewSummaryBody}>
          Use this table to find the projects that still need MCP wiring or the Stop hook. The goal is prompt capture, response summaries, and predictable VS Code discovery.
        </p>
        <div className={styles.overviewSummaryAction}>
          <span className={styles.overviewSummaryActionLabel}>Operator focus</span>
          <span>{nextActionSummary}</span>
        </div>
      </div>

      <table className={styles.overviewTable}>
        <thead>
          <tr>
            <th>Project</th>
            <th>Readiness</th>
            <th>What works</th>
            <th>Next step</th>
          </tr>
        </thead>
        <tbody>
          {data.projects.map((p) => {
            const readiness = getOverviewReadiness(p)
            return (
              <tr key={p.projectPath}>
                <td className={styles.overviewPathCell} title={p.projectPath}>
                  {p.projectPath.split(/[\\/]/).pop() ?? p.projectPath}
                </td>
                <td>
                  {readiness === 'ready'
                    ? <span className={styles.chipOk}>{readinessLabel(readiness)}</span>
                    : readiness === 'partial'
                      ? <span className={styles.chipWarn}>{readinessLabel(readiness)}</span>
                      : <span className={styles.chipMissing}>{readinessLabel(readiness)}</span>}
                </td>
                <td className={styles.overviewDetailCell}>
                  {getOverviewWorks(p)}
                </td>
                <td className={styles.overviewDetailCell}>
                  {getOverviewAction(p) === 'No action needed.'
                    ? <span className={styles.issueBadgeOk}>No action needed</span>
                    : <span className={styles.issueBadge}>{getOverviewAction(p)}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
