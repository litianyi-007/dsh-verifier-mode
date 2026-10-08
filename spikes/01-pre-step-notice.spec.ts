/**
 * Spike 1. A pre-step listener can append a logged notice, and a session
 * reloaded from the seed reconstructs that notice without the listener.
 */
import { describe, expect, it } from 'vitest'
import { createAgent, logJson, mountLoop, send, waitForIdle } from './support/harness.ts'
import { MockAdapter, textResponse } from './support/mock-adapter.ts'
import { verifierNotice } from '../src/notices.ts'
import { SessionId } from '@deepseek-ai/dsh-session'

const MARKER = 'P0-NOTICE-marker-pre-step'

describe('spike 1: agent/pre-step notice', () => {
  it('puts the notice in the model request and restores it from the session seed', async () => {
    const adapter = new MockAdapter([textResponse('first answer')])
    const ctx = await mountLoop(adapter)
    ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      return {
        ...decision,
        messages: [...decision.messages, verifierNotice(MARKER, 'p0 notice')],
      }
    })
    const agent = await createAgent(ctx, 'spike-1')
    const idle = waitForIdle(ctx, agent)
    send(agent, 'hello')
    await idle

    expect(adapter.requests).toHaveLength(1)
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain(MARKER)
    expect(logJson(agent)).toContain(MARKER)
    const seed = structuredClone(agent.session.snapshotEvents())

    const resumedAdapter = new MockAdapter([textResponse('second answer')])
    const resumed = await mountLoop(resumedAdapter)
    const handle = await resumed.agents.create({
      sessionId: SessionId('spike-1-resume'),
      seed,
      agentOptions: { provider: 'mock', model: 'flash' },
    })
    const resumedIdle = waitForIdle(resumed, handle.agent)
    send(handle.agent, 'continue')
    await resumedIdle

    expect(JSON.stringify(resumedAdapter.requests[0]?.messages)).toContain(MARKER)
    expect(JSON.stringify(resumedAdapter.requests[0]?.messages)).toContain('first answer')
    expect(JSON.stringify(resumedAdapter.requests[0]?.messages)).toContain('continue')
  })
})
