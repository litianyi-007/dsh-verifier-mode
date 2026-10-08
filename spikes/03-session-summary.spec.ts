/**
 * Spike 3. The judge digest skips empty assistant lines and names the tool.
 * Production reads `verifierJudge` via `stateOf`. The pure fold is compared
 * only inside this test.
 */
import { describe, expect, it } from 'vitest'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as plugin from '../src/index.ts'
import { readJudgeDigest, summarizeSession } from '../src/summary.ts'
import { createAgent, mountLoop, send, waitForIdle } from './support/harness.ts'
import { MockAdapter, textResponse, toolCallResponse } from './support/mock-adapter.ts'

const DIGEST = [
  'user: use the echo tool',
  'tool echo ok: from-tool',
  'assistant: final answer',
].join('\n')

describe('spike 3: session summary', () => {
  it('reproduces the digest after agents.create({ seed })', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-echo', 'echo', { text: 'from-tool' }),
      textResponse('final answer'),
    ])
    const ctx = await mountLoop(adapter)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(plugin, {})
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

    expect(readJudgeDigest(ctx.sessionProjections, agent.session)).toBe(DIGEST)
    expect(summarizeSession(agent.session.snapshotEvents())).toBe(DIGEST)

    const resumed = await mountLoop(new MockAdapter([textResponse('later')]))
    await resumed.plugin(CommandRuntime)
    await resumed.plugin(plugin, {})
    const handle = await resumed.agents.create({
      sessionId: SessionId('spike-3-resume'),
      seed: structuredClone(agent.session.snapshotEvents()),
      agentOptions: { provider: 'mock', model: 'flash' },
    })
    expect(readJudgeDigest(resumed.sessionProjections, handle.agent.session)).toBe(DIGEST)
    expect(summarizeSession(handle.agent.session.snapshotEvents())).toBe(DIGEST)
  })
})
