/* Iranti Control Plane — Shared API response types */
/* Mirrors server response shapes from docs/specs/control-plane-api.md */

/* ------------------------------------------------------------------ */
/*  Generic paginated wrapper                                           */
/* ------------------------------------------------------------------ */

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

/* ------------------------------------------------------------------ */
/*  ConflictLog entry (CP-T053)                                        */
/* ------------------------------------------------------------------ */

export interface ConflictEntry {
  type: 'CONFLICT_ESCALATED' | 'CONFLICT_REJECTED' | 'CONFLICT_RESOLVED' | 'IDEMPOTENT_SKIP'
  at: string
  reason?: string
  usedLLM?: boolean
  existingScore?: number
  incomingScore?: number
  incomingSource?: string
  incomingValue?: string
}

/* ------------------------------------------------------------------ */
/*  Knowledge Base                                                      */
/* ------------------------------------------------------------------ */

export interface KBFact {
  id: string
  entityType: string
  entityId: string
  key: string
  valueSummary: string | null
  valueRaw: string | null
  valueRawTruncated: boolean
  confidence: number
  source: string
  /** agentId — the authenticated agent that made the write call (createdBy) */
  agentId: string
  validFrom: string | null
  validUntil: string | null
  createdAt: string
  updatedAt: string | null
  properties: Record<string, unknown> | null
  /** conflictLog is returned as Record<string, unknown> | null from server; cast to ConflictEntry[] at render */
  conflictLog: Record<string, unknown> | null
  /** stability — Float, days — may be absent if API does not yet return it */
  stability?: number | null
  /** lastAccessedAt — ISO timestamp — may be absent if API does not yet return it */
  lastAccessedAt?: string | null
}

export interface KBListResponse extends PaginatedResponse<KBFact> {}

/* ------------------------------------------------------------------ */
/*  Archive                                                             */
/* ------------------------------------------------------------------ */

export interface ArchiveFact {
  id: string
  entityType: string
  entityId: string
  key: string
  valueSummary: string | null
  valueRaw: string | null
  valueRawTruncated: boolean
  confidence: number
  source: string
  agentId: string
  validFrom: string | null
  validUntil: string | null
  archivedAt: string
  archivedReason: string | null
  supersededBy: string | null
  resolutionState: string | null
  resolutionNote: string | null
  properties: Record<string, unknown> | null
  conflictLog: Record<string, unknown> | null
  createdAt: string
  /** CP-T049: flagging fields */
  flagged: boolean
  flagNote: string | null
  flaggedAt: string | null
}

export interface ArchiveListResponse extends PaginatedResponse<ArchiveFact> {}

/* ------------------------------------------------------------------ */
/*  Archive Flag / Restore (CP-T049)                                   */
/* ------------------------------------------------------------------ */

export interface ArchiveEventsResponse {
  events: StaffEvent[]
  archiveId: string
}

export interface FlagResponse {
  flagged: true
  flaggedAt: string
  note: string | null
}

export interface UnflagResponse {
  flagged: false
}

export interface RestoreResponse {
  restored: true
  superseded: boolean
}

/* ------------------------------------------------------------------ */
/*  Relationships                                                       */
/* ------------------------------------------------------------------ */

export interface Relationship {
  id: string
  fromEntityType: string
  fromEntityId: string
  toEntityType: string
  toEntityId: string
  relationshipType: string
  confidence: number | null
  source: string | null
  createdAt: string
  properties: Record<string, unknown> | null
}

/* ------------------------------------------------------------------ */
/*  Staff Events                                                        */
/* ------------------------------------------------------------------ */

export interface StaffEvent {
  eventId: string
  timestamp: string
  staffComponent: 'Librarian' | 'Attendant' | 'Archivist' | 'Resolutionist'
  actionType: string
  agentId: string
  source: string
  entityType?: string | null
  entityId?: string | null
  key?: string | null
  reason?: string | null
  level: 'audit' | 'debug'
  metadata?: Record<string, unknown> | null
}

export interface EventListResponse {
  items: StaffEvent[]
  total: number | null
  limit: number
  offset: number
  oldestEventTimestamp: string | null
}

/* ------------------------------------------------------------------ */
/*  Health                                                              */
/* ------------------------------------------------------------------ */

export interface HealthCheck {
  name: string
  status: 'ok' | 'warn' | 'error'
  message: string
  detail?: Record<string, unknown>
}

