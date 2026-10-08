/**
 * Session usage ledger. The cap key is provider + model.
 * `reasoningEffort` does not change the key or the yen cap.
 *
 * A bill includes uncached input, output, cache-read, cache-write, and
 * reasoning tokens whenever `assistant/message.usage` carries them.
 * Missing cache or reasoning fields bill as zero. Side `ctx.llm.stream`
 * usage never reaches this fold.
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import { z } from 'zod'

export interface UsageBill {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

export interface LedgerState {
  byRoute: Record<string, UsageBill>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    verifierLedger: LedgerState
  }
}

const billSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  reasoningTokens: z.number(),
}).strict()

const ledgerStateSchema = z.object({
  byRoute: z.record(z.string(), billSchema),
}).strict()

/** Cap identity. Effort is intentionally absent. */
export function routeKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/** Bill every count the usage object actually has. Absent cache and reasoning counts are zero. */
export function billOf(usage: TokenUsage): UsageBill {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    reasoningTokens: usage.reasoningTokens ?? 0,
  }
}

function addBill(left: UsageBill, right: UsageBill): UsageBill {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  }
}

export function applyLedger(state: LedgerState, event: SessionEvent): LedgerState {
  if (event.type !== 'assistant/message' || event.data.usage === undefined) return state
  const source = event.data.message.source
  const key = routeKey(source.provider, source.model)
  const bill = billOf(event.data.usage)
  const previous = state.byRoute[key]
  return {
    byRoute: {
      ...state.byRoute,
      [key]: previous === undefined ? bill : addBill(previous, bill),
    },
  }
}

export const ledgerProjectionDefinition = {
  key: 'verifierLedger',
  stateVersion: 1,
  stateSchema: ledgerStateSchema,
  init: (): LedgerState => ({ byRoute: {} }),
  apply: applyLedger,
} satisfies ProjectionDefinition<'verifierLedger', LedgerState>

export function readLedger(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
): LedgerState {
  return projections.stateOf(session, 'verifierLedger') ?? { byRoute: {} }
}
