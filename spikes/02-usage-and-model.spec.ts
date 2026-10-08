/**
 * Spike 2. Token usage is readable from `ctx.llm.stream` and from the
 * committed assistant message. The session cap route is provider + model,
 * read from the `verifierRoute` projection. An effort-only selection does
 * not change it. ACP same-step switching is out of MVP scope: this file only
 * records that a private ref with no `model/selection` event lags one request.
 */
import { describe, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.ts'
import { readLedger, routeKey } from '../src/ledger.ts'
import { readCurrentRoute } from '../src/route.ts'
import { createAgent, mountLoop, send, waitForIdle } from './support/harness.ts'
import { MockAdapter, textResponse } from './support/mock-adapter.ts'

function usageOf(chunks: { type: string; usage?: TokenUsage }[]): TokenUsage | undefined {
  return chunks.find(chunk => chunk.type === 'usage')?.usage
}

async function mountPlugin(adapter: MockAdapter): Promise<Context> {
  const ctx = await mountLoop(adapter)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(plugin, {})
  return ctx
}

describe('spike 2: usage and current model', () => {
  it('bills cache and reasoning tokens from the main turn and leaves the side stream out of the ledger', async () => {
    const side = textResponse('side call', { inputTokens: 3, outputTokens: 1, cacheReadTokens: 11 })
    side.splice(-2, 1, {
      type: 'usage',
      usage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 11, cacheWriteTokens: 2, totalTokens: 17 },
    })
    const adapter = new MockAdapter([
      side,
      textResponse('main answer', {
        inputTokens: 10,
        outputTokens: 8,
        cacheReadTokens: 4,
        cacheWriteTokens: 5,
        reasoningTokens: 7,
      }),
    ])
    const ctx = await mountPlugin(adapter)
    const chunks: { type: string; usage?: TokenUsage }[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'mock',
      model: 'mock',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'SIDE-ONLY' }],
        source: { kind: 'user' },
      })],
    })) {
      chunks.push(chunk)
    }
    expect(usageOf(chunks)).toMatchObject({
      inputTokens: 3,
      cacheReadTokens: 11,
      cacheWriteTokens: 2,
      totalTokens: 17,
    })

    const agent = await createAgent(ctx, 'spike-2-usage')
    const idle = waitForIdle(ctx, agent)
    send(agent, 'bill the main turn')
    await idle

    const message = agent.session.snapshotEvents().find(event => event.type === 'assistant/message')
    expect(message?.type === 'assistant/message' ? message.data.usage : undefined).toMatchObject({
      inputTokens: 10,
      outputTokens: 8,
      cacheReadTokens: 4,
      cacheWriteTokens: 5,
      reasoningTokens: 7,
    })
    expect(JSON.stringify(agent.session.snapshotEvents())).not.toContain('SIDE-ONLY')
    expect(readLedger(ctx.sessionProjections, agent.session).byRoute).toEqual({
      [routeKey('mock', 'flash')]: {
        inputTokens: 10,
        outputTokens: 8,
        cacheReadTokens: 4,
        cacheWriteTokens: 5,
        reasoningTokens: 7,
      },
    })
  })

  it('sees a logged model/selection at the next pre-step, before the request header catches up', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await mountPlugin(adapter)
    const agent = await createAgent(ctx, 'spike-2-web', 'flash')
    const selection: ModelSelectionRef = {
      current: { provider: 'mock', model: 'flash' },
      assembled: undefined,
    }
    installModelSelection(agent.ctx, selection)

    const first = waitForIdle(ctx, agent)
    send(agent, 'first')
    await first

    let foldedAtPreStep: ReturnType<typeof readCurrentRoute> | undefined
    let headerModel: string | undefined
    ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.turn === 2) {
        foldedAtPreStep = readCurrentRoute(ctx.sessionProjections, payload.agent.session, payload.agent.options)
        headerModel = payload.agent.session.requestHeader()?.config.model
      }
      return next()
    })
    agent.session.append('model/selection', { provider: 'mock', model: 'pro' })
    // The fold reads the log. The request model comes from this private ref.
    selection.current = { provider: 'mock', model: 'pro' }

    const second = waitForIdle(ctx, agent)
    send(agent, 'second')
    await second

    expect(headerModel).toBe('flash')
    expect(foldedAtPreStep).toEqual({ provider: 'mock', model: 'pro', source: 'model/selection' })
    expect(adapter.requests[1]?.model).toBe('pro')
    expect(agent.options.model).toBe('flash')
  })

  it('ignores a model/selection that only changes reasoningEffort', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await mountPlugin(adapter)
    const agent = await createAgent(ctx, 'spike-2-effort', 'flash')
    const first = waitForIdle(ctx, agent)
    send(agent, 'first')
    await first

    const before = ctx.sessionProjections.stateOf(agent.session, 'verifierRoute')
    agent.session.append('model/selection', {
      provider: 'mock',
      model: 'flash',
      reasoningEffort: 'high',
    })
    expect(ctx.sessionProjections.stateOf(agent.session, 'verifierRoute')).toBe(before)
    expect(readCurrentRoute(ctx.sessionProjections, agent.session, agent.options)).toEqual({
      provider: 'mock',
      model: 'flash',
      source: 'request/header',
    })
  })

  it('lags when only the private ModelSelectionRef changes and no model/selection event is logged', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await mountPlugin(adapter)
    const agent = await createAgent(ctx, 'spike-2-acp', 'flash')
    const selection: ModelSelectionRef = {
      current: { provider: 'mock', model: 'flash' },
      assembled: undefined,
    }
    installModelSelection(agent.ctx, selection)
    const first = waitForIdle(ctx, agent)
    send(agent, 'first')
    await first

    let foldedAtPreStep: ReturnType<typeof readCurrentRoute> | undefined
    ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.turn === 2) {
        foldedAtPreStep = readCurrentRoute(ctx.sessionProjections, payload.agent.session, payload.agent.options)
      }
      return next()
    })
    // Out of MVP: ACP can switch the private ref in the same step. This spike does not build that path.
    selection.current = { provider: 'mock', model: 'pro' }
    const second = waitForIdle(ctx, agent)
    send(agent, 'second')
    await second

    expect(foldedAtPreStep).toEqual({ provider: 'mock', model: 'flash', source: 'request/header' })
    expect(adapter.requests[1]?.model).toBe('pro')
  })
})
