/**
 * cp-config.ts — Persistent user configuration for the Control Plane itself.
 *
 * Routes:
 *   GET   /cp-config  — Return the persisted default port (or null).
 *   PATCH /cp-config  — Set or clear the persisted default port.
 *
 * Config is stored in ~/.iranti-runtime/iranti-cp-config.json so it
 * survives control-plane restarts and npm updates. The default port takes
 * effect the next time `iranti-cp` starts.
 */

import { Router } from 'express'
import { homedir } from 'os'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

export const cpConfigRouter = Router()

interface CpUserConfig {
  defaultPort?: number | null
}

function getConfigPath(): string {
  return join(homedir(), '.iranti-runtime', 'iranti-cp-config.json')
}

function readConfig(): CpUserConfig {
  try {
    const raw = readFileSync(getConfigPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as CpUserConfig) : {}
  } catch {
    return {}
  }
}

function writeConfig(config: CpUserConfig): void {
  mkdirSync(join(homedir(), '.iranti-runtime'), { recursive: true })
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf8')
}

// GET /cp-config — return the persisted default port
cpConfigRouter.get('/cp-config', (_req, res) => {
  const config = readConfig()
  res.json({ defaultPort: config.defaultPort ?? null })
})

// PATCH /cp-config — update or clear the persisted default port
cpConfigRouter.patch('/cp-config', (req, res) => {
  const { defaultPort } = req.body as { defaultPort?: unknown }

  if (defaultPort === null || defaultPort === undefined) {
    const config = readConfig()
    delete config.defaultPort
    writeConfig(config)
    res.json({ ok: true, defaultPort: null })
    return
  }

  const parsed = Number.parseInt(String(defaultPort), 10)
  if (!Number.isFinite(parsed) || parsed < 1024 || parsed > 65535) {
    res.status(400).json({ error: `Invalid port: "${defaultPort}". Must be 1024–65535.` })
    return
  }

  const config = readConfig()
  config.defaultPort = parsed
  writeConfig(config)
  res.json({ ok: true, defaultPort: parsed })
})
