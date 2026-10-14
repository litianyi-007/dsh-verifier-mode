/**
 * Desktop loads this package as JavaScript. These checks lock the entry
 * files the host and the browser module loader actually import.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  main: string
  exports: Record<string, string>
  scripts: Record<string, string>
}

it('points main and exports at the committed lib entry', () => {
  expect(pkg.main).toBe('./lib/index.js')
  expect(pkg.exports['.']).toBe('./lib/index.js')
  expect(pkg.exports['./client']).toBe('./lib/client.js')
  expect(pkg.scripts.build).toBe('node build.mjs')
  expect(pkg.scripts.prepare).toBe('node build.mjs')
})

it('imports the host entry as JavaScript', () => {
  const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  expect(host).not.toMatch(/from ['"][^'"]+\.ts['"]/)
  expect(host).toContain('Symbol.for("cosmokit.volatile.write")')
  expect(host).not.toContain('from "@deepseek-ai/cosmokit"')
  expect(host).not.toContain("from '@deepseek-ai/cosmokit'")
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const mod = await import('./lib/index.js')
    if (mod.name !== 'dsh-verifier-mode' || typeof mod.apply !== 'function' || !Array.isArray(mod.inject)) {
      process.exit(2)
    }
  `], { cwd: root, encoding: 'utf8' })
  const output = `${result.stdout}\n${result.stderr}`
  if (result.status === 0) return
  expect(output).toContain('ERR_MODULE_NOT_FOUND')
  expect(output).not.toContain('ERR_UNKNOWN_FILE_EXTENSION')
})

it('registers the browser factory under the package name', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  expect(client).not.toMatch(/from ['"][^'"]+\.ts['"]/)
  let registration: { id?: string; factory?: (require: NodeRequire) => Record<string, unknown> } | undefined
  const sandbox = vm.createContext({
    window: {
      __ModuleLoader__: {
        load(value: typeof registration) { registration = value },
      },
    },
  })
  vm.runInContext(client, sandbox, { filename: 'lib/client.js' })
  expect(registration?.id).toBe(pkg.name)
  const require = createRequire(import.meta.url)
  const exports = registration?.factory?.((specifier) => require(specifier))
  expect(typeof exports?.apply).toBe('function')
  expect(exports?.inject).toEqual(['slots', 'locale', 'remote', 'remote.commands', 'remote.credentials'])
  expect(exports?.VERIFIER_CHIP_ID).toBe('dsh-verifier-mode')
})
