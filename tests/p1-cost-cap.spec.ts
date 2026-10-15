/**
 * Per-model CNY cap. One running total. Reserve blocks a decision that would
 * exceed the cap. Live usage aborts a decision already in flight. The chip
 * shows paused, stderr gets a dsh: line, and a higher cap resumes the session.
 */
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { VerifierChip } from '../src/client/index.ts'
import { costClock } from '../src/clock.ts'
import { sessionCostLines, sessionSpendCny } from '../src/cost-book.ts'
import { readVerifierTraces } from '../src/trace.ts'
import { createAgent, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { json, passingAnswers, startJev } from './support/jev.ts'
import { mountVerifier, verifierConfig } from './support/mount.ts'

const PEAK = new Date(Date.UTC(2026, 9, 8, 2, 0, 0))

function candidate(title: string): ReturnType<typeof textResponse> {
  return textResponse(JSON.stringify({
    title,
    steps: ['step'],
    acceptance: ['done'],
    risks: [],
  }))
}

describe('P1 cost cap', () => {
  it('does not start a decision whose reserve would exceed the cap', async () => {
    const jev = await startJev((_body, response) => {
      json(response, 200, { usage: { inputTokens: 1, outputTokens: 0 }, answers: passingAnswers() })
    })
    const stderr: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stderr.write
    try {
      const adapter = new MockAdapter([textResponse('normal path')])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url, { cost: { maxPerSession: 0.01 } }))
      const agent = await createAgent(ctx, 'p1-cap-reserve')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'cheap task')
      await idle

      expect(adapter.requests).toHaveLength(1)
      expect(JSON.stringify(adapter.requests[0]?.messages)).toContain('[verifier cost-cap]')
      expect(stderr.join('')).toContain('dsh: verifier paused cost-cap')
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused).toBe(true)
      expect(readVerifierTraces(String(agent.session.id)).some(record => record.outcome === 'cost-cap')).toBe(true)
      expect(jev.bodies).toHaveLength(0)
      const paused = ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused
      const element = VerifierChip({
        t: (key) => key === 'chip.label' ? 'Verifier' : key === 'chip.paused' ? 'Paused' : key,
        toggle: async () => null,
        paused,
        active: true,
      })
      const button = element as ReturnType<typeof createElement> & { props: { children: string } }
      expect(button.props.children).toBe('Verifier · Paused')
    } finally {
      process.stderr.write = original
      await jev.close()
    }
  })

  it('aborts a decision when live usage crosses the cap, then resumes under the pro cap', async () => {
    const previous = costClock.now
    costClock.now = () => PEAK
    const jev = await startJev((body, response) => {
      const title = (body as { state?: { candidate?: { title?: string } } }).state?.candidate?.title
      json(response, 200, { usage: { inputTokens: 10, outputTokens: 0 }, answers: passingAnswers(title === 'Test-first' ? 4 : 1) })
    })
    const stderr: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stderr.write
    try {
      const heavy = textResponse(JSON.stringify({
        title: 'Minimal',
        steps: ['step'],
        acceptance: ['done'],
        risks: [],
      }), { inputTokens: 800_000, outputTokens: 1 })
      const adapter = new MockAdapter([
        heavy,
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('paused path'),
        candidate('Minimal'),
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('resumed path'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url))
      ctx.llm.registerAdapter(['deepseek'], adapter)
      const agent = await ctx.agentLoop.create(SessionId('p1-cap-resume'), {
        provider: 'deepseek',
        model: 'deepseek-flash',
      })
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const first = waitForIdle(ctx, agent)
      send(agent, 'first task')
      await first

      const spent = sessionSpendCny(String(agent.session.id))
      expect(spent).toBeGreaterThan(1)
      expect(spent).toBeLessThan(4)
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused).toBe(true)
      expect(stderr.join('')).toContain('dsh: verifier paused cost-cap')
      expect(adapter.requests).toHaveLength(4)
      expect(JSON.stringify(adapter.requests[3]?.messages)).toContain('Counted: generator+jev+post-steer')
      const capped = readVerifierTraces(String(agent.session.id)).find(record => record.point === 'intake' && record.outcome === 'cost-cap')
      const parsed = capped?.candidates?.find(item => item.title === 'Minimal')
      expect(parsed?.kept).toBe(false)
      expect(parsed?.dropReason).toBe('cost-cap')
      expect(sessionCostLines(String(agent.session.id)).some(line => line.model === 'deepseek/deepseek-flash' && line.source === 'generator')).toBe(true)

      const selection: ModelSelectionRef = {
        current: { provider: 'deepseek', model: 'deepseek-v4-pro' },
        assembled: undefined,
      }
      installModelSelection(agent.ctx, selection)
      agent.session.append('model/selection', { provider: 'deepseek', model: 'deepseek-v4-pro' })
      expect(sessionSpendCny(String(agent.session.id))).toBe(spent)

      const second = waitForIdle(ctx, agent)
      send(agent, 'second task')
      await second

      expect(sessionSpendCny(String(agent.session.id))).toBeGreaterThan(spent)
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused).toBe(false)
      expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('[verifier cost-resume]')
      expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('selected Test-first')
    } finally {
      costClock.now = previous
      process.stderr.write = original
      await jev.close()
    }
  })

  it('bills a flash generator against the pro session cap', async () => {
    const previous = costClock.now
    costClock.now = () => PEAK
    const jev = await startJev((_body, response) => {
      json(response, 200, { usage: { inputTokens: 10, outputTokens: 0 }, answers: passingAnswers(4) })
    })
    try {
      const heavy = textResponse(JSON.stringify({
        title: 'Minimal',
        steps: ['step'],
        acceptance: ['done'],
        risks: [],
      }), { inputTokens: 800_000, outputTokens: 1 })
      const adapter = new MockAdapter([
        heavy,
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('pro session finished'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url, {
        generatorRoute: { provider: 'deepseek', model: 'deepseek-flash' },
      }))
      ctx.llm.registerAdapter(['deepseek'], adapter)
      const agent = await ctx.agentLoop.create(SessionId('p1-cap-generator'), {
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
      })
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'use the cheap generator')
      await idle

      const lines = sessionCostLines(String(agent.session.id))
      const generated = lines.find(line => line.source === 'generator')
      expect(generated?.model).toBe('deepseek/deepseek-flash')
      expect(generated?.amountCny).toBeGreaterThan(1)
      expect(generated?.amountCny).toBeLessThan(4)
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused).toBe(false)
      expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('[verifier decision]')
    } finally {
      costClock.now = previous
      await jev.close()
    }
  })
})
