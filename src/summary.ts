/**
 * Judge digest folded from the session log.
 * Empty assistant text (the tool-call message) is skipped.
 * A tool line includes the tool name from the matching `tool/call`.
 */
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import { z } from 'zod'

export interface JudgeState {
  lines: string[]
  names: Record<string, string>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    verifierJudge: JudgeState
  }
}

const judgeStateSchema = z.object({
  lines: z.array(z.string()),
  names: z.record(z.string(), z.string()),
}).strict()

function textOf(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('')
}

export function initJudge(): JudgeState {
  return { lines: [], names: {} }
}

export function applyJudge(state: JudgeState, event: SessionEvent): JudgeState {
  if (event.type === 'user/message') {
    return { ...state, lines: [...state.lines, `user: ${textOf(event.data.content)}`] }
  }
  if (event.type === 'assistant/message') {
    const text = textOf(event.data.message.content)
    if (text === '') return state
    return { ...state, lines: [...state.lines, `assistant: ${text}`] }
  }
  if (event.type === 'tool/call') {
    return {
      ...state,
      names: { ...state.names, [String(event.data.callId)]: event.data.name },
    }
  }
  if (event.type === 'tool/result') {
    const flag = event.data.message.isError === true ? 'error' : 'ok'
    const name = state.names[String(event.data.message.toolCallId)] ?? 'unknown'
    return {
      ...state,
      lines: [...state.lines, `tool ${name} ${flag}: ${textOf(event.data.message.content)}`],
    }
  }
  return state
}

/** Pure fold for tests. Production reads `readJudgeDigest`. */
export function summarizeSession(events: readonly SessionEvent[]): string {
  let state = initJudge()
  for (const event of events) state = applyJudge(state, event)
  return state.lines.join('\n')
}

export const judgeProjectionDefinition = {
  key: 'verifierJudge',
  stateVersion: 1,
  stateSchema: judgeStateSchema,
  init: initJudge,
  apply: applyJudge,
} satisfies ProjectionDefinition<'verifierJudge', JudgeState>

export function readJudgeDigest(
  projections: Pick<SessionProjectionRegistry, 'stateOf'>,
  session: Session,
): string {
  return projections.stateOf(session, 'verifierJudge')?.lines.join('\n') ?? ''
}
