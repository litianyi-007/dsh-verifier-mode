/**
 * The bytes POST /v1/systemone would send. Fetch is stubbed.
 * The token below is a fixture, not a TypeSafe key, and it is not part of the body.
 */
import { describe, expect, it } from 'vitest'
import { auditQuestions, INTAKE_QUESTIONS, postJev } from '../src/jev.ts'
import type { JevRequest } from '../src/jev.ts'

const FIXTURE_TOKEN = 'test-token'

const intakeState = {
  task: 'fix the parser',
  constraints: ['keep the public API'],
  evidence: '<evidence nonce="abc123">\nlog line\n</evidence nonce="abc123">',
  candidate: {
    id: 'test-first',
    title: 'Test-first',
    steps: ['write the test'],
    acceptance: ['red then green'],
    risks: [],
  },
}

const intakeBody = {
  state: intakeState,
  model: 'jev-1.13.0',
  questions: {
    violates_constraint_0: {
      type: 'noul',
      instructions: 'Does the candidate violate the constraint at index 0 of `constraints`?',
      criteria: {
        true: 'It violates that constraint.',
        false: 'It does not violate that constraint.',
      },
    },
    irreversible_without_approval: {
      type: 'noul',
      instructions: 'Is the candidate irreversible without explicit approval?',
      criteria: {
        true: 'It is irreversible without approval.',
        false: 'It is reversible, or approval is already present.',
      },
    },
    addresses_request: {
      type: 'score',
      instructions: 'How completely does the candidate address the request in `task`?',
      criteria: [
        'Does not address the request',
        'Mentions the request and misses the main ask',
        'Addresses part of the request',
        'Addresses the request with a small gap',
        'Addresses the request',
      ],
    },
    grounded_in_evidence: {
      type: 'score',
      instructions: 'How grounded is the candidate in `evidence`?',
      criteria: [
        'Contradicts the evidence',
        'Mostly unsupported by the evidence',
        'Mostly grounded in the evidence',
        'Grounded in the evidence',
      ],
    },
    verifiable: {
      type: 'score',
      instructions: 'How verifiable is the candidate?',
      criteria: [
        'Cannot be checked',
        'Hard to check',
        'Mostly checkable',
        'Directly verifiable',
      ],
    },
    scope_risk: {
      type: 'score',
      instructions: 'How close is the candidate to the smallest change that does the job? Higher means a smaller change.',
      criteria: [
        'Much larger than the request',
        'Broader than the request',
        'Close to the requested scope',
        'Smallest change that does the job',
      ],
    },
  },
}

interface Captured {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

function stubFetch(captured: Captured[], payload: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value })
    captured.push({
      method: init?.method ?? 'GET',
      url,
      headers,
      body: JSON.parse(String(init?.body)),
    })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

describe('System One request body', () => {
  const original = globalThis.fetch

  it('posts the official intake body and keeps the fixture token out of it', async () => {
    const captured: Captured[] = []
    stubFetch(captured, {
      model: 'jev-1.13.0',
      answers: {
        violates_constraint_0: { type: 'noul', noul: 0.1 },
        addresses_request: { type: 'score', score: 4, confidence: 0.9, legend: { '0': 'low' }, probabilities: { '4': 1 } },
      },
      usage: { input_tokens: 12, output_tokens: 3 },
    })
    try {
      const request: JevRequest = { point: 'intake', state: intakeState, questions: INTAKE_QUESTIONS }
      const parsed = await postJev('https://api.typesafe.ai', FIXTURE_TOKEN, request, new AbortController().signal, 5_000)
      expect(captured).toHaveLength(1)
      const call = captured[0]!
      expect(call.method).toBe('POST')
      expect(call.url).toBe('https://api.typesafe.ai/v1/systemone')
      expect(call.headers['content-type']).toBe('application/json')
      expect(call.headers.authorization).toBe(`Bearer ${FIXTURE_TOKEN}`)
      expect(Object.keys(call.headers).sort()).toEqual(['authorization', 'content-type'])
      expect(call.body).toEqual(intakeBody)
      expect(JSON.stringify(call.body)).not.toContain(FIXTURE_TOKEN)
      expect(JSON.stringify(call.body)).not.toContain('"point"')
      expect(JSON.stringify(call.body)).not.toContain('"kind"')
      expect(JSON.stringify(call.body)).not.toContain('"levels"')
      expect(parsed).toEqual({
        usage: { inputTokens: 12, outputTokens: 3 },
        answers: {
          violates_constraint_0: { value: 0.1, confidence: 0 },
          addresses_request: { value: 4, confidence: 0.9 },
        },
      })
    } finally {
      globalThis.fetch = original
    }
  })

  it('omits Authorization when the token is empty and posts the audit questions', async () => {
    const captured: Captured[] = []
    stubFetch(captured, {
      answers: {
        criterion_met_0: { value: 0.1, confidence: 0.9 },
        unverified_claims: { value: 0.1, confidence: 0.9 },
        claims_supported_by_evidence: { value: 3, confidence: 0.9, levels: 4 },
      },
      usage: { inputTokens: 4, outputTokens: 1 },
    })
    try {
      const state = {
        task: 'ship it',
        constraints: [],
        evidence: '<evidence nonce="abc123">\nship it\n</evidence nonce="abc123">',
        acceptance: ['tests pass'],
      }
      const parsed = await postJev('http://127.0.0.1:9', '', {
        point: 'audit',
        state,
        questions: auditQuestions(state.acceptance),
      }, new AbortController().signal, 5_000)
      const call = captured[0]!
      expect(call.method).toBe('POST')
      expect(call.url).toBe('http://127.0.0.1:9/v1/systemone')
      expect(call.headers).toEqual({ 'content-type': 'application/json' })
      expect(call.body).toEqual({
        state,
        model: 'jev-1.13.0',
        questions: {
          criterion_met_0: {
            type: 'noul',
            instructions: 'Is acceptance criterion 0 unmet? Its text is: tests pass',
            criteria: { true: 'That criterion is unmet.', false: 'That criterion is met.' },
          },
          unverified_claims: {
            type: 'noul',
            instructions: 'Does the work make a claim that `evidence` does not support?',
            criteria: {
              true: 'It makes an unsupported claim.',
              false: 'Its claims are supported, or it makes none.',
            },
          },
          claims_supported_by_evidence: {
            type: 'score',
            instructions: 'How well does `evidence` support the claims in the work?',
            criteria: [
              'Claims contradict the evidence',
              'Claims are mostly unsupported',
              'Claims are mostly supported',
              'Claims are supported by the evidence',
            ],
          },
        },
      })
      expect(parsed.answers.criterion_met_0).toEqual({ value: 0.1, confidence: 0.9 })
      expect(parsed.usage).toEqual({ inputTokens: 4, outputTokens: 1 })
    } finally {
      globalThis.fetch = original
    }
  })
})
