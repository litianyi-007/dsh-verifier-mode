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

/** Pull one candidate object out of a model reply. Empty or prose replies are invalid. */
export function parseCandidate(text: string, id: string): ParsedCandidate | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as Record<string, unknown>
  const steps = stringList(record.steps)
  const acceptance = stringList(record.acceptance)
  if (typeof record.title !== 'string' || record.title.trim() === '' || steps === undefined || acceptance === undefined) {
    return undefined
  }
  return {
    id,
    title: record.title,
    steps,
    acceptance,
    risks: stringList(record.risks) ?? [],
  }
}
