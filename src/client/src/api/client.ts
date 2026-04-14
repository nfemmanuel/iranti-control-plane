/**
 * client.ts — Shared API client for the Iranti Control Plane.
 *
 * All control-plane API calls go through this module. Provides `apiFetch`
 * (generic fetch wrapper) and typed wrappers for every endpoint.
 */

import type { VersionSyncResult, InstallStateResult, StartInstanceResult, StopInstanceResult, ProcessStatusResult, RestartInstanceResult, OpenFileResult, PickPathResult, RunCommandResult, ControlPlaneSelfActionResult, ProviderWriteKeyResult, ProviderSetDefaultResult, ProviderFallbackResult, RoutingDefaultsResponse, TaskRoutingUpdateResult, AuthKeysListResponse, AuthKeyCreateResult, AuthKeyRevokeResult, CreateInstanceResult, ConfigureInstanceResult, MigrateInstanceRootResult, DeleteInstanceResult, ProjectsListResponse, BindProjectResult, RebindProjectResult, UnbindProjectResult, ClaudeIntegrationStatus, ScaffoldResult, IntegrationSummaryResponse, CodexIntegrationStatus, CodexSetupResult, CodexRemoveResult, HandshakeResult, AttendResult, DatabaseIntentChoice } from './types'

const BASE = '/api/control-plane'

export async function apiFetch<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

/**
 * Fetch the version sync status - compares locally installed Iranti
 * version against the latest published version on npm.
 * CP-T078
 */
export function fetchVersionSync(instanceId?: string): Promise<VersionSyncResult> {
  return apiFetch<VersionSyncResult>('/version-sync', { instanceId })
}

/**
 * Fetch the iranti CLI install state - detects whether the CLI is on PATH
 * and extracts its version.
 * CP-T079
 */
export function fetchInstallState(): Promise<InstallStateResult> {
  return apiFetch<InstallStateResult>('/install-state')
}

/**
 * Spawn `iranti run --instance <name>` as a detached subprocess.
 * Returns 202 on success, 400 if CLI not found, 409 if already running.
 * CP-T080
 */
export async function startInstance(name: string): Promise<StartInstanceResult> {
  const url = new URL(`${BASE}/instances/${encodeURIComponent(name)}/start`, window.location.origin)
  const res = await fetch(url.toString(), { method: 'POST' })
  const body = await res.json().catch(() => ({ error: res.statusText })) as StartInstanceResult & { error?: string }
  // 409 = already running - treat as soft info so the UI shows a helpful
  // message rather than throwing and potentially crashing the component
  if (res.status === 409) {
    return { started: false, instance: name, reason: body.error ?? 'Already running' }
  }
  if (!res.ok) {
    const error = new Error(body.error ?? res.statusText) as Error & { code?: string }
    error.code = body.code
    throw error
  }
  return body
}

/**
 * Send SIGTERM to the tracked process for this instance.
 * Returns 200 on success, 404 if not tracked.
 * CP-T080
 */
export async function stopInstance(name: string): Promise<StopInstanceResult> {
  const url = new URL(`${BASE}/instances/${encodeURIComponent(name)}/stop`, window.location.origin)
  const res = await fetch(url.toString(), { method: 'POST' })
  const body = await res.json().catch(() => ({ error: res.statusText })) as StopInstanceResult & { error?: string }
  if (!res.ok) {
    throw new Error(body.error ?? res.statusText)
  }
  return body
}

/**
 * Fetch the in-memory process tracking status for this instance.
 * CP-T080
 */
export function fetchProcessStatus(name: string): Promise<ProcessStatusResult> {
  return apiFetch<ProcessStatusResult>(`/instances/${encodeURIComponent(name)}/process-status`)
}

export async function restartInstance(name: string): Promise<RestartInstanceResult> {
  const url = new URL(`${BASE}/instances/${encodeURIComponent(name)}/restart`, window.location.origin)
  const res = await fetch(url.toString(), { method: 'POST' })
  const body = await res.json().catch(() => ({ error: res.statusText })) as RestartInstanceResult & { error?: string }
  if (!res.ok) {
    const error = new Error(body.error ?? res.statusText) as Error & { code?: string }
    error.code = body.code
    throw error
  }
  return body
}

