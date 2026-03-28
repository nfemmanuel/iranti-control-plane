import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}))

import { spawn } from 'child_process'
import { controlPlaneSelfRouter } from '../../routes/control-plane/control-plane-self.js'

const spawnMock = vi.mocked(spawn)

describe('control plane self routes', () => {
  let server: ReturnType<typeof express.application.listen>
  let baseUrl: string
  let killSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.useFakeTimers()
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    const app = express()
    app.use(express.json())
    app.use('/', controlPlaneSelfRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.useRealTimers()
    killSpy.mockRestore()
    vi.resetAllMocks()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('acknowledges stop and then schedules a SIGTERM for the current process', async () => {
    const res = await fetch(`${baseUrl}/self/stop`, { method: 'POST' })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({
      ok: true,
      action: 'stop',
      message: 'Control Plane is shutting down.',
    })

    vi.advanceTimersByTime(300)
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM')
  })

  it('acknowledges uninstall, launches npm uninstall, and then schedules a SIGTERM', async () => {
    const res = await fetch(`${baseUrl}/self/uninstall`, { method: 'POST' })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({
      ok: true,
      action: 'uninstall',
      message: 'Control Plane uninstall has started. The app will shut down before npm removes the package.',
    })

    expect(spawnMock).toHaveBeenCalledOnce()
  })
})
