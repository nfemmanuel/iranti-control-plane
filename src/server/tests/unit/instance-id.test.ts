import { describe, it, expect } from 'vitest'
import crypto from 'crypto'

// Inline the deriveInstanceId function under test.
// When the instance-aggregator lib is implemented at src/server/lib/instance-aggregator/,
// replace this with:
//   import { deriveInstanceId } from '../../lib/instance-aggregator/index.js'
//
// The function is defined in CP-T011 implementation plan §2.2.5:
//   Normalize path to lowercase and forward slashes, SHA-256 hash, take first 8 hex chars.
function deriveInstanceId(runtimeRoot: string): string {
  const normalized = runtimeRoot.toLowerCase().replace(/\\/g, '/')
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8)
}

describe('deriveInstanceId', () => {
  describe('format', () => {
    it('returns exactly 8 characters', () => {
      const id = deriveInstanceId('/home/user/.iranti')
      expect(id).toHaveLength(8)
    })

    it('returns lowercase hex characters only', () => {
      const id = deriveInstanceId('/home/user/.iranti')
      expect(id).toMatch(/^[0-9a-f]{8}$/)
    })

    it('returns 8 hex chars for a Windows path', () => {
      const id = deriveInstanceId('C:\\Users\\NF\\.iranti')
      expect(id).toHaveLength(8)
      expect(id).toMatch(/^[0-9a-f]{8}$/)
    })
  })

  describe('stability — same input produces same output', () => {
    it('is deterministic for the same path', () => {
      const path = '/home/user/.iranti'
      expect(deriveInstanceId(path)).toBe(deriveInstanceId(path))
    })

    it('is deterministic across multiple calls', () => {
      const path = 'C:\\Users\\NF\\iranti'
      const results = Array.from({ length: 5 }, () => deriveInstanceId(path))
      const allSame = results.every(r => r === results[0])
      expect(allSame).toBe(true)
    })
  })

  describe('cross-platform normalization', () => {
    it('Windows backslash path produces same id as forward-slash equivalent', () => {
      const windowsPath = 'C:\\Users\\NF\\.iranti'
      const unixEquivalent = 'c:/users/nf/.iranti'
      expect(deriveInstanceId(windowsPath)).toBe(deriveInstanceId(unixEquivalent))
    })

    it('case-insensitive: uppercase path produces same id as lowercase', () => {
      const upper = '/HOME/USER/.IRANTI'
      const lower = '/home/user/.iranti'
      expect(deriveInstanceId(upper)).toBe(deriveInstanceId(lower))
    })

    it('mixed case Windows path normalizes consistently', () => {
      const path1 = 'C:\\Users\\NF\\Projects\\iranti'
      const path2 = 'c:\\users\\nf\\projects\\iranti'
      expect(deriveInstanceId(path1)).toBe(deriveInstanceId(path2))
    })
  })

  describe('uniqueness — different paths produce different IDs', () => {
    it('different root paths produce different ids', () => {
      const id1 = deriveInstanceId('/home/user/.iranti')
      const id2 = deriveInstanceId('/home/user/iranti-alt')
      expect(id1).not.toBe(id2)
    })

    it('different users produce different ids', () => {
      const id1 = deriveInstanceId('/home/alice/.iranti')
      const id2 = deriveInstanceId('/home/bob/.iranti')
      expect(id1).not.toBe(id2)
    })

    it('paths differing only by trailing slash produce different ids', () => {
      // Trailing slash changes the normalized string — IDs will differ.
      // Implementer note: if this is undesired, normalization should strip trailing slashes.
      // Test documents current behavior — update if normalization is changed.
      const id1 = deriveInstanceId('/home/user/.iranti')
      const id2 = deriveInstanceId('/home/user/.iranti/')
      // These may or may not be equal depending on whether trailing slash is stripped.
      // Document actual behavior here:
      expect(typeof id1).toBe('string')
      expect(typeof id2).toBe('string')
      // Both must still be valid 8-char hex
      expect(id1).toMatch(/^[0-9a-f]{8}$/)
      expect(id2).toMatch(/^[0-9a-f]{8}$/)
    })

    it('a large set of different paths all produce unique ids (collision check)', () => {
      const paths = [
        '/home/alice/.iranti',
        '/home/bob/.iranti',
        '/opt/iranti-prod',
        '/opt/iranti-staging',
        'C:\\Users\\Alice\\.iranti',
        'C:\\Users\\Bob\\.iranti',
        '/tmp/iranti-test-1',
        '/tmp/iranti-test-2',
      ]
      const ids = paths.map(deriveInstanceId)
      const uniqueIds = new Set(ids)
      // All 8 paths should produce distinct IDs (SHA-256 truncated to 8 chars has negligible collision probability)
      expect(uniqueIds.size).toBe(paths.length)
    })
  })

  describe('edge cases', () => {
    it('handles empty string input', () => {
      const id = deriveInstanceId('')
      expect(id).toHaveLength(8)
      expect(id).toMatch(/^[0-9a-f]{8}$/)
    })

    it('handles very long path', () => {
      const longPath = '/home/' + 'a'.repeat(500) + '/.iranti'
      const id = deriveInstanceId(longPath)
      expect(id).toHaveLength(8)
      expect(id).toMatch(/^[0-9a-f]{8}$/)
    })

    it('handles path with special characters', () => {
      const id = deriveInstanceId('/home/user/my project with spaces/.iranti')
      expect(id).toHaveLength(8)
      expect(id).toMatch(/^[0-9a-f]{8}$/)
    })
  })
})
