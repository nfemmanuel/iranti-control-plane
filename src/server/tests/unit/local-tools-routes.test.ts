import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'

vi.mock('../../lib/local-operator-tools.js', () => ({
  pickLocalPath: vi.fn(),
  runLocalCommand: vi.fn(),
}))

import { pickLocalPath, runLocalCommand } from '../../lib/local-operator-tools.js'
import { localToolsRouter } from '../../routes/control-plane/local-tools.js'

const pickLocalPathMock = vi.mocked(pickLocalPath)
const runLocalCommandMock = vi.mocked(runLocalCommand)

describe('local tools routes', () => {
  let server: ReturnType<typeof express.application.listen>
  let baseUrl: string

  beforeEach(async () => {
    const app = express()
    app.use(express.json())
    app.use('/', localToolsRouter)
    server = app.listen(0)
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('validates pick-path input before invoking the native picker', async () => {
    const res = await fetch(`${baseUrl}/pick-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'directory', startPath: 'relative\\path' }),
    })

    expect(res.status).toBe(400)
    expect(pickLocalPathMock).not.toHaveBeenCalled()
  })

  it('returns the selected directory from the picker route', async () => {
    pickLocalPathMock.mockResolvedValue({
      canceled: false,
      path: 'C:\\Users\\NF\\Documents\\Projects\\demo',
      method: 'powershell',
    })

    const res = await fetch(`${baseUrl}/pick-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'directory',
        startPath: 'C:\\Users\\NF\\Documents\\Projects',
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      canceled: false,
      path: 'C:\\Users\\NF\\Documents\\Projects\\demo',
      method: 'powershell',
    })
  })

  it('validates run-command input before spawning a process', async () => {
    const res = await fetch(`${baseUrl}/run-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'iranti status', cwd: '.\\relative' }),
    })

    expect(res.status).toBe(400)
    expect(runLocalCommandMock).not.toHaveBeenCalled()
  })

  it('returns stdout and exit status from a runnable command', async () => {
    runLocalCommandMock.mockResolvedValue({
      ok: true,
      command: 'iranti status',
      cwd: null,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 123,
    })

    const res = await fetch(`${baseUrl}/run-command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'iranti status' }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      command: 'iranti status',
      cwd: null,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 123,
    })
  })
})
