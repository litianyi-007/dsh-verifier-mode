import { describe, expect, it } from 'vitest'
import { selectWinner } from '../src/selector.ts'
import type { ScoredCandidate, SelectionRules } from '../src/selector.ts'

const rules: SelectionRules = {
  violation: 0.5,
  confidenceFloor: 0.6,
  tieGap: 0.05,
  weights: { addresses: 0.35, grounded: 0.25, verifiable: 0.25, scope: 0.15 },
  noulKeys: ['violates_constraint_0', 'irreversible_without_approval'],
  scoreKeys: ['addresses_request', 'grounded_in_evidence', 'verifiable', 'scope_risk'],
}

function candidate(id: string, addresses: number, scope: number): ScoredCandidate {
  return {
    candidate: { id, title: id, steps: ['step'], acceptance: ['done'], risks: [] },
    answers: {
      violates_constraint_0: { value: 0.1, confidence: 0.9 },
      irreversible_without_approval: { value: 0.1, confidence: 0.9 },
      addresses_request: { value: addresses, confidence: 0.9, levels: 5 },
      grounded_in_evidence: { value: 3, confidence: 0.9, levels: 4 },
      verifiable: { value: 3, confidence: 0.9, levels: 4 },
      scope_risk: { value: scope, confidence: 0.9, levels: 4 },
    },
  }
}

describe('P1 selector', () => {
  it('picks the higher scope candidate when the composite gap is inside the tie window', () => {
    const selected = selectWinner([
      candidate('broad', 4, 0),
      candidate('local', 2, 3),
    ], rules)
    expect(selected.kind).toBe('winner')
    if (selected.kind === 'winner') expect(selected.candidate.id).toBe('local')
  })

  it('falls open when every candidate breaks a hard constraint', () => {
    const blocked = candidate('blocked', 4, 3)
    blocked.answers.violates_constraint_0 = { value: 0.9, confidence: 0.9 }
    expect(selectWinner([blocked], rules)).toEqual({ kind: 'fallback', reason: 'no eligible candidate' })
  })
})
