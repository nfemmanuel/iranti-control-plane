import { describe, expect, it } from 'vitest'
import { buildPortSelectionPlan } from '../../lib/portSelection.js'

describe('buildPortSelectionPlan', () => {
  it('uses the explicit process port as a strict single-port plan', () => {
    expect(buildPortSelectionPlan({ explicitPort: '3002', fallbackBasePort: '3000' })).toEqual({
      start: 3002,
      end: 3002,
      strict: true,
    })
  })

  it('falls back to the configured base port range when no explicit process port is set', () => {
    expect(buildPortSelectionPlan({ explicitPort: null, fallbackBasePort: '3000' })).toEqual({
      start: 3000,
      end: 3010,
      strict: false,
    })
  })

  it('defaults to the standard dev base when neither source is set', () => {
    expect(buildPortSelectionPlan({ explicitPort: null, fallbackBasePort: null })).toEqual({
      start: 3000,
      end: 3010,
      strict: false,
    })
  })
})