/* CP-T052: Capability Health fields — returned alongside existing checks */

export interface HealthDecay {
  enabled: boolean
  stabilityBase: number
  stabilityIncrement: number
  stabilityMax: number
  decayThreshold: number
}

export interface HealthVectorBackend {
  type: 'pgvector' | 'qdrant' | 'chroma' | 'unknown'
  configured: boolean
  url: string | null
  status: 'ok' | 'warn' | 'error'
}

export interface HealthAttendant {
  status: 'ok' | 'warn' | 'error' | 'unreachable'
  message: string
  checkedAt: string
}

/* CP-T072: Runtime lifecycle metadata from Iranti v0.2.16 runtimeLifecycle.ts */
export interface IrantiRuntimeMetadata {
  instanceName: string
  pid: number
  port: number
  startedAt: string
  lastHeartbeatAt: string
  updatedAt: string
  status: 'starting' | 'running' | 'stopping' | 'stopped'
  version?: string
  healthUrl?: string | null
}

/** CP-T072: Derived staleness status — computed server-side so the frontend never
 *  needs to compare timestamps. 'unknown' means no runtime data (ad-hoc mode). */
export type RuntimeStatus = 'running' | 'stale' | 'stopped' | 'unknown'

export interface InstanceScopeSummary {
  instanceId: string
  instanceName: string
  source: 'query' | 'binding'
}

/** @deprecated Use IrantiRuntimeMetadata instead — kept for backwards compat */
export type InstanceRuntimeInfo = IrantiRuntimeMetadata

export interface HealthResponse {
  overall: 'healthy' | 'degraded' | 'error'
  checkedAt: string
  checks: HealthCheck[]
  scope?: InstanceScopeSummary
  /** CP-T052: Memory Decay configuration */
  decay?: HealthDecay
  /** CP-T052: Vector backend reachability */
  vectorBackend?: HealthVectorBackend
  /** CP-T052: Attendant status — live probe of /memory/attend */
  attendant?: HealthAttendant
  /** CP-T072: Runtime metadata from Iranti /health; null if ad-hoc or unreachable */
  runtime?: IrantiRuntimeMetadata | null
  /** CP-T072: Derived staleness status */
  runtimeStatus?: RuntimeStatus
}

/* ------------------------------------------------------------------ */
/*  Instances                                                           */
/* ------------------------------------------------------------------ */

export interface DatabaseMeta {
  host: string
  port: number
  name: string
  urlRedacted: string
}

export interface EnvFileMeta {
  present: boolean
  bindingPresent?: boolean
  path: string | null
  instanceEnvPath?: string | null
  keysPresent: string[]
  keysMissing: string[]
}

export interface IntegrationMeta {
  defaultProvider: string | null
  defaultModel: string | null
  providerKeys: {
    anthropic: boolean
    openai: boolean
  }
}

export interface ProjectIntegration {
  claudeMdPresent: boolean
  mcpConfigPresent: boolean
  mcpConfigHasIranti: boolean
  codexIntegration: {
    configPresent: boolean
  }
}

export interface ProjectBinding {
  projectId: string
  projectRoot: string
  integration: ProjectIntegration
}

export interface InstanceMetadata {
  instanceId: string
  name: string
  setupState?: 'running' | 'configured' | 'incomplete'
  runtimeRoot: string
  configuredPort: number
  runningStatus: 'running' | 'stopped' | 'unreachable' | 'unknown'
  runningStatusCheckedAt: string | null
  irantVersion: string | null
  database: DatabaseMeta | null
  envFile: EnvFileMeta
  integration: IntegrationMeta
  projects: ProjectBinding[]
  discoveredAt: string
  /** CP-T058 H8 — IRANTI_PROJECT_MODE env var value, null if not set */
  projectMode: 'isolated' | 'shared' | null
  /** CP-T072: Runtime lifecycle metadata — null for ad-hoc instances or if unreachable */
  runtime?: IrantiRuntimeMetadata | null
  /** CP-T072: Derived staleness status — 'unknown' if no runtime data */
  runtimeStatus?: RuntimeStatus
}

export interface InstanceListResponse {
  instances: InstanceMetadata[]
  discoveredAt: string
  discoverySource: 'registry' | 'scan' | 'hybrid'
}

