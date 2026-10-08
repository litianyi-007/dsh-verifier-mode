/**
 * The CNY total is the sidecar, not the process. After the cache is dropped,
 * the next intake rebuilds spend before it decides, so a paused session stays
 * paused and does not announce a resume.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import { costClock } from '../src/clock.ts'
import { flushUsageStore, forgetSpendCache, releaseUsageStore, sessionCostLines, sessionSpendCny } from '../src/cost-book.ts'
import * as plugin from '../src/index.ts'
import { send, waitForIdle } from '../spikes/support/harness.ts'
import { mountLoop } from '../spikes/support/harness.ts'
import { MockAdapter, textResponse } from '../spikes/support/mock-adapter.ts'
import { json, passingAnswers, startJev } from './support/jev.ts'
import { verifierConfig } from './support/mount.ts'

const PEAK = new Date(Date.UTC(2026, 9, 8, 2, 0, 0))

async function mountStored(adapter: MockAdapter, root: string, baseUrl: string): Promise<Context> {
  const ctx = await mountLoop(adapter)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root })
  await ctx.plugin(storageDomain, { backend: 'json' })
  await ctx.plugin(plugin, verifierConfig(baseUrl))
  ctx.llm.registerAdapter(['deepseek'], adapter)
  return ctx
}

describe('P1 cost restart', () => {
  it('reloads the sidecar total and keeps a paused session paused', async () => {
    const previous = costClock.now
    costClock.now = () => PEAK
    const root = await mkdtemp(join(tmpdir(), 'verifier-cost-'))
    const jev = await startJev((_body, response) => {
      json(response, 200, { usage: { inputTokens: 4_000_000, outputTokens: 0 }, answers: passingAnswers() })
    })
    try {
      const candidate = textResponse(JSON.stringify({
        title: 'Minimal',
        steps: ['step'],
        acceptance: ['done'],
        risks: [],
      }))
      const firstAdapter = new MockAdapter([
        candidate,
        candidate,
        candidate,
        textResponse('paused path'),
      ])
      const ctx = await mountStored(firstAdapter, root, jev.url)
      const agent = await ctx.agentLoop.create(SessionId('p1-cost-restart'), {
        provider: 'deepseek',
        model: 'deepseek-flash',
      })
      await ctx.commands.execute(agent, '/verifier on', [], new AbortController().signal)
      const first = waitForIdle(ctx, agent)
      send(agent, 'cross the cap')
      await first
      await flushUsageStore()

      const total = sessionSpendCny(String(agent.session.id))
      expect(total).toBeGreaterThan(1)
      expect(ctx.sessionProjections.stateOf(agent.session, 'verifier')?.paused).toBe(true)
      const saved = sessionCostLines(String(agent.session.id))
      expect(saved.some(line => line.source === 'generator')).toBe(true)
      expect(saved.some(line => line.source === 'jev')).toBe(true)
      const seed = structuredClone(agent.session.snapshotEvents())
      expect(JSON.stringify(seed)).not.toContain('verifier/cost')

      await releaseUsageStore()
      forgetSpendCache()
      expect(sessionSpendCny('p1-cost-restart')).toBe(0)

      const resumedAdapter = new MockAdapter([textResponse('still paused')])
      const resumed = await mountStored(resumedAdapter, root, jev.url)
      expect(sessionSpendCny('p1-cost-restart')).toBeCloseTo(total, 6)
      const reloaded = sessionCostLines('p1-cost-restart')
      expect(reloaded.some(line => line.source === 'generator')).toBe(true)
      expect(reloaded.some(line => line.source === 'jev')).toBe(true)

      const handle = await resumed.agents.create({
        sessionId: SessionId('p1-cost-restart'),
        seed,
        agentOptions: { provider: 'deepseek', model: 'deepseek-flash' },
      })
      expect(resumed.sessionProjections.stateOf(handle.agent.session, 'verifier')?.paused).toBe(true)

      const second = waitForIdle(resumed, handle.agent)
      send(handle.agent, 'after restart')
      await second

      expect(JSON.stringify(resumedAdapter.requests[0]?.messages)).not.toContain('[verifier cost-resume]')
      expect(resumed.sessionProjections.stateOf(handle.agent.session, 'verifier')?.paused).toBe(true)
      expect(sessionSpendCny('p1-cost-restart')).toBeGreaterThanOrEqual(total)
    } finally {
      costClock.now = previous
      await releaseUsageStore()
      forgetSpendCache()
      await jev.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
