/**
 * Spike 2. Token usage is readable from `ctx.llm.stream` and from the
 * committed assistant message. The public current-route fold matches a Web
 * `model/selection` switch at pre-step, and lags an in-memory-only switch.
 */
import { describe, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { currentRoute } from '../src/route.ts'
import { createAgent, mountLoop, send, waitForIdle } from './support/harness.ts'
import { MockAdapter, textResponse } from './support/mock-adapter.ts'

function usageOf(chunks: { type: string; usage?: TokenUsage }[]): TokenUsage | undefined {
  return chunks.find(chunk => chunk.type === 'usage')?.usage
}

describe('spike 2: usage and current model', () => {
  it('reads cache tokens from ctx.llm.stream without writing that call into the session log', async () => {
    const side = textResponse('side call', { inputTokens: 3, outputTokens: 1, cacheReadTokens: 11 })
    side.splice(-2, 1, {
      type: 'usage',
      usage: { inputTokens: 3, outputTokens: 1, cacheReadTokens: 11, cacheWriteTokens: 2, totalTokens: 17 },
    })
    const adapter = new MockAdapter([side, textResponse('main answer')])
    const ctx = await mountLoop(adapter)
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
      outputTokens: 'main answer'.length,
    })
    expect(JSON.stringify(agent.session.snapshotEvents())).not.toContain('SIDE-ONLY')
  })

  it('sees a logged model/selection at the next pre-step, before the request header catches up', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await mountLoop(adapter)
    const agent = await createAgent(ctx, 'spike-2-web', 'flash')
    const selection: ModelSelectionRef = {
      current: { provider: 'mock', model: 'flash' },
      assembled: undefined,
    }
    installModelSelection(agent.ctx, selection)

    const first = waitForIdle(ctx, agent)
    send(agent, 'first')
    await first

    let foldedAtPreStep: ReturnType<typeof currentRoute> | undefined
    let headerModel: string | undefined
    ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.turn === 2) {
        foldedAtPreStep = currentRoute(payload.agent.session, payload.agent.options)
        headerModel = payload.agent.session.requestHeader()?.config.model
      }
      return next()
    })
    agent.session.append('model/selection', { provider: 'mock', model: 'pro' })
    selection.current = { provider: 'mock', model: 'pro' }

    const second = waitForIdle(ctx, agent)
    send(agent, 'second')
    await second

    expect(headerModel).toBe('flash')
    expect(foldedAtPreStep).toEqual({ provider: 'mock', model: 'pro', source: 'model/selection' })
    expect(adapter.requests[1]?.model).toBe('pro')
    expect(agent.options.model).toBe('flash')
  })

  it('lags when only the private ModelSelectionRef changes and no model/selection event is logged', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await mountLoop(adapter)
    const agent = await createAgent(ctx, 'spike-2-acp', 'flash')
    const selection: ModelSelectionRef = {
      current: { provider: 'mock', model: 'flash' },
      assembled: undefined,
    }
    installModelSelection(agent.ctx, selection)
    const first = waitForIdle(ctx, agent)
    send(agent, 'first')
    await first

    let foldedAtPreStep: ReturnType<typeof currentRoute> | undefined
    ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.turn === 2) foldedAtPreStep = currentRoute(payload.agent.session, payload.agent.options)
      return next()
    })
    selection.current = { provider: 'mock', model: 'pro' }
    const second = waitForIdle(ctx, agent)
    send(agent, 'second')
    await second

    expect(foldedAtPreStep).toEqual({ provider: 'mock', model: 'flash', source: 'request/header' })
    expect(adapter.requests[1]?.model).toBe('pro')
  })
})
