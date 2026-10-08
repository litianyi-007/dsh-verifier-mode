/**
 * Spike 7. A storage-domain sidecar keeps trace records outside the session log.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import { z } from 'zod'
import { createAgent, mountLoop, send, waitForIdle } from './support/harness.ts'
import { MockAdapter, textResponse } from './support/mock-adapter.ts'

const traceSchema = z.object({
  sessionId: z.string(),
  note: z.string(),
  score: z.number(),
})

const spec = storageDomain.defineDomain({
  name: 'verifier_trace',
  version: 1,
  tables: {
    traces: storageDomain.domainTable<string, z.infer<typeof traceSchema>>(traceSchema),
  },
})

describe('spike 7: storage-domain sidecar', () => {
  it('reopens a trace record that never entered the session log', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verifier-trace-'))
    const adapter = new MockAdapter([textResponse('session answer')])
    const ctx = await mountLoop(adapter)
    await ctx.plugin(Storage)
    await ctx.plugin(storageJson, { root })
    await ctx.plugin(storageDomain, { backend: 'json' })
    const domain = await ctx.storageDomain.open(spec)
    await domain.table('traces').put('trace-1', {
      sessionId: 'spike-7',
      note: 'SIDECAR-NOTE',
      score: 0.5,
    })
    await domain.close()

    const agent = await createAgent(ctx, 'spike-7')
    const idle = waitForIdle(ctx, agent)
    send(agent, 'ordinary turn')
    await idle
    expect(JSON.stringify(agent.session.snapshotEvents())).not.toContain('SIDECAR-NOTE')

    const again = await ctx.storageDomain.open(spec)
    expect(again.table('traces').get('trace-1')).toEqual({
      sessionId: 'spike-7',
      note: 'SIDECAR-NOTE',
      score: 0.5,
    })
    await again.close()

    const other = new Context()
    await other.plugin(Storage)
    await other.plugin(storageJson, { root })
    await other.plugin(storageDomain, { backend: 'json' })
    const reopened = await other.storageDomain.open(spec)
    expect(reopened.table('traces').get('trace-1')?.note).toBe('SIDECAR-NOTE')
    await reopened.close()
    await rm(root, { recursive: true, force: true })
  })
})
