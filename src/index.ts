/**
 * Verifier mode: session switch, D1 strategy selection, D4 audit, plan advice, CNY cap.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { Config, resolveConfig } from './config.ts'
import { ledgerProjectionDefinition } from './ledger.ts'
import { fallbackNotice, verifierModeNotice } from './notices.ts'
import { createVerifierProjection } from './projection.ts'
import { routeProjectionDefinition } from './route.ts'
import { billAssistantUsage, runAudit, runIntake, scorePlan, takePlanNote } from './runtime.ts'
import { sessionKey } from './cost-book.ts'
import { judgeProjectionDefinition } from './summary.ts'

export { Config }

export const name = 'dsh-verifier-mode'
export const inject = ['commands', 'sessionProjections', 'llm']

function parseMode(rawInput: string): 'on' | 'off' | 'status' | 'once' | 'invalid' {
  const arg = rawInput.trim()
  if (arg === '' || arg === 'status') return 'status'
  if (arg === 'on' || arg === 'off') return arg
  if (arg === 'once' || arg.startsWith('once ')) return 'once'
  return 'invalid'
}

/**
 * Register projections, `/verifier`, and the decision listeners.
 * @param ctx - requires `commands` and `sessionProjections`. `planMode` is optional.
 * @param config - validated plugin config. `enabledByDefault` seeds the projection.
 */
export function apply(ctx: Context, config: unknown = { enabledByDefault: false }): void {
  const readConfig = () => resolveConfig(config)
  ctx.sessionProjections.register(createVerifierProjection(() => readConfig().enabledByDefault))
  ctx.sessionProjections.register(routeProjectionDefinition)
  ctx.sessionProjections.register(ledgerProjectionDefinition)
  ctx.sessionProjections.register(judgeProjectionDefinition)

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message' || event.data.usage === undefined) return
    const usage = event.data.usage as TokenUsage
    const source = event.data.message.source
    billAssistantUsage(sessionKey(session.id), source.provider, source.model, usage, readConfig().pricing)
  })

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || payload.step !== 1) return decision
    try {
      return await runIntake(ctx, readConfig(), payload.agent, payload.turn, payload.signal, decision)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'intake failed'
      return { ...decision, messages: [...decision.messages, fallbackNotice(reason)] }
    }
  })

  ctx.on('agent/turn-stopping', async (payload) => {
    try {
      await runAudit(ctx, readConfig(), payload.agent, payload.turn, payload.signal)
    } catch {
      // Judge failures leave the turn on the normal path.
    }
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (exec.name !== 'exit_plan_mode' || exec.agent === undefined) return decision
    const plan = typeof exec.arguments === 'object' && exec.arguments !== null && 'plan' in exec.arguments
      && typeof exec.arguments.plan === 'string'
      ? exec.arguments.plan
      : ''
    try {
      await scorePlan(ctx, readConfig(), exec.agent, String(exec.callId), plan, exec.signal)
    } catch {
      // Advice is optional. The tool decision is unchanged.
    }
    return decision
  })

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const decision = await next()
    if (exec.name !== 'exit_plan_mode') return decision
    const note = takePlanNote(String(exec.callId))
    if (note === undefined || (decision.kind !== 'accept' && decision.kind !== 'block')) return decision
    return { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), note] }
  })

  ctx.commands.register({
    name: 'verifier',
    description: 'Turn verifier mode on or off for this session, or arm it for one turn',
    input: { hint: 'on|off|status|once' },
    handler: ({ agent, rawInput }) => {
      const state = ctx.sessionProjections.stateOf(agent.session, 'verifier')
      const mode = parseMode(rawInput)
      if (mode === 'invalid') {
        return { kind: 'error' as const, text: `unknown /verifier argument "${rawInput.trim()}" (expected on, off, status, or once)` }
      }
      if (mode === 'status') {
        const bits = [
          state?.active ? 'Verifier mode is on.' : 'Verifier mode is off.',
          state?.onceArmed ? 'Armed for the next turn.' : '',
          state?.paused ? 'Paused at the cost cap.' : '',
        ].filter(bit => bit !== '')
        return { kind: 'success' as const, text: bits.join(' ') }
      }
      if (mode === 'once') {
        return { kind: 'success' as const, text: 'Verifier will run for the next turn.' }
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
export { readVerifierTraces } from './trace.ts'
export { sessionSpendCny } from './cost-book.ts'
export { resolveCap, priceUsage, priceJev, isPeak, DEFAULT_PRICING, FLASH_ROUTE, PRO_ROUTE } from './pricing.ts'
export { costClock } from './clock.ts'
export { resolveConfig } from './config.ts'
