/**
 * Unit tests for providers.ts write-path functions.
 *
 * Tests the pure and near-pure logic involved in writing provider API keys to
 * the correct env file. Uses vi.mock to control the db.ts `env` singleton
 * so tests don't depend on the real .env.iranti present on the developer's machine.
 *
 * Note: getPreferredEnvFilePath() reads env['IRANTI_INSTANCE_ENV'] from db.ts
 * (module-level singleton). Without mocking, it returns the real instance env
 * path loaded at startup. vi.mock replaces env with a controllable empty object.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock db.ts BEFORE importing any module that imports it.
// vi.mock is hoisted — the factory is called before other imports.
// We export a mutable env object so tests can set/delete keys per-test.
vi.mock('../../db.js', () => ({
  env: {} as Record<string, string>,
  pool: { on: () => {} },
  query: vi.fn(),
}))

// Now import the functions under test (they will see the mocked env).
import {
  isPlaceholderKey,
  getPreferredEnvFilePath,
  writeEnvVar,
} from '../../routes/control-plane/providers.js'
import { env } from '../../db.js'

// ---------------------------------------------------------------------------
// isPlaceholderKey — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe('isPlaceholderKey', () => {
  it('returns true for sk-xxx prefix (case insensitive)', () => {
    expect(isPlaceholderKey('sk-xxx-something')).toBe(true)
    expect(isPlaceholderKey('SK-XXX-SOMETHING')).toBe(true)
  })

  it('returns true for "replace-me"', () => {
    expect(isPlaceholderKey('replace-me')).toBe(true)
    expect(isPlaceholderKey('replaceme')).toBe(true)
    expect(isPlaceholderKey('replace_me')).toBe(true)
  })

  it('returns true for "your-api-key" pattern', () => {
    expect(isPlaceholderKey('your-api-key')).toBe(true)
    expect(isPlaceholderKey('your_api_key')).toBe(true)
    expect(isPlaceholderKey('yourapikey')).toBe(true)
  })

  it('returns true for angle-bracket wrapped values', () => {
    expect(isPlaceholderKey('<your-key-here>')).toBe(true)
    expect(isPlaceholderKey('<API_KEY>')).toBe(true)
  })

  it('returns true for "test-key" and "testkey"', () => {
    expect(isPlaceholderKey('test-key')).toBe(true)
    expect(isPlaceholderKey('testkey')).toBe(true)
    expect(isPlaceholderKey('TEST_KEY')).toBe(true)
  })

  it('returns true for "dummy" prefix', () => {
    expect(isPlaceholderKey('dummy')).toBe(true)
    expect(isPlaceholderKey('dummy-key-value')).toBe(true)
    expect(isPlaceholderKey('DUMMY_KEY')).toBe(true)
  })

  it('returns true even with surrounding whitespace', () => {
    expect(isPlaceholderKey('  sk-xxx  ')).toBe(true)
  })

  it('returns false for a realistic-looking API key', () => {
    expect(isPlaceholderKey('sk-ant-api03-realKeyValue1234567890abcdef')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isPlaceholderKey('')).toBe(false)
  })

  it('returns false for a short but non-placeholder value', () => {
    expect(isPlaceholderKey('mykey')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getPreferredEnvFilePath — reads env + filesystem
// ---------------------------------------------------------------------------

describe('getPreferredEnvFilePath', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'iranti-cp-providers-'))
    // Start each test with an empty env object (mocked db.ts env)
    for (const key of Object.keys(env)) {
      delete (env as Record<string, string>)[key]
    }
  })

  afterEach(async () => {
    for (const key of Object.keys(env)) {
      delete (env as Record<string, string>)[key]
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  it('returns IRANTI_INSTANCE_ENV path when it points to an existing file', async () => {
    const instanceEnvPath = join(tempDir, '.env')
    await writeFile(instanceEnvPath, 'IRANTI_PORT=4000\n', 'utf8')
    ;(env as Record<string, string>)['IRANTI_INSTANCE_ENV'] = instanceEnvPath

    const result = getPreferredEnvFilePath()
    expect(result).toBe(instanceEnvPath)
  })

  it('does NOT return IRANTI_INSTANCE_ENV when the file does not exist', async () => {
    const nonExistentPath = join(tempDir, 'does-not-exist', '.env')
    ;(env as Record<string, string>)['IRANTI_INSTANCE_ENV'] = nonExistentPath

    const result = getPreferredEnvFilePath()
    // Falls through — must not be the non-existent path
    expect(result).not.toBe(nonExistentPath)
  })

  it('returns a string path even when no env file exists anywhere', () => {
    // env is empty, no files on disk
    const result = getPreferredEnvFilePath()
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// writeEnvVar — writes to instance env file
// ---------------------------------------------------------------------------

describe('writeEnvVar', () => {
  let tempDir: string
  let instanceEnvPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'iranti-cp-writeenv-'))
    instanceEnvPath = join(tempDir, '.env')
    // Clear env mock and point to our temp file
    for (const key of Object.keys(env)) {
      delete (env as Record<string, string>)[key]
    }
    ;(env as Record<string, string>)['IRANTI_INSTANCE_ENV'] = instanceEnvPath
  })

  afterEach(async () => {
    for (const key of Object.keys(env)) {
      delete (env as Record<string, string>)[key]
    }
    await rm(tempDir, { recursive: true, force: true })
  })

  it('appends a new key to an empty file', async () => {
    await writeFile(instanceEnvPath, '', 'utf8')
    writeEnvVar('ANTHROPIC_API_KEY', 'sk-ant-real-key')
    const contents = await readFile(instanceEnvPath, 'utf8')
    expect(contents).toContain('ANTHROPIC_API_KEY=sk-ant-real-key')
  })

  it('appends a new key to an existing file preserving other keys', async () => {
    await writeFile(instanceEnvPath, 'IRANTI_PORT=4000\n', 'utf8')
    writeEnvVar('OPENAI_API_KEY', 'sk-openai-real')
    const contents = await readFile(instanceEnvPath, 'utf8')
    expect(contents).toContain('IRANTI_PORT=4000')
    expect(contents).toContain('OPENAI_API_KEY=sk-openai-real')
  })

  it('updates an existing key without duplicating it', async () => {
    await writeFile(instanceEnvPath, 'ANTHROPIC_API_KEY=old-key\nIRANTI_PORT=4000\n', 'utf8')
    writeEnvVar('ANTHROPIC_API_KEY', 'sk-ant-updated-key')
    const contents = await readFile(instanceEnvPath, 'utf8')
    expect(contents).toContain('ANTHROPIC_API_KEY=sk-ant-updated-key')
    expect(contents).not.toContain('old-key')
    // Count occurrences — must be exactly 1
    const matches = contents.match(/ANTHROPIC_API_KEY=/g)
    expect(matches).toHaveLength(1)
  })

  it('deletes a key when value is null', async () => {
    await writeFile(instanceEnvPath, 'ANTHROPIC_API_KEY=sk-ant-key\nIRANTI_PORT=4000\n', 'utf8')
    writeEnvVar('ANTHROPIC_API_KEY', null)
    const contents = await readFile(instanceEnvPath, 'utf8')
    expect(contents).not.toContain('ANTHROPIC_API_KEY')
    expect(contents).toContain('IRANTI_PORT=4000')
  })

  it('preserves comments when updating', async () => {
    await writeFile(
      instanceEnvPath,
      '# Instance config\nANTHROPIC_API_KEY=old-key\n# End\n',
      'utf8'
    )
    writeEnvVar('ANTHROPIC_API_KEY', 'sk-new')
    const contents = await readFile(instanceEnvPath, 'utf8')
    expect(contents).toContain('# Instance config')
    expect(contents).toContain('# End')
  })

  it('documents: getPreferredEnvFilePath requires the file to exist for IRANTI_INSTANCE_ENV', async () => {
    // getPreferredEnvFilePath checks existsSync(instanceEnvPath) — if the file
    // does not exist it falls through to findEnvFilePath(). So to write to the
    // correct instance env path, the file must exist first (i.e., be created by
    // `iranti init` or equivalent). This is the expected operator flow.
    expect(existsSync(instanceEnvPath)).toBe(false)
    // With the file absent, getPreferredEnvFilePath falls back — not to instanceEnvPath
    const fallbackPath = getPreferredEnvFilePath()
    expect(fallbackPath).not.toBe(instanceEnvPath)

    // Once the file exists, it IS returned
    await writeFile(instanceEnvPath, '', 'utf8')
    expect(getPreferredEnvFilePath()).toBe(instanceEnvPath)
  })

  it('syncs in-memory env after writing a key', async () => {
    await writeFile(instanceEnvPath, 'IRANTI_PORT=4000\n', 'utf8')
    writeEnvVar('ANTHROPIC_API_KEY', 'sk-ant-synced')
    expect((env as Record<string, string>)['ANTHROPIC_API_KEY']).toBe('sk-ant-synced')
  })

  it('removes key from in-memory env after deleting', async () => {
    await writeFile(instanceEnvPath, 'ANTHROPIC_API_KEY=sk-old\n', 'utf8')
    ;(env as Record<string, string>)['ANTHROPIC_API_KEY'] = 'sk-old'
    writeEnvVar('ANTHROPIC_API_KEY', null)
    expect((env as Record<string, string>)['ANTHROPIC_API_KEY']).toBeUndefined()
  })

  it('documents: writeEnvVar does not reject placeholder values — caller must check', () => {
    // writeEnvVar has no placeholder guard — that's the route handler's responsibility.
    // This test documents the separation of concerns: isPlaceholderKey() must be
    // called BEFORE writeEnvVar() in the route handler.
    expect(isPlaceholderKey('sk-xxx-placeholder')).toBe(true)
    // writeEnvVar would write it anyway if called directly:
    // (not asserting write behavior here — just documenting the design intent)
  })
})
