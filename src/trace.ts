/**
 * Decision trace. The process Map is a cache. The durable copy is the
 * `traces` table in the `verifier_trace` storage-domain sidecar, next to
 * `usage`. A restart reloads it. The JSON file is the storage backend's
 * unit document (typically `verifier_trace.json` under the profile storage root).
 */
export type { CandidateTrace, DecisionTrace as TraceRecord } from './cost-book.ts'
import { persistDecision, readDecisions } from './cost-book.ts'
import type { DecisionTrace } from './cost-book.ts'

export async function pushTrace(sessionId: string, record: DecisionTrace): Promise<void> {
  await persistDecision(sessionId, record)
}

export function readVerifierTraces(sessionId: string): readonly DecisionTrace[] {
  return readDecisions(sessionId)
}
