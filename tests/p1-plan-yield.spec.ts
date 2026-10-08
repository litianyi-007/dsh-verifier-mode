/**
 * Plan mode: no strategy fan-out, the submitted plan is scored as advice,
 * exit_plan_mode is not rejected, D4 waits until the plan is approved,
 * and later execution turns keep that plan as the baseline.
 */
import { describe, expect, it } from 'vitest'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createAgent, logJson, mountLoop, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../spikes/support/mock-adapter.ts'
import * as plugin from '../src/index.ts'
import { json, passingAnswers, startJev } from './support/jev.ts'
import { verifierConfig } from './support/mount.ts'

const PLAN = '# Ship\n\nWrite the regression test, then fix the parser.'

async function mountPlan(adapter: MockAdapter, baseUrl: string, answer: 'Approve' | 'Keep planning') {
  const ctx = await mountLoop(adapter)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(PlanModeController, { section: 'Stay in plan mode until the user approves.' })
  await ctx.plugin(plugin, verifierConfig(baseUrl))
  ctx.on('user-questions/request', () => Promise.resolve({
    answers: [{ id: 'plan-review', selected: [answer] }],
  }))
  return ctx
}

describe('P1 plan-mode yield', () => {
  it('scores the submitted plan, never rejects it, and does not generate new strategies afterwards', async () => {
    const jev = await startJev((body, response) => {
      json(response, 200, { usage: { inputTokens: 12, outputTokens: 0 }, answers: passingAnswers() })
    })
    try {
      const adapter = new MockAdapter([
        toolCallResponse('call-plan', 'exit_plan_mode', { plan: PLAN }),
        textResponse('carried out the plan'),
        textResponse('next execution turn'),
      ])
      const ctx = await mountPlan(adapter, jev.url, 'Approve')
      const agent = await createAgent(ctx, 'p1-plan-approve')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      await ctx.commands.execute(agent, '/plan', [], new AbortController().signal)

      const first = waitForIdle(ctx, agent)
      send(agent, 'present the plan')
      await first

      expect(adapter.requests).toHaveLength(2)
      expect(adapter.requests.every(request => request.reasoningEffort === undefined)).toBe(true)
      expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('[verifier plan-score]')
      expect(logJson(agent)).toContain('Plan approved')
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.approvedPlan).toBe(PLAN)
      const audit = jev.bodies.filter(body => (body as { point?: string }).point === 'audit')
      expect(audit).toHaveLength(1)
      expect(JSON.stringify(audit[0])).toContain('# Ship')
      expect(jev.bodies.some(body => (body as { point?: string }).point === 'intake')).toBe(false)

      const second = waitForIdle(ctx, agent)
      send(agent, 'continue the approved plan')
      await second
      expect(adapter.requests).toHaveLength(3)
      expect(adapter.requests[2]?.reasoningEffort).toBeUndefined()
      expect(jev.bodies.filter(body => (body as { point?: string }).point === 'intake')).toHaveLength(0)
      expect(JSON.stringify(jev.bodies.filter(body => (body as { point?: string }).point === 'audit').at(-1))).toContain('# Ship')
    } finally {
      await jev.close()
    }
  })

  it('scores a plan submitted during /verifier once', async () => {
    const jev = await startJev((body, response) => {
      json(response, 200, { usage: { inputTokens: 12, outputTokens: 0 }, answers: passingAnswers() })
    })
    try {
      const adapter = new MockAdapter([
        toolCallResponse('call-once-plan', 'exit_plan_mode', { plan: PLAN }),
        textResponse('carried out the one turn'),
      ])
      const ctx = await mountPlan(adapter, jev.url, 'Approve')
      const agent = await createAgent(ctx, 'p1-plan-once')
      await ctx.commands.execute(agent, '/verifier once', [], new AbortController().signal)
      await ctx.commands.execute(agent, '/plan', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'present the plan once')
      await idle

      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.active).toBe(false)
      expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('[verifier plan-score]')
      expect(jev.bodies.some(body => (body as { point?: string }).point === 'plan')).toBe(true)
    } finally {
      await jev.close()
    }
  })

  it('skips D4 while plan mode stays active', async () => {
    const jev = await startJev((body, response) => {
      json(response, 200, { usage: { inputTokens: 12, outputTokens: 0 }, answers: passingAnswers() })
    })
    try {
      const adapter = new MockAdapter([
        toolCallResponse('call-plan', 'exit_plan_mode', { plan: PLAN }),
        textResponse('still planning'),
      ])
      const ctx = await mountPlan(adapter, jev.url, 'Keep planning')
      const agent = await createAgent(ctx, 'p1-plan-keep')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      await ctx.commands.execute(agent, '/plan', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'present the plan')
      await idle

      expect(adapter.requests).toHaveLength(2)
      expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('[verifier plan-score]')
      expect(logJson(agent)).toContain('keep planning')
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.approvedPlan).toBeNull()
      expect(jev.bodies.map(body => (body as { point?: string }).point)).toEqual(['plan'])
    } finally {
      await jev.close()
    }
  })
})
