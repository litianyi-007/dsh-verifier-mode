/**
 * Minimal host plugin: config, `/verifier`, and the session projection.
 * P0 scaffold only — no judge, cost ledger, or Jev client.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { verifierModeNotice } from './notices.ts'
import { verifierProjectionDefinition } from './projection.ts'

/** Plugin-owned settings. Live values use schemastery `.volatile()`. */
export interface Config {
  /** Initial preference only. Model-visible mode is the logged `/verifier` command. */
  enabledByDefault: boolean
}

export const Config: z<Config> = z.object({
  enabledByDefault: z.boolean().default(false).volatile(),
})

export const name = 'dsh-verifier-mode'
export const inject = ['commands', 'sessionProjections']

function parseMode(rawInput: string): 'on' | 'off' | 'status' | 'invalid' {
  const arg = rawInput.trim()
  if (arg === '' || arg === 'status') return 'status'
  if (arg === 'on' || arg === 'off') return arg
  return 'invalid'
}

/**
 * Register the projection and the `/verifier` command.
 * The command appends a user-role notice and settles `command/done`.
 * The projection folds that pair, so a reloaded session restores `active`.
 * @param ctx - plugin context. Requires `commands` and `sessionProjections`.
 * @param _config - validated plugin config. The volatile flag is not model-visible state.
 */
export function apply(ctx: Context, _config: Config = { enabledByDefault: false }): void {
  ctx.sessionProjections.register(verifierProjectionDefinition)
  ctx.commands.register({
    name: 'verifier',
    description: 'Turn verifier mode on or off for this session',
    input: { hint: 'on|off|status' },
    handler: ({ agent, rawInput }) => {
      const current = ctx.sessionProjections.stateOf(agent.session, 'verifier')?.active ?? false
      const mode = parseMode(rawInput)
      if (mode === 'invalid') {
        return { kind: 'error' as const, text: `unknown /verifier argument "${rawInput.trim()}" (expected on, off, or status)` }
      }
      if (mode === 'status') {
        return { kind: 'success' as const, text: current ? 'Verifier mode is on.' : 'Verifier mode is off.' }
      }
      const active = mode === 'on'
      const event = agent.session.append('user/message', verifierModeNotice(active), { surfaceOp: 'append' })
      return {
        kind: 'success' as const,
        text: active ? 'Verifier mode on.' : 'Verifier mode off.',
        sourceEventSeq: event.seq,
      }
    },
  })
}

export { verifierModeNotice, verifierNotice } from './notices.ts'
export { verifierProjectionDefinition } from './projection.ts'
export type { VerifierModeState, VerifierModeView } from './projection.ts'
export { currentRoute, currentRouteFromEvents } from './route.ts'
export type { CurrentRoute } from './route.ts'
export { summarizeSession } from './summary.ts'
