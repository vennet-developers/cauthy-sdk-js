import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', theme: 'src/theme.ts' },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  // Shipped minified, with its source maps: what an application downloads is what the budget measures.
  minify: true,
  clean: true,
  // It runs in the browser, and in Node while a framework renders on the server.
  target: 'es2020',
  platform: 'neutral',
  // The browser's types only: a Node global in src fails the build.
  tsconfig: 'tsconfig.build.json',
})
