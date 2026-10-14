/**
 * Self-contained host + client build for Desktop and git installs.
 *
 * Desktop 0.2.0-rc.2 ships a packaged Electron host (Node 24). That process
 * loads profile plugins as native ESM and does not compile TypeScript.
 * Node also refuses `.ts` files that sit under `node_modules`. The monorepo
 * `tsx` hook is only on source launches, so `exports` must point at `lib/`.
 *
 * The browser face is not ESM. `dsh-client-modules` serves `exports["./client"]`
 * as a classic script that must register
 * `window.__ModuleLoader__.load({ id, factory })`. The same shape is what
 * out-of-tree plugins emit with esbuild (banner + module intro + footer).
 *
 * Peer packages stay external so the host copy (one Cordis, one zod, one
 * schemastery) is the copy that runs. `@deepseek-ai/cosmokit` is not a peer;
 * `isVolatile` identifies values with `Symbol.for`, so the bundled function
 * still sees the host's volatile config objects.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const peers = new Set(Object.keys(pkg.peerDependencies))

/** Specifiers the Desktop web shell seeds into the client module table. */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function hostExternals() {
  return {
    name: 'host-peer-externals',
    setup(build) {
      // cosmokit's package entry is one module. Marking that file side-effect
      // free lets esbuild drop exports it can prove are unused. `isVolatile`
      // stays, and its `Symbol.for` check still matches the host's objects.
      build.onResolve({ filter: /^@deepseek-ai\/cosmokit$/ }, (args) => {
        if (args.pluginData?.cosmokitResolved === true) return null
        return build.resolve(args.path, {
          kind: args.kind,
          resolveDir: args.resolveDir,
          pluginData: { cosmokitResolved: true },
        }).then((result) => ({ ...result, sideEffects: false }))
      })
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith('.') || args.path.startsWith('/') || args.path.startsWith('\0')) return null
        if (args.path.startsWith('node:')) return { path: args.path, external: true }
        const name = packageName(args.path)
        if (peers.has(name)) return { path: args.path, external: true }
        return null
      })
    },
  }
}

function clientExternals() {
  return {
    name: 'client-platform-externals',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path.startsWith('.') || args.path.startsWith('/') || args.path.startsWith('\0')) return null
        if (CLIENT_EXTERNALS.has(args.path)) return { path: args.path, external: true }
        if (args.path.startsWith('@deepseek-ai/')) {
          return {
            errors: [{
              text: `client bundle must not inline ${args.path}; declare it as a platform external or keep the import type-only`,
            }],
          }
        }
        return null
      })
    },
  }
}

mkdirSync('lib', { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  plugins: [hostExternals()],
  legalComments: 'none',
})

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  plugins: [clientExternals()],
  legalComments: 'none',
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports;\n} });',
  },
})

const host = readFileSync('lib/index.js', 'utf8')
const client = readFileSync('lib/client.js', 'utf8')
if (/\.ts['"]/.test(host) || /\.ts['"]/.test(client)) {
  throw new Error('build: emitted lib/ still references a .ts specifier')
}
const syntax = spawnSync(process.execPath, ['--check', 'lib/index.js'], { encoding: 'utf8' })
if (syntax.status !== 0) {
  throw new Error(`build: lib/index.js failed node --check\n${syntax.stderr}`)
}
if (!host.includes('Symbol.for("cosmokit.volatile.write")')) {
  throw new Error('build: lib/index.js dropped isVolatile')
}
if (host.includes('from "@deepseek-ai/cosmokit"') || host.includes("from '@deepseek-ai/cosmokit'")) {
  throw new Error('build: cosmokit must be bundled; it is not a host peer')
}
const imported = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./lib/index.js')"], {
  encoding: 'utf8',
})
const importError = `${imported.stderr}\n${imported.stdout}`
if (importError.includes('ERR_UNKNOWN_FILE_EXTENSION')) {
  throw new Error(`build: lib/index.js is not plain JavaScript\n${importError}`)
}
if (imported.status === 0) {
  const shape = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const mod = await import('./lib/index.js')
    if (mod.name !== ${JSON.stringify(pkg.name)} || typeof mod.apply !== 'function' || mod.inject === undefined) {
      process.exit(2)
    }
  `], { encoding: 'utf8' })
  if (shape.status !== 0) {
    throw new Error(`build: lib/index.js did not export name, inject, and apply\n${shape.stderr}`)
  }
} else if (!importError.includes('ERR_MODULE_NOT_FOUND')) {
  throw new Error(`build: lib/index.js should load, or stop on a missing host peer\n${importError}`)
}

let registration
const sandbox = vm.createContext({
  window: {
    __ModuleLoader__: {
      load(value) { registration = value },
    },
  },
})
vm.runInContext(client, sandbox, { filename: 'lib/client.js' })
if (registration?.id !== pkg.name || typeof registration.factory !== 'function') {
  throw new Error('build: lib/client.js did not register a ModuleLoader factory')
}
const clientExports = registration.factory((specifier) => require(specifier))
if (typeof clientExports.apply !== 'function') {
  throw new Error('build: client factory did not export apply')
}
