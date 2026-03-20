import { Router } from 'express'
import { kbRouter } from './kb.js'
import { instancesRouter } from './instances.js'
import { healthRouter } from './health.js'
import { eventsRouter } from './events.js'
import { setupRouter } from './setup.js'
import { repairRouter } from './repair.js'

export const controlPlaneRouter = Router()

// Mount sub-routers
controlPlaneRouter.use('/', kbRouter)
controlPlaneRouter.use('/instances', instancesRouter)
controlPlaneRouter.use('/instances', setupRouter)
controlPlaneRouter.use('/instances', repairRouter)
controlPlaneRouter.use('/health', healthRouter)
controlPlaneRouter.use('/events', eventsRouter)
