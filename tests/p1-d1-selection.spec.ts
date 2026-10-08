/**
 * D1: three read-only candidates, one Jev score each, code picks the winner,
 * and the logged notice is what the main agent executes.
 */
import { describe, expect, it } from 'vitest'
import { createAgent, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { json, passingAnswers, startJev } from './support/jev.ts'
import { mountVerifier, verifierConfig } from './support/mount.ts'

function candidate(title: string, acceptance: string): ReturnType<typeof textResponse> {
  return textResponse(JSON.stringify({
    title,
    steps: [`step for ${title}`],
    acceptance: [acceptance],
    risks: ['none'],
  }))
}

describe('P1 D1 selection', () => {
  it('scores three candidates on separate dimensions and executes the winner notice', async () => {
    const jev = await startJev((body, response) => {
      const state = body.state as { task?: string; evidence?: string; candidate?: { title?: string } }
      const addresses = state.candidate?.title === 'Test-first' ? 4 : 1
      json(response, 200, { usage: { inputTokens: 30, outputTokens: 0 }, answers: passingAnswers(addresses) })
      expect(state.task).toContain('sk-test-secret')
      expect(state.evidence).toMatch(/<evidence nonce="[0-9a-f]+">/)
      expect(JSON.stringify(body)).not.toContain('[REDACTED]')
    })
    try {
      const adapter = new MockAdapter([
        candidate('Minimal', 'smallest diff'),
        candidate('Test-first', 'red tests first'),
        candidate('Investigate', 'cause found'),
        textResponse('executed the winner'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url))
      const agent = await createAgent(ctx, 'p1-d1')
      expect((await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal))?.result.kind).toBe('success')
      const idle = waitForIdle(ctx, agent)
      send(agent, 'fix the parser sk-test-secret')
      await idle

      expect(adapter.requests.slice(0, 3).map(request => request.reasoningEffort)).toEqual(['low', 'low', 'low'])
      expect(adapter.requests.slice(0, 3).every(request => request.tools === undefined)).toBe(true)
      expect(adapter.requests[3]?.reasoningEffort).toBeUndefined()
      const main = JSON.stringify(adapter.requests[3]?.messages)
      expect(main).toContain('[verifier decision] selected Test-first')
      expect(main).toContain('red tests first')
      expect(main).toContain('sk-test-secret')
      expect(jev.bodies.filter(body => (body as { point?: string }).point === 'intake')).toHaveLength(3)
    } finally {
      await jev.close()
    }
  })
})
