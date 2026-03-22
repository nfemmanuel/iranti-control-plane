/**
 * Auth Key Manager routes — CP-T088
 *
 * Manages Iranti registry-backed API keys. These are distinct from upstream
 * provider keys (OpenAI, Anthropic, etc.) — they are the tokens that agents
 * and project bindings use to authenticate against the Iranti instance.
 *
 * The key registry is stored as a JSON blob in the knowledge_entries table:
 *   entityType = 'system', entityId = 'auth', key = 'api_keys'
 *
 * Routes:
 *   GET    /api/control-plane/auth-keys           — list all keys (no raw tokens)
 *   POST   /api/control-plane/auth-keys           — create/rotate a key
 *   DELETE /api/control-plane/auth-keys/:keyId    — revoke a key
 *
 * SECURITY: raw token values are NEVER returned by list/get endpoints.
 * The full token is returned exactly once on creation, matching the Iranti
 * CLI behaviour ("Copy this token now — it will not be shown again.").
 *
 * The backend connects directly to the Iranti instance PostgreSQL DB using
 * the DATABASE_URL resolved from the instance env by db.ts. We do NOT proxy
 * through the Iranti HTTP API because we are managing the auth tokens
 * themselves and cannot authenticate against an API that we are setting up.
 */

import { Router, Request, Response } from 'express'
import { createHash, randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { env, query } from '../../db.js'

export const authKeysRouter = Router()

// ---------------------------------------------------------------------------
// Constants — must match Iranti's src/security/apiKeys.ts
// ---------------------------------------------------------------------------

const REGISTRY_ENTITY_TYPE = 'system'
const REGISTRY_ENTITY_ID   = 'auth'
const REGISTRY_KEY         = 'api_keys'
const REGISTRY_SOURCE      = 'system'
const REGISTRY_CREATED_BY  = 'system'

// Standard scopes surfaced in the UI scope selector
export const STANDARD_SCOPES = [
  'kb:read',
  'kb:write',
  'memory:read',
  'memory:write',
  'agents:read',
  'agents:write',
  'metrics:read',
] as const

// ---------------------------------------------------------------------------
// Key record type (mirrors Iranti's internal ApiKeyRecord)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Crypto helpers — must match Iranti's src/security/apiKeys.ts
// ---------------------------------------------------------------------------

function keyPepper(): string {
  return process.env.IRANTI_API_KEY_PEPPER ?? ''
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(`${secret}${keyPepper()}`).digest('hex')
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

// ---------------------------------------------------------------------------
// Scope validation — subset of Iranti's src/security/scopes.ts
// ---------------------------------------------------------------------------

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
      const ns = parts[2].split('/')
      if (ns.length !== 2 || !ns[0] || !ns[1]) {
        throw new Error(`scope "${scope}" namespace must be "entityType/entityId" or "entityType/*"`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Registry persistence — uses the CP's existing pg pool via query()
// ---------------------------------------------------------------------------

async function loadRegistry(): Promise<ApiKeyRegistry> {
  // knowledge_base uses quoted camelCase column names (Prisma convention, table mapped via @@map)
  const result = await query<{ valueRaw: unknown }>(
    `SELECT "valueRaw" FROM knowledge_base
     WHERE "entityType" = $1 AND "entityId" = $2 AND key = $3
     LIMIT 1`,
    [REGISTRY_ENTITY_TYPE, REGISTRY_ENTITY_ID, REGISTRY_KEY]
  )

  if (result.rows.length === 0) {
    return { version: 1, keys: [] }
  }

  const raw = result.rows[0].valueRaw
  return normalizeRegistry(raw)
}

async function saveRegistry(registry: ApiKeyRegistry): Promise<void> {
  const normalized = normalizeRegistry(registry)
  const valueSummary = `API key registry (${normalized.keys.length} keys)`

  // ON CONFLICT key is ("entityType", "entityId", key) per the Prisma @@unique constraint
  await query(
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

// ---------------------------------------------------------------------------
// Sync token to project .env.iranti (optional, per syncToProject param)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Guard — ensures DATABASE_URL is configured before any DB op
// ---------------------------------------------------------------------------

function getDatabaseUrl(): string | null {
  return env['DATABASE_URL'] ?? process.env.DATABASE_URL ?? null
}

function checkDbConfigured(res: Response): boolean {
  if (!getDatabaseUrl()) {
    res.status(503).json({
      error: 'No DATABASE_URL configured. Start an Iranti instance first.',
      code: 'NO_DATABASE_URL',
    })
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// GET /api/control-plane/auth-keys
// List all keys — never returns secretHash or raw token values
// ---------------------------------------------------------------------------

authKeysRouter.get('/', async (_req: Request, res: Response) => {
  if (!checkDbConfigured(res)) return

  try {
    const registry = await loadRegistry()

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

// ---------------------------------------------------------------------------
// POST /api/control-plane/auth-keys
// Create or rotate a key. Returns the full token ONCE.
// ---------------------------------------------------------------------------

authKeysRouter.post('/', async (req: Request, res: Response) => {
  if (!checkDbConfigured(res)) return

  const { keyId: keyIdRaw, owner, scopes, description, syncToProject } = req.body as {
    keyId?: unknown
    owner?: unknown
    scopes?: unknown
    description?: unknown
    syncToProject?: unknown
  }

  // --- Validate inputs ---
  if (!keyIdRaw || typeof keyIdRaw !== 'string') {
    res.status(400).json({ error: 'keyId is required and must be a string.' })
    return
  }
  const keyId = sanitizeKeyId(keyIdRaw)
  if (!keyId) {
    res.status(400).json({ error: 'keyId is invalid — only letters, numbers, "_" and "-" are allowed.' })
    return
  }

  if (!owner || typeof owner !== 'string' || !owner.trim()) {
    res.status(400).json({ error: 'owner is required.' })
    return
  }

  const scopeList: string[] = Array.isArray(scopes)
    ? (scopes as unknown[]).map(String).map(s => s.trim()).filter(Boolean)
    : []

  try {
    validateScopeList(scopeList)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    return
  }

  try {
    const registry = await loadRegistry()
    const now = new Date().toISOString()
    const secret = generateSecret()
    const secretHash = hashSecret(secret)

    const record: ApiKeyRecord = {
      keyId,
      owner:      owner.trim(),
      secretHash,
      scopes:     scopeList,
      isActive:   true,
      createdAt:  now,
      updatedAt:  now,
      revokedAt:  null,
      description: typeof description === 'string' ? description.trim() || undefined : undefined,
    }

    // Remove existing entry with same keyId (rotate)
    const withoutExisting = registry.keys.filter(k => k.keyId !== keyId)
    withoutExisting.push(record)
    await saveRegistry({ ...registry, keys: withoutExisting })

    const token = formatToken(keyId, secret)

    // Optional: sync token into a bound project's .env.iranti
    if (typeof syncToProject === 'string' && syncToProject.trim()) {
      try {
        syncTokenToProject(syncToProject.trim(), token)
      } catch (syncErr) {
        // Non-fatal — key was created; warn in response
        const syncWarn = syncErr instanceof Error ? syncErr.message : String(syncErr)
        res.status(201).json({
          ok:     true,
          keyId,
          token,
          scopes: scopeList,
          warning: `Key created but sync to project failed: ${syncWarn}`,
        })
        return
      }
    }

    res.status(201).json({
      ok:     true,
      keyId,
      token,
      scopes: scopeList,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[auth-keys] POST failed:', message)
    res.status(500).json({ error: message })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/control-plane/auth-keys/:keyId
// Revoke a key — marks it inactive with revokedAt timestamp
// ---------------------------------------------------------------------------

authKeysRouter.delete('/:keyId', async (req: Request, res: Response) => {
  if (!checkDbConfigured(res)) return

  const keyId = sanitizeKeyId(req.params.keyId ?? '')
  if (!keyId) {
    res.status(400).json({ error: 'keyId is required.' })
    return
  }

  try {
    const registry = await loadRegistry()
    const target = registry.keys.find(k => k.keyId === keyId)

    if (!target) {
      res.status(404).json({ error: `API key not found: ${keyId}` })
      return
    }

    target.isActive  = false
    target.revokedAt = new Date().toISOString()
    await saveRegistry(registry)

    res.json({ ok: true, keyId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[auth-keys] DELETE failed:', message)
    res.status(500).json({ error: message })
  }
})

