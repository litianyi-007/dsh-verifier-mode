/**
 * An API key on the schema default URL is configured. The process must score,
 * not fail open before the request. Fetch is stubbed so this never calls TypeSafe.
 */
import { describe, expect, it } from 'vitest'
import { createAgent, send, waitForIdle } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { passingAnswers } from './support/jev.ts'
import { mountVerifier } from './support/mount.ts'

function candidate(title: string): ReturnType<typeof textResponse> {
  return textResponse(JSON.stringify({
    title,
    steps: ['step'],
    acceptance: ['done'],
    risks: [],
  }))
}

describe('P1 default Jev URL', () => {
  it('scores when an API key is set on https://api.typesafe.ai', async () => {
    const calls: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
      calls.push(url)
      return new Response(JSON.stringify({
        usage: { inputTokens: 10, outputTokens: 0 },
        answers: passingAnswers(4),
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    try {
      const adapter = new MockAdapter([
        candidate('Minimal'),
        candidate('Test-first'),
        candidate('Investigate'),
        textResponse('scored on the default url'),
      ])
      const ctx = await mountVerifier(adapter, {
        intakeGate: 'always',
        jev: { baseUrl: 'https://api.typesafe.ai', apiKey: 'test-key', timeoutMs: 5_000 },
      })
      const agent = await createAgent(ctx, 'p1-default-jev')
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const idle = waitForIdle(ctx, agent)
      send(agent, 'score this task')
      await idle

      expect(calls).toContain('https://api.typesafe.ai/v1/systemone')
      expect(adapter.requests).toHaveLength(4)
      const main = JSON.stringify(adapter.requests[3]?.messages)
      expect(main).toContain('[verifier decision]')
      expect(main).not.toContain('jev is not configured')
    } finally {
      globalThis.fetch = original
    }
  })
})
