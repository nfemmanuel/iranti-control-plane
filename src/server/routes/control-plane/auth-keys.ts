/**
 * auth-keys.ts — API key management routes for Iranti instances. (CP-T088)
 *
 * Routes:
 *   GET    /auth-keys            — List all keys (no raw tokens, metadata only).
 *   POST   /auth-keys            — Create or rotate a key; returns the full token once.
 *   DELETE /auth-keys/:keyId     — Revoke a key (remains visible for audit purposes).
 *
 * Storage: keys are stored in the instance's knowledge_base as a JSON blob
 * under entity_type=system / entity_id=auth / key=api_keys. The raw token
 * is hashed (SHA-256) before storage; the full token is returned to the caller
 * exactly once at creation time.
 *
 * Scope: all routes require an instanceId query param or fall back to the
 * binding-configured instance. 503 is returned if no instance is found.
 */

import { Router, Request, Response } from 'express'
import { createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import pg from 'pg'
import { resolveInstanceAuthority, type ResolvedInstanceAuthority } from '../../lib/instance-authority.js'

export const authKeysRouter = Router()

const { Pool } = pg

const REGISTRY_ENTITY_TYPE = 'system'
const REGISTRY_ENTITY_ID   = 'auth'
const REGISTRY_KEY         = 'api_keys'
const REGISTRY_SOURCE      = 'system'
const REGISTRY_CREATED_BY  = 'system'

export const STANDARD_SCOPES = [
  'kb:read',
  'kb:write',
  'memory:read',
  'memory:write',
  'agents:read',
  'agents:write',
  'metrics:read',
] as const

interface ApiKeyRecord {
  keyId:       string
  owner:       string
  secretHash:  string
  scopes:      string[]
  isActive:    boolean
  createdAt:   string
  revokedAt:   string | null
  description?: string
  updatedAt?:  string
}

interface ApiKeyRegistry {
  version: number
  keys:    ApiKeyRecord[]
}

function keyPepper(scope: ResolvedInstanceAuthority): string {
  return scope.env['IRANTI_API_KEY_PEPPER']?.trim() ?? ''
}

function hashSecret(secret: string, scope: ResolvedInstanceAuthority): string {
  return createHash('sha256').update(`${secret}${keyPepper(scope)}`).digest('hex')
}

function generateSecret(length = 32): string {
  return randomBytes(length).toString('base64url')
}

function sanitizeKeyId(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
}

function formatToken(keyId: string, secret: string): string {
  return `${sanitizeKeyId(keyId)}.${secret}`
}

function validateScopeList(scopes: string[]): void {
  for (const scope of scopes) {
    const s = scope.trim()
    if (!s) throw new Error('scope cannot be empty')
    if (s === '*') continue
    const parts = s.split(':')
    if (parts.length < 2 || parts.length > 3) {
      throw new Error(`scope "${scope}" must be "resource:action" or "resource:action:entityType/entityId"`)
    }
    const [resource, action] = parts
    if (!resource || !action) {
      throw new Error(`scope "${scope}" must include both resource and action`)
    }
    if (parts.length === 3) {
      const namespace = parts[2].trim()
      if (!namespace) {
        throw new Error(`scope "${scope}" namespace cannot be empty`)
      }

      const ns = namespace.split('/')
      if (ns.length !== 2) {
        throw new Error(`scope "${scope}" namespace must be "entityType/entityId" or "entityType/*"`)
      }

      const [entityType, entityId] = ns
      if (!entityType || !entityId) {
        throw new Error(`scope "${scope}" namespace must include both entityType and entityId`)
      }

      if (entityType === '*' && entityId !== '*') {
        throw new Error(`scope "${scope}" namespace cannot use wildcard entityType with a specific entityId`)
      }
    }
  }
}

async function withScopedPool<T>(scope: ResolvedInstanceAuthority, fn: (pool: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({
    connectionString: scope.databaseUrl!,
    max: 1,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })

  try {
    return await fn(pool)
  } finally {
    await Promise.resolve(pool.end()).catch(() => undefined)
  }
}

async function loadRegistry(pool: pg.Pool): Promise<ApiKeyRegistry> {
  const result = await pool.query<{ valueRaw: unknown }>(
    `SELECT "valueRaw" FROM knowledge_base
     WHERE "entityType" = $1 AND "entityId" = $2 AND key = $3
     LIMIT 1`,
    [REGISTRY_ENTITY_TYPE, REGISTRY_ENTITY_ID, REGISTRY_KEY]
  )

  if (result.rows.length === 0) {
    return { version: 1, keys: [] }
  }

  return normalizeRegistry(result.rows[0]?.valueRaw)
}

async function saveRegistry(pool: pg.Pool, registry: ApiKeyRegistry): Promise<void> {
  const normalized = normalizeRegistry(registry)
  const valueSummary = `API key registry (${normalized.keys.length} keys)`

  await pool.query(
    `INSERT INTO knowledge_base
       ("entityType", "entityId", key, "valueRaw", "valueSummary",
        confidence, source, "createdBy", "isProtected", "conflictLog", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4::jsonb, $5, 100, $6, $7, true, '[]'::jsonb, now(), now())
     ON CONFLICT ("entityType", "entityId", key)
     DO UPDATE SET
       "valueRaw"     = EXCLUDED."valueRaw",
       "valueSummary" = EXCLUDED."valueSummary",
       "updatedAt"    = now()`,
    [
      REGISTRY_ENTITY_TYPE,
      REGISTRY_ENTITY_ID,
      REGISTRY_KEY,
      JSON.stringify(normalized),
      valueSummary,
      REGISTRY_SOURCE,
      REGISTRY_CREATED_BY,
    ]
  )
}

function normalizeRegistry(raw: unknown): ApiKeyRegistry {
  if (!raw || typeof raw !== 'object') {
    return { version: 1, keys: [] }
  }
  const maybe = raw as Record<string, unknown>
  const keysRaw = Array.isArray(maybe.keys) ? maybe.keys : []
  const keys: ApiKeyRecord[] = []

  for (const k of keysRaw) {
    if (!k || typeof k !== 'object') continue
    const r = k as Record<string, unknown>
    if (!r.keyId || !r.secretHash || !r.owner) continue
    keys.push({
      keyId:       sanitizeKeyId(String(r.keyId)),
      owner:       String(r.owner),
      secretHash:  String(r.secretHash),
      scopes:      Array.isArray(r.scopes) ? (r.scopes as unknown[]).map(String) : [],
      isActive:    r.isActive !== false,
      createdAt:   r.createdAt ? String(r.createdAt) : new Date().toISOString(),
      updatedAt:   r.updatedAt ? String(r.updatedAt) : undefined,
      revokedAt:   r.revokedAt ? String(r.revokedAt) : null,
      description: r.description ? String(r.description) : undefined,
    })
  }

  return {
    version: typeof maybe.version === 'number' ? maybe.version : 1,
    keys,
  }
}

function syncTokenToProject(projectRoot: string, token: string): void {
  const envPath = resolve(projectRoot, '.env.iranti')
  let lines: string[] = []

  if (existsSync(envPath)) {
    lines = readFileSync(envPath, 'utf8').split('\n')
  }

  let found = false
  const updated: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('#') && trimmed.indexOf('=') !== -1) {
      const lineKey = trimmed.slice(0, trimmed.indexOf('=')).trim()
      if (lineKey === 'IRANTI_API_KEY') {
        found = true
        updated.push(`IRANTI_API_KEY=${token}`)
        continue
      }
    }
    updated.push(line)
  }

  if (!found) {
    updated.push(`IRANTI_API_KEY=${token}`)
  }

  writeFileSync(envPath, updated.join('\n'), 'utf8')
}

