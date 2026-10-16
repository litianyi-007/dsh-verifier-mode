/**
 * Verifier mode: session switch, D1 strategy selection, D4 audit, plan advice, CNY cap.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { Config, resolveConfig } from './config.ts'
import type { ResolvedConfig } from './config.ts'
import { FEEDBACK_DEFAULTS, commitFeedback, detectPlatform, prepareNoticeForError } from './feedback.ts'
import { ledgerProjectionDefinition } from './ledger.ts'
import { fallbackNotice, verifierModeNotice } from './notices.ts'
import { createVerifierProjection } from './projection.ts'
import { routeProjectionDefinition } from './route.ts'
import { billAssistantUsage, feedbackForThrown, postSteerArmed, runAudit, runIntake, scorePlan, takePlanNotes } from './runtime.ts'
import { ensureUsageStore, sessionKey, watchUsageStore } from './cost-book.ts'
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

function reportLoadFailure(settings: ResolvedConfig['feedback'], error: unknown): void {
  try {
    const prepared = prepareNoticeForError('plugin-load', settings, error, { platform: detectPlatform(), point: 'load' })
    if (prepared === undefined) return
    process.stderr.write(`dsh: verifier feedback\n${prepared.text}\n`)
    commitFeedback('plugin-load', prepared.fingerprint)
  } catch {
    // The original failure is rethrown. An unwritten draft stays unclaimed.
  }
}

/**
 * Register projections, `/verifier`, and the decision listeners.
 * @param ctx - requires `commands` and `sessionProjections`. `planMode` and `storageDomain` are optional.
 * @param config - validated plugin config. `enabledByDefault` seeds the projection.
 */
export async function apply(ctx: Context, config: unknown = { enabledByDefault: false }): Promise<void> {
  const readConfig = () => resolveConfig(config)
  try {
    await applyPlugin(ctx, readConfig)
  } catch (error) {
    let settings: ResolvedConfig['feedback'] = FEEDBACK_DEFAULTS
    try {
      settings = readConfig().feedback
    } catch {
      // Config itself failed. The draft still uses the defaults.
    }
    reportLoadFailure(settings, error)
    throw error
  }
}

async function applyPlugin(ctx: Context, readConfig: () => ResolvedConfig): Promise<void> {
  await ensureUsageStore(ctx)
  watchUsageStore(ctx)
  ctx.sessionProjections.register(createVerifierProjection(() => readConfig().enabledByDefault))
  ctx.sessionProjections.register(routeProjectionDefinition)
  ctx.sessionProjections.register(ledgerProjectionDefinition)
  ctx.sessionProjections.register(judgeProjectionDefinition)

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message' || event.data.usage === undefined) return
    const config = readConfig()
    const id = sessionKey(session.id)
    // Design §8 A: only D4 post-steer main steps count. Ordinary assistant usage does not.
    if (!postSteerArmed(id) || config.cost.scope !== 'design') return
    const usage = event.data.usage as TokenUsage
    const source = event.data.message.source
    void billAssistantUsage(id, source.provider, source.model, usage, config.pricing).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown'
      process.stderr.write(`dsh: verifier cost ledger write failed: ${message}\n`)
      for (const note of feedbackForThrown(id, config, error, 'ledger')) {
        try {
          session.append('user/message', note.message, { surfaceOp: 'append' })
          commitFeedback(id, note.fingerprint)
        } catch {
          process.stderr.write('dsh: verifier feedback notice could not be appended\n')
        }
      }
    })
  })

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || payload.step !== 1) return decision
    try {
      return await runIntake(ctx, readConfig(), payload.agent, payload.turn, payload.signal, decision)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'intake failed'
      const resolved = readConfig()
      const sessionId = sessionKey(payload.agent.session.id)
      const notes = feedbackForThrown(sessionId, resolved, error, 'intake')
      for (const note of notes) commitFeedback(sessionId, note.fingerprint)
      return {
        ...decision,
        messages: [
          ...decision.messages,
          fallbackNotice(reason),
          ...notes.map(note => note.message),
        ],
      }
    }
  })

  ctx.on('agent/turn-stopping', async (payload) => {
    try {
      await runAudit(ctx, readConfig(), payload.agent, payload.turn, payload.signal)
    } catch (error) {
      // Judge failures leave the turn on the normal path. The draft is separate.
      const sessionId = sessionKey(payload.agent.session.id)
      for (const note of feedbackForThrown(sessionId, readConfig(), error, 'audit')) {
        try {
          payload.agent.session.append('user/message', note.message, { surfaceOp: 'append' })
          commitFeedback(sessionId, note.fingerprint)
        } catch {
          process.stderr.write('dsh: verifier feedback notice could not be appended\n')
        }
      }
    }
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (exec.name !== 'exit_plan_mode' || exec.agent === undefined) return decision
    const plan = typeof exec.arguments === 'object' && exec.arguments !== null && 'plan' in exec.arguments
      && typeof exec.arguments.plan === 'string'
      ? exec.arguments.plan
      : ''
    const agent = exec.agent
    try {
      await scorePlan(ctx, readConfig(), agent, String(exec.callId), plan, exec.signal)
    } catch (error) {
      // Advice is optional. The tool decision is unchanged.
      const sessionId = sessionKey(agent.session.id)
      for (const note of feedbackForThrown(sessionId, readConfig(), error, 'plan')) {
        try {
          agent.session.append('user/message', note.message, { surfaceOp: 'append' })
          commitFeedback(sessionId, note.fingerprint)
        } catch {
          process.stderr.write('dsh: verifier feedback notice could not be appended\n')
        }
      }
    }
    return decision
  })

  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const decision = await next()
    if (exec.name !== 'exit_plan_mode') return decision
    const notes = takePlanNotes(String(exec.callId))
    if (notes.length === 0 || (decision.kind !== 'accept' && decision.kind !== 'block')) return decision
    return { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), ...notes] }
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
