import { Router } from 'express'
import { kbRouter } from './kb.js'
import { instancesRouter } from './instances.js'
import { healthRouter } from './health.js'
import { eventsRouter } from './events.js'
import { logsRouter } from './logs.js'
import { setupRouter } from './setup.js'
import { repairRouter } from './repair.js'
import { escalationsRouter } from './escalations.js'
import { providersRouter } from './providers.js'
import { chatRouter } from './chat.js'
import { archivistRouter } from './archivist.js'
import { agentsRouter } from './agents.js'
import { whoknowsRouter } from './whoknows.js'
import { diagnosticsRouter } from './diagnostics.js'
import { metricsRouter } from './metrics.js'
import { overviewRouter } from './overview.js'
import { sessionsRouter } from './sessions.js'
import { upgradeRouter } from './upgrade.js'
import { versionSyncRouter } from './version-sync.js'
import { installStateRouter } from './install-state.js'
import { lifecycleRouter } from './lifecycle.js'
import { openFileRouter } from './open-file.js'
import { authKeysRouter } from './auth-keys.js'
import { instanceLifecycleRouter } from './instance-lifecycle.js'
import { projectBindingsRouter } from './project-bindings.js'
import { claudeIntegrationRouter } from './claude-integration.js'
import { codexIntegrationRouter } from './codex-integration.js'
import { attendantDebugRouter } from './attendant-debug.js'

export const controlPlaneRouter = Router()

// Mount sub-routers
controlPlaneRouter.use('/', archivistRouter)
controlPlaneRouter.use('/', kbRouter)
// WhoKnows proxy: GET /kb/whoknows/:entityType/:entityId → proxies /memory/whoknows/... on Iranti
controlPlaneRouter.use('/', whoknowsRouter)
// Project bindings: POST/PATCH/GET /instances/:instanceName/projects — CP-T091
// Mounted BEFORE instancesRouter so the specific /projects routes shadow the Phase-1 stub
controlPlaneRouter.use('/instances', projectBindingsRouter)
// Claude Code integration: GET/POST .../projects/:projectId/claude-integration — CP-T092/T093
// Mounted AFTER projectBindingsRouter (more specific routes win in Express)
controlPlaneRouter.use('/instances', claudeIntegrationRouter)
controlPlaneRouter.use('/instances', instancesRouter)
controlPlaneRouter.use('/instances', setupRouter)
controlPlaneRouter.use('/instances', repairRouter)
controlPlaneRouter.use('/health', healthRouter)
controlPlaneRouter.use('/events', eventsRouter)
controlPlaneRouter.use('/logs', logsRouter)
controlPlaneRouter.use('/escalations', escalationsRouter)
// Flat provider routes: GET /providers, GET /providers/:id/models
// Instance-scoped provider routes: GET /instances/:instanceId/providers, etc.
controlPlaneRouter.use('/', providersRouter)
controlPlaneRouter.use('/instances', providersRouter)
// Chat endpoint: POST /chat, DELETE /chat/:sessionId
controlPlaneRouter.use('/', chatRouter)
// Agent Registry: GET /agents, GET /agents/:agentId
controlPlaneRouter.use('/', agentsRouter)
// Diagnostics: POST /diagnostics/run, GET /diagnostics/last
controlPlaneRouter.use('/diagnostics', diagnosticsRouter)
// Metrics Dashboard: GET /metrics/kb-growth, GET /metrics/agent-activity, GET /metrics/summary
controlPlaneRouter.use('/metrics', metricsRouter)
// Overview Dashboard: GET /overview — CP-T068
controlPlaneRouter.use('/overview', overviewRouter)
// Session Recovery: GET /sessions, POST /sessions/:sessionId/resume, POST /sessions/:sessionId/abandon — CP-T071
controlPlaneRouter.use('/sessions', sessionsRouter)
// Upgrade coordination: POST /instances/:name/upgrade, GET /instances/:name/upgrade/:jobId — CP-T073
controlPlaneRouter.use('/instances', upgradeRouter)
// Version sync: GET /version-sync — CP-T078
controlPlaneRouter.use('/version-sync', versionSyncRouter)
// Install state: GET /install-state — CP-T079
controlPlaneRouter.use('/install-state', installStateRouter)
// Lifecycle controls: POST /instances/:name/start, POST /instances/:name/stop, GET /instances/:name/process-status — CP-T080
controlPlaneRouter.use('/instances', lifecycleRouter)
// Open local file in system editor: POST /open-file — CP-T084
controlPlaneRouter.use('/open-file', openFileRouter)
// Auth Key Manager: GET/POST /auth-keys, DELETE /auth-keys/:keyId — CP-T088
controlPlaneRouter.use('/auth-keys', authKeysRouter)
// Instance Create & Configure: POST /instances, PATCH /instances/:name — CP-T089/T090
controlPlaneRouter.use('/', instanceLifecycleRouter)
// Codex Integration Manager: GET/POST/DELETE /integrations/codex — CP-T095
controlPlaneRouter.use('/integrations', codexIntegrationRouter)
// Attendant Debug Tools: POST /debug/handshake, POST /debug/attend — CP-T096
controlPlaneRouter.use('/debug', attendantDebugRouter)
