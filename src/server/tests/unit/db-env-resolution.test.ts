import { describe, expect, it, vi, afterEach } from 'vitest'
import { win32 } from 'path'
import { ancestorBindingCandidates, envFileCandidates } from '../../db.js'

describe('ancestorBindingCandidates', () => {
  it('walks upward from src/server to the repo root binding file', () => {
    const start = 'C:\\Users\\NF\\Documents\\Projects\\iranti-control-plane\\src\\server'
    const candidates = ancestorBindingCandidates(start)

    expect(candidates[0]).toBe(win32.resolve(start, '.env.iranti'))
    expect(candidates).toContain('C:\\Users\\NF\\Documents\\Projects\\iranti-control-plane\\.env.iranti')
  })
})

describe('envFileCandidates', () => {
  afterEach(() => {
    delete process.env['IRANTI_INSTANCE']
    delete process.env['IRANTI_INSTANCE_NAME']
  })

  it('prefers ancestor project bindings before home-directory fallbacks', () => {
    const start = 'C:\\Users\\NF\\Documents\\Projects\\iranti-control-plane\\src\\server'
    const home = 'C:\\Users\\NF'
    const candidates = envFileCandidates(start, home, false, 'C:\\Program Files\\nodejs\\node.exe')

    const repoBinding = 'C:\\Users\\NF\\Documents\\Projects\\iranti-control-plane\\.env.iranti'
    const homeBinding = 'C:\\Users\\NF\\.iranti-runtime\\.env.iranti'

    expect(candidates).toContain(repoBinding)
    expect(candidates).toContain(homeBinding)
    expect(candidates.indexOf(repoBinding)).toBeLessThan(candidates.indexOf(homeBinding))
  })

  it('includes explicit instance env when IRANTI_INSTANCE is set', () => {
    process.env['IRANTI_INSTANCE'] = 'iranti_dev'
    const start = 'C:\\Users\\NF\\Documents\\Projects\\iranti-control-plane\\src\\server'
    const home = 'C:\\Users\\NF'
    const candidates = envFileCandidates(start, home, false, 'C:\\Program Files\\nodejs\\node.exe')

    const devEnv = 'C:\\Users\\NF\\.iranti-runtime\\instances\\iranti_dev\\.env'
    expect(candidates).toContain(devEnv)
  })

  it('includes explicit instance env when IRANTI_INSTANCE_NAME is set', () => {
    process.env['IRANTI_INSTANCE_NAME'] = 'production'
    const start = 'C:\\some\\dir'
    const home = 'C:\\Users\\NF'
    const candidates = envFileCandidates(start, home, false, 'C:\\Program Files\\nodejs\\node.exe')

    const prodEnv = 'C:\\Users\\NF\\.iranti-runtime\\instances\\production\\.env'
    expect(candidates).toContain(prodEnv)
  })
})