async function resolveScopedInstance(req: Request, res: Response): Promise<ResolvedInstanceAuthority | null> {
  const instanceId = typeof req.query.instanceId === 'string' ? req.query.instanceId.trim() : ''
  const scope = await resolveInstanceAuthority(instanceId || undefined)

  if (!scope) {
    res.status(404).json({
      error: instanceId
        ? `Iranti instance not found: ${instanceId}`
        : 'No Iranti instance could be resolved. Select an instance first.',
      code: 'INSTANCE_NOT_FOUND',
    })
    return null
  }

  if (!scope.databaseUrl) {
    res.status(503).json({
      error: `No DATABASE_URL configured for instance ${scope.instanceName}. Configure the instance database first.`,
      code: 'NO_DATABASE_URL',
    })
    return null
  }

  return scope
}

authKeysRouter.get('/', async (req: Request, res: Response) => {
  const scope = await resolveScopedInstance(req, res)
  if (!scope) return

  try {
    const registry = await withScopedPool(scope, (pool) => loadRegistry(pool))
    const keys = registry.keys.map((k) => ({
      keyId:       k.keyId,
      owner:       k.owner,
      scopes:      k.scopes,
      description: k.description ?? null,
      createdAt:   k.createdAt,
      updatedAt:   k.updatedAt ?? k.createdAt,
      revoked:     !k.isActive,
      revokedAt:   k.revokedAt ?? null,
    }))

    res.json({ keys })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[auth-keys] GET failed:', message)
    res.status(500).json({ error: message })
  }
})

