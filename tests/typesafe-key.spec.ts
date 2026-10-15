/**
 * The TypeSafe key is a credential, not a profile-patch field.
 * Fetch is stubbed. These tests do not call TypeSafe or DeepSeek.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { CREDENTIALS_FILENAME, LocalCredentialProvider, resolveSpec } from '@deepseek-ai/dsh-credentials-local'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createAgent, mountLoop, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { resolveConfig } from '../src/config.ts'
import { TYPESAFE_API_KEY_REF, TYPESAFE_ROW_CONFIG_KEY } from '../src/credential-ref.ts'
import { jevSettingsView } from '../src/jev-key.ts'
import { apply as applyClient } from '../src/client/index.ts'
import { projectCredentialView, renderKeyForm, TypeSafeKeyController } from '../src/client/key-form.ts'
import type { CredentialsClient, KeyFormState } from '../src/client/key-form.ts'
import * as plugin from '../src/index.ts'
import { en } from '../src/client/locales.ts'
import { passingAnswers } from './support/jev.ts'

const SECRET = 'sk-typesafe-test-9f3c'
const PATCH = resolve('cordis.patch.yml')

function candidate(title: string): ReturnType<typeof textResponse> {
  return textResponse(JSON.stringify({
    title,
    steps: ['step'],
    acceptance: ['done'],
    risks: [],
  }))
}

function scriptedAdapter(): MockAdapter {
  return new MockAdapter([
    candidate('Minimal'),
    candidate('Test-first'),
    candidate('Investigate'),
    textResponse('main answer'),
  ])
}

interface Captured {
  url: string
  authorization: string | null
}

function stubFetch(captured: Captured[]): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    captured.push({ url, authorization: new Headers(init?.headers).get('authorization') })
    return new Response(JSON.stringify({
      usage: { inputTokens: 10, outputTokens: 0 },
      answers: passingAnswers(4),
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

const defaultJev = {
  jev: { baseUrl: 'https://api.typesafe.ai', apiKey: '', timeoutMs: 5_000 },
}

async function mountWithCredentials(
  home: string,
  config: Record<string, unknown>,
): Promise<{ ctx: Context; adapter: MockAdapter }> {
  const adapter = scriptedAdapter()
  const ctx = await mountLoop(adapter)
  await ctx.plugin(LocalCredentialProvider, { dshHome: home, watch: false })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(plugin, config)
  return { ctx, adapter }
}

interface ElementNode {
  type?: unknown
  props?: {
    type?: string
    autoComplete?: string
    value?: string
    children?: unknown
  }
}

function findInput(node: unknown): ElementNode['props'] | undefined {
  if (node === null || typeof node !== 'object') return undefined
  const element = node as ElementNode
  if (element.type === 'input') return element.props
  const children = element.props?.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    const found = findInput(child)
    if (found !== undefined) return found
  }
  return undefined
}

describe('TypeSafe credential', () => {
  const homes: string[] = []
  const originalFetch = globalThis.fetch

  afterEach(async () => {
    globalThis.fetch = originalFetch
    await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
  })

  it('does not write the key into the profile patch', async () => {
    const before = await readFile(PATCH, 'utf8')
    expect(before).not.toContain(SECRET)
    expect(before).not.toContain(TYPESAFE_API_KEY_REF)
    expect(before).not.toMatch(/apiKey/)

    const home = await mkdtemp(join(tmpdir(), 'dsh-verifier-key-'))
    homes.push(home)
    const filename = resolveSpec({ dshHome: home, watch: false }).filename
    expect(filename).toBe(resolve(home, CREDENTIALS_FILENAME))

    const ctx = await mountLoop(scriptedAdapter())
    await ctx.plugin(LocalCredentialProvider, { dshHome: home, watch: false })
    await ctx.credentials.set(credentialRef(TYPESAFE_API_KEY_REF), SECRET)

    const described = await ctx.credentials.describe(credentialRef(TYPESAFE_API_KEY_REF))
    const literal = resolveConfig({
      jev: { baseUrl: 'https://api.typesafe.ai', apiKey: 'patch-literal', timeoutMs: 5_000 },
    })
    const settings = {
      jev: jevSettingsView(literal),
      credentials: { [TYPESAFE_API_KEY_REF]: described },
    }
    expect(JSON.stringify(settings)).not.toContain(SECRET)
    expect(JSON.stringify(settings)).not.toContain('patch-literal')
    expect(settings.jev).toEqual({
      baseUrl: 'https://api.typesafe.ai',
      apiKeyEnv: TYPESAFE_API_KEY_REF,
      timeoutMs: 5_000,
    })
    expect(Object.keys(described).sort()).toEqual(['configured', 'source', 'writable'])
    expect(described).toEqual({ configured: true, source: 'file', writable: true })

    const stored = await readFile(filename, 'utf8')
    expect(stored).toContain(TYPESAFE_API_KEY_REF)
    expect(stored).toContain(SECRET)
    expect(await readFile(PATCH, 'utf8')).toBe(before)
    await expect(readFile(join(home, 'cordis.patch.yml'), 'utf8')).rejects.toThrow()
  })

  it('fail-opens when the credential is unset', async () => {
    const captured: Captured[] = []
    stubFetch(captured)
    const home = await mkdtemp(join(tmpdir(), 'dsh-verifier-key-'))
    homes.push(home)
    const { ctx, adapter } = await mountWithCredentials(home, defaultJev)
    const described = await ctx.credentials.describe(credentialRef(TYPESAFE_API_KEY_REF))
    expect(described.configured).toBe(false)
    expect(JSON.stringify(described)).not.toContain(SECRET)

    const agent = await createAgent(ctx, 'typesafe-unset')
    await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
    const idle = waitForIdle(ctx, agent)
    send(agent, 'score without a key')
    await idle

    expect(captured).toEqual([])
    const main = JSON.stringify(adapter.requests.at(-1)?.messages)
    expect(main).toContain('jev is not configured')
    expect(main).not.toContain('[verifier decision]')
  })

  it('sends the saved credential as Bearer and does not echo it', async () => {
    const captured: Captured[] = []
    stubFetch(captured)
    const home = await mkdtemp(join(tmpdir(), 'dsh-verifier-key-'))
    homes.push(home)
    const patchBefore = await readFile(PATCH, 'utf8')
    const { ctx, adapter } = await mountWithCredentials(home, { ...defaultJev, intakeGate: 'always' })
    await ctx.credentials.set(credentialRef(TYPESAFE_API_KEY_REF), SECRET)

    const described = await ctx.credentials.describe(credentialRef(TYPESAFE_API_KEY_REF))
    const settings = {
      jev: jevSettingsView(resolveConfig(defaultJev)),
      credentials: { [TYPESAFE_API_KEY_REF]: described },
    }
    expect(JSON.stringify(settings)).not.toContain(SECRET)
    expect(settings.jev).not.toHaveProperty('apiKey')

    const agent = await createAgent(ctx, 'typesafe-set')
    await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
    const idle = waitForIdle(ctx, agent)
    send(agent, 'score with a saved key')
    await idle

    expect(captured.length).toBeGreaterThan(0)
    expect(captured.every(call => call.url === 'https://api.typesafe.ai/v1/systemone')).toBe(true)
    expect(captured.every(call => call.authorization === `Bearer ${SECRET}`)).toBe(true)
    const main = JSON.stringify(adapter.requests.at(-1)?.messages)
    expect(main).toContain('[verifier decision]')
    expect(main).not.toContain(SECRET)
    expect(await readFile(PATCH, 'utf8')).toBe(patchBefore)
  })
})

describe('TypeSafe key page', () => {
  const t = (key: keyof typeof en): string => en[key]

  it('registers Configure on the verifier row and writes only the credentials domain', async () => {
    const calls: string[] = []
    let stored: string | undefined
    const credentials: CredentialsClient = {
      async describe(refs) {
        calls.push(`describe ${refs.join(',')}`)
        const view = stored === undefined
          ? { configured: false, writable: true, value: stored }
          : { configured: true, writable: true, source: 'file', value: stored }
        return { ok: true, value: { [TYPESAFE_API_KEY_REF]: view } }
      },
      async set(ref, value) {
        calls.push(`set ${ref}`)
        stored = value
        return { ok: true, value: undefined }
      },
      async unset(ref) {
        calls.push(`unset ${ref}`)
        stored = undefined
        return { ok: true, value: undefined }
      },
    }
    const controller = new TypeSafeKeyController(credentials)
    const leaked = projectCredentialView({ configured: true, writable: true, source: 'file', value: SECRET })
    expect(JSON.stringify(leaked)).not.toContain(SECRET)
    expect(leaked).toEqual({ configured: true, writable: true, source: 'file' })

    controller.edit(SECRET)
    await controller.save()
    expect(calls).toEqual([
      `set ${TYPESAFE_API_KEY_REF}`,
      `describe ${TYPESAFE_API_KEY_REF}`,
    ])
    expect(controller.getSnapshot().text).toBe('')
    expect(controller.getSnapshot().configured).toBe(true)
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(SECRET)

    controller.edit('')
    await controller.save()
    expect(calls).toEqual([
      `set ${TYPESAFE_API_KEY_REF}`,
      `describe ${TYPESAFE_API_KEY_REF}`,
    ])

    await controller.clear()
    expect(calls.at(-2)).toBe(`unset ${TYPESAFE_API_KEY_REF}`)
    expect(controller.getSnapshot().configured).toBe(false)
    expect(calls.some(call => call.startsWith('settings') || call.includes('patch'))).toBe(false)

    const state: KeyFormState = controller.getSnapshot()
    const input = findInput(renderKeyForm({
      t,
      state: { ...state, text: '' },
      onEdit: () => {},
      onSave: () => {},
      onClear: () => {},
    }))
    expect(input?.type).toBe('password')
    expect(input?.autoComplete).toBe('new-password')
    expect(input?.value).toBe('')

    const client = new Context()
    const slots = new SlotRegistry(client)
    const locale = new LocaleRuntime(client)
    client.provide('locale', locale)
    client.provide('remote', { credentials, $on: () => () => {} })
    const Frame = () => null
    slots.register({
      name: 'root',
      children: {
        'plugins.row.config': { kind: 'keyed', scope: 'root' },
      },
    }, Frame as never)
    applyClient(client as never)
    const entry = slots.entries('plugins.row.config').find(item => item.options.key === TYPESAFE_ROW_CONFIG_KEY)
    expect(entry?.options.key).toBe('dsh-verifier-mode#dsh-verifier-mode')
    expect(entry?.component).toBeTypeOf('function')
  })
})
