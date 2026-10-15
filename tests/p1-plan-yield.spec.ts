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
import { addCostLine } from '../src/cost-book.ts'
import * as plugin from '../src/index.ts'
import { readVerifierTraces } from '../src/trace.ts'
import { callKind, json, passingAnswers, startJev } from './support/jev.ts'
import { verifierConfig } from './support/mount.ts'

const PLAN = '# Ship\n\nWrite the regression test, then fix the parser.'

async function mountPlan(
  adapter: MockAdapter,
  baseUrl: string,
  answer: 'Approve' | 'Keep planning',
  extra: Record<string, unknown> = {},
) {
  const ctx = await mountLoop(adapter)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(PlanModeController, { section: 'Stay in plan mode until the user approves.' })
  await ctx.plugin(plugin, verifierConfig(baseUrl, extra))
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
      const audit = jev.bodies.filter(body => callKind(body) === 'audit')
      expect(audit).toHaveLength(1)
      expect(JSON.stringify(audit[0])).toContain('# Ship')
      expect(jev.bodies.some(body => callKind(body) === 'intake')).toBe(false)

      const second = waitForIdle(ctx, agent)
      send(agent, 'continue the approved plan')
      await second
      expect(adapter.requests).toHaveLength(3)
      expect(adapter.requests[2]?.reasoningEffort).toBeUndefined()
      expect(jev.bodies.filter(body => callKind(body) === 'intake')).toHaveLength(0)
      expect(JSON.stringify(jev.bodies.filter(body => callKind(body) === 'audit').at(-1))).toContain('# Ship')
    } finally {
      await jev.close()
    }
  })

  it('keeps executing an approved plan when only the K reserve would exceed the cap', async () => {
    const jev = await startJev((body, response) => {
      json(response, 200, { usage: { inputTokens: 1, outputTokens: 0 }, answers: passingAnswers() })
    })
    try {
      const adapter = new MockAdapter([
        toolCallResponse('call-plan', 'exit_plan_mode', { plan: PLAN }),
        textResponse('carried out the plan'),
        textResponse('next execution turn'),
      ])
      const ctx = await mountPlan(adapter, jev.url, 'Approve', { cost: { maxPerSession: 0.04 } })
      const agent = await createAgent(ctx, 'p1-plan-near-cap')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      await ctx.commands.execute(agent, '/plan', [], new AbortController().signal)

      const first = waitForIdle(ctx, agent)
      send(agent, 'present the plan')
      await first

      const second = waitForIdle(ctx, agent)
      send(agent, 'continue the approved plan')
      await second

      const last = JSON.stringify(adapter.requests.at(-1)?.messages)
      expect(last).not.toContain('[verifier cost-cap]')
      expect(adapter.requests.every(request => request.reasoningEffort === undefined)).toBe(true)
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused).toBe(false)
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.approvedPlan).toBe(PLAN)
      expect(jev.bodies.filter(body => callKind(body) === 'audit').length).toBeGreaterThan(0)
      expect(jev.bodies.filter(body => callKind(body) === 'intake')).toHaveLength(0)
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
      expect(jev.bodies.some(body => callKind(body) === 'plan')).toBe(true)
    } finally {
      await jev.close()
    }
  })

  it('does not score a plan after the cap is already spent', async () => {
    const jev = await startJev((_body, response) => {
      json(response, 500, { error: 'should not score' })
    })
    try {
      const adapter = new MockAdapter([
        toolCallResponse('call-plan', 'exit_plan_mode', { plan: PLAN }),
        textResponse('still planning'),
      ])
      const ctx = await mountPlan(adapter, jev.url, 'Keep planning')
      const agent = await createAgent(ctx, 'p1-plan-at-cap')
      await addCostLine('p1-plan-at-cap', {
        source: 'jev',
        model: 'jev',
        amountCny: 1,
        nativeAmount: 1,
        nativeCurrency: 'CNY',
      })
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      await ctx.commands.execute(agent, '/plan', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'present the plan')
      await idle

      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused).toBe(false)
      expect(jev.bodies.filter(body => callKind(body) === 'plan')).toHaveLength(0)
      expect(JSON.stringify(adapter.requests[1]?.messages)).not.toContain('[verifier plan-score]')
      expect(readVerifierTraces(String(agent.session.id))).toEqual(expect.arrayContaining([
        expect.objectContaining({ point: 'plan', outcome: 'cost-cap' }),
      ]))
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
      expect(jev.bodies.map(body => callKind(body))).toEqual(['plan'])
    } finally {
      await jev.close()
    }
  })
})