authKeysRouter.post('/', async (req: Request, res: Response) => {
  const scope = await resolveScopedInstance(req, res)
  if (!scope) return

  const { keyId: keyIdRaw, owner, scopes, description, syncToProject } = req.body as {
    keyId?: unknown
    owner?: unknown
    scopes?: unknown
    description?: unknown
    syncToProject?: unknown
  }

  if (!keyIdRaw || typeof keyIdRaw !== 'string') {
    res.status(400).json({ error: 'keyId is required and must be a string.' })
    return
  }
  const keyId = sanitizeKeyId(keyIdRaw)
  if (!keyId) {
    res.status(400).json({ error: 'keyId is invalid - only letters, numbers, "_" and "-" are allowed.' })
    return
  }

  if (!owner || typeof owner !== 'string' || !owner.trim()) {
    res.status(400).json({ error: 'owner is required.' })
    return
  }

  const scopeList: string[] = Array.isArray(scopes)
    ? (scopes as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
    : []

  try {
    validateScopeList(scopeList)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    return
  }

  try {
    const now = new Date().toISOString()
    const secret = generateSecret()
    const secretHash = hashSecret(secret, scope)
    const token = formatToken(keyId, secret)

    await withScopedPool(scope, async (pool) => {
      const registry = await loadRegistry(pool)
      const record: ApiKeyRecord = {
        keyId,
        owner: owner.trim(),
        secretHash,
        scopes: scopeList,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        revokedAt: null,
        description: typeof description === 'string' ? description.trim() || undefined : undefined,
      }

      const withoutExisting = registry.keys.filter((key) => key.keyId !== keyId)
      withoutExisting.push(record)
      await saveRegistry(pool, { ...registry, keys: withoutExisting })
    })

    if (typeof syncToProject === 'string' && syncToProject.trim()) {
      try {
        syncTokenToProject(syncToProject.trim(), token)
      } catch (syncErr) {
        const syncWarn = syncErr instanceof Error ? syncErr.message : String(syncErr)
        res.status(201).json({
          ok: true,
          keyId,
          token,
          scopes: scopeList,
          warning: `Key created but sync to project failed: ${syncWarn}`,
        })
        return
      }
    }

    res.status(201).json({ ok: true, keyId, token, scopes: scopeList })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[auth-keys] POST failed:', message)
    res.status(500).json({ error: message })
  }
})

authKeysRouter.delete('/:keyId', async (req: Request, res: Response) => {
  const scope = await resolveScopedInstance(req, res)
  if (!scope) return

  const keyId = sanitizeKeyId(req.params.keyId ?? '')
  if (!keyId) {
    res.status(400).json({ error: 'keyId is required.' })
    return
  }

  try {
    const revoked = await withScopedPool(scope, async (pool) => {
      const registry = await loadRegistry(pool)
      const target = registry.keys.find((key) => key.keyId === keyId)
      if (!target) {
        return false
      }

      target.isActive = false
      target.revokedAt = new Date().toISOString()
      target.updatedAt = target.revokedAt
      await saveRegistry(pool, registry)
      return true
    })

    if (!revoked) {
      res.status(404).json({ error: `API key not found: ${keyId}` })
      return
    }

    res.json({ ok: true, keyId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[auth-keys] DELETE failed:', message)
    res.status(500).json({ error: message })
  }
})
