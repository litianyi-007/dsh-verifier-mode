/** Generator and Jev failures leave the turn on the normal path. */
import { describe, expect, it } from 'vitest'
import { createAgent, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { callKind, json, startJev } from './support/jev.ts'
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
})
