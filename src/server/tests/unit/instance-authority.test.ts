import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  deriveInstanceId,
  resolveBoundProjectPath,
  resolveInstanceAuthority,
} from '../../lib/instance-authority.js'

describe('instance authority resolution', () => {
  let tempRoot: string
  let runtimeRoot: string
  let projectPath: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'iranti-cp-authority-'))
    runtimeRoot = join(tempRoot, '.iranti-runtime')
    projectPath = join(tempRoot, 'project-alpha')

    await mkdir(join(runtimeRoot, 'instances', 'alpha'), { recursive: true })
    await mkdir(projectPath, { recursive: true })

    const instanceEnvPath = join(runtimeRoot, 'instances', 'alpha', '.env')
    await writeFile(
      instanceEnvPath,
      [
        'IRANTI_INSTANCE_NAME=alpha',
        'IRANTI_PORT=4310',
        'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/alpha',
        'IRANTI_API_KEY=test-alpha-key',
      ].join('\n') + '\n',
      'utf8'
    )

    await writeFile(
      join(projectPath, '.env.iranti'),
      [
        'IRANTI_URL=http://localhost:4310',
        'IRANTI_API_KEY=test-alpha-key',
        'IRANTI_INSTANCE=alpha',
        `IRANTI_INSTANCE_ENV=${instanceEnvPath}`,
      ].join('\n') + '\n',
      'utf8'
    )

    process.env['IRANTI_HOME'] = runtimeRoot
    vi.spyOn(process, 'cwd').mockReturnValue(projectPath)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    delete process.env['IRANTI_HOME']
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('resolves an instance by derived instance id and includes cwd project binding', async () => {
    const instanceDir = join(runtimeRoot, 'instances', 'alpha')
    const instanceId = deriveInstanceId(instanceDir)

    const scope = await resolveInstanceAuthority(instanceId)
    expect(scope).not.toBeNull()
    expect(scope?.instanceName).toBe('alpha')
    expect(scope?.instanceId).toBe(instanceId)
    expect(scope?.boundProjects.map((project) => project.projectPath)).toContain(projectPath)
  })

  it('resolves a bound project path only when the project is explicitly bound to the instance', async () => {
    const scope = await resolveInstanceAuthority('alpha')
    expect(scope).not.toBeNull()

    const bound = await resolveBoundProjectPath(
      scope!.instanceName,
      scope!.runtimeRoot,
      scope!.instanceEnvPath,
      encodeURIComponent(projectPath)
    )
    const unbound = await resolveBoundProjectPath(
      scope!.instanceName,
      scope!.runtimeRoot,
      scope!.instanceEnvPath,
      encodeURIComponent(join(tempRoot, 'other-project'))
    )

    expect(bound).toBe(projectPath)
    expect(unbound).toBeNull()
  })
})
