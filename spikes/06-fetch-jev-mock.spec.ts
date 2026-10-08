/**
 * Spike 6. `connection.fetch.register` serves an inbound route whose handler
 * POSTs to a local mock of a Jev-style `/v1/systemone`. No TypeSafe SDK.
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'

describe('spike 6: fetch.register to a local Jev mock', () => {
  it('registers /api/verifier-mode/score, calls the mock, and 404s after dispose', async () => {
    let received: unknown
    const server = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/systemone') {
        res.writeHead(404)
        res.end()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      req.on('end', () => {
        received = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ score: 0.42, note: 'local-mock' }))
      })
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const port = (server.address() as AddressInfo).port

    const ctx = new Context()
    const fiber = ctx.plugin((pluginCtx) => {
      new HostConnectionService(pluginCtx, [], {} as never)
    })
    await fiber.await()
    const connection = ctx.get('connection') as HostConnectionService
    const dispose = connection.fetch.register({
      path: '/api/verifier-mode/score',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const body = await request.json() as { state: unknown }
        const response = await fetch(`http://127.0.0.1:${port}/v1/systemone`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: body.state, model: 'mock', questions: ['q1'] }),
        })
        return new Response(await response.text(), {
          status: response.status,
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    const shared = connection.createSharedFetchHandler('/api')
    const response = await shared.fetch(new Request('http://host/api/verifier-mode/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: { step: 1 } }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ score: 0.42, note: 'local-mock' })
    expect(received).toEqual({ state: { step: 1 }, model: 'mock', questions: ['q1'] })

    await dispose()
    const withdrawn = await shared.fetch(new Request('http://host/api/verifier-mode/score', { method: 'POST' }))
    expect(withdrawn.status).toBe(404)
    await fiber.dispose()
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()) })
  })
})
