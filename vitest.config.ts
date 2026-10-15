import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

const reactDir = dirname(fileURLToPath(import.meta.resolve('react/package.json')))
/**
 * Point React at its CJS builds. The package entry files `require('./cjs/...')`,
 * and Vite's SSR runner executes those entries from a path that drops `node_modules`,
 * so the relative require cannot be resolved.
 */
const reactDevelopment = resolve(reactDir, 'cjs/react.development.js')
const reactJsxRuntime = resolve(reactDir, 'cjs/react-jsx-runtime.development.js')
const reactJsxDevRuntime = resolve(reactDir, 'cjs/react-jsx-dev-runtime.development.js')

/** Local DSH checkout. Spikes import its TypeScript source, never a built lib/. */
const DSH = process.env.DSH_ROOT ?? '/home/ubuntu/deepseek-harness'

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: [`${DSH}/tsconfig.base.json`],
      ignoreConfigErrors: true,
    }),
    {
      name: 'stub-css',
      enforce: 'pre',
      load(id) {
        if (id.endsWith('.css')) {
          return 'export default new Proxy({}, { get: (_, key) => String(key) })'
        }
        return undefined
      },
    },
  ],
  resolve: {
    alias: [
      { find: 'react/jsx-dev-runtime', replacement: reactJsxDevRuntime },
      { find: 'react/jsx-runtime', replacement: reactJsxRuntime },
      { find: /^react$/, replacement: reactDevelopment },
      {
        // Longer than `@deepseek-ai/dsh-credentials`, which is a prefix alias.
        find: /^@deepseek-ai\/dsh-credentials-local$/,
        replacement: `${DSH}/packages/credentials/credentials-local/src/index.ts`,
      },
      {
        find: '@deepseek-ai/dsh-client-locale/client',
        replacement: `${DSH}/packages/client/locale/src/client/index.ts`,
      },
      {
        find: '@deepseek-ai/dsh-client-ui-renderer/client',
        replacement: `${DSH}/packages/client/ui-renderer/src/client/index.ts`,
      },
      {
        find: '@deepseek-ai/dsh-headless/json-stream',
        replacement: `${DSH}/packages/bundle/headless/src/json-stream.ts`,
      },
    ],
  },
  server: {
    fs: {
      allow: [DSH, process.cwd()],
    },
  },
  test: {
    environment: 'node',
    include: ['spikes/**/*.spec.ts', 'tests/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
