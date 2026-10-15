/** Generator and Jev failures leave the turn on the normal path. */
import { describe, expect, it } from 'vitest'
import { readVerifierTraces } from '../src/trace.ts'
import { createAgent, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { callKind, json, passingAnswers, startJev } from './support/jev.ts'
import { mountVerifier, verifierConfig } from './support/mount.ts'

describe('P1 fail-open', () => {
  it('continues the main turn when Jev returns an error', async () => {
    const jev = await startJev((body, response) => {
      json(response, 500, { error: 'unavailable' })
    })
    try {
      const candidate = textResponse(JSON.stringify({
        title: 'Test-first',
        steps: ['write the test'],
        acceptance: ['red then green'],
        risks: [],
      }))
      const adapter = new MockAdapter([candidate, candidate, candidate, textResponse('normal answer')])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url))
      const agent = await createAgent(ctx, 'p1-jev-down')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'repair sk-test-secret')
      await idle

      expect(adapter.requests).toHaveLength(4)
      const main = JSON.stringify(adapter.requests[3]?.messages)
      expect(main).toContain('[verifier fallback] Verifier could not decide:')
      expect(main).toContain('sk-test-secret')
      expect(main).not.toContain('[verifier decision]')
      expect(JSON.stringify(jev.bodies[0])).toContain('sk-test-secret')
      expect(JSON.stringify(jev.bodies[0])).toMatch(/<evidence nonce=/)
    } finally {
      await jev.close()
    }
  })

  it('skips scoring when fewer than two candidates parse', async () => {
    const jev = await startJev((_body, response) => {
      json(response, 500, { error: 'should not score' })
    })
    try {
      const adapter = new MockAdapter([
        textResponse('nope'),
        textResponse('still nope'),
        textResponse('no json here'),
        textResponse('normal answer'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url))
      const agent = await createAgent(ctx, 'p1-bad-candidates')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'do the task')
      await idle

      expect(adapter.requests).toHaveLength(4)
      expect(JSON.stringify(adapter.requests[3]?.messages)).toContain('fewer than 2 candidates')
      expect(jev.bodies.filter(body => callKind(body) === 'intake')).toHaveLength(0)
    } finally {
      await jev.close()
    }
  })

  it('marks candidates that were parsed but not scored when Jev fails mid-scoring', async () => {
    let intakeCalls = 0
    const jev = await startJev((body, response) => {
      if (callKind(body) !== 'intake') {
        json(response, 200, { usage: { inputTokens: 1, outputTokens: 0 }, answers: passingAnswers() })
        return
      }
      intakeCalls += 1
      if (intakeCalls >= 2) {
        json(response, 500, { error: 'down' })
        return
      }
      json(response, 200, { usage: { inputTokens: 10, outputTokens: 0 }, answers: passingAnswers(4) })
    })
    try {
      const candidate = (title: string) => textResponse(JSON.stringify({
        title,
        steps: ['step'],
        acceptance: ['done'],
        risks: [],
      }))
      const adapter = new MockAdapter([
        candidate('Minimal'),
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('normal answer'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url))
      const agent = await createAgent(ctx, 'p1-jev-mid-score')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'fix the parser')
      await idle

      expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('[verifier fallback]')
      expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('jev 500')
      const fallback = readVerifierTraces(String(agent.session.id)).find(record => record.outcome === 'fallback')
      const rows = fallback?.candidates ?? []
      const scored = rows.find(item => item.title === 'Minimal')
      const pending = rows.filter(item => item.title !== 'Minimal')
      expect(scored?.kept).toBe(true)
      expect(scored?.dropReason).toBeUndefined()
      expect(pending.length).toBeGreaterThan(0)
      expect(pending.every(item => item.kept === false && item.dropReason === 'scoring-failed')).toBe(true)
    } finally {
      await jev.close()
    }
  })
})
