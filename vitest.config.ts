import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

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
    include: ['spikes/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
