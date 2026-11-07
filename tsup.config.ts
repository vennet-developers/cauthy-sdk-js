import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', theme: 'src/theme.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // It runs in the browser, and in Node while a framework renders on the server.
  target: 'es2020',
  platform: 'neutral',
})
