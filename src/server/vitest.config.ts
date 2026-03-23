import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Use forks pool so process.chdir() works in tests that need to
    // simulate being run from a specific working directory.
    pool: 'forks',
  },
})
