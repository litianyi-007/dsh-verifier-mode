/**
 * Selection rules for one scored set of candidates.
 * Hard constraints are Noul probabilities. Weighted scores are level indexes.
 * A close top-2 picks the higher scope_risk (smaller change). No Choice call and no tournament.
 */

export interface ScoreAnswer {
  value: number
  confidence: number
  levels?: number
}

export interface Candidate {
  id: string
  title: string
  steps: string[]
  acceptance: string[]
  risks: string[]
}

export interface ScoredCandidate {
  candidate: Candidate
  answers: Record<string, ScoreAnswer>
}

export interface SelectionRules {
  violation: number
  confidenceFloor: number
  tieGap: number
  weights: { addresses: number; grounded: number; verifiable: number; scope: number }
  /** Question keys asked for this decision. Missing answers disqualify the candidate. */
  noulKeys: string[]
  scoreKeys: string[]
}

export interface SelectionWinner {
  kind: 'winner'
  candidate: Candidate
  composite: number
  confidence: number
}

export interface SelectionFallback {
  kind: 'fallback'
  reason: string
}

const SCORE_WEIGHT: Record<string, keyof SelectionRules['weights']> = {
  addresses_request: 'addresses',
  grounded_in_evidence: 'grounded',
  verifiable: 'verifiable',
  scope_risk: 'scope',
}

function unit(answer: ScoreAnswer): number {
  if (answer.levels !== undefined && answer.levels > 1) return answer.value / (answer.levels - 1)
  return answer.value
}

export function scoreCandidate(
  scored: ScoredCandidate,
  rules: SelectionRules,
): { eligible: boolean; composite: number; confidence: number; scope: number; reason?: string } {
  for (const key of rules.noulKeys) {
    const answer = scored.answers[key]
    if (answer === undefined) return { eligible: false, composite: 0, confidence: 0, scope: 0, reason: `missing ${key}` }
    if (answer.value >= rules.violation) {
      return { eligible: false, composite: 0, confidence: 0, scope: 0, reason: `${key} ${answer.value}` }
    }
  }
  let composite = 0
  let confidence = 1
  let scope = 0
  for (const key of rules.scoreKeys) {
    const answer = scored.answers[key]
    if (answer === undefined) return { eligible: false, composite: 0, confidence: 0, scope: 0, reason: `missing ${key}` }
    const weightKey = SCORE_WEIGHT[key]
    const weight = weightKey === undefined ? 0 : rules.weights[weightKey]
    const normalized = unit(answer)
    composite += weight * normalized
    confidence = Math.min(confidence, answer.confidence)
    if (key === 'scope_risk') scope = normalized
  }
  if (confidence < rules.confidenceFloor) {
    return { eligible: false, composite, confidence, scope, reason: `confidence ${confidence}` }
  }
  return { eligible: true, composite, confidence, scope }
}

export function selectWinner(
  scored: readonly ScoredCandidate[],
  rules: SelectionRules,
): SelectionWinner | SelectionFallback {
  const ranked = scored.flatMap((item) => {
    const score = scoreCandidate(item, rules)
    return score.eligible ? [{ item, score }] : []
  })
  if (ranked.length === 0) return { kind: 'fallback', reason: 'no eligible candidate' }
  ranked.sort((left, right) => right.score.composite - left.score.composite || right.score.scope - left.score.scope)
  const [first, second] = ranked
  let chosen = first!
  if (second !== undefined && chosen.score.composite - second.score.composite < rules.tieGap) {
    chosen = chosen.score.scope >= second.score.scope ? chosen : second
  }
  return {
    kind: 'winner',
    candidate: chosen.item.candidate,
    composite: chosen.score.composite,
    confidence: chosen.score.confidence,
  }
}
