/**
 * Session-scoped verifier mode, folded from the command lifecycle and cost notices.
 * Reload reconstructs `active`, `onceArmed`, `paused`, and the approved plan from the log.
 */
import type {} from '@deepseek-ai/dsh-commands/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import { z } from 'zod'
import { COST_CAP_MARK, COST_RESUME_MARK } from './notices.ts'

/** Host fold of `/verifier` plus cost pause and an approved plan. */
export interface VerifierModeState {
  active: boolean
  running: { commandId: string; wanted: 'on' | 'off' | 'once' } | null
  onceArmed: boolean
  paused: boolean
  pendingPlan: { callId: string; text: string } | null
  approvedPlan: string | null
}

/** Wire view served to a client chip. */
export interface VerifierModeView {
  active: boolean
  paused: boolean
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
    wanted: z.enum(['on', 'off', 'once']),
  }).strict().nullable(),
  onceArmed: z.boolean(),
  paused: z.boolean(),
  pendingPlan: z.object({
    callId: z.string(),
    text: z.string(),
  }).strict().nullable(),
  approvedPlan: z.string().nullable(),
}).strict()

const viewSchema = z.object({
  active: z.boolean(),
  paused: z.boolean(),
}).strict()

function wantedFromArgs(args: string | undefined): 'on' | 'off' | 'once' | undefined {
  const trimmed = args?.trim() ?? ''
  if (trimmed === 'on') return 'on'
  if (trimmed === 'off') return 'off'
  if (trimmed === 'once' || trimmed.startsWith('once ')) return 'once'
  return undefined
}

function messageText(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('')
}

/**
 * Build the verifier projection.
 * `readEnabled` is read inside `init`, so `enabledByDefault` seeds `active`
 * for each new session. A later successful `/verifier on|off` replaces it.
 * `/verifier once` arms a single turn and clears on `turn/end`.
 */
export function createVerifierProjection(
  readEnabled: () => boolean,
): ProjectionDefinition<'verifier', VerifierModeState> {
  return {
    key: 'verifier',
    stateVersion: 3,
    stateSchema,
    init: () => ({
      active: readEnabled(),
      running: null,
      onceArmed: false,
      paused: false,
      pendingPlan: null,
      approvedPlan: null,
    }),
    apply: (state, event) => {
      if (event.type === 'command/run' && event.data.name === 'verifier') {
        const wanted = wantedFromArgs(event.data.args)
        if (wanted === undefined) return state
        return { ...state, running: { commandId: event.data.commandId, wanted } }
      }
      if (event.type === 'command/done' && state.running !== null && event.data.commandId === state.running.commandId) {
        if (event.data.kind !== 'success') return { ...state, running: null }
        if (state.running.wanted === 'once') return { ...state, onceArmed: true, running: null }
        if (state.running.wanted === 'on') return { ...state, active: true, running: null }
        return {
          ...state,
          active: false,
          onceArmed: false,
          paused: false,
          pendingPlan: null,
          approvedPlan: null,
          running: null,
        }
      }
      if (event.type === 'turn/end' && state.onceArmed) return { ...state, onceArmed: false }
      if (event.type === 'user/message') {
        const text = messageText(event.data.content)
        if (text.includes(COST_CAP_MARK)) return state.paused ? state : { ...state, paused: true }
        if (text.includes(COST_RESUME_MARK)) return state.paused ? { ...state, paused: false } : state
        return state
      }
      if (event.type === 'tool/call' && event.data.name === 'exit_plan_mode') {
        let text = ''
        try {
          const parsed = JSON.parse(event.data.arguments) as { plan?: unknown }
          if (typeof parsed.plan === 'string') text = parsed.plan
        } catch {
          text = ''
        }
        return { ...state, pendingPlan: { callId: String(event.data.callId), text } }
      }
      if (event.type === 'tool/result' && state.pendingPlan !== null && String(event.data.message.toolCallId) === state.pendingPlan.callId) {
        if (event.data.message.isError === true) return { ...state, pendingPlan: null }
        return { ...state, approvedPlan: state.pendingPlan.text, pendingPlan: null }
      }
      return state
    },
    wire: {
      viewSchema,
      view: (state) => ({ active: state.active, paused: state.paused }),
    },
  }
}
