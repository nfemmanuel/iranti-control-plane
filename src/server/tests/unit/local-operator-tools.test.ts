import { describe, expect, it } from 'vitest'
import { parseRunnableCommand, tokenizeCommand } from '../../lib/local-operator-tools.js'

describe('local operator tools', () => {
  it('tokenizes quoted command arguments without invoking a shell parser', () => {
    expect(tokenizeCommand('iranti claude-setup "C:\\Users\\NF\\Projects\\my app"')).toEqual([
      'iranti',
      'claude-setup',
      'C:\\Users\\NF\\Projects\\my app',
    ])
  })

  it('accepts iranti commands for in-app execution', () => {
    expect(parseRunnableCommand('iranti run --instance local')).toEqual({
      executable: 'iranti',
      args: ['run', '--instance', 'local'],
    })
  })

  it('accepts npm run migrate for in-app execution', () => {
    expect(parseRunnableCommand('npm run migrate')).toEqual({
      executable: 'npm',
      args: ['run', 'migrate'],
    })
  })

  it('accepts npm install -g iranti for in-app execution', () => {
    expect(parseRunnableCommand('npm install -g iranti')).toEqual({
      executable: 'npm',
      args: ['install', '-g', 'iranti'],
    })
  })

  it('rejects non-whitelisted commands', () => {
    expect(() => parseRunnableCommand('npm install -g something-else')).toThrow(/not approved for in-app execution/i)
  })

  it('keeps Windows .cmd launch targets in the executable slot', () => {
    expect(parseRunnableCommand('iranti doctor --instance cofactor --debug')).toEqual({
      executable: 'iranti',
      args: ['doctor', '--instance', 'cofactor', '--debug'],
    })
  })
})
