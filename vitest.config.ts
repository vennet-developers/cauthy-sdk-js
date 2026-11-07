import { defineConfig } from 'vitest/config'

// Node by default; a test that needs a page says `// @vitest-environment jsdom`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
