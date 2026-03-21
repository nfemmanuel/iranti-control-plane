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

export const controlPlaneRouter = Router()

// Mount sub-routers
controlPlaneRouter.use('/', archivistRouter)
controlPlaneRouter.use('/', kbRouter)
// WhoKnows proxy: GET /kb/whoknows/:entityType/:entityId → proxies /memory/whoknows/... on Iranti
controlPlaneRouter.use('/', whoknowsRouter)
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
