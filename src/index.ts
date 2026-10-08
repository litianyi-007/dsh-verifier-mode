/**
 * Minimal host plugin: config, `/verifier`, and the session projections.
 * P0 scaffold only — no judge runner or Jev client.
 */
import type { Context } from '@deepseek-ai/cordis'
import { isVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import { ledgerProjectionDefinition } from './ledger.ts'
import { verifierModeNotice } from './notices.ts'
import { createVerifierProjection } from './projection.ts'
import { routeProjectionDefinition } from './route.ts'
import { judgeProjectionDefinition } from './summary.ts'

/** Plugin-owned settings. Live values use schemastery `.volatile()`. */
export interface Config {
  /** Seeds `verifier.active` for a new session. A logged `/verifier` command replaces it. */
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

/** Read the volatile flag at projection init, so each new session sees the current value. */
function enabledNow(config: Config): boolean {
  const flag: unknown = config.enabledByDefault
  if (isVolatile(flag)) return flag.get() === true
  return flag === true
}

/**
 * Register the projections and the `/verifier` command.
 * The command appends a user-role notice and settles `command/done`.
 * The verifier projection folds that pair, so a reloaded session restores `active`.
 * @param ctx - plugin context. Requires `commands` and `sessionProjections`.
 * @param config - validated plugin config. `enabledByDefault` seeds the projection.
 */
export function apply(ctx: Context, config: Config = { enabledByDefault: false }): void {
  const readEnabled = () => enabledNow(config)
  ctx.sessionProjections.register(createVerifierProjection(readEnabled))
  ctx.sessionProjections.register(routeProjectionDefinition)
  ctx.sessionProjections.register(ledgerProjectionDefinition)
  ctx.sessionProjections.register(judgeProjectionDefinition)
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
export { createVerifierProjection } from './projection.ts'
export type { VerifierModeState, VerifierModeView } from './projection.ts'
export { currentRouteFromEvents, readCurrentRoute } from './route.ts'
export type { CurrentRoute } from './route.ts'
export { readLedger, routeKey } from './ledger.ts'
export type { LedgerState, UsageBill } from './ledger.ts'
export { readJudgeDigest, summarizeSession } from './summary.ts'
