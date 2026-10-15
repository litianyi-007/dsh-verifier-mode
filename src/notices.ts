/**
 * Logged user-role notices. Model-visible text is written to the session log;
 * a pre-step listener may also hand the same message to the loop so the
 * current step sees it.
 */
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Candidate } from './selector.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'verifier-mode': { kind: 'verifier-mode' } & ContextFormed
  }
}

export const COST_CAP_MARK = '[verifier cost-cap]'
export const COST_RESUME_MARK = '[verifier cost-resume]'

/** One-line notice the session log and the model request can both carry. */
export function verifierNotice(text: string, summary: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'verifier-mode',
      form: 'notice',
      summary: boundContextSummary(summary),
    },
  })
}

/** Notice appended when `/verifier on|off` commits. */
export function verifierModeNotice(active: boolean): UserMessage {
  return verifierNotice(
    active
      ? '[verifier mode on] Candidate generation and scoring apply to later steps.'
      : '[verifier mode off] Candidate generation and scoring are off.',
    active ? 'verifier mode on' : 'verifier mode off',
  )
}

export function decisionNotice(candidate: Candidate, composite: number, confidence: number): UserMessage {
  const acceptance = candidate.acceptance.map(item => `- ${item}`).join('\n')
  return verifierNotice(
    [
      `[verifier decision] selected ${candidate.title} (composite ${composite.toFixed(2)}, confidence ${confidence.toFixed(2)})`,
      'acceptance:',
      acceptance,
    ].join('\n'),
    `selected ${candidate.title}`,
  )
}

export function fallbackNotice(reason: string, summary?: string): UserMessage {
  const detail = summary === undefined || summary === '' ? '' : ` ${summary}`
  return verifierNotice(
    `[verifier fallback] Verifier could not decide: ${reason}.${detail}`,
    'verifier could not decide',
  )
}

/** One line when the intake gate skips multi-candidate generation. */
export function intakeSkipNotice(reason: 'command' | 'trivial' | 'single-step' | 'gate-failed', auditOn: boolean): UserMessage {
  const audit = auditOn ? '完成时仍会审计。' : ''
  const line = reason === 'command'
    ? `[verifier skip] 这是斜杠命令，不生成多方案。${audit}`
    : reason === 'trivial'
      ? `[verifier skip] 这轮是闲聊或确认，不生成多方案。${audit}`
      : reason === 'single-step'
        ? `[verifier skip] 不需要多步改动，按普通路径执行。${audit}`
        : `[verifier skip] 入口判断失败，按普通路径执行。${audit}`
  return verifierNotice(line, 'verifier skipped intake')
}

export function costCapNotice(spent: number, cap: number, model: string, counted: string): UserMessage {
  return verifierNotice(
    `${COST_CAP_MARK} spent ${spent.toFixed(2)} cap ${cap.toFixed(2)} CNY model ${model}. Counted: ${counted}. Ordinary main-loop usage is excluded. Verifier is paused; continue on the normal path.`,
    'verifier paused cost cap',
  )
}

export function costResumeNotice(spent: number, cap: number, model: string): UserMessage {
  return verifierNotice(
    `${COST_RESUME_MARK} spent ${spent.toFixed(2)} cap ${cap.toFixed(2)} CNY model ${model}. Verifier is running again.`,
    'verifier cost resume',
  )
}

export function planScoreNotice(summary: string): UserMessage {
  return verifierNotice(`[verifier plan-score] ${summary}`, 'verifier plan score')
}

export function steerNotice(failed: readonly string[]): UserMessage {
  return verifierNotice(
    `[verifier audit] unmet: ${failed.join(', ')}. Fix those items and finish.`,
    'verifier audit failed',
  )
}

export function incompleteNotice(failed: readonly string[]): UserMessage {
  return verifierNotice(
    `[verifier incomplete] still unmet after one steer: ${failed.join(', ')}`,
    'verifier audit incomplete',
  )
}
