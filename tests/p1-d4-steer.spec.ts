/** D4: one failing audit steers once. A second failure stops. */
import { describe, expect, it } from 'vitest'
import { createAgent, logJson, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { callKind, json, passingAnswers, startJev } from './support/jev.ts'
import { mountVerifier, verifierConfig } from './support/mount.ts'

function candidate(title: string): ReturnType<typeof textResponse> {
  return textResponse(JSON.stringify({
    title,
    steps: ['ship'],
    acceptance: ['tests pass'],
    risks: [],
  }))
}

describe('P1 D4 audit', () => {
  it('steers once when the audit fails and does not steer again', async () => {
    const jev = await startJev((body, response) => {
      if (callKind(body) === 'audit') {
        json(response, 200, {
          usage: { inputTokens: 15, outputTokens: 0 },
          answers: { ...passingAnswers(), criterion_met_0: { value: 0.95, confidence: 0.9 }, unverified_claims: { value: 0.9, confidence: 0.9 } },
        })
        return
      }
      const title = (body as { state?: { candidate?: { title?: string } } }).state?.candidate?.title
      json(response, 200, { usage: { inputTokens: 15, outputTokens: 0 }, answers: passingAnswers(title === 'Test-first' ? 4 : 1) })
    })
    try {
      const adapter = new MockAdapter([
        candidate('Minimal'),
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('not done yet'),
        textResponse('still not done'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url))
      const agent = await createAgent(ctx, 'p1-d4')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'make the tests pass')
      await idle

      expect(adapter.requests).toHaveLength(5)
      expect(JSON.stringify(adapter.requests[4]?.messages)).toContain('[verifier audit] unmet:')
      expect(logJson(agent)).toContain('[verifier incomplete]')
      expect(jev.bodies.filter(body => callKind(body) === 'audit')).toHaveLength(2)
    } finally {
      await jev.close()
    }
  })
})
