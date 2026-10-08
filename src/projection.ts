/**
 * Session-scoped verifier mode, folded from the command lifecycle.
 * Reload reconstructs `active` from the log; nothing is kept only in memory.
 */
import type {} from '@deepseek-ai/dsh-commands/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import { z } from 'zod'

/** Host fold of `/verifier on|off`. */
export interface VerifierModeState {
  active: boolean
  running: { commandId: string; wanted: boolean } | null
}

/** Wire view served to a client chip. */
export interface VerifierModeView {
  active: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    verifier: VerifierModeState
  }
  interface SessionProjectionMap {
    verifier: VerifierModeView
  }
}

const stateSchema = z.object({
  active: z.boolean(),
  running: z.object({
    commandId: z.string(),
    wanted: z.boolean(),
  }).strict().nullable(),
}).strict()

const viewSchema = z.object({
  active: z.boolean(),
}).strict()

function wantedFromArgs(args: string | undefined): boolean | undefined {
  const trimmed = args?.trim()
  if (trimmed === 'on') return true
  if (trimmed === 'off') return false
  return undefined
}

export const verifierProjectionDefinition = {
  key: 'verifier',
  stateVersion: 1,
  stateSchema,
  init: () => ({ active: false, running: null }),
  apply: (state, event) => {
    if (event.type === 'command/run' && event.data.name === 'verifier') {
      const wanted = wantedFromArgs(event.data.args)
      if (wanted === undefined) return state
      return { ...state, running: { commandId: event.data.commandId, wanted } }
    }
    if (event.type === 'command/done' && state.running !== null && event.data.commandId === state.running.commandId) {
      if (event.data.kind !== 'success') return { ...state, running: null }
      return { active: state.running.wanted, running: null }
    }
    return state
  },
  wire: {
    viewSchema,
    view: (state) => ({ active: state.active }),
  },
} satisfies ProjectionDefinition<'verifier', VerifierModeState>
