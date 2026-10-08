/** Local Jev stand-in. Records bodies and never calls TypeSafe. */
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface JevMock {
  url: string
  bodies: unknown[]
  close(): Promise<void>
}

export async function startJev(handler: (body: Record<string, unknown>, response: ServerResponse) => void): Promise<JevMock> {
  const bodies: unknown[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST' || request.url !== '/v1/systemone') {
      response.writeHead(404)
      response.end()
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      bodies.push(body)
      handler(body, response)
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('jev mock failed to bind')
  return {
    url: `http://127.0.0.1:${address.port}`,
    bodies,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

/**
 * Which decision a System One body is. `point` is not on the wire.
 * Audit is recognized by its question ids. A plan reuses the intake questions
 * and also carries `state.plan`.
 */
export function callKind(body: unknown): 'intake' | 'audit' | 'plan' | 'other' {
  if (body === null || typeof body !== 'object') return 'other'
  const record = body as { state?: { plan?: unknown }; questions?: unknown }
  const questions = record.questions
  if (questions === null || typeof questions !== 'object' || Array.isArray(questions)) return 'other'
  const keys = questions as Record<string, unknown>
  if ('unverified_claims' in keys || 'claims_supported_by_evidence' in keys) return 'audit'
  if ('addresses_request' in keys && typeof record.state?.plan === 'string') return 'plan'
  if ('addresses_request' in keys) return 'intake'
  return 'other'
}

export function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

export function passingAnswers(addresses = 4): Record<string, { value: number; confidence: number; levels?: number }> {
  return {
    violates_constraint_0: { value: 0.1, confidence: 0.9 },
    irreversible_without_approval: { value: 0.1, confidence: 0.9 },
    addresses_request: { value: addresses, confidence: 0.9, levels: 5 },
    grounded_in_evidence: { value: 3, confidence: 0.9, levels: 4 },
    verifiable: { value: 3, confidence: 0.9, levels: 4 },
    scope_risk: { value: 3, confidence: 0.9, levels: 4 },
    unverified_claims: { value: 0.1, confidence: 0.9 },
    claims_supported_by_evidence: { value: 3, confidence: 0.9, levels: 4 },
    criterion_met_0: { value: 0.1, confidence: 0.9 },
  }
}
