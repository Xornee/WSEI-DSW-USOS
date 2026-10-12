import { defineConfig } from 'vitest/config'

// Osobny config, bo vite.config.ts ma root: 'web' (front) —
// testy dotycza proxy i modulow wspoldzielonych.
export default defineConfig({
  test: {
    root: '.',
    environment: 'node',
    include: [
      'server/**/*.test.ts',
      'shared/**/*.test.ts',
      'web/src/**/*.test.ts',
    ],
  },
})
