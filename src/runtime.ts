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
import { candidatePrompt, inspectCandidate, strategiesFor } from './candidates.ts'
import type { ParsedCandidate } from './candidates.ts'
import {
  addCostLine,
  countedSourceLabel,
  ensureUsageStore,
  sessionKey,
  sessionSpendCny,
} from './cost-book.ts'
import type { CandidateTrace, CostScope, DecisionTrace } from './cost-book.ts'
import { resolveJevApiKey } from './jev-key.ts'
import {
  GATE_QUESTION,
  INTAKE_QUESTIONS,
  auditQuestions,
  clipTask,
  delimitEvidence,
  freshNonce,
  postJev,
} from './jev.ts'
import type { JevResponse } from './jev.ts'
import { commitFeedback, detectPlatform, prepareNoticeForError, prepareNoticeForTrace, sanitizeCode } from './feedback.ts'
import {
  costCapNotice,
  costResumeNotice,
  decisionNotice,
  fallbackNotice,
  feedbackNotice,
  incompleteNotice,
  intakeSkipNotice,
  planScoreNotice,
  steerNotice,
} from './notices.ts'
import { estimateIntakeCny, priceJev, priceUsage, resolveCap, routeOf } from './pricing.ts'
import { readCurrentRoute } from './route.ts'
import { deterministicSkip, userTurnFacts, INTAKE_GATE_THRESHOLD } from './intake-gate.ts'
import { scoreCandidate, scoreSummary, selectWinner } from './selector.ts'
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
const planNotes = new Map<string, UserMessage[]>()
const turnStrategy = new Map<string, string[]>()
const postSteer = new Set<string>()
/** Greetings, slash commands, and other deterministic trivial skips. D4 does not spend a Jev call. A failed or single-step gate still audits. */
const skipAudit = new Set<string>()

interface TakenFeedback {
  fingerprint: string
  message: UserMessage
}

/** Draft only. The caller records the fingerprint after a successful handoff. */
function takeFeedback(sessionId: string, config: ResolvedConfig, trace: DecisionTrace): TakenFeedback | undefined {
  try {
    const prepared = prepareNoticeForTrace(sessionId, config.feedback, trace, {
      platform: detectPlatform(),
      costScope: config.cost.scope,
      countedSources: trace.countedSources ?? countedSourceLabel(config.cost.scope),
    })
    if (prepared === undefined) return undefined
    return { fingerprint: prepared.fingerprint, message: feedbackNotice(prepared.text) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'feedback failed'
    process.stderr.write(`dsh: verifier feedback failed: ${sanitizeCode(message) || 'feedback-failed'}\n`)
    return undefined
  }
}

function withFeedback(
  sessionId: string,
  config: ResolvedConfig,
  trace: DecisionTrace,
  messages: readonly UserMessage[],
): UserMessage[] {
  const taken = takeFeedback(sessionId, config, trace)
  if (taken === undefined) return [...messages]
  commitFeedback(sessionId, taken.fingerprint)
  return [...messages, taken.message]
}

function appendSessionFeedback(agent: Agent, sessionId: string, config: ResolvedConfig, trace: DecisionTrace): void {
  const taken = takeFeedback(sessionId, config, trace)
  if (taken === undefined) return
  try {
    agent.session.append('user/message', taken.message, { surfaceOp: 'append' })
    commitFeedback(sessionId, taken.fingerprint)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'append failed'
    process.stderr.write(`dsh: verifier feedback failed: ${sanitizeCode(detail) || 'append-failed'}\n`)
  }
}

/** Draft for a thrown failure. The fingerprint stays unrecorded until the caller commits it. */
export function feedbackForThrown(
  sessionId: string,
  config: ResolvedConfig,
  error: unknown,
  point?: string,
): TakenFeedback[] {
  try {
    const prepared = prepareNoticeForError(sessionId, config.feedback, error, {
      platform: detectPlatform(),
      point,
    })
    if (prepared === undefined) return []
    return [{ fingerprint: prepared.fingerprint, message: feedbackNotice(prepared.text) }]
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'feedback failed'
    process.stderr.write(`dsh: verifier feedback failed: ${sanitizeCode(message) || 'feedback-failed'}\n`)
    return []
  }
}

/** The next main-agent assistant steps belong to a D4 steer until the turn moves on. */
export function armPostSteer(sessionId: string): void {
  postSteer.add(sessionId)
}

export function disarmPostSteer(sessionId: string): void {
  postSteer.delete(sessionId)
}

export function postSteerArmed(sessionId: string): boolean {
  return postSteer.has(sessionId)
}

const DEFAULT_JEV_URL = 'https://api.typesafe.ai'

/**
 * Score when a credential or an in-memory key is set, including on the schema's default URL.
 * An empty key on that URL stays fail-open so an unconfigured process does not call TypeSafe.
 */
async function judgeReady(ctx: Context, config: ResolvedConfig): Promise<boolean> {
  const key = await resolveJevApiKey(ctx, config)
  if (key !== '') return true
  return config.jev.baseUrl !== DEFAULT_JEV_URL
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
    scoreLevels: Object.fromEntries(INTAKE_QUESTIONS.flatMap(question => (
      question.kind === 'score' && question.levels !== undefined ? [[question.key, question.levels]] : []
    ))),
  }
}