/* ------------------------------------------------------------------ */
/*  Relationship Graph (CP-T032)                                        */
/* ------------------------------------------------------------------ */

export interface RelationshipGraphNode {
  entityType: string
  entityId: string
  factCount: number
  isRoot: boolean
}

export interface RelationshipGraphEdge {
  fromEntityType: string
  fromEntityId: string
  toEntityType: string
  toEntityId: string
  relationshipType: string
  confidence: number | null
  source: string | null
  createdBy: string | null
}

export interface RelationshipGraph {
  rootEntity: { entityType: string; entityId: string }
  nodes: RelationshipGraphNode[]
  edges: RelationshipGraphEdge[]
  truncated: boolean
}

/* ------------------------------------------------------------------ */
/*  Entity Detail                                                       */
/* ------------------------------------------------------------------ */

export interface EntityDetailResponse {
  /** Always null in Phase 1 — entities table does not exist in current Iranti schema */
  entity: null
  currentFacts: KBFact[]
  archivedFacts: ArchiveFact[]
  relationships: Relationship[]
}

/* ------------------------------------------------------------------ */
/*  WhoKnows / Contributors (CP-T057)                                  */
/* ------------------------------------------------------------------ */

export interface WhoKnowsContributor {
  agentId: string
  writeCount: number
  lastContributedAt: string | null
}

export interface WhoKnowsResponse {
  contributors: WhoKnowsContributor[]
  total: number
}

/* ------------------------------------------------------------------ */
/*  Temporal History                                                    */
/* ------------------------------------------------------------------ */

export interface HistoryInterval {
  id: string
  source: 'kb' | 'archive'
  valueSummary: string | null
  valueRaw: string | null
  confidence: number
  agentId: string | null
  providerSource: string | null
  validFrom: string | null
  validUntil: string | null
  archivedAt: string | null
  /** Human-readable label — raw archive reason codes are mapped before leaving the backend */
  archivedReason: string | null
  supersededBy: string | null
  resolutionState: string | null
  conflictLog: Record<string, unknown> | null
  createdAt: string
}

export interface TemporalHistoryResponse {
  entityType: string
  entityId: string
  key: string
  current: HistoryInterval | null
  history: HistoryInterval[]
  hasHistory: boolean
}

/** CP-T056 — Point-in-time asOf query result */
export interface AsOfQueryResult {
  entityType: string
  entityId: string
  key: string
  asOf: string
  /** The fact active at asOf, or null if none existed at that time */
  fact: HistoryInterval | null
}

/* ------------------------------------------------------------------ */
/*  Entity Aliases (CP-T061 / CP-T065)                                */
/* ------------------------------------------------------------------ */

export interface EntityAlias {
  alias: string
  aliasNorm: string
  source: string
  confidence: number
  createdAt: string
}

export interface EntityAliasesResponse {
  canonicalEntity: string
  aliases: EntityAlias[]
  total: number
}

/* ------------------------------------------------------------------ */
/*  Providers (CP-T034)                                                 */
/* ------------------------------------------------------------------ */

/** CP-T063: scope type — "global" means key applies to all namespaces */
export type ProviderScopeType = 'global' | 'namespace' | 'unknown'

export interface ProviderStatus {
  id: string
  name: string
  keyPresent: boolean
  keyEnvVar: string
  keyMasked: string | null
  reachable: boolean
  lastChecked: string
  isDefault: boolean
  /** CP-T063: scope string from provider config; null if unavailable */
  scope: string | null
  /** CP-T063: derived scope category; "unknown" if Iranti doesn't expose it */
  scopeType: ProviderScopeType
}

export interface ProvidersResponse {
  providers: ProviderStatus[]
  checkedAt: string
  /** Canonical default provider (LLM_PROVIDER env var), or null if not set */
  defaultProvider: string | null
  /** Ordered fallback chain (LLM_PROVIDER_FALLBACK env var), empty if not set */
  fallbackChain: string[]
  /**
   * CP-T087: current task-model routing overrides.
   * Key = task type, value = env var override (null = use provider default).
   * Task types: classification, relevance_filtering, conflict_resolution,
   * summarization, task_inference, extraction
   */
  taskRouting: Record<string, string | null>
}

/* ------------------------------------------------------------------ */
/*  Task-model routing (CP-T087)                                       */
/* ------------------------------------------------------------------ */