/**
 * Request the control plane server to open a whitelisted local config file
 * in the user's default system editor. Always resolves - never rejects -
 * because the server returns HTTP 200 for both success and "file not found".
 * CP-T084
 */
export async function openFile(filePath: string): Promise<OpenFileResult> {
  const url = new URL(`${BASE}/open-file`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  })
  // The server always returns HTTP 200 with an OpenFileResult shape.
  // A non-200 here means an unexpected server error (e.g. 400 Bad Request
  // for a path that somehow bypassed the UI whitelist, or 500).
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<OpenFileResult>
}

export async function pickPath(params: {
  kind: 'directory' | 'file'
  title?: string
  startPath?: string
}): Promise<PickPathResult> {
  const url = new URL(`${BASE}/pick-path`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as PickPathResult
}

export async function runCommand(params: {
  command: string
  cwd?: string
}): Promise<RunCommandResult> {
  const url = new URL(`${BASE}/run-command`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as RunCommandResult
}

export async function stopControlPlane(): Promise<ControlPlaneSelfActionResult> {
  const url = new URL(`${BASE}/self/stop`, window.location.origin)
  const res = await fetch(url.toString(), { method: 'POST' })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as ControlPlaneSelfActionResult
}

export async function uninstallControlPlane(): Promise<ControlPlaneSelfActionResult> {
  const url = new URL(`${BASE}/self/uninstall`, window.location.origin)
  const res = await fetch(url.toString(), { method: 'POST' })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as ControlPlaneSelfActionResult
}

// ---------------------------------------------------------------------------
// Provider write path (CP-T085, CP-T086)
// ---------------------------------------------------------------------------

async function providerDelete<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), { method: 'DELETE' })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as T
}

/** Set or update a provider API key. CP-T085 */
export async function setProviderKey(provider: string, key: string, instanceId?: string): Promise<ProviderWriteKeyResult> {
  const url = new URL(`${BASE}/providers/${encodeURIComponent(provider)}/key`, window.location.origin)
  if (instanceId) url.searchParams.set('instanceId', instanceId)
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as ProviderWriteKeyResult
}

/** Remove a provider API key. CP-T085 */
export function removeProviderKey(provider: string, instanceId?: string): Promise<ProviderWriteKeyResult> {
  return providerDelete<ProviderWriteKeyResult>(`/providers/${encodeURIComponent(provider)}/key`, { instanceId })
}

/** Set the default provider (writes LLM_PROVIDER). CP-T086 */
export async function setDefaultProvider(provider: string, instanceId?: string): Promise<ProviderSetDefaultResult> {
  const url = new URL(`${BASE}/providers/default`, window.location.origin)
  if (instanceId) url.searchParams.set('instanceId', instanceId)
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as ProviderSetDefaultResult
}

/** Clear the default provider. CP-T086 */
export function clearDefaultProvider(instanceId?: string): Promise<ProviderSetDefaultResult> {
  return providerDelete<ProviderSetDefaultResult>('/providers/default', { instanceId })
}

/** Set the provider fallback chain (writes LLM_PROVIDER_FALLBACK). CP-T086 */
export async function setFallbackChain(chain: string[], instanceId?: string): Promise<ProviderFallbackResult> {
  const url = new URL(`${BASE}/providers/fallback`, window.location.origin)
  if (instanceId) url.searchParams.set('instanceId', instanceId)
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain }),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as ProviderFallbackResult
}

/** Clear the provider fallback chain. CP-T086 */
export function clearFallbackChain(instanceId?: string): Promise<ProviderFallbackResult> {
  return providerDelete<ProviderFallbackResult>('/providers/fallback', { instanceId })
}

// ---------------------------------------------------------------------------
// Task-model routing (CP-T087)
// ---------------------------------------------------------------------------

/**
 * Fetch routing defaults for a given provider - what model each task would use
 * with no overrides set. CP-T087.
 */
export function fetchRoutingDefaults(provider: string, instanceId?: string): Promise<RoutingDefaultsResponse> {
  return apiFetch<RoutingDefaultsResponse>('/providers/routing-defaults', { provider, instanceId })
}

