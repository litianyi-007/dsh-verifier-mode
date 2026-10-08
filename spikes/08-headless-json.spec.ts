/**
 * Spike 8. `projectJsonRun` drops `user/message`. This test does not start
 * the `dsh` CLI and does not call headless `summarize()` (that function is
 * private). It also does not call `finish()`, so a `final` line is not evidence.
 * `logger.warn` does not reach stderr. An explicit `dsh:` stderr write does.
 */
import { describe, expect, it } from 'vitest'
import { projectJsonRun } from '@deepseek-ai/dsh-headless/json-stream'
import { verifierNotice } from '../src/notices.ts'
import { createAgent, mountLoop, send, waitForIdle } from './support/harness.ts'
import { MockAdapter, textResponse } from './support/mock-adapter.ts'

const PAUSE = 'P0-PAUSE-notice'

describe('spike 8: headless json pause notice', () => {
  it('omits the user notice from projectJsonRun and does not print logger.warn on stderr', async () => {
    const adapter = new MockAdapter([textResponse('visible answer')])
    const ctx = await mountLoop(adapter)
    ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      return {
        ...decision,
        messages: [...decision.messages, verifierNotice(PAUSE, 'verifier paused')],
      }
    })
    const agent = await createAgent(ctx, 'spike-8')
    const lines: string[] = []
    const projection = projectJsonRun(ctx, agent, { write: chunk => { lines.push(chunk) } })
    const idle = waitForIdle(ctx, agent)
    send(agent, 'run')
    await idle
    projection.dispose()

    const events = lines.map(line => JSON.parse(line) as { type: string; text?: string })
    expect(events.some(event => event.type === 'text' && event.text === 'visible answer')).toBe(true)
    expect(events.some(event => event.type === 'final')).toBe(false)
    expect(lines.join('')).not.toContain(PAUSE)
    expect(JSON.stringify(agent.session.snapshotEvents())).toContain(PAUSE)

    const stderr: string[] = []
    const captured: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stderr.write
    // Match app-boot's startup collector: level 2 admits warn, and the sink is memory.
    ctx.logger.exporter({
      levels: { default: 2 },
      export: (message) => { captured.push(JSON.stringify(message.args)) },
    })
    try {
      ctx.logger.warn('verifier paused %s', PAUSE)
      expect(stderr.join('')).not.toContain(PAUSE)
      // Default exporter threshold is INFO (1). WARN is 2, so the built-in buffer drops it.
      expect(JSON.stringify(ctx.logger.buffer)).not.toContain(PAUSE)
      expect(captured.join('')).toContain(PAUSE)
      process.stderr.write(`dsh: verifier paused ${PAUSE}\n`)
      expect(stderr.join('')).toContain(`dsh: verifier paused ${PAUSE}`)
    } finally {
      process.stderr.write = original
    }
  })
})