export interface RoutingDefaultsResponse {
  provider: string
  /** Default model for each task type given this provider */
  defaults: Record<string, string>
}

export interface TaskRoutingUpdateResult {
  ok: boolean
  written: Record<string, string | null>
  warnings: string[]
  /** Always true — Iranti reads these vars at startup */
  restartRequired: boolean
  taskRouting: Record<string, string | null>
}

/* ------------------------------------------------------------------ */
/*  Provider write path (CP-T085, CP-T086)                             */
/* ------------------------------------------------------------------ */

export interface ProviderWriteKeyResult {
  ok: boolean
  provider: string
  envVar: string
  keyMasked: string | null
}

export interface ProviderSetDefaultResult {
  ok: boolean
  provider: string | null
}

export interface ProviderFallbackResult {
  ok: boolean
  chain: string[]
}

export interface ProviderModelEntry {
  id: string
  name: string
  family: string
  context: number
}

export interface ProviderModelsResponse {
  providerId: string
  models: ProviderModelEntry[]
  source: 'static' | 'live' | 'fallback'
  fetchedAt: string
}

/* ------------------------------------------------------------------ */
/*  Setup Status (CP-T035)                                              */
/* ------------------------------------------------------------------ */

export interface SetupStep {
  id: string
  label: string
  status: 'complete' | 'incomplete' | 'warning' | 'not_applicable'
  message: string
  actionRequired: string | null
  repairAction: string | null
}

export interface SetupStatusResponse {
  instanceId: string
  steps: SetupStep[]
  isFullyConfigured: boolean
  firstRunDetected: boolean
}

/* ------------------------------------------------------------------ */
/*  Repair Actions (CP-T033)                                            */
/* ------------------------------------------------------------------ */

export interface RepairMcpJsonResponse {
  filePath: string
  content: string
  action: 'created' | 'replaced'
  revertable: false
}

export interface RepairClaudeMdResponse {
  filePath: string
  action: 'appended' | 'replaced' | 'created'
  diff: string
  revertable: false
}

export interface DoctorCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  message: string
  repairAction: string | null
}

export interface DoctorResponse {
  instanceId: string
  checks: DoctorCheck[]
  checkedAt: string
}

/* ------------------------------------------------------------------ */
/*  Agent Registry (CP-T051)                                           */
/* ------------------------------------------------------------------ */

export interface AgentStats {
  totalWrites: number
  totalRejections: number
  totalEscalations: number
  avgConfidence: number
  lastSeen: string | null
  isActive: boolean
}

export interface AgentRecord {
  agentId: string
  name: string | null
  description: string | null
  capabilities: string[]
  model: string | null
  properties: Record<string, unknown> | null
  team: string | null
  stats: AgentStats
}

export interface AgentsListResponse {
  agents: AgentRecord[]
  total: number
}

/* ------------------------------------------------------------------ */
/*  Metrics (CP-T060)                                                  */
/* ------------------------------------------------------------------ */

export interface KbGrowthDataPoint {
  date: string
  totalFacts: number
  newFacts: number
  archivedFacts: number
}

export interface KbGrowthResponse {
  period: '7d' | '30d'
  truncated: boolean
  data: KbGrowthDataPoint[]
}

export interface AgentActivityDataPoint {
  date: string
  writes: number
  rejections: number
  escalations: number
}

export interface AgentActivitySeries {
  agentId: string
  data: AgentActivityDataPoint[]
}

export interface AgentActivityResponse {
  period: '7d' | '30d'
  agents: AgentActivitySeries[]
}

export interface MetricsSummaryResponse {
  totalFacts: number
  factsLast24h: number
  factsLast7d: number
  activeAgentsLast7d: number
  rejectionRateLast7d: number
  archiveRateLast7d: number
}

/* ------------------------------------------------------------------ */
/*  Diagnostics (CP-T059)                                              */
/* ------------------------------------------------------------------ */

export interface DiagnosticCheckResult {
  check: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  fixHint: string | null
  durationMs: number
}

export interface DiagnosticRunResult {
  runAt: string
  overallStatus: 'pass' | 'warn' | 'fail'
  checks: DiagnosticCheckResult[]
  totalDurationMs: number
  scope?: InstanceScopeSummary
}

/* ------------------------------------------------------------------ */
/*  KB Search (CP-T066)                                                */
/* ------------------------------------------------------------------ */

