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
  agentId: string
  validFrom: string | null
  validUntil: string | null
  createdAt: string
  updatedAt: string | null
  properties: Record<string, unknown> | null
  conflictLog: Record<string, unknown> | null
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

export interface HealthResponse {
  overall: 'healthy' | 'degraded' | 'error'
  checkedAt: string
  checks: HealthCheck[]
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
  path: string | null
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

/* ------------------------------------------------------------------ */
/*  Providers (CP-T034)                                                 */
/* ------------------------------------------------------------------ */

export interface ProviderStatus {
  id: string
  name: string
  keyPresent: boolean
  keyEnvVar: string
  keyMasked: string | null
  reachable: boolean
  lastChecked: string
  isDefault: boolean
}

export interface ProvidersResponse {
  providers: ProviderStatus[]
  checkedAt: string
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
