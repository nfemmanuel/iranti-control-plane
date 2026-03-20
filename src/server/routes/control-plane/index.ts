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

export const controlPlaneRouter = Router()

// Mount sub-routers
controlPlaneRouter.use('/', kbRouter)
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