export interface KBSearchResult {
  entityType: string
  entityId: string
  key: string
  valueSummary: string | null
  confidence: number
  source: string
  lexicalScore: number
  vectorScore: number
  score: number
}

export interface KBSearchResponse {
  results: KBSearchResult[]
  query: string
  total: number
}

/* ------------------------------------------------------------------ */
/*  Entity Type Browser (CP-T067)                                      */
/* ------------------------------------------------------------------ */

export interface EntityTypeSummary {
  entityType: string
  factCount: number
  lastUpdatedAt: string | null
}

export interface EntityTypesResponse {
  entityTypes: EntityTypeSummary[]
  total: number
}

/* ------------------------------------------------------------------ */
/*  Overview Dashboard (CP-T068)                                       */
/* ------------------------------------------------------------------ */

export interface OverviewHealthCheck {
  name: string
  status: string
}

export interface OverviewRecentEvent {
  id: string
  staffComponent: string
  actionType: string
  agentId: string | null
  entityType: string | null
  entityId: string | null
  key: string | null
  reason: string | null
  timestamp: string
}

export interface OverviewActiveAgent {
  agentId: string
  isActive: boolean
  lastSeen: string | null
  totalWrites: number
}

export interface OverviewResponse {
  health: {
    overall: string
    checks: OverviewHealthCheck[]
    fetchedAt: string
  }
  kb: {
    totalFacts: number
    factsLast24h: number
    activeAgentsLast7d: number
    truncated: boolean
    fetchedAt: string
  }
  recentEvents: OverviewRecentEvent[]
  activeAgents: OverviewActiveAgent[]
  fetchedAt: string
}

/* ------------------------------------------------------------------ */
/*  Upgrade Jobs (CP-T073)                                             */
/* ------------------------------------------------------------------ */

export interface UpgradeJobStarted {
  jobId: string
  instanceName: string
  status: 'started'
  startedAt: string
}

export interface UpgradeJobStatus {
  jobId: string
  instanceName: string
  status: 'running' | 'complete' | 'failed'
  output: string[]
  exitCode: number | null
  startedAt: string
  completedAt: string | null
}

/* ------------------------------------------------------------------ */
/*  Sessions (CP-T071)                                                 */
/* ------------------------------------------------------------------ */

export type SessionState = 'interrupted' | 'checkpointed' | 'complete' | 'abandoned' | 'unknown'

export interface SessionRecord {
  sessionId: string
  agentId: string
  state: SessionState
  task: string | null
  startedAt: string | null
  lastCheckpointAt: string | null
  completedAt: string | null
  abandonedAt: string | null
  /** Raw checkpoint data — backend may include this; optional */
  checkpoint?: Record<string, unknown> | null
}

export interface SessionsResponse {
  sessions: SessionRecord[]
  total: number
  fetchedAt: string
  /** Non-fatal error message when Iranti is unreachable or sessions not queryable */
  error?: string
  /** Informational note explaining which data sources were checked */
  note?: string
}

export interface SessionActionResponse {
  success: boolean
  sessionId: string
  message?: string
  error?: string
}

/* ------------------------------------------------------------------ */
/*  Version Sync (CP-T078)                                             */
/* ------------------------------------------------------------------ */

export interface VersionSyncResult {
  installedVersion: string | null
  latestVersion: string | null
  upToDate: boolean | null
  releaseUrl: string
}

/* ------------------------------------------------------------------ */
/*  Install State (CP-T079)                                            */
/* ------------------------------------------------------------------ */

export interface InstallStateResult {
  installed: boolean
  version: string | null         // semver string e.g. "0.2.16", null if not installed
  executablePath: string | null  // absolute path from `which`/`where`
  checkedAt: string              // ISO timestamp
}

/* ------------------------------------------------------------------ */
/*  Process Lifecycle (CP-T080)                                        */
/* ------------------------------------------------------------------ */

export interface StartInstanceResult {
  instanceName?: string
  instance?: string
  pid?: number
  status?: 'started'
  startedAt?: string
  started?: boolean
  reason?: string
  /** Present on error paths */
  error?: string
  code?: string
}

export interface StopInstanceResult {
  instanceName: string
  pid: number | null
  status: 'stopped'
  stoppedAt: string
  /** Present on error paths (404) */
  error?: string
  code?: string
}

