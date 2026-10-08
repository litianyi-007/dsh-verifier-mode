/**
 * Session switch: `/verifier once` runs one turn, then the logged mode returns.
 * The profile default is covered in spike 5. CLI/SDK use cordis.patch.yml.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createAgent, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { json, passingAnswers, startJev } from './support/jev.ts'
import { mountVerifier, verifierConfig } from './support/mount.ts'

function candidate(title: string): ReturnType<typeof textResponse> {
  return textResponse(JSON.stringify({
    title,
    steps: ['do the work'],
    acceptance: [`${title} done`],
    risks: [],
  }))
}

describe('P1 session switch', () => {
  it('runs /verifier once for a single turn and leaves the session off afterwards', async () => {
    const jev = await startJev((body, response) => {
      const state = body.state as { candidate?: { title?: string } }
      const addresses = state.candidate?.title === 'Test-first' ? 4 : 1
      json(response, 200, { usage: { inputTokens: 20, outputTokens: 0 }, answers: passingAnswers(addresses) })
    })
    try {
      const adapter = new MockAdapter([
        candidate('Minimal'),
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('once done'),
        textResponse('later'),
      ])
      const ctx = await mountVerifier(adapter, verifierConfig(jev.url))
      const agent = await createAgent(ctx, 'p1-once')
      const armed = await ctx.commands.execute(agent, '/verifier once', [], new AbortController().signal)
      expect(armed?.result.kind).toBe('success')
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')).toMatchObject({
        active: false,
        onceArmed: true,
      })

      const first = waitForIdle(ctx, agent)
      send(agent, 'ship the once task')
      await first
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.onceArmed).toBe(false)
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.active).toBe(false)
      expect(JSON.stringify(adapter.requests[3]?.messages)).toContain('selected Test-first')
      expect(adapter.requests[0]?.reasoningEffort).toBe('low')
      const afterOnce = adapter.requests.length

      const second = waitForIdle(ctx, agent)
      send(agent, 'ordinary follow-up')
      await second
      expect(adapter.requests.length).toBe(afterOnce + 1)
      expect(adapter.requests.at(-1)?.reasoningEffort).toBeUndefined()
      expect(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')).toContain('dsh-verifier-mode')
    } finally {
      await jev.close()
    }
  })
})
