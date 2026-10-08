/**
 * Spike 3. A judge digest built from `agent.session` matches the digest of a
 * session recreated from that log.
 */
import { describe, expect, it } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import { summarizeSession } from '../src/summary.ts'
import { createAgent, mountLoop, send, waitForIdle } from './support/harness.ts'
import { MockAdapter, textResponse, toolCallResponse } from './support/mock-adapter.ts'

describe('spike 3: session summary', () => {
  it('reproduces the digest after agents.create({ seed })', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-echo', 'echo', { text: 'from-tool' }),
      textResponse('final answer'),
    ])
    const ctx = await mountLoop(adapter)
    ctx.tools.register(defineTool({
      name: 'echo',
      description: 'Echo text.',
      parameters: {
        text: { type: 'string', required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args) {
        return { text: args.text }
      },
    }))
    const agent = await createAgent(ctx, 'spike-3')
    const idle = waitForIdle(ctx, agent)
    send(agent, 'use the echo tool')
    await idle

    const original = summarizeSession(agent.session.snapshotEvents())
    expect(original).toContain('user: use the echo tool')
    expect(original).toContain('tool ok:')
    expect(original).toContain('assistant: final answer')

    const resumed = await mountLoop(new MockAdapter([textResponse('later')]))
    const handle = await resumed.agents.create({
      sessionId: SessionId('spike-3-resume'),
      seed: structuredClone(agent.session.snapshotEvents()),
      agentOptions: { provider: 'mock', model: 'flash' },
    })
    expect(summarizeSession(handle.agent.session.snapshotEvents())).toBe(original)
  })
})
