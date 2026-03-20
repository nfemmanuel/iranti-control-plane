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
}

export interface ArchiveListResponse extends PaginatedResponse<ArchiveFact> {}

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
