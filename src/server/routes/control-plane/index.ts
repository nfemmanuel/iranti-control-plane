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
import { localToolsRouter } from './local-tools.js'
import { controlPlaneSelfRouter } from './control-plane-self.js'
import { sessionLedgerRouter } from './session-ledger.js'

export const controlPlaneRouter = Router()

// Mount sub-routers
controlPlaneRouter.use('/', archivistRouter)
controlPlaneRouter.use('/', kbRouter)
controlPlaneRouter.use('/', whoknowsRouter)
controlPlaneRouter.use('/instances', projectBindingsRouter)
controlPlaneRouter.use('/instances', claudeIntegrationRouter)
controlPlaneRouter.use('/instances', instancesRouter)
controlPlaneRouter.use('/instances', setupRouter)
controlPlaneRouter.use('/instances', repairRouter)
controlPlaneRouter.use('/health', healthRouter)
controlPlaneRouter.use('/events', eventsRouter)
controlPlaneRouter.use('/logs', logsRouter)
controlPlaneRouter.use('/escalations', escalationsRouter)
controlPlaneRouter.use('/', providersRouter)
controlPlaneRouter.use('/instances', providersRouter)
controlPlaneRouter.use('/', chatRouter)
controlPlaneRouter.use('/', agentsRouter)
controlPlaneRouter.use('/diagnostics', diagnosticsRouter)
controlPlaneRouter.use('/metrics', metricsRouter)
controlPlaneRouter.use('/overview', overviewRouter)
controlPlaneRouter.use('/sessions', sessionsRouter)
controlPlaneRouter.use('/session-ledger', sessionLedgerRouter)
controlPlaneRouter.use('/instances', upgradeRouter)
controlPlaneRouter.use('/version-sync', versionSyncRouter)
controlPlaneRouter.use('/install-state', installStateRouter)
controlPlaneRouter.use('/instances', lifecycleRouter)
controlPlaneRouter.use('/open-file', openFileRouter)
controlPlaneRouter.use('/', localToolsRouter)
controlPlaneRouter.use('/', controlPlaneSelfRouter)
controlPlaneRouter.use('/auth-keys', authKeysRouter)
controlPlaneRouter.use('/', instanceLifecycleRouter)
controlPlaneRouter.use('/integrations', codexIntegrationRouter)
controlPlaneRouter.use('/debug', attendantDebugRouter)