async function billJev(sessionId: string, response: JevResponse): Promise<void> {
  const inputTokens = response.usage?.inputTokens ?? 0
  const outputTokens = response.usage?.outputTokens ?? 0
  const priced = priceJev(inputTokens, outputTokens)
  await addCostLine(sessionId, {
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

interface GeneratedCandidate {
  strategy: string
  candidate?: ParsedCandidate
  dropReason?: string
  overCap: boolean
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
  scope: CostScope,
  onOverCap: () => void,
): Promise<GeneratedCandidate> {
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
    if (signal.aborted) break
    if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
      throw new Error(chunk.reason.failure?.message ?? 'generator failed')
    }
    chunks.push(chunk)
    if (chunk.type === 'usage' && chunk.usage && !billed) {
      billed = true
      const priced = priceUsage(routeOf(provider, model), chunk.usage, costClock.now(), config.pricing)
      await addCostLine(sessionId, {
        source: 'generator',
        model: routeOf(provider, model),
        amountCny: priced.amountCny,
        nativeAmount: priced.nativeAmount,
        nativeCurrency: priced.nativeCurrency,
      })
      if (sessionSpendCny(sessionId, scope) >= cap) {
        overCap = true
        onOverCap()
      }
    }
    if (overCap) break
  }
  const text = chunks.flatMap(chunk => chunk.type === 'text-delta' && chunk.text ? [chunk.text] : []).join('')
  const inspected = inspectCandidate(text, strategy)
  if (inspected.dropReason !== undefined) {
    process.stderr.write(`dsh: verifier dropped candidate strategy=${strategy} reason=${inspected.dropReason}\n`)
  }
  return { strategy, candidate: inspected.candidate, dropReason: inspected.dropReason, overCap }
}

/**
 * K candidates at once, one shared model, distinct strategies.
 * Concurrency is K (2–5). Crossing the cap aborts the rest of the batch.
 */
async function generateCandidates(
  ctx: Context,
  config: ResolvedConfig,
  sessionId: string,
  provider: string,
  model: string,
  task: string,
  signal: AbortSignal,
  cap: number,
  scope: CostScope,
): Promise<{ items: GeneratedCandidate[]; overCap: boolean }> {
  const limiter = new AbortController()
  const stop = () => { limiter.abort() }
  if (signal.aborted) stop()
  else signal.addEventListener('abort', stop, { once: true })
  let overCap = false
  const strategies = strategiesFor(config.candidates)
  const items = await Promise.all(strategies.map(async (strategy) => {
    try {
      const generated = await generateOne(
        ctx, config, sessionId, provider, model, strategy, task, limiter.signal, cap, scope,
        () => { overCap = true; stop() },
      )
      if (generated.overCap) overCap = true
      return generated
    } catch (error) {
      const reason = limiter.signal.aborted && !signal.aborted
        ? 'aborted'
        : sanitizeCode(error instanceof Error ? error.message : 'generator failed') || 'generator-failed'
      if (reason !== 'aborted') {
        process.stderr.write(`dsh: verifier dropped candidate strategy=${strategy} reason=${reason}\n`)
      }
      return {
        strategy,
        overCap: sessionSpendCny(sessionId, scope) >= cap,
        dropReason: reason,
      }
    }
  }))
  signal.removeEventListener('abort', stop)
  return { items, overCap: overCap || (!signal.aborted && sessionSpendCny(sessionId, scope) >= cap) }
}

function candidateTraces(
  items: readonly GeneratedCandidate[],
  scored: readonly ScoredCandidate[] | undefined,
  rules: SelectionRules,
  unscoredReason?: string,
): CandidateTrace[] {
  return items.map((item) => {
    if (item.candidate === undefined) {
      return { id: item.strategy, strategy: item.strategy, kept: false, dropReason: item.dropReason ?? 'dropped' }
    }
    const score = scored?.find(row => row.candidate.id === item.candidate?.id)
    if (score === undefined) {
      if (unscoredReason !== undefined) {
        return {
          id: item.candidate.id,
          strategy: item.strategy,
          kept: false,
          title: item.candidate.title,
          dropReason: unscoredReason,
        }
      }
      return {
        id: item.candidate.id,
        strategy: item.strategy,
        kept: true,
        title: item.candidate.title,
        ...item.dropReason === undefined ? {} : { dropReason: item.dropReason },
      }
    }
    const detail = scoreCandidate(score, rules)
    return {
      id: item.candidate.id,
      strategy: item.strategy,
      kept: detail.eligible,
      title: item.candidate.title,
      composite: detail.composite,
      confidence: detail.confidence,
      eligible: detail.eligible,
      ...detail.eligible ? {} : { dropReason: detail.reason ?? 'rejected', reason: detail.reason },
    }
  })
}

async function pause(
  sessionId: string,
  config: ResolvedConfig,
  spent: number,
  cap: { amount: number; model: string },
  messages: UserMessage[],
  alreadyPaused: boolean,
  point: 'intake' | 'audit' = 'intake',
  candidates?: CandidateTrace[],
): Promise<UserMessage[]> {
  const scope = config.cost.scope
  const counted = countedSourceLabel(scope)
  if (alreadyPaused) return messages
  const trace: DecisionTrace = {
    point,
    outcome: 'cost-cap',
    spentCny: spent,
    cap: cap.amount,
    capModel: cap.model,
    countedSources: counted,
    ...candidates === undefined ? {} : { candidates },
  }
  await pushTrace(sessionId, trace)
  process.stderr.write(`dsh: verifier paused cost-cap spent=${spent.toFixed(2)} cap=${cap.amount.toFixed(2)} model=${cap.model} counted=${counted}\n`)
  return withFeedback(sessionId, config, trace, [...messages, costCapNotice(spent, cap.amount, cap.model, counted)])
}

async function skipGate(
  sessionId: string,
  turn: number,
  decision: EnterDecision,
  reason: 'command' | 'trivial' | 'single-step' | 'gate-failed',
  config: ResolvedConfig,
  detail?: string,
): Promise<EnterDecision> {
  if (reason === 'command' || reason === 'trivial') skipAudit.add(`${sessionId}:${turn}`)
  const recorded = reason === 'gate-failed' && detail !== undefined && detail !== ''
    ? `gate-failed: ${detail}`
    : reason
  const trace: DecisionTrace = { point: 'gate', outcome: 'skipped', reason: recorded }
  await pushTrace(sessionId, trace)
  const promiseAudit = config.audit && (reason === 'single-step' || reason === 'gate-failed')
  return {
    ...decision,
    messages: withFeedback(sessionId, config, trace, [...decision.messages, intakeSkipNotice(reason, promiseAudit)]),
  }
}

export async function runIntake(
  ctx: Context,
  config: ResolvedConfig,
  agent: Agent,
  turn: number,
  signal: AbortSignal,
  decision: EnterDecision,
): Promise<EnterDecision> {
  await ensureUsageStore(ctx)
  const sessionId = sessionKey(agent.session.id)
  // A new user turn starts here. Earlier post-steer steps are already billed.
  disarmPostSteer(sessionId)
  const state = ctx.sessionProjections.stateOf(agent.session, 'verifier')
  const effective = state?.active === true || state?.onceArmed === true
  if (!effective || !config.intake) return decision
  if (planActive(ctx, agent)) return decision

  const scope = config.cost.scope
  if (config.intakeGate !== 'always') {
    const why = deterministicSkip(userTurnFacts(decision.messages))
    if (why !== undefined) return skipGate(sessionId, turn, decision, why, config)
  }

  const current = readCurrentRoute(ctx.sessionProjections, agent.session, agent.options)
  const mainRoute = routeOf(current.provider, current.model)
  const generator = config.generatorRoute ?? { provider: current.provider, model: current.model }
  const generatorRoute = routeOf(generator.provider, generator.model)
  const cap = resolveCap(mainRoute, config.cost, config.pricing.aliases)
  let spent = sessionSpendCny(sessionId, scope)
  // Already at the cap: pause before the cheap gate and before an approved plan runs.
  // The K-candidate reserve waits until the gate has said yes.
  if (spent >= cap.amount) {
    return { ...decision, messages: await pause(sessionId, config, spent, cap, decision.messages, state?.paused === true) }
  }

  let messages = decision.messages
  if (state?.paused === true) {
    messages = [...messages, costResumeNotice(spent, cap.amount, cap.model)]
  }
  if (state?.approvedPlan) return { ...decision, messages }
  if (!await judgeReady(ctx, config)) {
    const trace: DecisionTrace = { point: 'intake', outcome: 'fallback', reason: 'jev is not configured' }
    await pushTrace(sessionId, trace)
    return { ...decision, messages: withFeedback(sessionId, config, trace, [...messages, fallbackNotice(trace.reason ?? '')]) }
  }

  const task = clipTask(textOf(messages))
  const facts = userTurnFacts(messages)
  if (config.intakeGate !== 'always') {
    if (facts.hasAttachment && facts.text.trim() === '') {
      await pushTrace(sessionId, { point: 'gate', outcome: 'passed', reason: 'attachment' })
    } else {
      let gate: 'yes' | 'no' | 'failed' | 'cap' = 'failed'
      let gateStatus = 'missing answer'
      try {
        const response = await postJev(config.jev.baseUrl, await resolveJevApiKey(ctx, config), {
          point: 'gate',
          state: { task: clipTask(facts.text), constraints: [], evidence: '' },
          questions: [GATE_QUESTION],
        }, signal, config.jev.timeoutMs)
        await billJev(sessionId, response)
        if (sessionSpendCny(sessionId, scope) >= cap.amount) gate = 'cap'
        else {
          const answer = response.answers.needs_multi_step_work
          if (answer === undefined || !Number.isFinite(answer.value)) {
            gate = 'failed'
            gateStatus = 'missing answer'
          } else gate = answer.value >= INTAKE_GATE_THRESHOLD ? 'yes' : 'no'
        }
      } catch (error) {
        gate = 'failed'
        gateStatus = error instanceof Error ? error.message : 'jev failed'
      }
      if (gate === 'cap') {
        return { ...decision, messages: await pause(sessionId, config, sessionSpendCny(sessionId, scope), cap, messages, false) }
      }
      if (gate === 'no') return skipGate(sessionId, turn, { ...decision, messages }, 'single-step', config)
      if (gate === 'failed') return skipGate(sessionId, turn, { ...decision, messages }, 'gate-failed', config, gateStatus)
    }
  }

  spent = sessionSpendCny(sessionId, scope)
  const estimate = estimateIntakeCny(config.candidates, config.candidateMaxTokens, generatorRoute, costClock.now(), config.pricing)
  if (spent + estimate > cap.amount) {
    return { ...decision, messages: await pause(sessionId, config, spent, cap, messages, state?.paused === true) }
  }

  const evidence = delimitEvidence(readJudgeDigest(ctx.sessionProjections, agent.session), freshNonce())
  if (ctx.get('llm') === undefined) throw new Error('llm service is unavailable')
  const generated = await generateCandidates(
    ctx, config, sessionId, generator.provider, generator.model, task, signal, cap.amount, scope,
  )
  if (signal.aborted) {
    await pushTrace(sessionId, { point: 'intake', outcome: 'skipped', reason: 'aborted', candidates: candidateTraces(generated.items, undefined, intakeRules(config)) })
    return { ...decision, messages }
  }
  if (generated.overCap) {
    return {
      ...decision,
      messages: await pause(
        sessionId,
        config,
        sessionSpendCny(sessionId, scope),
        cap,
        messages,
        false,
        'intake',
        candidateTraces(generated.items, undefined, intakeRules(config), 'cost-cap'),
      ),
    }
  }
  const parsed = generated.items.flatMap(item => item.candidate === undefined ? [] : [item.candidate])
  const rules = intakeRules(config)
  if (parsed.length < 2) {
    const dropped = generated.items.flatMap(item => item.dropReason === undefined ? [] : [`${item.strategy} ${item.dropReason}`]).join('; ')
    const trace: DecisionTrace = {
      point: 'intake',
      outcome: 'fallback',
      reason: 'fewer than 2 candidates',
      candidates: candidateTraces(generated.items, undefined, rules),
    }
    await pushTrace(sessionId, trace)
    return { ...decision, messages: withFeedback(sessionId, config, trace, [...messages, fallbackNotice('fewer than 2 candidates', dropped)]) }
  }

  const scored: ScoredCandidate[] = []
  try {
    for (const candidate of parsed) {
      const response = await postJev(config.jev.baseUrl, await resolveJevApiKey(ctx, config), {
        point: 'intake',
        state: { task, constraints: [], evidence, candidate },
        questions: INTAKE_QUESTIONS,
      }, signal, config.jev.timeoutMs)
      await billJev(sessionId, response)
      if (sessionSpendCny(sessionId, scope) >= cap.amount) {
        return {
          ...decision,
          messages: await pause(
            sessionId,
            config,
            sessionSpendCny(sessionId, scope),
            cap,
            messages,
            false,
            'intake',
            candidateTraces(generated.items, scored, rules, 'cost-cap'),
          ),
        }
      }
      scored.push({ candidate, answers: response.answers })
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'jev failed'
    const trace: DecisionTrace = {
      point: 'intake',
      outcome: 'fallback',
      reason,
      candidates: candidateTraces(generated.items, scored, rules, 'scoring-failed'),
    }
    await pushTrace(sessionId, trace)
    return { ...decision, messages: withFeedback(sessionId, config, trace, [...messages, fallbackNotice(reason)]) }
  }

  const summary = scoreSummary(scored, rules)
  const selected = selectWinner(scored, rules)
  if (selected.kind === 'fallback') {
    const trace: DecisionTrace = {
      point: 'intake',
      outcome: 'fallback',
      reason: selected.reason,
      candidates: candidateTraces(generated.items, scored, rules),
    }
    await pushTrace(sessionId, trace)
    return { ...decision, messages: withFeedback(sessionId, config, trace, [...messages, fallbackNotice(selected.reason, summary)]) }
  }
  turnStrategy.set(`${sessionId}:${turn}`, selected.candidate.acceptance)
  await pushTrace(sessionId, {
    point: 'intake',
    outcome: 'committed',
    winner: selected.candidate.title,
    reason: summary,
    spentCny: sessionSpendCny(sessionId, scope),
    cap: cap.amount,
    capModel: cap.model,
    countedSources: countedSourceLabel(scope),
    candidates: candidateTraces(generated.items, scored, rules),
  })
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
  await ensureUsageStore(ctx)
  const state = ctx.sessionProjections.stateOf(agent.session, 'verifier')
  const effective = state?.active === true || state?.onceArmed === true
  if (!effective || !config.audit || state?.paused === true || planActive(ctx, agent) || !await judgeReady(ctx, config)) return
  const sessionId = sessionKey(agent.session.id)
  if (skipAudit.has(`${sessionId}:${turn}`)) {
    await pushTrace(sessionId, { point: 'audit', outcome: 'skipped', reason: 'intake-gate' })
    return
  }
  const current = readCurrentRoute(ctx.sessionProjections, agent.session, agent.options)
  const cap = resolveCap(routeOf(current.provider, current.model), config.cost, config.pricing.aliases)
  const scope = config.cost.scope
  const spent = sessionSpendCny(sessionId, scope)
  if (spent >= cap.amount) {
    disarmPostSteer(sessionId)
    if (state?.paused !== true) {
      const counted = countedSourceLabel(scope)
      const trace: DecisionTrace = { point: 'audit', outcome: 'cost-cap', spentCny: spent, cap: cap.amount, capModel: cap.model, countedSources: counted }
      await pushTrace(sessionId, trace)
      agent.session.append('user/message', costCapNotice(spent, cap.amount, cap.model, counted), { surfaceOp: 'append' })
      process.stderr.write(`dsh: verifier paused cost-cap spent=${spent.toFixed(2)} cap=${cap.amount.toFixed(2)} model=${cap.model} counted=${counted}\n`)
      appendSessionFeedback(agent, sessionId, config, trace)
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
    const response = await postJev(config.jev.baseUrl, await resolveJevApiKey(ctx, config), {
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
    await billJev(sessionId, response)
    if (sessionSpendCny(sessionId, scope) >= cap.amount) {
      disarmPostSteer(sessionId)
      const counted = countedSourceLabel(scope)
      const now = sessionSpendCny(sessionId, scope)
      const trace: DecisionTrace = { point: 'audit', outcome: 'cost-cap', spentCny: now, cap: cap.amount, capModel: cap.model, countedSources: counted }
      await pushTrace(sessionId, trace)
      if (state?.paused !== true) {
        agent.session.append('user/message', costCapNotice(now, cap.amount, cap.model, counted), { surfaceOp: 'append' })
        process.stderr.write(`dsh: verifier paused cost-cap spent=${now.toFixed(2)} cap=${cap.amount.toFixed(2)} model=${cap.model} counted=${counted}\n`)
        appendSessionFeedback(agent, sessionId, config, trace)
      }
      return
    }
    failed = auditQuestions(acceptance).flatMap((question) => {
      if (question.kind !== 'noul') return []
      const answer = response.answers[question.key]
      return answer !== undefined && answer.value >= config.thresholds.violation ? [question.key] : []
    })
  } catch (error) {
    disarmPostSteer(sessionId)
    const trace: DecisionTrace = { point: 'audit', outcome: 'fallback', reason: error instanceof Error ? error.message : 'jev failed' }
    await pushTrace(sessionId, trace)
    appendSessionFeedback(agent, sessionId, config, trace)
    return
  }
  if (failed.length === 0) {
    disarmPostSteer(sessionId)
    await pushTrace(sessionId, { point: 'audit', outcome: 'passed' })
    return
  }
  const used = steers.get(`${sessionId}:${turn}`) ?? 0
  if (used < config.maxAuditRounds) {
    steers.set(`${sessionId}:${turn}`, used + 1)
    armPostSteer(sessionId)
    await pushTrace(sessionId, { point: 'audit', outcome: 'steered', reason: failed.join(',') })
    agent.steer(steerNotice(failed))
    return
  }
  disarmPostSteer(sessionId)
  await pushTrace(sessionId, { point: 'audit', outcome: 'incomplete', reason: failed.join(',') })
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
  await ensureUsageStore(ctx)
  const state = ctx.sessionProjections.stateOf(agent.session, 'verifier')
  const armed = state?.active === true || state?.onceArmed === true
  if (!armed || config.planReview !== 'advise' || state?.paused === true || !await judgeReady(ctx, config)) return
  const sessionId = sessionKey(agent.session.id)
  const current = readCurrentRoute(ctx.sessionProjections, agent.session, agent.options)
  const cap = resolveCap(routeOf(current.provider, current.model), config.cost, config.pricing.aliases)
  const spent = sessionSpendCny(sessionId, config.cost.scope)
  if (spent >= cap.amount) {
    const trace: DecisionTrace = {
      point: 'plan',
      outcome: 'cost-cap',
      spentCny: spent,
      cap: cap.amount,
      capModel: cap.model,
      countedSources: countedSourceLabel(config.cost.scope),
    }
    await pushTrace(sessionId, trace)
    appendSessionFeedback(agent, sessionId, config, trace)
    return
  }
  const task = clipTask(plan)
  const evidence = delimitEvidence(plan, freshNonce())
  try {
    const response = await postJev(config.jev.baseUrl, await resolveJevApiKey(ctx, config), {
      point: 'plan',
      state: { task, constraints: [], evidence, plan, candidate: { id: 'plan', title: 'submitted plan', steps: [plan], acceptance: [plan], risks: [] } },
      questions: INTAKE_QUESTIONS,
    }, signal, config.jev.timeoutMs)
    await billJev(sessionId, response)
    const selected = selectWinner([{
      candidate: { id: 'plan', title: 'submitted plan', steps: [plan], acceptance: [plan], risks: [] },
      answers: response.answers,
    }], intakeRules(config))
    const summary = selected.kind === 'winner'
      ? `composite ${selected.composite.toFixed(2)}, confidence ${selected.confidence.toFixed(2)}`
      : selected.reason
    planNotes.set(callId, [planScoreNotice(summary)])
    await pushTrace(sessionId, { point: 'plan', outcome: 'plan-score', reason: summary })
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'jev failed'
    const trace: DecisionTrace = { point: 'plan', outcome: 'fallback', reason }
    await pushTrace(sessionId, trace)
    planNotes.set(callId, [planScoreNotice(reason)])
    appendSessionFeedback(agent, sessionId, config, trace)
  }
}

export function takePlanNotes(callId: string): UserMessage[] {
  const notes = planNotes.get(callId)
  if (notes !== undefined) planNotes.delete(callId)
  return notes ?? []
}

/** Bill one main-agent step that follows a D4 steer. Ordinary main usage is not billed. */
export async function billAssistantUsage(
  sessionId: string,
  provider: string,
  model: string,
  usage: TokenUsage,
  table: ResolvedConfig['pricing'],
): void {
  const priced = priceUsage(routeOf(provider, model), usage, costClock.now(), table)
  await addCostLine(sessionId, {
    source: 'post-steer',
    model: routeOf(provider, model),
    amountCny: priced.amountCny,
    nativeAmount: priced.nativeAmount,
    nativeCurrency: priced.nativeCurrency,
  })
}
