/**
 * Judge-facing digest of a session log. Built only from `agent.session`
 * events, so a reloaded seed produces the same text.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function textOf(blocks: readonly { type: string; text?: string }[]): string {
  return blocks.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('')
}

/** Stable multiline digest: user text, assistant text, and tool-result text. */
export function summarizeSession(events: readonly SessionEvent[]): string {
  const lines: string[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      lines.push(`user: ${textOf(event.data.content)}`)
    } else if (event.type === 'assistant/message') {
      lines.push(`assistant: ${textOf(event.data.message.content)}`)
    } else if (event.type === 'tool/result') {
      const flag = event.data.message.isError === true ? 'error' : 'ok'
      lines.push(`tool ${flag}: ${textOf(event.data.message.content)}`)
    }
  }
  return lines.join('\n')
}