/**
 * Update task-model routing overrides.
 * Pass null for a task to clear its override. CP-T087.
 */
export async function updateTaskRouting(overrides: Record<string, string | null>, instanceId?: string): Promise<TaskRoutingUpdateResult> {
  const url = new URL(`${BASE}/providers/task-routing`, window.location.origin)
  if (instanceId) url.searchParams.set('instanceId', instanceId)
  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ overrides }),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as TaskRoutingUpdateResult
}

/**
 * Clear all 6 task-model routing overrides, reverting to provider defaults. CP-T087.
 */
export async function resetTaskRouting(instanceId?: string): Promise<TaskRoutingUpdateResult> {
  const url = new URL(`${BASE}/providers/task-routing`, window.location.origin)
  if (instanceId) url.searchParams.set('instanceId', instanceId)
  const res = await fetch(url.toString(), { method: 'DELETE' })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as TaskRoutingUpdateResult
}

/**
 * Trigger an upgrade job for the given instance.
 * Returns a job ID that can be polled for progress.
 * CP-T081
 */
export async function triggerUpgrade(instanceName: string): Promise<{ jobId: string }> {
  const url = new URL(`${BASE}/instances/${encodeURIComponent(instanceName)}/upgrade`, window.location.origin)
  const res = await fetch(url.toString(), { method: 'POST' })
  const body = await res.json() as { jobId?: string; error?: string; code?: string }
  if (!res.ok) {
    throw new Error(body.error ?? res.statusText)
  }
  return { jobId: body.jobId ?? '' }
}

// ---------------------------------------------------------------------------
// Auth Key Manager (CP-T088)
// ---------------------------------------------------------------------------

/**
 * List all registry-backed API keys for the active Iranti instance.
 * Never includes raw token values - only metadata and masked status.
 */
export function fetchAuthKeys(instanceId?: string): Promise<AuthKeysListResponse> {
  return apiFetch<AuthKeysListResponse>('/auth-keys', { instanceId })
}

/**
 * Create or rotate an API key.
 * Returns the full token exactly once - the caller must copy it immediately.
 */
export async function createAuthKey(params: {
  keyId:           string
  owner:           string
  scopes:          string[]
  description?:    string
  syncToProject?:  string
  instanceId?:     string
}): Promise<AuthKeyCreateResult> {
  const url = new URL(`${BASE}/auth-keys`, window.location.origin)
  if (params.instanceId) url.searchParams.set('instanceId', params.instanceId)
  const { instanceId: _instanceId, ...body } = params
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as AuthKeyCreateResult
}

/**
 * Revoke a registry API key by keyId.
 * The key remains visible in the list with Revoked status for audit purposes.
 */
export async function revokeAuthKey(keyId: string, instanceId?: string): Promise<AuthKeyRevokeResult> {
  const url = new URL(`${BASE}/auth-keys/${encodeURIComponent(keyId)}`, window.location.origin)
  if (instanceId) url.searchParams.set('instanceId', instanceId)
  const res = await fetch(url.toString(), { method: 'DELETE' })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as AuthKeyRevokeResult
}

// ---------------------------------------------------------------------------
// Instance Create / Configure (CP-T089, CP-T090)
// ---------------------------------------------------------------------------

/**
 * Create a new Iranti instance directory and .env.iranti.
 * Returns the created instance metadata and a note about DB migration.
 * CP-T089
 */