export interface ProcessStatusResult {
  managed: boolean
  pid: number | null
  alive: boolean | null
}

/* ------------------------------------------------------------------ */
/*  Open File (CP-T084)                                                */
/* ------------------------------------------------------------------ */

export interface OpenFileResult {
  opened: boolean
  path: string
  reason?: string
}

/* ------------------------------------------------------------------ */
/*  Auth Key Manager (CP-T088)                                         */
/* ------------------------------------------------------------------ */

export interface AuthKey {
  keyId:        string
  owner:        string
  scopes:       string[]
  description:  string | null
  createdAt:    string
  updatedAt:    string
  revoked:      boolean
  revokedAt:    string | null
}

export interface AuthKeysListResponse {
  keys: AuthKey[]
}

export interface AuthKeyCreateResult {
  ok:       boolean
  keyId:    string
  /** Full token — shown once only, must be copied before leaving the page */
  token:    string
  scopes:   string[]
  /** Non-fatal warning (e.g. syncToProject failed after successful creation) */
  warning?: string
}

export interface AuthKeyRevokeResult {
  ok:    boolean
  keyId: string
}

/* ------------------------------------------------------------------ */
/*  Instance Create (CP-T089)                                          */
/* ------------------------------------------------------------------ */

export interface CreateInstanceResult {
  ok: boolean
  name: string
  instanceDir: string
  envFile: string
  port: number
  provider: string
  note: string
}

/* ------------------------------------------------------------------ */
/*  Instance Configure (CP-T090)                                       */
/* ------------------------------------------------------------------ */

export interface ConfigureInstanceResult {
  ok: boolean
  name: string
  restartRequired: boolean
  changed: string[]
}

/* ------------------------------------------------------------------ */
/*  Project Bindings (CP-T091)                                         */
/* ------------------------------------------------------------------ */

export interface BoundProject {
  projectPath: string
  agentId: string
  memoryEntity: string
  mode: 'isolated' | 'shared'
  boundAt: string
}

export interface ProjectsListResponse {
  instanceName: string
  projects: BoundProject[]
}

export interface BindProjectResult {
  ok: boolean
  projectPath: string
  envIrantiPath: string
  instanceName: string
  agentId: string
  memoryEntity: string
  mode: string
}

export interface RebindProjectResult {
  ok: boolean
  projectPath: string
  changed: string[]
}

/* ------------------------------------------------------------------ */
/*  Claude Code Integration (CP-T092, CP-T093)                        */
/* ------------------------------------------------------------------ */

export interface ClaudeIntegrationStatus {
  projectPath: string
  mcpJson: Record<string, unknown> | null
  mcpJsonPath: string | null
  hooksJson: Record<string, unknown> | null
  hooksJsonPath: string | null
  irantiMcpEntry: { command: string; args: string[]; env?: Record<string, string> } | null
  irantiHooks: { sessionStart: string | null; userPromptSubmit: string | null }
  issues: string[]
}

export interface ScaffoldResult {
  ok: boolean
  written: string[]
  output?: string
  error?: string
}

export interface IntegrationSummaryItem {
  projectPath: string
  mcpPresent: boolean
  irantiMcpRegistered: boolean
  hooksPresent: boolean
  irantiHooksCount: number
  issues: string[]
}

export interface IntegrationSummaryResponse {
  instanceName: string
  projects: IntegrationSummaryItem[]
}

/* ------------------------------------------------------------------ */
/*  Codex Integration (CP-T095)                                        */
/* ------------------------------------------------------------------ */

export interface CodexIntegrationStatus {
  codexInstalled: boolean
  irantiRegistered: boolean
  registeredConfig: Record<string, unknown> | null
  issues: string[]
}

export interface CodexSetupResult {
  ok: boolean
  output: string
  error?: string
}

export interface CodexRemoveResult {
  ok: boolean
  output?: string
  error?: string
}

/* ------------------------------------------------------------------ */
/*  Attendant Debug Tools (CP-T096)                                    */
/* ------------------------------------------------------------------ */

/**
 * Iranti returns a variable-shape handshake brief.
 * The control plane passes the response body through as-is.
 */
export interface HandshakeResult {
  [key: string]: unknown
}

/**
 * Iranti returns a variable-shape attend result.
 * The control plane passes the response body through as-is.
 */
export interface AttendResult {
  [key: string]: unknown
}

