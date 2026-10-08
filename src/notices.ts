/**
 * Logged user-role notices. Model-visible text is written to the session log;
 * a pre-step listener may also hand the same message to the loop so the
 * current step sees it.
 */
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'verifier-mode': { kind: 'verifier-mode' } & ContextFormed
  }
}

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
