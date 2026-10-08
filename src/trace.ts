/** Decision trace kept beside the session log. Cap pauses record `outcome: 'cost-cap'`. */

export interface TraceRecord {
  point: 'intake' | 'audit' | 'plan'
  outcome: 'committed' | 'fallback' | 'cost-cap' | 'plan-score' | 'steered' | 'incomplete' | 'passed' | 'skipped'
  reason?: string
  winner?: string
  spentCny?: number
  cap?: number
  capModel?: string
}

const traces = new Map<string, TraceRecord[]>()

export function pushTrace(sessionId: string, record: TraceRecord): void {
  const list = traces.get(sessionId) ?? []
  list.push(record)
  traces.set(sessionId, list)
}

export function readVerifierTraces(sessionId: string): readonly TraceRecord[] {
  return traces.get(sessionId) ?? []
}
