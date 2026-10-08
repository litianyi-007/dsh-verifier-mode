/**
 * D1 intake, D4 audit, and plan-mode advice.
 * Candidates come from ctx.llm at candidateEffort (default low), never a fork.
 * Plan mode skips D1 and D4. exit_plan_mode is scored and never rejected.
 * After a plan is approved, later turns do not generate a new strategy.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { TokenUsage, UserMessage } from '@deepseek-ai/dsh-llm'
import { costClock } from './clock.ts'
import type { ResolvedConfig } from './config.ts'
import { STRATEGIES, candidatePrompt, parseCandidate } from './candidates.ts'
import type { ParsedCandidate } from './candidates.ts'
import { addCostLine, sessionKey, sessionSpendCny } from './cost-book.ts'
import {
  INTAKE_QUESTIONS,
  auditQuestions,
  clipTask,
  delimitEvidence,
  freshNonce,
  postJev,
} from './jev.ts'
import type { JevResponse } from './jev.ts'
import {
  costCapNotice,
  costResumeNotice,
  decisionNotice,
  fallbackNotice,
  incompleteNotice,
  planScoreNotice,
  steerNotice,
} from './notices.ts'
import { estimateIntakeCny, priceJev, priceUsage, resolveCap, routeOf } from './pricing.ts'
import { readCurrentRoute } from './route.ts'
import { selectWinner } from './selector.ts'
import type { ScoredCandidate, SelectionRules } from './selector.ts'
import { readJudgeDigest } from './summary.ts'
import { pushTrace } from './trace.ts'

interface EnterDecision {
  kind: 'enter'
  messages: UserMessage[]
  [key: string]: unknown
}

interface PlanModeService {
  get(agent: Agent): { active: boolean }
}

const steers = new Map<string, number>()
const planNotes = new Map<string, UserMessage>()
const turnStrategy = new Map<string, string[]>()

function judgeReady(config: ResolvedConfig): boolean {
  return config.jev.baseUrl !== 'https://api.typesafe.ai'
}

function planActive(ctx: Context, agent: Agent): boolean {
  const plan = ctx.get('planMode') as PlanModeService | undefined
  return plan?.get(agent).active === true
}

function textOf(messages: readonly { content?: readonly { type: string; text?: string }[] }[]): string {
  return messages.flatMap(message => message.content ?? []).flatMap(block => block.type === 'text' && block.text ? [block.text] : []).join('\n')
}

function intakeRules(config: ResolvedConfig): SelectionRules {
  return {
    violation: config.thresholds.violation,
    confidenceFloor: config.thresholds.confidenceFloor,
    tieGap: config.thresholds.tieGap,
    weights: config.weights,
    noulKeys: INTAKE_QUESTIONS.filter(question => question.kind === 'noul').map(question => question.key),
    scoreKeys: INTAKE_QUESTIONS.filter(question => question.kind === 'score').map(question => question.key),
  }
}

function billJev(sessionId: string, response: JevResponse): void {
  const inputTokens = response.usage?.inputTokens ?? 0
  const outputTokens = response.usage?.outputTokens ?? 0
  const priced = priceJev(inputTokens, outputTokens)
  addCostLine(sessionId, {
    source: 'jev',
    model: 'jev',
    amountCny: priced.amountCny,
    nativeAmount: priced.nativeAmount,
    nativeCurrency: priced.nativeCurrency,
  })
}

interface GeneratorChunk {
  type: string
  text?: string
  usage?: TokenUsage
  reason?: { kind?: string; failure?: { message?: string } }
}

interface LlmStream {
  stream(options: {
    provider: string
    model: string
    reasoningEffort: ReturnType<typeof ReasoningEffortId>
    maxTokens: number
    messages: ReturnType<typeof createUserMessage>[]
    signal: AbortSignal
  }): AsyncIterable<GeneratorChunk>
}

async function generateOne(
  ctx: Context,
  config: ResolvedConfig,
  sessionId: string,
  provider: string,
  model: string,
  strategy: string,
  task: string,
  signal: AbortSignal,
  cap: number,
): Promise<{ candidate?: ParsedCandidate; overCap: boolean }> {
  // Event dispatch shadows the listener fiber, so `ctx.llm` throws
  // "without inject" even when this plugin lists `llm`. `get` reads the store.
  const llm = ctx.get('llm') as LlmStream | undefined
  if (llm === undefined) throw new Error('llm service is unavailable')
  const chunks: GeneratorChunk[] = []
  const stream = llm.stream({
    provider,
    model,
    reasoningEffort: ReasoningEffortId(config.candidateEffort),
    maxTokens: config.candidateMaxTokens,
    messages: [createUserMessage({
      content: [{ type: 'text', text: candidatePrompt(strategy, task) }],
      source: { kind: 'user' },
    })],
    signal,
  })
  let overCap = false
  let billed = false
  for await (const chunk of stream) {
    if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'generator failed')
    }
    chunks.push(chunk)
    if (chunk.type === 'usage' && chunk.usage && !billed) {
      billed = true
      const priced = priceUsage(routeOf(provider, model), chunk.usage, costClock.now(), config.pricing)
      addCostLine(sessionId, {
        source: 'generator',
        model: routeOf(provider, model),
        amountCny: priced.amountCny,
        nativeAmount: priced.nativeAmount,
        nativeCurrency: priced.nativeCurrency,
      })
      if (sessionSpendCny(sessionId) >= cap) overCap = true
    }
    if (overCap) break
  }
  const text = chunks.flatMap(chunk => chunk.type === 'text-delta' && chunk.text ? [chunk.text] : []).join('')
  return { candidate: parseCandidate(text, strategy), overCap }
}

function pause(
  sessionId: string,
  spent: number,
  cap: { amount: number; model: string },
  messages: UserMessage[],
  alreadyPaused: boolean,
): UserMessage[] {
  if (alreadyPaused) return messages
  pushTrace(sessionId, {
    point: 'intake',
    outcome: 'cost-cap',
    spentCny: spent,
    cap: cap.amount,
    capModel: cap.model,
  })
  process.stderr.write(`dsh: verifier paused cost-cap spent=${spent.toFixed(2)} cap=${cap.amount.toFixed(2)} model=${cap.model}\n`)
  return [...messages, costCapNotice(spent, cap.amount, cap.model)]
}

export async function runIntake(
  ctx: Context,
  config: ResolvedConfig,
  agent: Agent,
  turn: number,
  signal: AbortSignal,
  decision: EnterDecision,
): Promise<EnterDecision> {
  const state = ctx.sessionProjections.stateOf(agent.session, 'verifier')
  const effective = state?.active === true || state?.onceArmed === true
  if (!effective || !config.intake) return decision
  if (planActive(ctx, agent)) return decision

  const sessionId = sessionKey(agent.session.id)
  const current = readCurrentRoute(ctx.sessionProjections, agent.session, agent.options)
  const mainRoute = routeOf(current.provider, current.model)
  const generator = config.generatorRoute ?? { provider: current.provider, model: current.model }
  const generatorRoute = routeOf(generator.provider, generator.model)
  const cap = resolveCap(mainRoute, config.cost, config.pricing.aliases)
  const spent = sessionSpendCny(sessionId)
  const estimate = estimateIntakeCny(config.candidates, config.candidateMaxTokens, generatorRoute, costClock.now(), config.pricing)
  const over = spent >= cap.amount || spent + estimate > cap.amount
  if (over) {
    return { ...decision, messages: pause(sessionId, spent, cap, decision.messages, state?.paused === true) }
  }

  let messages = decision.messages
  if (state?.paused === true) {
    messages = [...messages, costResumeNotice(spent, cap.amount, cap.model)]
  }
  if (state?.approvedPlan) return { ...decision, messages }
  if (!judgeReady(config)) {
    pushTrace(sessionId, { point: 'intake', outcome: 'fallback', reason: 'jev is not configured' })
    return { ...decision, messages: [...messages, fallbackNotice('jev is not configured')] }
  }

  const task = clipTask(textOf(messages))
  const evidence = delimitEvidence(readJudgeDigest(ctx.sessionProjections, agent.session), freshNonce())
  const strategies = STRATEGIES.slice(0, config.candidates)
  const parsed: ParsedCandidate[] = []
  for (const strategy of strategies) {
    if (signal.aborted || sessionSpendCny(sessionId) >= cap.amount) {
      return { ...decision, messages: pause(sessionId, sessionSpendCny(sessionId), cap, messages, false) }
    }
    const generated = await generateOne(ctx, config, sessionId, generator.provider, generator.model, strategy, task, signal, cap.amount)
    if (generated.candidate) parsed.push(generated.candidate)
    if (generated.overCap || sessionSpendCny(sessionId) >= cap.amount) {
      return { ...decision, messages: pause(sessionId, sessionSpendCny(sessionId), cap, messages, false) }
    }
  }
  if (parsed.length < 2) {
    pushTrace(sessionId, { point: 'intake', outcome: 'fallback', reason: 'fewer than 2 candidates' })
    return { ...decision, messages: [...messages, fallbackNotice('fewer than 2 candidates')] }
  }

  let scored: ScoredCandidate[]
  try {
    scored = []
    for (const candidate of parsed) {
      const response = await postJev(config.jev.baseUrl, config.jev.apiKey, {
        point: 'intake',
        state: { task, constraints: [], evidence, candidate },
        questions: INTAKE_QUESTIONS,
      }, signal, config.jev.timeoutMs)
      billJev(sessionId, response)
      if (sessionSpendCny(sessionId) >= cap.amount) {
        return { ...decision, messages: pause(sessionId, sessionSpendCny(sessionId), cap, messages, false) }
      }
      scored.push({ candidate, answers: response.answers })
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'jev failed'
    pushTrace(sessionId, { point: 'intake', outcome: 'fallback', reason })
    return { ...decision, messages: [...messages, fallbackNotice(reason)] }
  }

  const selected = selectWinner(scored, intakeRules(config))
  if (selected.kind === 'fallback') {
    pushTrace(sessionId, { point: 'intake', outcome: 'fallback', reason: selected.reason })
    return { ...decision, messages: [...messages, fallbackNotice(selected.reason)] }
  }
  turnStrategy.set(`${sessionId}:${turn}`, selected.candidate.acceptance)
  pushTrace(sessionId, { point: 'intake', outcome: 'committed', winner: selected.candidate.title, spentCny: sessionSpendCny(sessionId), cap: cap.amount, capModel: cap.model })
  return {
    ...decision,
    messages: [...messages, decisionNotice(selected.candidate, selected.composite, selected.confidence)],
  }
}

export async function runAudit(
  ctx: Context,
  config: ResolvedConfig,
  agent: Agent,
  turn: number,
  signal: AbortSignal,
): Promise<void> {
  const state = ctx.sessionProjections.stateOf(agent.session, 'verifier')
  const effective = state?.active === true || state?.onceArmed === true
  if (!effective || !config.audit || state?.paused === true || planActive(ctx, agent) || !judgeReady(config)) return
  const sessionId = sessionKey(agent.session.id)
  const current = readCurrentRoute(ctx.sessionProjections, agent.session, agent.options)
  const cap = resolveCap(routeOf(current.provider, current.model), config.cost, config.pricing.aliases)
  if (sessionSpendCny(sessionId) >= cap.amount) {
    if (state?.paused !== true) {
      agent.session.append('user/message', costCapNotice(sessionSpendCny(sessionId), cap.amount, cap.model), { surfaceOp: 'append' })
      process.stderr.write(`dsh: verifier paused cost-cap spent=${sessionSpendCny(sessionId).toFixed(2)} cap=${cap.amount.toFixed(2)} model=${cap.model}\n`)
      pushTrace(sessionId, { point: 'audit', outcome: 'cost-cap', spentCny: sessionSpendCny(sessionId), cap: cap.amount, capModel: cap.model })
    }
    return
  }
  const acceptance = state?.approvedPlan
    ? [state.approvedPlan]
    : turnStrategy.get(`${sessionId}:${turn}`) ?? []
  const task = clipTask(readJudgeDigest(ctx.sessionProjections, agent.session))
  const evidence = delimitEvidence(task, freshNonce())
  let failed: string[] = []
  try {
    const response = await postJev(config.jev.baseUrl, config.jev.apiKey, {
      point: 'audit',
      state: {
        task,
        constraints: [],
        evidence,
        acceptance,
        plan: state?.approvedPlan ?? undefined,
      },
      questions: auditQuestions(acceptance),
    }, signal, config.jev.timeoutMs)
    billJev(sessionId, response)
    failed = auditQuestions(acceptance).flatMap((question) => {
      if (question.kind !== 'noul') return []
      const answer = response.answers[question.key]
      return answer !== undefined && answer.value >= config.thresholds.violation ? [question.key] : []
    })
  } catch (error) {
    pushTrace(sessionId, { point: 'audit', outcome: 'fallback', reason: error instanceof Error ? error.message : 'jev failed' })
    return
  }
  if (failed.length === 0) {
    pushTrace(sessionId, { point: 'audit', outcome: 'passed' })
    return
  }
  const used = steers.get(`${sessionId}:${turn}`) ?? 0
  if (used < config.maxAuditRounds) {
    steers.set(`${sessionId}:${turn}`, used + 1)
    pushTrace(sessionId, { point: 'audit', outcome: 'steered', reason: failed.join(',') })
    agent.steer(steerNotice(failed))
    return
  }
  pushTrace(sessionId, { point: 'audit', outcome: 'incomplete', reason: failed.join(',') })
  agent.session.append('user/message', incompleteNotice(failed), { surfaceOp: 'append' })
}

export async function scorePlan(
  ctx: Context,
  config: ResolvedConfig,
  agent: Agent,
  callId: string,
  plan: string,
  signal: AbortSignal,
): Promise<void> {
  const state = ctx.sessionProjections.stateOf(agent.session, 'verifier')
  if (state?.active !== true || config.planReview !== 'advise' || state.paused === true || !judgeReady(config)) return
  const sessionId = sessionKey(agent.session.id)
  const task = clipTask(plan)
  const evidence = delimitEvidence(plan, freshNonce())
  try {
    const response = await postJev(config.jev.baseUrl, config.jev.apiKey, {
      point: 'plan',
      state: { task, constraints: [], evidence, plan, candidate: { id: 'plan', title: 'submitted plan', steps: [plan], acceptance: [plan], risks: [] } },
      questions: INTAKE_QUESTIONS,
    }, signal, config.jev.timeoutMs)
    billJev(sessionId, response)
    const selected = selectWinner([{
      candidate: { id: 'plan', title: 'submitted plan', steps: [plan], acceptance: [plan], risks: [] },
      answers: response.answers,
    }], intakeRules(config))
    const summary = selected.kind === 'winner'
      ? `composite ${selected.composite.toFixed(2)}, confidence ${selected.confidence.toFixed(2)}`
      : selected.reason
    planNotes.set(callId, planScoreNotice(summary))
    pushTrace(sessionId, { point: 'plan', outcome: 'plan-score', reason: summary })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'jev failed'
    planNotes.set(callId, planScoreNotice(reason))
    pushTrace(sessionId, { point: 'plan', outcome: 'fallback', reason })
  }
}

export function takePlanNote(callId: string): UserMessage | undefined {
  const note = planNotes.get(callId)
  if (note !== undefined) planNotes.delete(callId)
  return note
}

export function billAssistantUsage(
  sessionId: string,
  provider: string,
  model: string,
  usage: TokenUsage,
  table: ResolvedConfig['pricing'],
): void {
  const priced = priceUsage(routeOf(provider, model), usage, costClock.now(), table)
  addCostLine(sessionId, {
    source: 'main',
    model: routeOf(provider, model),
    amountCny: priced.amountCny,
    nativeAmount: priced.nativeAmount,
    nativeCurrency: priced.nativeCurrency,
  })
}