export async function createInstance(params: {
  name: string
  port: number
  dbUrl: string
  provider: string
  dbIntent?: DatabaseIntentChoice
  providerKey?: string
}): Promise<CreateInstanceResult> {
  const url = new URL(`${BASE}/instances`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as CreateInstanceResult
}

/**
 * Update port, dbUrl, provider, or providerKey for an existing instance.
 * Returns whether a restart is required and which fields changed.
 * CP-T090
 */
export async function configureInstance(
  name: string,
  params: {
    port?: number
    dbUrl?: string
    provider?: string
    dbIntent?: DatabaseIntentChoice
    providerKey?: string
  }
): Promise<ConfigureInstanceResult> {
  const url = new URL(`${BASE}/instances/${encodeURIComponent(name)}`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as ConfigureInstanceResult
}

export async function migrateInstanceRoot(name: string): Promise<MigrateInstanceRootResult> {
  const url = new URL(`${BASE}/instances/${encodeURIComponent(name)}/migrate-root`, window.location.origin)
  const res = await fetch(url.toString(), { method: 'POST' })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as MigrateInstanceRootResult
}

export async function deleteInstance(
  name: string,
  params: {
    confirmName: string
    removeProjectBindings?: boolean
    dropDatabase?: boolean
  }
): Promise<DeleteInstanceResult> {
  const url = new URL(`${BASE}/instances/${encodeURIComponent(name)}`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as DeleteInstanceResult
}


// ---------------------------------------------------------------------------
// Project Bindings (CP-T091)
// ---------------------------------------------------------------------------

/**
 * List all projects bound to a given instance.
 * CP-T091
 */
export function fetchInstanceProjects(instanceName: string): Promise<ProjectsListResponse> {
  return apiFetch<ProjectsListResponse>(`/instances/${encodeURIComponent(instanceName)}/projects`)
}

/**
 * Bind a new project directory to an instance.
 * Writes .env.iranti into the project directory.
 * CP-T091
 */
export async function bindProject(
  instanceName: string,
  params: {
    projectPath: string
    mode?: string
    agentId?: string
    memoryEntity?: string
    addToGitignore?: boolean
  }
): Promise<BindProjectResult> {
  const url = new URL(
    `${BASE}/instances/${encodeURIComponent(instanceName)}/projects`,
    window.location.origin
  )
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as BindProjectResult
}

// ---------------------------------------------------------------------------
// Claude Code Integration (CP-T092, CP-T093)
// ---------------------------------------------------------------------------

/**
 * Fetch the Claude Code integration status for a single bound project.
 * Reads .mcp.json and .claude/settings.local.json and returns diagnostic info.
 * CP-T092
 */
export function fetchClaudeIntegration(
  instanceName: string,
  projectPath: string
): Promise<ClaudeIntegrationStatus> {
  return apiFetch<ClaudeIntegrationStatus>(
    `/instances/${encodeURIComponent(instanceName)}/projects/${encodeURIComponent(projectPath)}/claude-integration`
  )
}

/**
 * Scaffold .mcp.json and .claude/settings.local.json for a bound project,
 * replicating what `iranti claude-setup` does.
 * CP-T092
 */
export async function scaffoldClaudeIntegration(
  instanceName: string,
  projectPath: string,
  force?: boolean
): Promise<ScaffoldResult> {
  const url = new URL(
    `${BASE}/instances/${encodeURIComponent(instanceName)}/projects/${encodeURIComponent(projectPath)}/claude-integration/scaffold`,
    window.location.origin
  )
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: force ?? false }),
  })
  const data = await res.json().catch(() => ({ ok: false, written: [], error: res.statusText }))
  if (!res.ok) {
    const errMsg = (data as { error?: string }).error ?? res.statusText
    throw new Error(errMsg)
  }
  return data as ScaffoldResult
}

/**
 * Fetch aggregated Claude Code integration status across all bound projects
 * for a given instance. Used by the Integration Overview section (CP-T093).
 */
export function fetchIntegrationSummary(instanceName: string): Promise<IntegrationSummaryResponse> {
  return apiFetch<IntegrationSummaryResponse>(
    `/instances/${encodeURIComponent(instanceName)}/integration-summary`
  )
}

// ---------------------------------------------------------------------------
// Codex Integration (CP-T095)
// ---------------------------------------------------------------------------

/**
 * Fetch Codex installation status and Iranti MCP registration state.
 * CP-T095
 */
export function fetchCodexIntegration(): Promise<CodexIntegrationStatus> {
  return apiFetch<CodexIntegrationStatus>('/integrations/codex')
}

/**
 * Run `iranti codex-setup` to register Iranti as an MCP server with Codex.
 * CP-T095
 */
export async function setupCodexIntegration(): Promise<CodexSetupResult> {
  const url = new URL(`${BASE}/integrations/codex`, window.location.origin)
  const res = await fetch(url.toString(), { method: 'POST' })
  const data = await res.json().catch(() => ({ ok: false, output: '', error: res.statusText }))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
  return data as CodexSetupResult
}

