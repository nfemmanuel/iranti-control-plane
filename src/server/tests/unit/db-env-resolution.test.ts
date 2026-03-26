import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { ancestorBindingCandidates, envFileCandidates } from '../../db.js'

describe('ancestorBindingCandidates', () => {
  it('walks upward from src/server to the repo root binding file', () => {
    const start = 'C:\\Users\\NF\\Documents\\Projects\\iranti-control-plane\\src\\server'
    const candidates = ancestorBindingCandidates(start)

    expect(candidates[0]).toBe(resolve(start, '.env.iranti'))
    expect(candidates).toContain('C:\\Users\\NF\\Documents\\Projects\\iranti-control-plane\\.env.iranti')
  })
})

describe('envFileCandidates', () => {
  it('prefers ancestor project bindings before home-directory fallbacks', () => {
    const start = 'C:\\Users\\NF\\Documents\\Projects\\iranti-control-plane\\src\\server'
    const home = 'C:\\Users\\NF'
    const candidates = envFileCandidates(start, home, false, 'C:\\Program Files\\nodejs\\node.exe')

    const repoBinding = 'C:\\Users\\NF\\Documents\\Projects\\iranti-control-plane\\.env.iranti'
    const homeBinding = 'C:\\Users\\NF\\.iranti-runtime\\.env.iranti'
    const localEnv = 'C:\\Users\\NF\\.iranti-runtime\\instances\\local\\.env'

    expect(candidates).toContain(repoBinding)
    expect(candidates).toContain(homeBinding)
    expect(candidates).toContain(localEnv)
    expect(candidates.indexOf(repoBinding)).toBeLessThan(candidates.indexOf(homeBinding))
    expect(candidates.indexOf(repoBinding)).toBeLessThan(candidates.indexOf(localEnv))
  })
})
