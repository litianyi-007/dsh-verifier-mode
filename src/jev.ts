/**
 * Local-shaped Jev client. The body is the task and evidence as written,
 * clipped and nonce-delimited. Nothing is redacted.
 */
import { randomBytes } from 'node:crypto'
import type { ScoreAnswer } from './selector.ts'

export interface JevState {
  task: string
  constraints: string[]
  evidence: string
  candidate?: { id: string; title: string; steps: string[]; acceptance: string[]; risks: string[] }
  plan?: string
  acceptance?: string[]
}

export interface JevQuestion {
  key: string
  kind: 'noul' | 'score'
  levels?: number
}

export interface JevRequest {
  point: 'intake' | 'audit' | 'plan'
  state: JevState
  questions: JevQuestion[]
}

export interface JevResponse {
  usage?: { inputTokens?: number; outputTokens?: number }
  answers: Record<string, ScoreAnswer>
}

const EVIDENCE_CHARS = 8_000

export function freshNonce(): string {
  return randomBytes(8).toString('hex')
}

/** Clip, then wrap. The nonce is an injection fence, not a privacy transform. */
export function delimitEvidence(text: string, nonce: string): string {
  const clipped = text.length <= EVIDENCE_CHARS ? text : text.slice(0, EVIDENCE_CHARS)
  return `<evidence nonce="${nonce}">\n${clipped}\n</evidence nonce="${nonce}">`
}

export function clipTask(text: string): string {
  return text.length <= EVIDENCE_CHARS ? text : text.slice(0, EVIDENCE_CHARS)
}

export const INTAKE_QUESTIONS: JevQuestion[] = [
  { key: 'violates_constraint_0', kind: 'noul' },
  { key: 'irreversible_without_approval', kind: 'noul' },
  { key: 'addresses_request', kind: 'score', levels: 5 },
  { key: 'grounded_in_evidence', kind: 'score', levels: 4 },
  { key: 'verifiable', kind: 'score', levels: 4 },
  { key: 'scope_risk', kind: 'score', levels: 4 },
]

export function auditQuestions(acceptance: readonly string[]): JevQuestion[] {
  const criteria = acceptance.slice(0, 5).map((_, index) => ({ key: `criterion_met_${index}`, kind: 'noul' as const }))
  return [
    ...criteria,
    { key: 'unverified_claims', kind: 'noul' },
    { key: 'claims_supported_by_evidence', kind: 'score', levels: 4 },
  ]
}

export async function postJev(
  baseUrl: string,
  apiKey: string,
  body: JevRequest,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<JevResponse> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const response = await fetch(new URL('/v1/systemone', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey === '' ? {} : { authorization: `Bearer ${apiKey}` }),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, timeout]),
  })
  if (!response.ok) throw new Error(`jev ${response.status}`)
  return await response.json() as JevResponse
}