/**
 * Remove Iranti MCP registration from Codex.
 * Tries `iranti uninstall --target codex` first, falls back to direct config edit.
 * CP-T095
 */
export async function removeCodexIntegration(): Promise<CodexRemoveResult> {
  const url = new URL(`${BASE}/integrations/codex`, window.location.origin)
  const res = await fetch(url.toString(), { method: 'DELETE' })
  const data = await res.json().catch(() => ({ ok: false, error: res.statusText }))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
  return data as CodexRemoveResult
}

/**
 * Rebind an existing project to a different instance or change its mode.
 * CP-T091
 */
export async function rebindProject(
  instanceName: string,
  projectPath: string,
  params: {
    targetInstanceName?: string
    mode?: string
  }
): Promise<RebindProjectResult> {
  const url = new URL(
    `${BASE}/instances/${encodeURIComponent(instanceName)}/projects`,
    window.location.origin
  )
  url.searchParams.set('projectPath', projectPath)
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as RebindProjectResult
}

export async function unbindProject(
  instanceName: string,
  projectPath: string,
  params?: {
    keepIntegrations?: boolean
  }
): Promise<UnbindProjectResult> {
  const url = new URL(
    `${BASE}/instances/${encodeURIComponent(instanceName)}/projects`,
    window.location.origin
  )
  url.searchParams.set('projectPath', projectPath)
  if (params?.keepIntegrations) {
    url.searchParams.set('keepIntegrations', 'true')
  }
  const res = await fetch(url.toString(), { method: 'DELETE' })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as UnbindProjectResult
}

// ---------------------------------------------------------------------------
// Attendant Debug Tools (CP-T096)
// ---------------------------------------------------------------------------

/**
 * Simulate an agent handshake against the live Iranti instance.
 * Proxies POST /memory/handshake and returns the raw Iranti brief.
 * CP-T096
 */
export async function runDebugHandshake(agentId: string, task: string): Promise<HandshakeResult> {
  const url = new URL(`${BASE}/debug/handshake`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, task }),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as HandshakeResult
}

/**
 * Query the Attendant for memory blocks relevant to a given context.
 * Proxies POST /memory/attend and returns the raw Iranti response.
 * CP-T096
 */
export async function runDebugAttend(
  agentId: string,
  query: string,
  context?: string
): Promise<AttendResult> {
  const url = new URL(`${BASE}/debug/attend`, window.location.origin)
  const body: Record<string, string> = { agentId, query }
  if (context && context.trim() !== '') body.context = context
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as AttendResult
}

/**
 * Fetch the persisted Control Plane default port from server-side config.
 * Returns null if no default has been set.
 */
export function getCpConfig(): Promise<{ defaultPort: number | null }> {
  return apiFetch<{ defaultPort: number | null }>('/cp-config')
}

// ---------------------------------------------------------------------------
// Rules (operating rules stored as rule/* entities)
// ---------------------------------------------------------------------------

export interface Rule {
  id: number
  ruleId: string
  key: string
  rule: string
  triggers: string[]
  enforcement: string
  scope: string
  updatedAt: string | null
}

export interface RulesListResponse {
  total: number
  rules: Rule[]
}

export function fetchRules(instanceId?: string): Promise<RulesListResponse> {
  return apiFetch<RulesListResponse>('/rules', { instanceId })
}

export async function deleteRule(ruleId: string, instanceId?: string): Promise<{ deleted: string; entriesRemoved: number }> {
  const url = new URL(`${BASE}/rules/${encodeURIComponent(ruleId)}`, window.location.origin)
  if (instanceId) url.searchParams.set('instanceId', instanceId)
  const res = await fetch(url.toString(), { method: 'DELETE' })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as { deleted: string; entriesRemoved: number }
}

/**
 * Persist a new Control Plane default port (or null to clear it).
 * Takes effect on next iranti-cp start.
 */
export async function setCpConfig(defaultPort: number | null): Promise<{ ok: boolean; defaultPort: number | null }> {
  const url = new URL(`${BASE}/cp-config`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultPort }),
  })
  const data = await res.json().catch(() => ({ error: res.statusText }))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText)
  return data as { ok: boolean; defaultPort: number | null }
}
