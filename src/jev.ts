/**
 * Jev client for POST /v1/systemone.
 * The wire body is the official System One request: state, model, and a
 * questions map. Evidence stays nonce-delimited. Nothing is redacted.
 * `point` is local bookkeeping and is not sent.
 */
import { randomBytes } from 'node:crypto'
import type { ScoreAnswer } from './selector.ts'

/** Versioned model id. `jev-latest` currently aliases this id; the body pins it. */
export const JEV_MODEL = 'jev-1.13.0'

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
  /** Score rubric length. Index 0 is the low end. Selection still reads this. */
  levels?: number
  instructions: string
  /** Ordered low to high. One entry per score index, length `levels`. */
  rubric?: readonly string[]
  /** What a noul near 1 means. The audit treats a high noul as a failure. */
  yes?: string
  /** What a noul near 0 means. */
  no?: string
}

export interface JevRequest {
  point: 'intake' | 'audit' | 'plan'
  state: JevState
  questions: JevQuestion[]
}

interface WireNoul {
  type: 'noul'
  instructions: string
  criteria?: { true?: string; false?: string }
}

interface WireScore {
  type: 'score'
  instructions: string
  criteria: string[]
}

export interface SystemOneBody {
  state: JevState
  model: typeof JEV_MODEL
  questions: Record<string, WireNoul | WireScore>
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

const GROUNDED_RUBRIC = [
  'Contradicts the evidence',
  'Mostly unsupported by the evidence',
  'Mostly grounded in the evidence',
  'Grounded in the evidence',
] as const

const VERIFIABLE_RUBRIC = [
  'Cannot be checked',
  'Hard to check',
  'Mostly checkable',
  'Directly verifiable',
] as const

const SCOPE_RUBRIC = [
  'Much larger than the request',
  'Broader than the request',
  'Close to the requested scope',
  'Smallest change that does the job',
] as const

export const INTAKE_QUESTIONS: JevQuestion[] = [
  {
    key: 'violates_constraint_0',
    kind: 'noul',
    instructions: 'Does the candidate violate the constraint at index 0 of `constraints`?',
    yes: 'It violates that constraint.',
    no: 'It does not violate that constraint.',
  },
  {
    key: 'irreversible_without_approval',
    kind: 'noul',
    instructions: 'Is the candidate irreversible without explicit approval?',
    yes: 'It is irreversible without approval.',
    no: 'It is reversible, or approval is already present.',
  },
  {
    key: 'addresses_request',
    kind: 'score',
    levels: 5,
    instructions: 'How completely does the candidate address the request in `task`?',
    rubric: [
      'Does not address the request',
      'Mentions the request and misses the main ask',
      'Addresses part of the request',
      'Addresses the request with a small gap',
      'Addresses the request',
    ],
  },
  {
    key: 'grounded_in_evidence',
    kind: 'score',
    levels: 4,
    instructions: 'How grounded is the candidate in `evidence`?',
    rubric: GROUNDED_RUBRIC,
  },
  {
    key: 'verifiable',
    kind: 'score',
    levels: 4,
    instructions: 'How verifiable is the candidate?',
    rubric: VERIFIABLE_RUBRIC,
  },
  {
    key: 'scope_risk',
    kind: 'score',
    levels: 4,
    instructions: 'How close is the candidate to the smallest change that does the job? Higher means a smaller change.',
    rubric: SCOPE_RUBRIC,
  },
]

export function auditQuestions(acceptance: readonly string[]): JevQuestion[] {
  const criteria = acceptance.slice(0, 5).map((text, index) => ({
    key: `criterion_met_${index}`,
    kind: 'noul' as const,
    // A high noul is an audit failure. Ask whether the criterion is unmet.
    instructions: `Is acceptance criterion ${index} unmet? Its text is: ${text}`,
    yes: 'That criterion is unmet.',
    no: 'That criterion is met.',
  }))
  return [
    ...criteria,
    {
      key: 'unverified_claims',
      kind: 'noul',
      instructions: 'Does the work make a claim that `evidence` does not support?',
      yes: 'It makes an unsupported claim.',
      no: 'Its claims are supported, or it makes none.',
    },
    {
      key: 'claims_supported_by_evidence',
      kind: 'score',
      levels: 4,
      instructions: 'How well does `evidence` support the claims in the work?',
      rubric: [
        'Claims contradict the evidence',
        'Claims are mostly unsupported',
        'Claims are mostly supported',
        'Claims are supported by the evidence',
      ],
    },
  ]
}

/**
 * Official request body. Question objects carry `type` and, for a score, an
 * ordered `criteria` array. `kind`, `levels`, and `point` are not fields.
 */
export function systemOneBody(body: JevRequest): SystemOneBody {
  const questions: SystemOneBody['questions'] = {}
  for (const question of body.questions) {
    if (question.kind === 'score') {
      const criteria = [...(question.rubric ?? [])]
      if (criteria.length < 2 || (question.levels !== undefined && criteria.length !== question.levels)) {
        throw new Error(`jev score ${question.key} needs one criterion per level`)
      }
      questions[question.key] = {
        type: 'score',
        instructions: question.instructions,
        criteria,
      }
      continue
    }
    const criteria: { true?: string; false?: string } = {}
    if (question.yes !== undefined) criteria.true = question.yes
    if (question.no !== undefined) criteria.false = question.no
    questions[question.key] = {
      type: 'noul',
      instructions: question.instructions,
      ...(Object.keys(criteria).length === 0 ? {} : { criteria }),
    }
  }
  return { state: body.state, model: JEV_MODEL, questions }
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number') return value
  }
  return undefined
}

function parseAnswer(raw: unknown): ScoreAnswer | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  if (record.type === 'noul' && typeof record.noul === 'number') {
    return { value: record.noul, confidence: typeof record.confidence === 'number' ? record.confidence : 0 }
  }
  if (record.type === 'score' && typeof record.score === 'number') {
    return { value: record.score, confidence: typeof record.confidence === 'number' ? record.confidence : 0 }
  }
  if (typeof record.value === 'number') {
    const confidence = typeof record.confidence === 'number' ? record.confidence : 0
    return typeof record.levels === 'number'
      ? { value: record.value, confidence, levels: record.levels }
      : { value: record.value, confidence }
  }
  return undefined
}

/** Map an official or legacy mock payload onto the answers the selector reads. */
export function parseJevResponse(payload: unknown): JevResponse {
  const record = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const usageRecord = record.usage !== null && typeof record.usage === 'object'
    ? record.usage as Record<string, unknown>
    : undefined
  const inputTokens = usageRecord === undefined ? undefined : numberField(usageRecord, 'inputTokens', 'input_tokens')
  const outputTokens = usageRecord === undefined ? undefined : numberField(usageRecord, 'outputTokens', 'output_tokens')
  const answers: Record<string, ScoreAnswer> = {}
  if (record.answers !== null && typeof record.answers === 'object') {
    for (const [key, value] of Object.entries(record.answers as Record<string, unknown>)) {
      const parsed = parseAnswer(value)
      if (parsed !== undefined) answers[key] = parsed
    }
  }
  return {
    ...(inputTokens === undefined && outputTokens === undefined
      ? {}
      : { usage: { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 } }),
    answers,
  }
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
    body: JSON.stringify(systemOneBody(body)),
    signal: AbortSignal.any([signal, timeout]),
  })
  if (!response.ok) throw new Error(`jev ${response.status}`)
  return parseJevResponse(await response.json())
}
