/**
 * Spike 5. The composer chip calls `remote.commands.execute(sessionId, line, [])`.
 * `/verifier` logs the toggle, and a reloaded session restores the projection.
 *
 * The generated `@deepseek-ai/dsh-commands/remote` client is a build artifact
 * and is not executed here. The test uses the host `CommandRuntime.execute`
 * behind the same client signature the plan chip uses.
 */
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as plugin from '../src/index.ts'
import { apply as applyClient, VerifierChip } from '../src/client/index.ts'
import { createAgent, logJson, mountLoop, send, waitForIdle } from './support/harness.ts'
import { MockAdapter, textResponse } from './support/mock-adapter.ts'

const Frame = () => null

describe('spike 5: /verifier chip and command', () => {
  it('runs /verifier on|off from the chip and restores the mode from the log', async () => {
    const ctx = await mountLoop(new MockAdapter([textResponse('after toggle')]))
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(plugin, {})
    const agent = await createAgent(ctx, 'spike-5')
    const sessionId = agent.id

    const client = new Context()
    const slots = new SlotRegistry(client)
    const locale = new LocaleRuntime(client)
    client.provide('locale', locale)
    const calls: string[] = []
    client.provide('remote', {
      commands: {
        execute: async (id: string, line: string, attachments: readonly unknown[]) => {
          calls.push(`${id} ${line} ${attachments.length}`)
          expect(id).toBe(sessionId)
          const value = await ctx.commands.execute(agent, line, [], new AbortController().signal)
          return { ok: true as const, value }
        },
      },
    })
    slots.register({
      name: 'root',
      children: {
        'conversation.input.left': { kind: 'list', scope: 'session' },
      },
    }, Frame as never)
    applyClient(client as never)

    const entry = slots.entries('conversation.input.left').find(item => item.options.id === 'dsh-verifier-mode')
    expect(entry?.inject).toBeTypeOf('function')
    const face = entry!.inject!(sessionId as never) as { toggle: (active: boolean) => Promise<string | null> }
    expect(await face.toggle(true)).toBeNull()
    expect(await face.toggle(false)).toBeNull()
    expect(calls).toEqual([
      `${sessionId} /verifier on 0`,
      `${sessionId} /verifier off 0`,
    ])

    expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.active).toBe(false)

    let click = Promise.resolve<string | null>(null)
    const element = VerifierChip({
      t: (key) => locale.bind('verifier')(key),
      toggle: (active) => {
        click = face.toggle(active)
        return click
      },
      active: false,
    })
    const button = element as ReturnType<typeof createElement> & { props: { onClick: () => void; children: string } }
    expect(button.props.children).toBe('Verifier')
    button.props.onClick()
    expect(await click).toBeNull()
    expect(calls.at(-1)).toBe(`${sessionId} /verifier on 0`)

    expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.active).toBe(true)
    expect(logJson(agent)).toContain('command/run')
    expect(logJson(agent)).toContain('[verifier mode on]')

    const resumedAdapter = new MockAdapter([textResponse('restored')])
    const resumed = await mountLoop(resumedAdapter)
    await resumed.plugin(CommandRuntime)
    await resumed.plugin(plugin, {})
    const handle = await resumed.agents.create({
      sessionId: SessionId('spike-5-resume'),
      seed: structuredClone(agent.session.snapshotEvents()),
      agentOptions: { provider: 'mock', model: 'flash' },
    })
    expect(resumed.sessionProjections.stateOf(handle.agent.session, 'verifier')?.active).toBe(true)

    const idle = waitForIdle(resumed, handle.agent)
    send(handle.agent, 'after reload')
    await idle
    expect(JSON.stringify(resumedAdapter.requests[0]?.messages)).toContain('[verifier mode on]')
  })
})

describe('spike 5: enabledByDefault', () => {
  it('seeds verifier.active from enabledByDefault before any /verifier command', async () => {
    const on = await mountLoop(new MockAdapter([]))
    await on.plugin(CommandRuntime)
    await on.plugin(plugin, { enabledByDefault: true })
    const onAgent = await createAgent(on, 'spike-5-default-on')
    expect(on.sessionProjections.stateOf(onAgent.session, 'verifier')?.active).toBe(true)
    expect(logJson(onAgent)).not.toContain('command/run')
    expect(on.sessionProjections.stateOf(onAgent.session, 'verifierRoute')).toEqual({ pending: null, lastUsed: null })
    expect(on.sessionProjections.stateOf(onAgent.session, 'verifierLedger')).toEqual({ byRoute: {} })
    expect(on.sessionProjections.stateOf(onAgent.session, 'verifierJudge')).toEqual({ lines: [], names: {} })

    const off = await mountLoop(new MockAdapter([]))
    await off.plugin(CommandRuntime)
    await off.plugin(plugin, { enabledByDefault: false })
    const offAgent = await createAgent(off, 'spike-5-default-off')
    expect(off.sessionProjections.stateOf(offAgent.session, 'verifier')?.active).toBe(false)

    const bare = await mountLoop(new MockAdapter([]))
    await bare.plugin(CommandRuntime)
    await bare.plugin(plugin, {})
    const bareAgent = await createAgent(bare, 'spike-5-default-bare')
    expect(bare.sessionProjections.stateOf(bareAgent.session, 'verifier')?.active).toBe(false)
  })
})

describe('spike 5 slot core', () => {
  it('list registration requires an id, matching conversation.input.left', () => {
    const core = new SlotCore()
    core.register({
      name: 'root',
      children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
    }, Frame as never)
    expect(() => core.register({ name: 'conversation.input.left' }, Frame)).toThrow(/requires options.id/)
  })
})
