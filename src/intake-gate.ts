/**
 * Deterministic half of the D1 intake gate (design §3.2).
 * Only clearly non-work turns are skipped here. Anything else goes to the
 * cheap `needs_multi_step_work` Noul. This is not a category classifier.
 */

/** Noul at or above this value means the turn needs multi-step work. */
export const INTAKE_GATE_THRESHOLD = 0.5

export type DeterministicSkip = 'command' | 'trivial'

const ACKNOWLEDGMENTS = new Set([
  'hi', 'hello', 'hey', 'yo', 'ok', 'okay', 'k', 'yes', 'no', 'yep', 'nope',
  'thanks', 'thank you', 'thx', 'ty', 'np',
  '你好', '您好', '嗨', '谢谢', '感谢', '多谢', '好的', '好', '嗯', '哦', '噢',
  '收到', '明白', '知道了', '行', '可以', '不行', '是', '不是', '对', '不对',
  '嗯嗯', '哈哈', 'ok的', '好呀', '好啊',
])

export interface TurnFacts {
  text: string
  hasAttachment: boolean
}

/** Latest user-authored text. Notices and context blocks are not the request. */
export function userTurnFacts(
  messages: readonly { source?: { kind?: string }; content?: readonly { type: string; text?: string }[] }[],
): TurnFacts {
  const authored = messages.filter(message => message.source?.kind === 'user' || message.source?.kind === undefined)
  const source = authored.length > 0 ? authored : messages
  let hasAttachment = false
  const text = source.flatMap(message => message.content ?? []).flatMap((block) => {
    if (block.type === 'text' && block.text) return [block.text]
    if (block.type !== 'text') hasAttachment = true
    return []
  }).join('\n')
  return { text, hasAttachment }
}

function normalizedAck(text: string): string {
  return text.trim().replace(/[!！.。,，?？~～\s]+$/gu, '').toLowerCase()
}

/**
 * Skip only turns that are obviously not work.
 * An attachment is a work signal, so it is not treated as chit-chat.
 * Short repair requests such as "修 bug" are left for the Noul.
 */
export function deterministicSkip(facts: TurnFacts): DeterministicSkip | undefined {
  const trimmed = facts.text.trim()
  if (facts.hasAttachment && trimmed === '') return undefined
  if (trimmed.startsWith('/')) return 'command'
  if (facts.hasAttachment) return undefined
  if (trimmed === '') return 'trivial'
  const ack = normalizedAck(trimmed)
  if (ACKNOWLEDGMENTS.has(ack) || ACKNOWLEDGMENTS.has(trimmed)) return 'trivial'
  if (!/\p{L}|\p{N}/u.test(trimmed)) return 'trivial'
  return undefined
}
