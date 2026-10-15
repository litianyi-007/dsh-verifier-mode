/** Strategy prompts and the JSON candidate schema. Generation is read-only: no tools. */

export const STRATEGIES = [
  'minimal-change',
  'test-first',
  'investigate-first',
  'alternative-approach',
] as const

export interface ParsedCandidate {
  id: string
  title: string
  steps: string[]
  acceptance: string[]
  risks: string[]
}

export function candidatePrompt(strategy: string, task: string): string {
  return [
    `Strategy: ${strategy}.`,
    'You are proposing a plan, not executing it. Do not call tools.',
    'Reply with one JSON object only, no markdown:',
    '{"title":"...","steps":["..."],"acceptance":["..."],"risks":["..."]}',
    'Task:',
    task,
  ].join('\n')
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every(item => typeof item === 'string')) return undefined
  return value
}

export type CandidateDropReason = 'empty' | 'not-json' | 'schema'

/** Pull one candidate object out of a model reply, and say why a reply was dropped. */
export function inspectCandidate(
  text: string,
  id: string,
): { candidate?: ParsedCandidate; dropReason?: CandidateDropReason } {
  if (text.trim() === '') return { dropReason: 'empty' }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return { dropReason: 'not-json' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { dropReason: 'not-json' }
  }
  if (parsed === null || typeof parsed !== 'object') return { dropReason: 'schema' }
  const record = parsed as Record<string, unknown>
  const steps = stringList(record.steps)
  const acceptance = stringList(record.acceptance)
  if (typeof record.title !== 'string' || record.title.trim() === '' || steps === undefined || acceptance === undefined) {
    return { dropReason: 'schema' }
  }
  return {
    candidate: {
      id,
      title: record.title,
      steps,
      acceptance,
      risks: stringList(record.risks) ?? [],
    },
  }
}

/** Pull one candidate object out of a model reply. Empty or prose replies are invalid. */
export function parseCandidate(text: string, id: string): ParsedCandidate | undefined {
  return inspectCandidate(text, id).candidate
}

/** Strategies for this K. Extra slots past the built-in set keep a distinct id. */
export function strategiesFor(candidates: number): string[] {
  const count = Math.min(5, Math.max(2, Number.isFinite(candidates) ? Math.floor(candidates) : 3))
  return Array.from({ length: count }, (_, index) => {
    const name = STRATEGIES[index % STRATEGIES.length]!
    return index < STRATEGIES.length ? name : `${name}-extra`
  })
}
