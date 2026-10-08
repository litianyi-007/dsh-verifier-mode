/**
 * Spike 4. `exit_plan_mode` rejection and a pre-execute deny both still run
 * post-execute, and `additionalContexts` reach the next model request.
 * A throwing pre-execute listener skips post-execute.
 */
import { describe, expect, it } from 'vitest'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'
import { defineTool } from '@deepseek-ai/dsh-tools'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { verifierNotice } from '../src/notices.ts'
import { createAgent, logJson, mountLoop, send, waitForIdle } from './support/harness.ts'
import { MockAdapter, textResponse, toolCallResponse } from './support/mock-adapter.ts'

const REJECTED = 'P0-PLAN-REJECTED-context'
const DENIED = 'P0-TOOL-DENIED-context'

function registerEcho(ctx: { tools: { register: (definition: ReturnType<typeof defineTool>) => void } }): void {
  ctx.tools.register(defineTool({
    name: 'echo',
    description: 'Echo text.',
    parameters: { text: { type: 'string', required: true } },
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
}

describe('spike 4: exit_plan_mode additionalContexts', () => {
  it('attaches additionalContexts when the user keeps planning', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-plan', 'exit_plan_mode', { plan: '# Ship\n\nDo the work.' }),
      textResponse('revised plan'),
    ])
    const ctx = await mountLoop(adapter)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(PlanModeController, { section: 'Stay in plan mode until the user approves.' })
    ctx.on('user-questions/request', () => Promise.resolve({
      answers: [{ id: 'plan-review', selected: ['Keep planning'] }],
    }))
    ctx.on('tools/post-execute', async (exec, result, next) => {
      const decision = await next()
      if (exec.name !== 'exit_plan_mode' || result.isError !== true || decision.kind !== 'accept') return decision
      return {
        ...decision,
        additionalContexts: [verifierNotice(REJECTED, 'plan rejected')],
      }
    })

    const agent = await createAgent(ctx, 'spike-4-plan')
    const entered = await ctx.commands.execute(agent, '/plan', [], new AbortController().signal)
    expect(entered?.result.kind).toBe('success')

    const idle = waitForIdle(ctx, agent)
    send(agent, 'present the plan')
    await idle

    expect(adapter.requests).toHaveLength(2)
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain(REJECTED)
    expect(logJson(agent)).toContain(REJECTED)
    expect(logJson(agent)).toContain('keep planning')
  })

  it('attaches additionalContexts when pre-execute denies the tool', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-echo', 'echo', { text: 'hi' }),
      textResponse('after deny'),
    ])
    const ctx = await mountLoop(adapter)
    registerEcho(ctx)
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (exec.name !== 'echo') return decision
      return { kind: 'deny', reason: 'spike deny' }
    })
    ctx.on('tools/post-execute', async (exec, result, next) => {
      const decision = await next()
      if (exec.name !== 'echo' || result.isError !== true || decision.kind !== 'accept') return decision
      return {
        ...decision,
        additionalContexts: [verifierNotice(DENIED, 'tool denied')],
      }
    })
    const agent = await createAgent(ctx, 'spike-4-deny')
    const idle = waitForIdle(ctx, agent)
    send(agent, 'echo something')
    await idle

    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain(DENIED)
    expect(logJson(agent)).toContain('spike deny')
  })

  it('skips post-execute when a pre-execute listener throws', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('call-echo', 'echo', { text: 'hi' }),
      textResponse('after throw'),
    ])
    const ctx = await mountLoop(adapter)
    registerEcho(ctx)
    let post = 0
    ctx.on('tools/pre-execute', () => {
      throw new Error('pre-execute exploded')
    })
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      post += 1
      return next()
    })
    const agent = await createAgent(ctx, 'spike-4-throw')
    const idle = waitForIdle(ctx, agent)
    send(agent, 'echo something')
    await idle

    expect(post).toBe(0)
    expect(logJson(agent)).toContain('pre-execute exploded')
  })
})
